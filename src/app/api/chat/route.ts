import {
  Output,
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  safeValidateUIMessages,
  streamText,
  toUIMessageStream,
} from "ai";
import { deepseek } from "@ai-sdk/deepseek";
import { PLAN_SYSTEM_PROMPT, planSchema, planTools } from "@/lib/plan-config";

export async function POST(req: Request) {
  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || !("messages" in body)) {
    return Response.json({ error: "请提供有效的对话消息。" }, { status: 400 });
  }
  const validation = await safeValidateUIMessages({
    messages: body.messages,
    tools: planTools,
  });
  if (!validation.success || validation.data.length === 0) {
    return Response.json({ error: "对话消息格式不正确。" }, { status: 400 });
  }

  const result = streamText({
    model: deepseek(process.env.DEEPSEEK_MODEL || "deepseek-chat"),
    system: PLAN_SYSTEM_PROMPT,
    messages: await convertToModelMessages(validation.data),
    tools: planTools,
    output: Output.object({ schema: planSchema }),
    stopWhen: isStepCount(10),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream, tools: planTools }),
  });
}
