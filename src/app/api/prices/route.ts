import { calculatePriceEstimate, parsePriceEstimateInputs } from "@/shared/prices";
import { getPriceBook, validPriceQuery } from "@/server/prices";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const city = (url.searchParams.get("city") || url.searchParams.get("scope") || "national").trim().toLowerCase();
  const period = url.searchParams.get("period")?.trim() || undefined;
  if (!validPriceQuery(city, period)) return Response.json({ error: "城市或期号不正确" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const book = await getPriceBook(city, period);
  return Response.json(book, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const city = (url.searchParams.get("city") || url.searchParams.get("scope") || "national").trim().toLowerCase();
  const period = url.searchParams.get("period")?.trim() || undefined;
  if (Number(request.headers.get("Content-Length") || 0) > 65536) return Response.json({ error: "价格估算参数过大" }, { status: 413 });
  const raw = await request.text().catch(() => "");
  if (raw.length > 65536) return Response.json({ error: "价格估算参数过大" }, { status: 413 });
  let payload: unknown = null;
  try { payload = JSON.parse(raw); } catch { /* malformed payload is rejected below */ }
  const items = parsePriceEstimateInputs(payload);
  if (!items) {
    return Response.json({ error: "价格估算项不正确" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (!validPriceQuery(city, period)) return Response.json({ error: "城市或期号不正确" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const book = await getPriceBook(city, period);
  try {
    return Response.json(calculatePriceEstimate(book, items), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "缺少对应材料的有效参考价" }, { status: 422, headers: { "Cache-Control": "no-store" } });
  }
}

export function HEAD() {
  return new Response(null, { headers: { "Cache-Control": "no-store" } });
}
