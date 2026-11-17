import { test, expect, type Locator, type Page } from "@playwright/test";
import { deflateSync } from "node:zlib";
import type { FloorPlanGeometry, Point } from "../../src/shared/floorplan-geometry";
import type { Plan } from "../../src/shared/plan-data";
import { recognizedGeometry, recognizedPlan } from "../fixtures/recognized-plan";

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
const uncalibratedGeometry: FloorPlanGeometry = { ...recognizedGeometry, calibration: null, confirmed: false };

function planWithGeometry(geometry: FloorPlanGeometry, base: Plan = recognizedPlan): Plan {
  return { ...base, floorPlan: geometry };
}

async function mockChatPlan(page: Page, getPlan: (prompt: string) => Plan) {
  await page.route("**/api/chat", async route => {
    const body = route.request().postDataJSON();
    const prompt = body.messages.at(-1)?.parts?.map((part: { text?: string }) => part.text || "").join("") || "";
    const text = JSON.stringify(getPlan(prompt));
    const events = [
      { type: "start", messageId: `reply-${body.messages.length}` },
      { type: "text-start", id: "text" },
      { type: "text-delta", id: "text", delta: text },
      { type: "text-end", id: "text" },
      { type: "finish", finishReason: "stop" },
    ];
    await route.fulfill({ contentType: "text/event-stream", headers: { "x-vercel-ai-ui-message-stream": "v1" }, body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n" });
  });
}

async function generatePlan(page: Page, prompt = "打开测试方案") {
  await page.getByRole("textbox", { name: "装修需求" }).fill(prompt);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator(frameSelector)).toBeVisible();
}

async function upload(page: Page) {
  const homeEntry = page.locator(".home-upload-entry");
  if (await homeEntry.isVisible()) {
    await homeEntry.click();
  } else {
    if (await page.getByRole("button", { name: "返回对话", exact: true }).isVisible()) {
      await page.getByRole("button", { name: "返回对话", exact: true }).click();
    }
    await page.getByTestId("plan-card").last().getByRole("button", { name: "上传户型图", exact: true }).click();
  }
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[type="file"]').first().setInputFiles(uploadFile);
  return dialog;
}

async function recognize(page: Page) {
  const dialog = await upload(page);
  await expect(dialog).toBeHidden({ timeout: 30000 });
  await expect(page.locator(".studio-views")).toHaveAttribute("data-view", "design");
  await expect(page).toHaveURL(/\/design$/);
  return dialog;
}

async function screenPoint(svg: Locator, point: Point) {
  return svg.evaluate((node, value) => {
    const element = node as SVGSVGElement, location = element.createSVGPoint();
    location.x = value[0]; location.y = value[1];
    const transformed = location.matrixTransform(element.getScreenCTM()!);
    return { x: transformed.x, y: transformed.y };
  }, point);
}

async function clickPoint(page: Page, svg: Locator, point: Point) {
  const screen = await screenPoint(svg, point);
  await page.mouse.click(screen.x, screen.y);
}

async function savedPlan(page: Page) {
  return page.locator(frameSelector).evaluate(frame => {
    const encoded = new URL((frame as HTMLIFrameElement).src).hash.slice("#plan=".length);
    return JSON.parse(decodeURIComponent(encoded)) as Plan & { floorPlan: FloorPlanGeometry };
  });
}

async function openCalibration(page: Page) {
  await page.getByRole("button", { name: "返回对话", exact: true }).click();
  const planCard = page.getByTestId("plan-card").last();
  await planCard.getByRole("button", { name: "校准校对", exact: true }).click();
  const editor = page.locator(".floorplan-import-backdrop.is-review .floorplan-import");
  await expect(editor).toBeVisible();
  return editor;
}

test("上传后自动识别并直达 2D/3D 工作台，不恢复旧会话", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  let requests = 0;
  await page.route("**/api/floorplan/recognize", async route => {
    requests++;
    const input = route.request().postDataJSON();
    expect(input).toMatchObject({ name: uploadFile.name, width: 1000, height: 800 });
    expect(input.image).toMatch(/^data:image\/jpeg;base64,/);
    await route.fulfill({ json: { geometry: { ...recognizedGeometry, warnings: ["请核对入户门位置。"] } } });
  });
  await page.goto("/");
  const dialog = await recognize(page);
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: "户型校准与描图" })).toHaveCount(0);
  const frame = page.frameLocator(frameSelector);
  await expect(frame.locator("#plan")).toContainText("客厅");
  await expect(frame.locator("#gRooms polygon.room")).toHaveCount(2);
  expect((await frame.locator('#gRooms polygon[data-room="living"]').getAttribute("points"))?.split(" ")).toHaveLength(7);
  await frame.getByRole("button", { name: "3D 场景", exact: true }).click();
  await expect(frame.locator("body")).toHaveClass(/m3d/);
  await expect(frame.locator("canvas")).toBeVisible();
  const result = await savedPlan(page);
  expect(result.floorPlan.outline).toEqual(recognizedGeometry.outline);
  expect(result.floorPlan.rooms).toEqual(recognizedGeometry.rooms);
  expect(requests).toBe(1);
  await page.getByRole("button", { name: "返回对话", exact: true }).click();
  await expect(page.getByText(`已导入户型图：${uploadFile.name}`, { exact: true })).toBeVisible();
  await page.getByTestId("plan-card").getByRole("button", { name: "查看户型", exact: true }).click();
  await expect(page.locator(frameSelector)).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "说出你的装修需求" })).toBeVisible();
  await expect(page.locator(frameSelector)).toHaveCount(0);
});

