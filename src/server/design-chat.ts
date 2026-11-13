import { calculateArea, calculateBudget } from "../lib/design-tools";
import { DESIGN_SYSTEM_PROMPT, DESIGN_TOOLS } from "./design-prompt";
import { attachSourceGeometry, geometryDesignPrompt, omitGeometry, sourceGeometry } from "./floorplan-design";
import type { FloorPlanGeometry } from "../lib/floorplan-geometry";

type ChatMessage = { role: string; content: string | null; tool_call_id?: string; tool_calls?: ToolCall[] };
type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type Options = { apiKey?: string; model?: string; fetcher?: typeof fetch };

class DesignError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

function failure(error: unknown): string {
  if (error instanceof DesignError) return error.message;
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return "设计服务响应超时，请稍后重新生成。";
  return "设计服务暂时没有完成响应，请稍后重新生成。";
}

function executeTool(call: ToolCall) {
  const args: unknown = JSON.parse(call.function.arguments);
  if (!args || typeof args !== "object") throw new Error("Invalid tool arguments");
  const value = args as Record<string, unknown>;
  const positive = (key: string) => typeof value[key] === "number" && Number.isFinite(value[key]) && (value[key] as number) > 0;
  if (call.function.name === "calculateRoomArea" && positive("width") && positive("length")) {
    return calculateArea({ width: value.width as number, length: value.length as number });
  }
  if (call.function.name === "estimateBudget" && typeof value.style === "string" && positive("totalArea") && positive("roomCount") && Number.isInteger(value.roomCount) && (value.budgetCap === undefined || positive("budgetCap"))) {
    return calculateBudget({ style: value.style, totalArea: value.totalArea as number, roomCount: value.roomCount as number, budgetCap: value.budgetCap as number | undefined });
  }
  throw new Error("Invalid tool arguments");
}

function isCompletePlan(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object") return false;
    const plan = value as Record<string, unknown>;
    if (typeof plan.style !== "string" || typeof plan.overview !== "string" || typeof plan.totalArea !== "number" || !Number.isFinite(plan.totalArea) || plan.totalArea <= 0) return false;
    if (!Array.isArray(plan.rooms) || plan.rooms.length < 1 || plan.rooms.length > 100) return false;
    for (const item of plan.rooms) {
      if (!item || typeof item !== "object") return false;
      const room = item as Record<string, unknown>;
      if (typeof room.name !== "string" || [room.width, room.length, room.area].some((number) => typeof number !== "number" || !Number.isFinite(number) || number <= 0)) return false;
      if (room.furniture !== undefined && (!Array.isArray(room.furniture) || room.furniture.some((furniture) => !furniture || typeof furniture !== "object" || typeof furniture.name !== "string" || typeof furniture.count !== "number" || !Number.isInteger(furniture.count) || furniture.count <= 0))) return false;
    }
    const budget = plan.budget;
    if (!budget || typeof budget !== "object") return false;
    const amount = (budget as Record<string, unknown>).total;
    const items = (budget as Record<string, unknown>).items;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || !Array.isArray(items)) return false;
    if (items.some((item) => !item || typeof item !== "object" || typeof item.category !== "string" || typeof item.item !== "string" || typeof item.cost !== "number" || !Number.isFinite(item.cost) || item.cost < 0)) return false;
    return plan.highlights === undefined || (Array.isArray(plan.highlights) && plan.highlights.every((highlight) => typeof highlight === "string"));
  } catch {
    return false;
  }
}

// Network chunks may split a UTF-8 character or JSON; parse complete SSE frames.
async function* providerEvents(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replace(/\r\n/g, "\n");
      if (buffer.length > 262144) throw new Error("Provider frame too large");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
        if (data === "[DONE]") return;
        if (data) yield JSON.parse(data);
      }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// Avoid framework routing and repeated incremental schema parsing on Workers Free.
