import { handleFloorPlanRecognition } from "@/server/ai/floorplan-recognition";
import { checkOpenAICompatibleVisionConfig, createOpenAICompatibleFloorPlanVision } from "@/server/ai/vision-provider";
import { visionEnv } from "@/server/env";

// Local Node.js liveness/readiness check; this only validates server settings
// and never calls the vision API or exposes their values.
export function GET() {
  const status = checkOpenAICompatibleVisionConfig(visionEnv());
  return Response.json(
    { status: status.ready ? "ready" : "not_configured", ...(status.ready ? {} : { reason: status.reason }) },
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
