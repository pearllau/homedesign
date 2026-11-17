import type { InferEnv, UnwrapConfig } from "cf/config";
import type config from "../cloudflare.config";
import { handleDesignChat } from "./server/ai/design-chat";
import { handleFloorPlanRecognition } from "./server/ai/floorplan-recognition";
import { calculatePriceEstimate, parsePriceEstimateInputs } from "./shared/prices";
import { validPriceQuery } from "./shared/price-book-selection";
import { getWorkerPriceBook } from "./server/worker-prices";

type Env = InferEnv<UnwrapConfig<typeof config.worker>>;

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/api/floorplan/recognize") {
      return handleFloorPlanRecognition(request, { ai: env.AI });
    }
    if (url.pathname === "/api/prices") {
      if (request.method === "HEAD") return new Response(null, { headers: { "Cache-Control": "no-store" } });
      if (request.method !== "GET" && request.method !== "POST") return Response.json({ error: "不支持的请求方法" }, { status: 405, headers: { Allow: "GET, HEAD, POST", "Cache-Control": "no-store" } });
      const city = (url.searchParams.get("city") || url.searchParams.get("scope") || "national").trim().toLowerCase();
      const period = url.searchParams.get("period")?.trim() || undefined;
      if (!validPriceQuery(city, period)) return Response.json({ error: "城市或期号不正确" }, { status: 400, headers: { "Cache-Control": "no-store" } });
      const book = await getWorkerPriceBook(city, period);
      if (request.method === "POST") {
        if (Number(request.headers.get("Content-Length") || 0) > 65536) return Response.json({ error: "价格估算参数过大" }, { status: 413 });
        return request.text().then((raw) => {
          try { if (raw.length > 65536) throw new Error("too large"); const items = parsePriceEstimateInputs(JSON.parse(raw)); if (!items) throw new Error("invalid items"); return Response.json(calculatePriceEstimate(book, items), { headers: { "Cache-Control": "no-store" } }); }
          catch { return Response.json({ error: "价格估算参数不正确" }, { status: 400, headers: { "Cache-Control": "no-store" } }); }
        }).catch(() => Response.json({ error: "价格估算参数不正确" }, { status: 400, headers: { "Cache-Control": "no-store" } }));
      }
      return Response.json(book, { headers: { "Cache-Control": "no-store" } });
    }
    if (new URL(request.url).pathname === "/api/chat") {
      return handleDesignChat(request, { apiKey: env.DEEPSEEK_API_KEY, model: env.DEEPSEEK_MODEL, priceBook: await getWorkerPriceBook("national") });
    }
    return import("vinext/server/fetch-handler").then(({ default: app }) => app.fetch(request, env, ctx));
  },
};

export default worker;