// DeepSeek still generates the plan and invokes deterministic calculation tools.
export async function handleDesignChat(req: Request, options: Options): Promise<Response> {
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  if (!options.apiKey) return new Response("设计服务尚未配置，请联系网站维护者。", { status: 503 });
  if (Number(req.headers.get("content-length")) > 262144) return new Response("对话内容过长，请开启新对话。", { status: 413 });
  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || !("messages" in body) || !Array.isArray(body.messages) || body.messages.length > 200) return new Response("对话消息格式不正确。", { status: 400 });
  const messages: ChatMessage[] = [{ role: "system", content: DESIGN_SYSTEM_PROMPT }];
  let geometry: FloorPlanGeometry | null = null;
  for (const item of body.messages.slice(-32)) {
    if (!item || (item.role !== "user" && item.role !== "assistant") || !Array.isArray(item.parts)) return new Response("对话消息格式不正确。", { status: 400 });
    const text = item.parts.filter((part: { type?: string; text?: unknown } | null) => part?.type === "text" && typeof part.text === "string").map((part: { text: string }) => part.text).join("");
    if (item.role === "assistant" && text.includes('"floorPlan"')) {
      const recognized = sourceGeometry(text);
      if (!recognized) return new Response("上传户型尚未通过校准校对，请先确认户型。", { status: 400 });
      geometry = recognized;
    }
    const modelText = item.role === "assistant" ? omitGeometry(text) : text;
    if (modelText.length > 65536) return new Response("单条消息过长，请缩短后重试。", { status: 413 });
    if (modelText.trim()) messages.push({ role: item.role, content: modelText });
  }
  if (geometry) messages[0].content += `\n${geometryDesignPrompt(geometry)}`;
  if (messages.length === 1 || messages.at(-1)?.role !== "user") return new Response("请先输入装修需求。", { status: 400 });

  const abort = new AbortController();
  const signal = AbortSignal.any([req.signal, abort.signal, AbortSignal.timeout(180000)]);
  const encoder = new TextEncoder();
  const fetcher = options.fetcher ?? fetch;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      try {
        send({ type: "start", messageId: crypto.randomUUID() });
        for (let step = 0; step < 10; step++) {
          const response = await fetcher("https://api.deepseek.com/chat/completions", {
            method: "POST", signal,
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.apiKey}` },
            body: JSON.stringify({ model: options.model || "deepseek-chat", messages, tools: DESIGN_TOOLS, stream: true, response_format: { type: "json_object" }, max_tokens: 6144 }),
          });
          if (!response.ok || !response.body) {
            await response.body?.cancel();
            const code = response.status;
            throw new DesignError(`provider_${code}`, code === 401 ? "设计服务授权失效，请联系网站维护者。" : code === 402 ? "设计服务余额不足，请联系网站维护者。" : code === 429 ? "设计服务当前繁忙，请稍后重试。" : "设计服务暂时不可用，请稍后重新生成。");
          }
          const calls: ToolCall[] = [];
          let content = "";
          let finish: string | undefined;
          const textId = `design-${step}`;
          for await (const event of providerEvents(response.body)) {
            if (event.error) throw new DesignError("provider_stream", "设计服务返回异常，请稍后重新生成。");
            const choice = event.choices?.[0];
            if (!choice) continue;
            if (choice.finish_reason) finish = choice.finish_reason;
            const delta = choice.delta;
            if (typeof delta?.content === "string" && delta.content) {
              if (!content && !geometry) send({ type: "text-start", id: textId });
              content += delta.content;
              if (!geometry) send({ type: "text-delta", id: textId, delta: delta.content });
            }
            for (const fragment of delta?.tool_calls ?? []) {
              if (!Number.isInteger(fragment.index) || fragment.index < 0 || fragment.index >= 100) throw new Error("Invalid tool index");
              const call = calls[fragment.index] ??= { id: "", type: "function", function: { name: "", arguments: "" } };
              if (fragment.id) call.id += fragment.id;
              if (fragment.function?.name) call.function.name += fragment.function.name;
              if (fragment.function?.arguments) call.function.arguments += fragment.function.arguments;
            }
          }
          if (content && !geometry) send({ type: "text-end", id: textId });
          if (calls.length) {
            if (finish !== "tool_calls") throw new DesignError("incomplete_tools", "计算尚未完成，请重新生成。");
            messages.push({ role: "assistant", content: content || null, tool_calls: calls });
            for (const call of calls) {
              let result;
              try { result = executeTool(call); }
              catch { result = { error: "参数无效，请使用合理的正数尺寸、房间数量和预算，重新调用工具。" }; }
              messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
            }
            continue;
          }
          if (finish !== "stop" || !isCompletePlan(content)) throw new DesignError("incomplete", "这份方案还没有完整生成，请重新生成。");
          if (geometry) {
            send({ type: "text-start", id: textId });
            send({ type: "text-delta", id: textId, delta: attachSourceGeometry(content, geometry) });
            send({ type: "text-end", id: textId });
          }
          send({ type: "finish", finishReason: "stop" });
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }
        throw new DesignError("step_limit", "这份方案的计算尚未完成，请缩小本次修改范围后重试。");
      } catch (error) {
        if (!abort.signal.aborted && !req.signal.aborted) {
          // Do not log prompts, provider bodies or credentials.
          console.error(JSON.stringify({ event: "design_generation_failed", code: error instanceof DesignError ? error.code : error instanceof Error ? error.name : "unknown" }));
          send({ type: "error", errorText: failure(error) });
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }
      }
    },
    cancel() { abort.abort(); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "x-vercel-ai-ui-message-stream": "v1" } });
}