test("重新校对保留计价建筑面积、预算和方案说明，房间改名继续保留原家具", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const sourcePlan: Plan = {
    ...recognizedPlan,
    totalArea: 98,
    highlights: ["保留原始墙体", "按建筑面积计价"],
    budget: { total: 168000, items: [
      { category: "硬装", item: "按建筑面积计价", cost: 118000 },
      { category: "家具", item: "原有家具配置", cost: 50000 },
    ] },
    rooms: recognizedPlan.rooms.map((room, index) => ({ ...room, notes: index === 0 ? "保留现有沙发与通道" : "保留床和阅读空间" })),
  };
  sourcePlan.floorPlan = uncalibratedGeometry;
  await mockChatPlan(page, () => sourcePlan);
  let recognitionRequests = 0;
  await page.route("**/api/floorplan/recognize", route => { recognitionRequests++; return route.abort(); });
  await page.goto("/");
  await generatePlan(page);
  const correction = await openCalibration(page);
  const properties = correction.locator(".floorplan-properties");
  await expect(correction.getByRole("button", { name: "确认并生成 2D / 3D", exact: true })).toBeDisabled();
  await properties.getByLabel("选择图元").selectOption("room:living");
  await properties.getByLabel("房间名称").fill("家庭起居室");
  await properties.getByLabel("选择图元").selectOption("opening:door1");
  await properties.getByLabel("距墙起点（%）").fill("45");
  await properties.getByLabel("占墙长度（%）").fill("25");
  const svg = correction.locator(".floorplan-review-canvas");
  await correction.getByRole("button", { name: "尺寸校准", exact: true }).click();
  await clickPoint(page, svg, [150, 100]); await clickPoint(page, svg, [900, 100]);
  await correction.getByLabel("参考长度（米）").fill("7.5");
  await correction.getByRole("button", { name: "确认尺寸", exact: true }).click();
  await correction.getByRole("button", { name: "确认并生成 2D / 3D", exact: true }).click();
  await expect(correction).toBeHidden();
  const renamed = await savedPlan(page);
  expect(renamed.floorPlan.rooms.find(room => room.id === "living")?.name).toBe("家庭起居室");
  expect(renamed.rooms[0]).toMatchObject({ name: "家庭起居室", furniture: sourcePlan.rooms[0].furniture });
  expect(renamed.rooms[1].furniture).toEqual(sourcePlan.rooms[1].furniture);
  expect(renamed.totalArea).toBe(sourcePlan.totalArea);
  expect(renamed.floorPlan.openings.find(opening => opening.id === "door1")).toMatchObject({ offset: .45, width: .25 });
  expect(renamed.floorPlan.calibration?.source).toBe("manual");
  await expect(page.frameLocator(frameSelector).locator("#plan")).toContainText("家庭起居室");
  await page.getByRole("button", { name: "返回对话", exact: true }).click();
  const updated = page.getByTestId("plan-card").last();
  await updated.getByRole("button", { name: "展开方案", exact: true }).click();
  await expect(updated).toContainText("¥168,000");
  await expect(updated).toContainText("保留现有沙发与通道");
  await expect(updated).toContainText("保留原始墙体");
  await expect(updated.getByRole("button", { name: "校准校对", exact: true })).toHaveCount(0);
  expect(recognitionRequests).toBe(0);
});

test("识别失败可重试和手工描图，关闭后不会覆盖现有方案", async ({ page }) => {
  await mockChatPlan(page, () => planWithGeometry(uncalibratedGeometry));
  let recognitionRequests = 0;
  await page.route("**/api/floorplan/recognize", route => { recognitionRequests++; return route.fulfill({ status: 422, json: { error: "图片无法识别，请重试" } }); });
  await page.goto("/");
  await generatePlan(page);
  const before = await savedPlan(page);
  const dialog = await upload(page);
  await expect(dialog.getByRole("alert")).toContainText("图片无法识别，请重试");
  await dialog.getByRole("button", { name: "重新识别", exact: true }).click();
  await expect.poll(() => recognitionRequests).toBe(2);
  await expect(dialog.getByRole("alert")).toContainText("图片无法识别，请重试");
  await dialog.getByRole("button", { name: "手工描图", exact: true }).click();
  const editor = page.locator(".floorplan-import-backdrop.is-review");
  await expect(editor.getByRole("heading", { name: "户型校准与描图" })).toBeVisible();
  await editor.getByRole("button", { name: "关闭户型图导入" }).click();
  expect(await savedPlan(page)).toEqual(before);
  await expect(page.frameLocator(frameSelector).locator("#plan")).toContainText("客厅");
});

