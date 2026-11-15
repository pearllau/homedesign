import { test, expect } from "@playwright/test";
import { handleDesignChat } from "../../src/server/ai/design-chat";
import { calculateBudget } from "../../src/shared/design-tools";

function request(text = "35㎡单身公寓，预算6万以内") {
  return new Request("https://test.invalid/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: [{ id: "user-1", role: "user", parts: [{ type: "text", text }] }] }) });
}

const completePlan = JSON.stringify({ style: "现代简约", overview: "收纳方案", totalArea: 35, rooms: [{ name: "客厅", width: 5, length: 4, area: 20, furniture: [{ name: "沙发", count: 1 }] }], budget: { total: 60000, items: [{ category: "家具", item: "收纳柜", cost: 60000 }] }, highlights: ["释放动线"] });

function providerResponse(events: object[], fragmented = false) {
  const bytes = new TextEncoder().encode(events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join("") + "data: [DONE]\r\n\r\n");
  return new Response(new ReadableStream({ start(controller) {
    if (fragmented) for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
    else controller.enqueue(bytes);
    controller.close();
  } }), { headers: { "Content-Type": "text/event-stream" } });
}

test("轻量接口将分片 UTF-8 和 SSE 转为可读消息，保留真实上下文", async () => {
  let sent: Record<string, unknown> | undefined;
  const response = await handleDesignChat(request(), { apiKey: "test-only", fetcher: async (_url, init) => {
    sent = JSON.parse(String(init?.body));
    return providerResponse([{ choices: [{ delta: { content: completePlan } }] }, { choices: [{ delta: {}, finish_reason: "stop" }] }], true);
  } });
  const output = await response.text();
  expect(response.headers.get("x-vercel-ai-ui-message-stream")).toBe("v1");
  expect(output).toContain("收纳方案");
  expect(output).toContain('"finishReason":"stop"');
  expect(output).not.toContain("test-only");
  expect(sent?.messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: "user", content: "35㎡单身公寓，预算6万以内" })]));
});

test("工具调用使用实际面积和预算，计算结果发送回 DeepSeek", async () => {
  let calls = 0;
  const response = await handleDesignChat(request(), { apiKey: "test-only", fetcher: async (_url, init) => {
    calls++;
    if (calls === 1) return providerResponse([{ choices: [{ delta: { tool_calls: [
      { index: 0, id: "area", function: { name: "calculateRoomArea", arguments: '{"width":5,"length":4}' } },
      { index: 1, id: "budget", function: { name: "estimateBudget", arguments: '{"style":"现代简约","totalArea":35,"roomCount":3,"budgetCap":60000}' } },
    ] }, finish_reason: "tool_calls" }] }]);
    const body = JSON.parse(String(init?.body));
    const toolMessages = body.messages.filter((message: { role: string }) => message.role === "tool");
    expect(JSON.parse(toolMessages[0].content)).toEqual({ width: 5, length: 4, area: 20 });
    expect(JSON.parse(toolMessages[1].content)).toEqual(calculateBudget({ style: "现代简约", totalArea: 35, roomCount: 3, budgetCap: 60000 }));
    expect(JSON.parse(toolMessages[1].content).total).toBeLessThanOrEqual(60000);
    return providerResponse([{ choices: [{ delta: { content: completePlan }, finish_reason: "stop" }] }]);
  } });
  const output = await response.text();
  expect(calls).toBe(2);
  expect(output).toContain('"finishReason":"stop"');
  expect(output).not.toContain('"type":"error"');
});

test("结构无效或 JSON 不完整时不会标记成功", async () => {
  const response = await handleDesignChat(request(), { apiKey: "test-only", fetcher: async () => providerResponse([{ choices: [{ delta: { content: '{"rooms":[]}' }, finish_reason: "stop" }] }]) });
  const output = await response.text();
  expect(output).toContain('"type":"error"');
  expect(output).not.toContain('"type":"finish"');
});

for (const [status, message] of [[401, "授权失效"], [402, "余额不足"], [429, "当前繁忙"], [503, "暂时不可用"]] as const) {
  test(`上游 ${status} 显示可操作提示且不泄露上游原文`, async () => {
    const response = await handleDesignChat(request(), { apiKey: "test-only", fetcher: async () => new Response("private-provider-error", { status }) });
    const output = await response.text();
    expect(output).toContain(message);
    expect(output).not.toContain("private-provider-error");
    expect(output).not.toContain('"type":"finish"');
  });
}

test("断开的上游流不会被误报为完成", async () => {
  const response = await handleDesignChat(request(), { apiKey: "test-only", fetcher: async () => providerResponse([{ choices: [{ delta: { content: '{"style":' } }] }]) });
  const output = await response.text();
  expect(output).toContain('"type":"error"');
  expect(output).not.toContain('"type":"finish"');
});

test("用户停止时终止上游请求，非法输入不调用模型", async () => {
  let called = false;
  const options = { apiKey: "test-only", fetcher: async () => { called = true; return new Response(); } };
  const bad = new Request("https://test.invalid/api/chat", { method: "POST", body: JSON.stringify({ messages: [{ role: "system", parts: [] }] }) });
  expect((await handleDesignChat(bad, options)).status).toBe(400);
  expect(called).toBe(false);
  let upstreamSignal: AbortSignal | null | undefined;
  const response = await handleDesignChat(request(), { apiKey: "test-only", fetcher: async (_url, init) => {
    upstreamSignal = init?.signal;
    return new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))); });
  } });
  await response.body?.cancel();
  expect(upstreamSignal?.aborted).toBe(true);
});
