import { test, expect } from "@playwright/test";
import type { UIMessage } from "ai";
import { extractPlan, getMessageText, type Plan } from "../../src/shared/plan-data";
import { restoreMessages } from "../../src/features/studio/lib/store";

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

test("JavaScript 不可用时仍然显示首屏文字，而不是透明空白", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  await page.goto("/");
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

test("旧缓存不恢复，完整方案可在当前会话切换和二次修改", async ({ page }) => {
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
  await expect(page.getByTestId("plan-card")).not.toContainText("建筑面积");
  await expect(page.getByTestId("plan-card").locator(".plan-activity")).toHaveCount(0);
  const designFrame = page.getByTitle("户型设计与 3D 预览");
  await expect(designFrame).toBeVisible();
  await expect(page.locator(".studio-views")).toHaveAttribute("data-view", "design");
  const frame = page.frameLocator('iframe[title="户型设计与 3D 预览"]');
  await expect(frame.locator("#plan")).toContainText("客厅");
  await expect(frame.locator(".panel-ops p")).toHaveCount(0);
  await expect(page).toHaveURL(/\/design$/);
  await expect(frame.locator("#tgLib")).toHaveAttribute("aria-expanded", "false");
  await expect(frame.locator("aside.lib")).toHaveAttribute("aria-hidden", "true");
  await expect(frame.locator(".furniture-category[open]")).toHaveCount(0);
  await expect(frame.locator(".plan-details-heading")).toContainText("方案详细");
  await frame.locator("#closePlanDetails").click();
  await expect(frame.locator("#tgPanel")).toHaveAttribute("aria-expanded", "false");
  await frame.locator("#tgPanel").click();
  await expect(frame.locator("#planDetailsPanel")).toHaveAttribute("aria-hidden", "false");
  await expect(frame.locator(".detail-section-title").filter({ hasText: "房间面积" })).toBeVisible();
  const frameInstance = await frame.locator("html").evaluate((node) => {
    node.setAttribute("data-test-instance", "kept");
    return node.getAttribute("data-test-instance");
  });
  await page.getByRole("button", { name: "修改需求", exact: true }).click();
  await expect(page.locator(".studio-views")).toHaveAttribute("data-view", "chat");
  await expect(page.locator('.studio-view[data-panel="chat"]')).toHaveAttribute("data-phase", "visible");
  await expect(designFrame).toBeHidden();
  await expect(page.getByRole("textbox")).toBeFocused();
  await page.getByRole("button", { name: "继续设计", exact: true }).click();
  await expect(page.locator(".studio-views")).toHaveAttribute("data-view", "design");
  await expect(page.locator('.studio-view[data-panel="design"]')).toHaveAttribute("data-phase", "visible");
  await expect(designFrame).toBeVisible();
  await expect(frame.locator("html")).toHaveAttribute("data-test-instance", frameInstance!);
  await expect(page.getByText("就绪", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "修改需求", exact: true }).click();
  await expect(page.getByRole("button", { name: "展开方案", exact: true })).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "展开方案", exact: true }).click();
  await expect(page.getByRole("button", { name: "复制方案" })).toBeVisible();
  await page.getByRole("textbox").fill("换成日式原木风");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByTestId("plan-card")).toHaveCount(2);
  await expect(page.locator(".studio-views")).toHaveAttribute("data-view", "design");
  await expect(page.getByTitle("户型设计与 3D 预览")).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "说出你的装修需求" })).toBeVisible();
  await expect(page.getByTitle("户型设计与 3D 预览")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("请求等待、流式响应和单路径 SVG 往复动画跟随实际进度", async ({ page }) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch;
    const control = window as typeof window & { startTestStream?: () => void; finishTestStream?: () => void };
    window.fetch = async (...args) => {
      if (!String(args[0]).endsWith("/api/chat")) return originalFetch(...args);
      return new Promise<Response>((resolve) => {
        control.startTestStream = () => {
          const encoder = new TextEncoder();
          const stream = new ReadableStream({ start(controller) {
            const send = (event: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            send({ type: "start", messageId: "controlled-reply" });
            send({ type: "text-start", id: "text" });
            send({ type: "text-delta", id: "text", delta: "我正在根据预算整理" });
            control.finishTestStream = () => {
              send({ type: "text-delta", id: "text", delta: "空间布局。" });
              send({ type: "text-end", id: "text" });
              send({ type: "finish", finishReason: "stop" });
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            };
          } });
          resolve(new Response(stream, { headers: { "Content-Type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" } }));
        };
      });
    };
  });
  await page.goto("/");
  await page.getByRole("textbox").fill("20平方米的客厅怎么设计");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("正在连接你的设计师")).toBeVisible();
  await expect(page.locator(".plan-activity")).toHaveAttribute("data-renderer", "svg");
  const outline = page.locator(".activity-outline-svg path");
  await expect(outline).toHaveCount(1);
  await expect(outline).toHaveAttribute("pathLength", "1");
  const offsets: number[] = [];
  for (let sample = 0; sample < 12; sample++) {
    offsets.push(await outline.evaluate(node => Number.parseFloat(getComputedStyle(node).strokeDashoffset)));
    await page.waitForTimeout(350);
  }
  const steps = offsets.slice(1).map((value, index) => value - offsets[index]);
  expect(steps.some(step => step > .05), "轮廓应沿原路退回").toBe(true);
  expect(steps.some(step => step < -.05), "轮廓应持续绘制").toBe(true);
  await expect(outline).toBeVisible();
  await page.evaluate(() => (window as typeof window & { startTestStream: () => void }).startTestStream());
  await expect(page.getByText("正在整理空间与预算")).toBeVisible();
  await page.evaluate(() => (window as typeof window & { finishTestStream: () => void }).finishTestStream());
  await expect(page.getByText("我正在根据预算整理空间布局。")).toBeVisible();
  await expect(page.getByRole("button", { name: "停止生成" })).toHaveCount(0);
  await expect(page.locator(".generation-feedback")).toHaveCount(0);
});

