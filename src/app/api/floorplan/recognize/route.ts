import { FLOORPLAN_VISION_MODEL, handleFloorPlanRecognition } from "@/server/ai/floorplan-recognition";
import { checkOpenAICompatibleVisionConfig, createOpenAICompatibleFloorPlanVision } from "@/server/ai/vision-provider";
import { visionEnv } from "@/server/env";

const WARM_INTERVAL_MS = 3 * 60_000;
const WARM_IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAeklEQVRogdXOQREAAAyDMPybZiL62BEFwTiMwziMwziMwziMwziMwziMwziMwziMwziMwziMwziMwziMwziMwziMwziMwziMwziMwziMwziMwziMwziMwziMwziMwziMwziMwziMwziMwzi+A6sDylPSwurF5TQAAAAASUVORK5CYII=";
let warming = false;
let warmAt = 0;

// 视觉模型空闲一段时间后的第一次请求会明显变慢（模型侧冷启动，实测可到 60 秒以上），
// 第二次才回到 20 秒左右。弹窗打开时先打一发最小请求预热，把这段等待挪到用户选图、
// 裁剪的时候，而不是让他们盯着「正在识别」转圈。
function warmUp() {
  if (warming || Date.now() - warmAt < WARM_INTERVAL_MS) return false;
  const config = visionEnv();
  if (!checkOpenAICompatibleVisionConfig(config).ready) return false;
  warming = true;
  warmAt = Date.now();
  const vision = createOpenAICompatibleFloorPlanVision({ ...config, disableThinking: true });
  void vision.run(FLOORPLAN_VISION_MODEL, {
    messages: [{ role: "user", content: [{ type: "text", text: "预热：只回复 {\"ok\":true}" }, { type: "image_url", image_url: { url: WARM_IMAGE } }] }],
    guided_json: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
    max_tokens: 8,
    temperature: 0,
  }, { signal: AbortSignal.timeout(120_000) }).catch(() => undefined).finally(() => { warming = false; });
  return true;
}

// Local Node.js liveness/readiness check; this only validates server settings
// and never exposes their values. ?warm=1 additionally fires a tiny request.
export function GET(request: Request) {
  const status = checkOpenAICompatibleVisionConfig(visionEnv());
  const warmed = new URL(request.url).searchParams.get("warm") === "1" ? warmUp() : false;
  return Response.json(
    { status: status.ready ? "ready" : "not_configured", warmed, ...(status.ready ? {} : { reason: status.reason }) },
    { status: status.ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}

// Prefer a configured OpenAI-compatible vision API for local Node.js runtime.
// Cloudflare's Worker entrypoint supplies its native AI binding separately.
export function POST(request: Request) {
  const config = visionEnv();
  if (!checkOpenAICompatibleVisionConfig(config).ready) return handleFloorPlanRecognition(request, {});
  // 快路径关闭思考（约 7 秒）；只有快路径修复后仍不成形时，才降级到低强度思考重试。
  return handleFloorPlanRecognition(request, {
    vision: createOpenAICompatibleFloorPlanVision({ ...config, disableThinking: true }),
    fallbackVision: createOpenAICompatibleFloorPlanVision({ ...config, disableThinking: false, reasoningEffort: "low" }),
  });
}
