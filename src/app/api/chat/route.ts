import { handleDesignChat } from "@/server/design-chat";

export function POST(req: Request) {
  return handleDesignChat(req, { apiKey: process.env.DEEPSEEK_API_KEY, model: process.env.DEEPSEEK_MODEL });
}