test("接口失败显示可恢复反馈，重新生成后回到方案", async ({ page }) => {
  let fail = true;
  await page.route("**/api/chat", async (route) => {
    if (fail) {
      fail = false;
      await route.fulfill({ status: 503, body: "Unavailable" });
      return;
    }
    const events = [{ type: "start", messageId: "recovered" }, { type: "text-start", id: "text" }, { type: "text-delta", id: "text", delta: JSON.stringify(plan) }, { type: "text-end", id: "text" }, { type: "finish", finishReason: "stop" }];
    await route.fulfill({ contentType: "text/event-stream", headers: { "x-vercel-ai-ui-message-stream": "v1" }, body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n" });
  });
  await page.goto("/");
  await page.getByRole("textbox").fill("设计一个客厅");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("这次连接没有完成")).toBeVisible();
  await page.getByRole("button", { name: "重新生成" }).click();
  await expect(page.getByTitle("户型设计与 3D 预览")).toBeVisible();
  await expect(page.getByText("这次连接没有完成")).toHaveCount(0);
});

test("减少动态效果下可生成和切换，旧历史不会自动恢复", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript((savedPlan) => {
    localStorage.setItem("ai-decor-chat", JSON.stringify({ state: { messages: [{ id: "saved", role: "assistant", parts: [{ type: "text", text: JSON.stringify(savedPlan) }] }] }, version: 0 }));
  }, plan);
  await page.route("**/api/chat", async route => {
    const events = [{ type: "start", messageId: "reduced-motion-plan" }, { type: "text-start", id: "text" }, { type: "text-delta", id: "text", delta: JSON.stringify(plan) }, { type: "text-end", id: "text" }, { type: "finish", finishReason: "stop" }];
    await route.fulfill({ contentType: "text/event-stream", headers: { "x-vercel-ai-ui-message-stream": "v1" }, body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n" });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "说出你的装修需求" })).toBeVisible();
  await expect(page.getByTitle("户型设计与 3D 预览")).toHaveCount(0);
  await page.getByRole("textbox").fill("20平方米的客厅");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByTitle("户型设计与 3D 预览")).toBeVisible();
  await page.getByRole("button", { name: "修改需求", exact: true }).click();
  await expect(page.getByTestId("plan-card")).toBeVisible();
  await expect(page.getByTestId("plan-card").locator(".plan-activity")).toHaveCount(0);
  await page.getByRole("button", { name: "继续设计", exact: true }).click();
  await expect(page.getByTitle("户型设计与 3D 预览")).toBeVisible();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.reload();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "说出你的装修需求" })).toBeVisible();
  await expect(page.getByTitle("户型设计与 3D 预览")).toHaveCount(0);
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
  await page.locator('#viewSeg [data-view="3d"]').click();
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
  await page.locator('#viewSeg [data-view="3d"]').click();
  await expect(page.locator("#toast")).toContainText("可以继续编辑 2D 户型");
  await expect(page.locator("#plan")).toBeVisible();
  await expect(page.locator("body")).not.toHaveClass(/busy|m3d/);
  await page.locator('#viewSeg [data-view="3d"]').click();
  await expect(page.locator("body")).not.toHaveClass(/busy|m3d/);
  expect(errors).toEqual([]);
});

test("手机尺寸下首页可以输入", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/chat", async (route) => {
    const events = [
      { type: "start", messageId: "mobile-plan" },
      { type: "text-start", id: "text" },
      { type: "text-delta", id: "text", delta: JSON.stringify(plan) },
      { type: "text-end", id: "text" },
      { type: "finish", finishReason: "stop" },
    ];
    await route.fulfill({ contentType: "text/event-stream", headers: { "x-vercel-ai-ui-message-stream": "v1" }, body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n" });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "说出你的装修需求" })).toBeVisible();
  await page.getByRole("textbox").fill("30平方米单身公寓");
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByTitle("户型设计与 3D 预览")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator(".studio-views")).toHaveAttribute("data-view", "design");
  await expect(page.getByTitle("户型设计与 3D 预览")).toBeVisible();
  const frame = page.frameLocator('iframe[title="户型设计与 3D 预览"]');
  await expect(frame.locator("html")).toHaveAttribute("data-scene-ready", "true");
  expect(await frame.locator("html").evaluate((node) => node.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await frame.locator("#stage").evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThan(400);
  await expect(frame.locator("#layers")).toBeHidden();
  await frame.locator("#drawer-layers > summary").click();
  await expect(frame.locator("#drawer-layers > summary")).toHaveAttribute("aria-expanded", "true");
  await expect(frame.locator("#layers")).toBeVisible();
  await expect(frame.locator("#toggles3d")).toBeHidden();
  await frame.locator("#drawer-layers > summary").click();
  await expect(frame.locator("#drawer-layers > summary")).toHaveAttribute("aria-expanded", "false");
  await expect(frame.locator("#layers")).toBeHidden();
  await frame.locator("#tgLib").click();
  await expect(frame.locator("aside.lib")).toHaveClass(/open/);
  await frame.locator("#tgPanel").click();
  await expect(frame.locator("aside.right")).toHaveClass(/open/);
  await expect(frame.locator("aside.lib")).toBeHidden();
  await frame.locator("#tgPanel").click();
  await expect(frame.locator("aside.right")).toBeHidden();
  await page.getByRole("button", { name: "修改需求", exact: true }).click();
  await expect(page.getByRole("textbox")).toBeFocused();
});
