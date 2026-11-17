// Pure calculations shared by both the AI SDK tools and the lightweight Worker API.
import { fallbackPriceBook, type PriceBook, type PriceMeta, type PriceStyle } from "./prices";

export type BudgetRange = { low: number; mid: number; high: number };
export type BudgetItem = BudgetRange & {
  category: string;
  item: string;
  /** Backwards-compatible value used by the existing plan schema/UI. */
  cost: number;
};

function round(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) throw new Error("Invalid budget amount");
  return Math.max(0, Math.round(value));
}

function findStyle(style: string, book: PriceBook): PriceStyle | undefined {
  const normalized = style.trim().toLowerCase();
  const exact = book.styles.find((item) => item.id.toLowerCase() === normalized || item.name.toLowerCase() === normalized);
  if (exact) return exact;
  const match = book.styles.find((item) => normalized.includes(item.name.toLowerCase()));
  const alias = /日|原木|禅/.test(style) ? "japanese-wood" : /欧/.test(style) ? "european" : /美/.test(style) ? "american" : /中/.test(style) ? "chinese" : /奢/.test(style) ? "light-luxury" : /简/.test(style) ? "minimal" : "default";
  const generic = book.styles.find((item) => item.id === "default" || item.name === "通用");
  return match ?? book.styles.find((item) => item.id === alias) ?? generic;
}

function allowanceRange(book: PriceBook, id: string): BudgetRange {
  const item = book.allowances?.find((entry) => entry.id === id);
  return item ? { low: item.low, mid: item.mid, high: item.high } : { low: 0, mid: 0, high: 0 };
}

function basisFor(book: PriceBook, style: string, styleFromFallback: boolean): PriceMeta & { style: string; fallbackReason?: string } {
  const hasFallbackAllowances = book.allowances?.some((item) => item.confidence === "fallback") ?? false;
  const fallbackReason = [
    book.meta.fallbackReason ?? "",
    styleFromFallback ? "当前信息价未提供风格综合单价，硬装使用项目内置离线规划基准。" : "",
    hasFallbackAllowances ? "家具、家电和软装使用项目内置离线规划基准。" : "",
  ].filter((reason, index, reasons) => reason && reasons.indexOf(reason) === index).join(" ");
  return {
    ...book.meta,
    source: styleFromFallback
      ? "项目内置离线规划基准（硬装、家具、家电与软装）"
      : hasFallbackAllowances && book.meta.confidence !== "fallback"
        ? `${book.meta.source}（硬装） + 项目内置离线规划基准（家具、家电与软装）`
        : book.meta.source,
    sourceUrl: styleFromFallback ? "" : book.meta.sourceUrl,
    style,
    methodology: "硬装综合单价 × 建筑面积；家具与家电按空间数量估算，软装按建筑面积估算。全屋规划预算与地面材料信息价估算分别列示，不以材料均价替代综合单价。",
    confidence: styleFromFallback || hasFallbackAllowances ? "fallback" : book.meta.confidence,
    ...(fallbackReason ? { fallbackReason } : {}),
  };
}
export function calculateArea({ width, length }: { width: number; length: number }) {
  return { area: Math.round(width * length * 100) / 100, width, length };
}

export function calculateBudget({ style, totalArea, roomCount, budgetCap, priceBook }: { style: string; totalArea: number; roomCount: number; budgetCap?: number; priceBook?: PriceBook }) {
  if (typeof style !== "string" || !style.trim() || style.length > 1000
    || !Number.isFinite(totalArea) || totalArea <= 0 || totalArea > 1000000
    || !Number.isInteger(roomCount) || roomCount < 1 || roomCount > 100
    || budgetCap != null && (!Number.isSafeInteger(budgetCap) || budgetCap <= 0)) throw new Error("Invalid budget input");
  const supplied = priceBook ?? fallbackPriceBook();
  const baseline = fallbackPriceBook();
  const suppliedStyle = findStyle(style, supplied);
  const selectedStyle = suppliedStyle ?? findStyle(style, baseline);
  const styleFromFallback = !suppliedStyle;
  const book = {
    ...supplied,
    allowances: [
      ...(baseline.allowances ?? []).filter((item) => !supplied.allowances?.some((entry) => entry.id === item.id)),
      ...(supplied.allowances ?? []),
    ],
  };
  const hard = selectedStyle ?? { low: 0, mid: 0, high: 0 };
  const furniture = allowanceRange(book, "furniture");
  const appliances = allowanceRange(book, "appliances");
  const soft = allowanceRange(book, "soft-furnishing");
  const items: BudgetItem[] = [
    { category: "硬装", item: "基础施工 + 主材", ...Object.fromEntries((["low", "mid", "high"] as const).map((key) => [key, round(totalArea * hard[key])])) as BudgetRange, cost: round(totalArea * hard.mid) },
    { category: "家具", item: "全屋家具", low: round(roomCount * furniture.low), mid: round(roomCount * furniture.mid), high: round(roomCount * furniture.high), cost: round(roomCount * furniture.mid) },
    { category: "家电", item: "全屋家电", low: round(roomCount * appliances.low), mid: round(roomCount * appliances.mid), high: round(roomCount * appliances.high), cost: round(roomCount * appliances.mid) },
    { category: "软装", item: "窗帘灯具装饰", low: round(totalArea * soft.low), mid: round(totalArea * soft.mid), high: round(totalArea * soft.high), cost: round(totalArea * soft.mid) },
  ];
  const natural = (key: keyof BudgetRange) => round(items.reduce((sum, item) => sum + item[key], 0));
  const naturalRange = { low: natural("low"), mid: natural("mid"), high: natural("high") };
  // A user's cap is a planning constraint, not a reason to falsify the
  // reference prices. Preserve the market interval and expose any overage.
  const total = naturalRange.mid;
  const overBudget = budgetCap != null && budgetCap > 0 && total > budgetCap;
  return {
    total,
    low: naturalRange.low,
    mid: naturalRange.mid,
    high: naturalRange.high,
    items,
    basis: basisFor(book, style, styleFromFallback),
    naturalRange,
    ...(budgetCap != null && budgetCap > 0 ? { budgetCap, overBudget, ...(overBudget ? { overBy: total - budgetCap } : {}) } : {}),
  };
}
