import { test, expect } from "@playwright/test";
import type { UIMessage } from "ai";
import { extractPlan, getMessageText, type Plan } from "../src/lib/plan-data";
import { restoreMessages } from "../src/lib/store";

const plan: Plan = {
  style: "现代简约",
  overview: "保留清晰动线的客厅",
  totalArea: 20,
  rooms: [{ name: "客厅", width: 5, length: 4, area: 20, furniture: [{ name: "沙发", count: 1 }] }],
  budget: { total: 30000, items: [{ category: "家具", item: "沙发", cost: 30000 }] },
};

test("方案解析拒绝不完整数据，支持 Markdown 和完整方案", () => {
  expect(extractPlan('{"rooms":[]}')).toBeNull();
  expect(extractPlan('{"rooms":[{"name":"客厅"}]}')).toBeNull();
  expect(extractPlan('{"style":"现代简约"')).toBeNull();
  expect(extractPlan(JSON.stringify({ ...plan, budget: null }))).toBeNull();
  expect(extractPlan(JSON.stringify({ ...plan, rooms: [{ ...plan.rooms[0], width: 0 }] }))).toBeNull();
  expect(extractPlan(`方案：\n\`\`\`json\n${JSON.stringify(plan)}\n\`\`\``)).toEqual(plan);
  expect(extractPlan(JSON.stringify(plan))).toEqual(plan);
});

test("旧版和损坏的历史记录不会进入对话渲染", () => {
  const message: UIMessage = { id: "valid", role: "user", parts: [{ type: "text", text: "你好" }] };
  expect(restoreMessages({ messages: [null, { id: "old", content: "旧消息" }, { id: "bad", role: "user", parts: [null] }, message] })).toEqual([message]);
  expect(restoreMessages(null)).toEqual([]);
  expect(getMessageText(message.parts)).toBe("你好");
});

test("首次访问无需登录，首页和输入框可见", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "说出你的装修需求" })).toBeVisible();
  await page.getByRole("button", { name: "35㎡ 单身公寓，小户型收纳怎么设计" }).click();
  await expect(page.getByRole("textbox")).toHaveValue("35㎡ 单身公寓，小户型收纳怎么设计");
  expect(errors).toEqual([]);
});

test("JavaScript 不可用时仍然显示首屏文字，而不是透明空白", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4175/");
  const heading = page.getByRole("heading", { name: "说出你的装修需求" });
  await expect(heading).toBeVisible();
  expect(await heading.evaluate((node) => {
    for (let parent: Element | null = node; parent; parent = parent.parentElement) {
      if (getComputedStyle(parent).opacity === "0") return false;
    }
    return true;
  })).toBe(true);
  await expect(page.locator("noscript")).toBeVisible();
  await context.close();
});

test("JS 资源失败时给出恢复入口", async ({ page }) => {
  await page.route("**/_next/static/**/*.js", (route) => route.abort());
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "说出你的装修需求" })).toBeVisible();
  await expect(page.locator("#app-load-notice")).toBeVisible({ timeout: 25000 });
});

test("异常缓存可恢复，完整方案生成、刷新和二次修改正常", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem("stability-test-initialized")) {
      localStorage.setItem("ai-decor-chat", JSON.stringify({ state: { messages: [{ id: "legacy", role: "assistant", content: "旧数据" }] }, version: 0 }));
      localStorage.setItem("stability-test-initialized", "true");
    }
  });
  await page.route("**/api/chat", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.messages.at(-1).role).toBe("user");
    const text = JSON.stringify(plan);
    const events = [
      { type: "start", messageId: `reply-${body.messages.length}` },
      { type: "text-start", id: "text" },
      { type: "text-delta", id: "text", delta: text },
      { type: "text-end", id: "text" },
      { type: "finish", finishReason: "stop" },
    ];
    await route.fulfill({ contentType: "text/event-stream", headers: { "x-vercel-ai-ui-message-stream": "v1" }, body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n" });
  });
  await page.goto("/");
  await page.getByRole("textbox").fill("设计一个20平方米的客厅");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByTitle("户型设计与 3D 预览")).toBeVisible();
  const frame = page.frameLocator('iframe[title="户型设计与 3D 预览"]');
  await expect(frame.locator("#plan")).toContainText("客厅");
  await page.reload();
  await expect(page.getByRole("button", { name: "复制方案" })).toBeVisible();
  await page.getByRole("textbox").fill("换成日式原木风");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByTitle("户型设计与 3D 预览")).toBeVisible();
  expect(errors).toEqual([]);
});

test("禁用 LocalStorage 也能从方案打开 2D 和 3D，资源全部同源", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException("Storage blocked", "SecurityError"); };
    Storage.prototype.setItem = () => { throw new DOMException("Storage blocked", "SecurityError"); };
  });
  await page.route("https://**/*", (route) => route.abort());
  await page.goto(`/floorplan-3d.html#plan=${encodeURIComponent(JSON.stringify({ ...plan, sig: "storage-test" }))}`);
  await expect(page.locator("#plan")).toContainText("客厅");
  await expect(page.locator("html")).toHaveAttribute("data-scene-ready", "true");
  await page.getByRole("button", { name: "3D 场景", exact: true }).click();
  await expect(page.locator("#view3d canvas")).toBeVisible();
  await expect(page.locator("#view3d .rlabel")).toContainText("客厅");
});

test("设备不支持 WebGL 时恢复 2D，解除切换锁定", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
      if (String(args[0]).startsWith("webgl") || String(args[0]) === "experimental-webgl") return null;
      return original.apply(this, args);
    } as typeof original;
  });
  await page.goto(`/floorplan-3d.html#plan=${encodeURIComponent(JSON.stringify({ ...plan, sig: "no-webgl" }))}`);
  await expect(page.locator("html")).toHaveAttribute("data-scene-ready", "true");
  await page.getByRole("button", { name: "3D 场景", exact: true }).click();
  await expect(page.locator("#toast")).toContainText("可以继续编辑 2D 户型");
  await expect(page.locator("#plan")).toBeVisible();
  await expect(page.locator("body")).not.toHaveClass(/busy|m3d/);
  await page.getByRole("button", { name: "3D 场景", exact: true }).click();
  await expect(page.locator("body")).not.toHaveClass(/busy|m3d/);
  expect(errors).toEqual([]);
});

test("手机尺寸下首页可以输入", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "说出你的装修需求" })).toBeVisible();
  await page.getByRole("textbox").fill("30平方米单身公寓");
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeEnabled();
});
