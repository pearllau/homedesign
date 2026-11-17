import { handleDesignChat } from "@/server/ai/design-chat";
import { deepseekEnv } from "@/server/env";
import { getPriceBook } from "@/server/prices";

export async function POST(req: Request) {
  return handleDesignChat(req, { ...deepseekEnv(), priceBook: await getPriceBook() });
}
