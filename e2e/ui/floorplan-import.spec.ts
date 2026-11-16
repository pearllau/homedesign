import { test, expect, type Page } from "@playwright/test";
import { deflateSync } from "node:zlib";
import { recognizedGeometry } from "../fixtures/recognized-plan";

function png(width = 1000, height = 800) {
  const chunk = (name: string, data: Buffer) => {
    const type = Buffer.from(name), bytes = Buffer.concat([type, data]);
    let crc = 0xffffffff;
    for (const byte of bytes) { crc ^= byte; for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, bytes, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc((width * 3 + 1) * height, 255);
  for (let row = 0; row < height; row++) pixels[row * (width * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}

const uploadFile = { name: recognizedGeometry.source.name, mimeType: "image/png", buffer: png() };
const frameSelector = 'iframe[title="户型设计与 3D 预览"]';

async function uploadFromHomeCard(page: Page) {
  const chooser = page.waitForEvent("filechooser");
  await page.locator(".home-upload-entry").click();
  await chooser.then(chooser => chooser.setFiles(uploadFile));
  return page.getByRole("dialog");
}

test("首页卡片直接唤起文件选择，选图后自动识别并进入工作台", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  let requests = 0;
  await page.route("**/api/floorplan/recognize*", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { ready: true } });
    requests++;
    const input = route.request().postDataJSON();
    // 识别图统一缩到 896px 长边，并且只编码一次带参考网格的 JPEG。
    expect(input).toMatchObject({ name: uploadFile.name, width: 896, height: 717 });
    expect(input.image).toMatch(/^data:image\/jpeg;base64,/);
    await route.fulfill({ json: { geometry: recognizedGeometry } });
  });
  await page.goto("/");
  // 首页卡片不再弹出二级浮层：点击即打开系统文件选择框。
  const dialog = await uploadFromHomeCard(page);
  await expect(dialog).toBeHidden();
  await expect(page.locator(".studio-views")).toHaveAttribute("data-view", "design");
  await expect(page.locator(frameSelector)).toBeVisible();
  expect(requests).toBe(1);
  await expect(page.frameLocator(frameSelector).locator("#plan")).toContainText("客厅");
});

test("识别等待中只给阶段文案，不显示计时和虚假进度", async ({ page }) => {
  await page.route("**/api/floorplan/recognize*", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { ready: true } });
    await new Promise(resolve => setTimeout(resolve, 1200));
    await route.fulfill({ json: { geometry: recognizedGeometry } });
  });
  await page.goto("/");
  const dialog = await uploadFromHomeCard(page);
  await expect(dialog.locator(".floorplan-scan-text")).toContainText(/正在(上传户型图|识别墙体与房间)…/);
  await expect(dialog.locator(".floorplan-scan-timer")).toHaveCount(0);
  await expect(dialog.locator(".floorplan-scan-progress")).toHaveCount(0);
  await expect(dialog.locator(".floorplan-scan-hint")).toHaveCount(0);
  await expect(dialog).toBeHidden();
});

test("识别失败时给出错误并允许重试，关闭后回到空白首页", async ({ page }) => {
  await page.route("**/api/floorplan/recognize*", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { ready: true } });
    await route.fulfill({ status: 422, json: { error: "图片无法识别，请重试" } });
  });
  await page.goto("/");
  const dialog = await uploadFromHomeCard(page);
  await expect(dialog.getByRole("alert")).toContainText("图片无法识别，请重试");
  await expect(dialog.getByRole("button", { name: "重新识别", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "关闭户型图上传" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: "说出你的装修需求" })).toBeVisible();
});

test("取消识别会中止请求并回到可操作的上传状态", async ({ page }) => {
  await page.addInitScript(() => {
    const nativeFetch = window.fetch;
    const control = window as typeof window & { floorplanWasAborted?: boolean };
    window.fetch = async (input, init) => {
      const url = String(input);
      if (!url.includes("/api/floorplan/recognize") || (init?.method || "GET").toUpperCase() !== "POST") return nativeFetch(input, init);
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => { control.floorplanWasAborted = true; reject(new DOMException("Aborted", "AbortError")); }, { once: true });
      });
    };
  });
  await page.route("**/api/floorplan/recognize*", route => route.fulfill({ json: { ready: true } }));
  await page.goto("/");
  const dialog = await uploadFromHomeCard(page);
  // 识别等待时收起上传栏与导航，只留居中的扫描卡片。
  await expect(dialog.locator(".floorplan-scan-card")).toBeVisible();
  await expect(dialog.locator(".floorplan-import-sidebar")).toHaveCount(0);
  await dialog.getByRole("button", { name: "取消识别", exact: true }).first().click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { floorplanWasAborted?: boolean }).floorplanWasAborted)).toBe(true);
  await expect(dialog.getByRole("button", { name: "重新识别", exact: true })).toBeEnabled();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByRole("button", { name: "关闭户型图上传" }).click();
  await expect(page.getByRole("heading", { name: "说出你的装修需求" })).toBeVisible();
});

test("视觉服务未配置时立即报错，而不是等识别超时", async ({ page }) => {
  await page.route("**/api/floorplan/recognize*", route => route.fulfill({ status: 503, json: { error: "户型识别服务还没有配置，请先设置 VISION_API_KEY 与 VISION_MODEL。", code: "vision_not_configured" } }));
  await page.goto("/");
  const dialog = await uploadFromHomeCard(page);
  await expect(dialog.getByRole("alert")).toContainText("户型识别服务还没有配置");
});

test("工作台的测量抽屉里提供单墙定标尺", async ({ page }) => {
  await page.route("**/api/floorplan/recognize*", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { ready: true } });
    await route.fulfill({ json: { geometry: recognizedGeometry } });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  const dialog = await uploadFromHomeCard(page);
  await expect(dialog).toBeHidden();
  const frame = page.frameLocator(frameSelector);
  await expect(frame.locator("#plan")).toContainText("客厅");
  await frame.locator("#drawMeasure > summary").click();
  const hint = frame.locator("#calibHint");
  await expect(hint).toContainText("在图上点一下那面已知长度的墙");
  await frame.locator("#calibPick").click();
  await expect(hint).toContainText("点选一面已知长度的墙");
  await frame.locator("#calibPick").click();
  await expect(hint).toContainText("在图上点一下那面已知长度的墙");
  await expect(frame.locator("#calibApply")).toBeDisabled();
});