test("移动端可展开图元属性，完成校准并进入户型设计", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/floorplan/recognize", route => route.fulfill({ json: { geometry: uncalibratedGeometry } }));
  await page.goto("/");
  await recognize(page);
  const dialog = await openCalibration(page);
  const mobileProperties = dialog.locator(".floorplan-mobile-properties");
  await expect(dialog.locator(".floorplan-properties")).toBeHidden();
  await mobileProperties.locator("summary").click();
  await mobileProperties.getByLabel("选择图元").selectOption("room:bed");
  await mobileProperties.getByLabel("房间名称").fill("主卧");
  await expect(mobileProperties).toContainText("未校准，暂不计算面积");
  await expect(dialog.locator("svg image")).toHaveAttribute("href", /^data:image\/jpeg;base64,/);
  const svg = dialog.locator(".floorplan-review-canvas");
  await dialog.getByRole("button", { name: "尺寸校准", exact: true }).click();
  await clickPoint(page, svg, [150, 100]); await clickPoint(page, svg, [900, 100]);
  await dialog.getByLabel("参考长度（米）").fill("7.5");
  await dialog.getByRole("button", { name: "确认尺寸", exact: true }).click();
  await expect(mobileProperties).toContainText(/面积 \d/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await dialog.getByRole("button", { name: "确认并生成 2D / 3D", exact: true }).click();
  await expect(page.locator(frameSelector)).toBeVisible();
  await expect(page.frameLocator(frameSelector).locator("#plan")).toContainText("主卧");
  expect((await savedPlan(page)).floorPlan.rooms[1].name).toBe("主卧");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test("手工描图可补外轮廓、房间、墙和门，再按两点真实长度校准", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  let requests = 0;
  await page.route("**/api/floorplan/recognize", route => { requests++; return route.fulfill({ status: 422, json: { error: "进入手工描图" } }); });
  await page.goto("/");
  const uploadDialog = await upload(page);
  await expect(uploadDialog.getByRole("alert")).toContainText("进入手工描图");
  await uploadDialog.getByRole("button", { name: "手工描图", exact: true }).click();
  const dialog = page.locator(".floorplan-import-backdrop.is-review .floorplan-import");
  const svg = dialog.locator(".floorplan-review-canvas");
  const rectangle: Point[] = [[100, 100], [800, 100], [800, 700], [100, 700]];
  for (const point of rectangle) await clickPoint(page, svg, point);
  await dialog.getByRole("button", { name: "完成外轮廓（4 点）", exact: true }).click();
  await dialog.getByRole("button", { name: "加房间", exact: true }).click();
  for (const point of rectangle) await clickPoint(page, svg, point);
  await dialog.getByRole("button", { name: "完成房间（4 点）", exact: true }).click();
  await dialog.locator(".floorplan-properties").getByLabel("房间名称").fill("书房");
  await dialog.getByRole("button", { name: "加墙线", exact: true }).click();
  await clickPoint(page, svg, rectangle[0]); await clickPoint(page, svg, rectangle[1]);
  await dialog.getByRole("button", { name: "加门", exact: true }).click();
  await dialog.getByRole("button", { name: "尺寸校准", exact: true }).click();
  await clickPoint(page, svg, rectangle[0]); await clickPoint(page, svg, rectangle[1]);
  await dialog.getByLabel("参考长度（米）").fill("7");
  await dialog.getByRole("button", { name: "确认尺寸", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "确认并生成 2D / 3D", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "确认并生成 2D / 3D", exact: true }).click();
  await expect(page.frameLocator(frameSelector).locator("#plan")).toContainText("书房");
  const result = (await savedPlan(page)).floorPlan;
  expect(result.outline).toHaveLength(4); expect(result.rooms).toHaveLength(1);
  expect(result.walls).toHaveLength(1); expect(result.openings[0].kind).toBe("door");
  expect(result.calibration?.lengthMeters).toBe(7); expect(result.confirmed).toBe(true);
  expect(requests).toBe(1);
});

test("取消识别会中止请求并回到可操作的上传状态", async ({ page }) => {
  await page.addInitScript(() => {
    const nativeFetch = window.fetch;
    const control = window as typeof window & { floorplanWasAborted?: boolean };
    window.fetch = async (input, init) => {
      if (!String(input).endsWith("/api/floorplan/recognize")) return nativeFetch(input, init);
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => { control.floorplanWasAborted = true; reject(new DOMException("Aborted", "AbortError")); }, { once: true });
      });
    };
  });
  await page.goto("/");
  const dialog = await upload(page);
  await expect(dialog.locator(".floorplan-scan-beam")).toBeVisible();
  await dialog.getByRole("button", { name: "取消识别", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { floorplanWasAborted?: boolean }).floorplanWasAborted)).toBe(true);
  await expect(dialog.getByRole("button", { name: "重新识别", exact: true })).toBeEnabled();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByRole("button", { name: "关闭户型图导入" }).click();
  await expect(page.getByRole("heading", { name: "说出你的装修需求" })).toBeVisible();
});
