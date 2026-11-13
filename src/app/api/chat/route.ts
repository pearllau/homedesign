import { handleDesignChat } from "@/server/ai/design-chat";
import { deepseekEnv } from "@/server/env";

export function POST(req: Request) {
  return handleDesignChat(req, deepseekEnv());
}
