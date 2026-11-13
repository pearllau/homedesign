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
  const vision = checkOpenAICompatibleVisionConfig(config).ready ? createOpenAICompatibleFloorPlanVision(config) : undefined;
  return handleFloorPlanRecognition(request, { vision });
}
