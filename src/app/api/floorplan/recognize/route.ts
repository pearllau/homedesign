import { handleFloorPlanRecognition } from "@/server/floorplan-recognition";
import { checkOpenAICompatibleVisionConfig, createOpenAICompatibleFloorPlanVision } from "@/server/vision-provider";

function visionConfig() {
  return {
    apiKey: process.env.VISION_API_KEY || "",
    baseUrl: process.env.VISION_BASE_URL || "",
    model: process.env.VISION_MODEL || "",
  };
}

// Local Node.js liveness/readiness check; this only validates server settings
// and never calls the vision API or exposes their values.
export function GET() {
  const status = checkOpenAICompatibleVisionConfig(visionConfig());
  return Response.json(
    { status: status.ready ? "ready" : "not_configured", ...(status.ready ? {} : { reason: status.reason }) },
    { status: status.ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}

// Prefer a configured OpenAI-compatible vision API for local Node.js runtime.
// Cloudflare's Worker entrypoint supplies its native AI binding separately.
export function POST(request: Request) {
  const config = visionConfig();
  const vision = checkOpenAICompatibleVisionConfig(config).ready ? createOpenAICompatibleFloorPlanVision(config) : undefined;
  return handleFloorPlanRecognition(request, { vision });
}
