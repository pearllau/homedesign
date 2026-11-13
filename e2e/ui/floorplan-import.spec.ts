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

async function upload(page: Page) {
  await page.getByRole("button", { name: "上传户型图", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[type="file"]').first().setInputFiles(uploadFile);
  await expect(dialog.getByRole("button", { name: "开始识别", exact: true })).toBeEnabled();
  return dialog;
}

async function recognize(page: Page) {
  const dialog = await upload(page);
  await dialog.getByRole("button", { name: "开始识别", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "校准并校对户型" })).toBeVisible();
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
  return page.evaluate(() => {
    const history = JSON.parse(localStorage.getItem("ai-decor-chat") || "{}") as { state?: { messages?: { role: string; parts: { type: string; text?: string }[] }[] } };
    const message = history.state?.messages?.filter(item => item.role === "assistant").at(-1);
    return JSON.parse(message?.parts.find(part => part.type === "text")?.text || "{}") as Plan & { floorPlan: FloorPlanGeometry };
  });
}

async function seedPlan(page: Page, sourcePlan: Plan = recognizedPlan) {
  await page.addInitScript(plan => {
    if (localStorage.getItem("import-test-seeded")) return;
    localStorage.setItem("ai-decor-chat", JSON.stringify({ state: { messages: [
      { id: "old-user", role: "user", parts: [{ type: "text", text: "保留这段旧对话" }] },
      { id: "old-plan", role: "assistant", parts: [{ type: "text", text: JSON.stringify(plan) }] },
    ] }, version: 0 }));
    localStorage.setItem("import-test-seeded", "true");
  }, sourcePlan);
}

test("上传识别、尺寸确认、图元校对后沿用现有 2D/3D，并恢复原图和对话", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await seedPlan(page);
  await page.route("**/api/floorplan/recognize", async route => {
    const input = route.request().postDataJSON();
    expect(input).toMatchObject({ name: uploadFile.name, width: 1000, height: 800 });
    expect(input.image).toMatch(/^data:image\/jpeg;base64,/);
    await route.fulfill({ json: { geometry: { ...recognizedGeometry, warnings: ["请核对入户门位置。"] } } });
  });
  await page.goto("/");
  const dialog = await recognize(page);
  const properties = dialog.locator(".floorplan-properties");
  const generate = dialog.getByRole("button", { name: "确认并生成 2D / 3D", exact: true });
  await expect(generate).toBeDisabled();
  await properties.getByLabel("选择图元").selectOption("room:living");
  await expect(properties).toContainText("未校准，暂不计算面积");
  await properties.getByLabel("房间名称").fill("起居室");
  const svg = dialog.locator(".floorplan-review-canvas");
  const from = await screenPoint(svg, [150, 100]), to = await screenPoint(svg, [170, 120]);
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 4 }); await page.mouse.up();
  const correctedPoints = await dialog.locator(".floorplan-room.selected").getAttribute("points");
  expect(correctedPoints).not.toBe(recognizedGeometry.rooms[0].polygon.map(point => point.join(",")).join(" "));
  await properties.getByLabel("选择图元").selectOption("opening:door1");
  await properties.getByLabel("距墙起点（%）").fill("45");
  await properties.getByLabel("占墙长度（%）").fill("25");
  await dialog.locator(".floorplan-recognition-notes > summary").click();
  await dialog.getByRole("button", { name: "这些提示已核对" }).click();
  await expect(dialog.locator(".floorplan-recognition-notes")).toHaveCount(0);
  await expect(generate).toBeDisabled();
  await dialog.getByRole("button", { name: "确认尺寸", exact: true }).click();
  await expect(generate).toBeEnabled();
  await properties.getByLabel("选择图元").selectOption("room:living");
  await expect(properties).toContainText(/面积 \d/);
  await generate.click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".studio-views")).toHaveAttribute("data-view", "design");
  const frame = page.frameLocator(frameSelector);
  await expect(page.locator(frameSelector)).toBeVisible();
  await expect(frame.locator("#plan")).toContainText("起居室");
  await expect(frame.locator("#gRooms polygon.room")).toHaveCount(2);
  expect((await frame.locator('#gRooms polygon[data-room="living"]').getAttribute("points"))?.split(" ")).toHaveLength(7);
  await frame.getByRole("button", { name: "3D 场景", exact: true }).click();
  await expect(frame.locator("body")).toHaveClass(/m3d/);
  await expect(frame.locator("canvas")).toBeVisible();
  const plan = await savedPlan(page);
  expect(plan.floorPlan.confirmed).toBe(true);
  expect(plan.floorPlan.outline).toEqual(recognizedGeometry.outline);
  expect(plan.floorPlan.rooms[0].name).toBe("起居室");
  expect(plan.floorPlan.rooms[0].polygon[0][0]).toBeCloseTo(170, 0);
  expect(plan.floorPlan.openings.find(opening => opening.id === "door1")).toMatchObject({ offset: .45, width: .25 });
  expect(plan.floorPlan.calibration?.source).toBe("manual");
  await page.reload();
  await expect(page.locator(frameSelector)).toBeVisible();
  await expect(frame.locator("#plan")).toContainText("起居室");
  await page.getByRole("button", { name: "校对户型", exact: true }).click();
  const correction = page.getByRole("dialog");
  await expect(correction.locator("svg image")).toHaveAttribute("href", /^data:image\/jpeg;base64,/);
  await correction.locator(".floorplan-properties").getByLabel("选择图元").selectOption("room:living");
  await correction.locator(".floorplan-properties").getByLabel("房间名称").fill("未确认的修改");
  await correction.getByRole("button", { name: "关闭户型图导入" }).click();
  expect((await savedPlan(page)).floorPlan.rooms[0].name).toBe("起居室");
  await page.getByRole("button", { name: "对话", exact: true }).click();
  await expect(page.getByText("保留这段旧对话", { exact: true })).toBeVisible();
  await expect(page.getByText(`已校对户型图：${uploadFile.name}`, { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox")).toBeVisible();
  await page.getByRole("button", { name: "户型设计", exact: true }).click();
  await expect(page.locator(frameSelector)).toBeVisible();
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
  await seedPlan(page, sourcePlan);
  let recognitionRequests = 0;
  await page.route("**/api/floorplan/recognize", route => { recognitionRequests++; return route.abort(); });
  await page.goto("/");
  await page.getByRole("button", { name: "校对户型", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "确认并生成 2D / 3D", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "确认并生成 2D / 3D", exact: true }).click();
  await expect(dialog).toBeHidden();
  const unchanged = await savedPlan(page);
  expect(unchanged).toMatchObject({
    style: sourcePlan.style, overview: sourcePlan.overview, totalArea: sourcePlan.totalArea,
    budget: sourcePlan.budget, highlights: sourcePlan.highlights,
  });
  expect(unchanged.rooms.map(room => ({ name: room.name, furniture: room.furniture, notes: room.notes })))
    .toEqual(sourcePlan.rooms.map(room => ({ name: room.name, furniture: room.furniture, notes: room.notes })));
  await page.getByRole("button", { name: "校对户型", exact: true }).click();
  const correction = page.getByRole("dialog");
  const properties = correction.locator(".floorplan-properties");
  await properties.getByLabel("选择图元").selectOption("room:living");
  await properties.getByLabel("房间名称").fill("家庭起居室");
  await correction.getByRole("button", { name: "确认并生成 2D / 3D", exact: true }).click();
  await expect(correction).toBeHidden();
  const renamed = await savedPlan(page);
  expect(renamed.floorPlan.rooms.find(room => room.id === "living")?.name).toBe("家庭起居室");
  expect(renamed.rooms[0]).toMatchObject({ name: "家庭起居室", furniture: sourcePlan.rooms[0].furniture, notes: sourcePlan.rooms[0].notes });
  expect(renamed.rooms[1].furniture).toEqual(sourcePlan.rooms[1].furniture);
  expect(renamed).toMatchObject({
    style: sourcePlan.style, overview: sourcePlan.overview, totalArea: sourcePlan.totalArea,
    budget: sourcePlan.budget, highlights: sourcePlan.highlights,
  });
  await expect(page.frameLocator(frameSelector).locator("#plan")).toContainText("家庭起居室");
  expect(recognitionRequests).toBe(0);
});

test("识别失败可重试和手工描图，关闭后不会覆盖现有方案", async ({ page }) => {
  await seedPlan(page);
  await page.route("**/api/floorplan/recognize", route => route.fulfill({ status: 422, json: { error: "图片无法识别，请重试" } }));
  await page.goto("/");
  const before = await page.evaluate(() => localStorage.getItem("ai-decor-chat"));
  const dialog = await upload(page);
  await dialog.getByRole("button", { name: "开始识别", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("图片无法识别，请重试");
  await expect(dialog.getByRole("button", { name: "开始识别", exact: true })).toBeEnabled();
  await expect(dialog.getByRole("button", { name: "手工描图", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "关闭户型图导入" }).click();
  expect(await page.evaluate(() => localStorage.getItem("ai-decor-chat"))).toBe(before);
  await expect(page.frameLocator(frameSelector).locator("#plan")).toContainText("客厅");
  await page.getByRole("button", { name: "校对户型", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "附加原图作对照" })).toBeVisible();
  await page.getByRole("dialog").locator('input[type="file"]').nth(1).setInputFiles(uploadFile);
  await expect(page.getByRole("dialog").locator("svg image")).toBeVisible();
  await expect(page.getByRole("dialog").locator(".floorplan-outline")).toHaveAttribute("points", recognizedGeometry.outline.map(point => point.join(",")).join(" "));
});

test("移动端可展开图元属性，完成校准并进入户型设计", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/floorplan/recognize", route => route.fulfill({ json: { geometry: recognizedGeometry } }));
  await page.goto("/");
  const dialog = await recognize(page);
  const mobileProperties = dialog.locator(".floorplan-mobile-properties");
  await expect(dialog.locator(".floorplan-properties")).toBeHidden();
  await mobileProperties.locator("summary").click();
  await mobileProperties.getByLabel("选择图元").selectOption("room:bed");
  await mobileProperties.getByLabel("房间名称").fill("主卧");
  await expect(mobileProperties).toContainText("未校准，暂不计算面积");
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
  await page.route("**/api/floorplan/recognize", route => { requests++; return route.abort(); });
  await page.goto("/");
  const dialog = await upload(page);
  await dialog.getByRole("button", { name: "手工描图", exact: true }).click();
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
  expect(requests).toBe(0);
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
  await dialog.getByRole("button", { name: "开始识别", exact: true }).click();
  await dialog.getByRole("button", { name: "取消识别", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as typeof window & { floorplanWasAborted?: boolean }).floorplanWasAborted)).toBe(true);
  await expect(dialog.getByRole("button", { name: "开始识别", exact: true })).toBeEnabled();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByRole("button", { name: "关闭户型图导入" }).click();
  await expect(page.getByRole("heading", { name: "说出你的装修需求" })).toBeVisible();
});
