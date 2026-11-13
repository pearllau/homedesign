import type { InferEnv, UnwrapConfig } from "cf/config";
import type config from "../cloudflare.config";
import { handleDesignChat } from "./server/design-chat";
import { handleFloorPlanRecognition } from "./server/floorplan-recognition";

type Env = InferEnv<UnwrapConfig<typeof config.worker>>;

const worker = {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (new URL(request.url).pathname === "/api/floorplan/recognize") {
      return handleFloorPlanRecognition(request, { ai: env.AI });
    }
    if (new URL(request.url).pathname === "/api/chat") {
      return handleDesignChat(request, { apiKey: env.DEEPSEEK_API_KEY, model: env.DEEPSEEK_MODEL });
    }
    return import("vinext/server/fetch-handler").then(({ default: app }) => app.fetch(request, env, ctx));
  },
};

export default worker;
