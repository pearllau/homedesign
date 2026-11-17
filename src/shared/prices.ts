/**
 * Price book contract shared by the budget calculator, API and viewer.
 *
 * The checked-in data is deliberately marked as a fallback baseline. Official
 * monthly sheets can be imported with scripts/import-price-book.mjs; the UI
 * must keep the source, period and confidence beside every estimate.
 */
import baseline from "../../data/prices/national-2026-11.json" with { type: "json" };

export type PriceConfidence = "official" | "provincial" | "fallback";

export type PriceMaterial = {
  id: string;
  name: string;
  spec?: string;
  unit: "元/㎡" | string;
  low: number;
  mid: number;
  high: number;
  sampleCities?: number;
  sampleCityNames?: string[];
  labor?: number;
  brandTier?: string;
  fallback?: boolean;
  fallbackSource?: string;
  /** Provenance for this row after official/fallback merge. */
  confidence?: PriceConfidence;
  source?: string;
  sourceUrl?: string;
  period?: string;
};

export type PriceStyle = {
  id: string;
  name: string;
  spec?: string;
  unit: "元/㎡" | string;
  low: number;
  mid: number;
  high: number;
  sampleCities?: number;
  sampleCityNames?: string[];
};

export type PriceAllowance = {
  id: string;
  name: string;
  unit: "元/间" | "元/㎡";
  low: number;
  mid: number;
  high: number;
  source: string;
  confidence: PriceConfidence;
};

export type PriceSourceProvenance = {
  publishedAt?: string | null;
  downloadUrl?: string;
  downloadedAt?: string;
  sourceFile?: string;
  sourceFileSha256?: string;
};

export type PriceMeta = PriceSourceProvenance & {
  city: string;
  cityName: string;
  period: string;
  scope?: string;
  sampleCities?: number;
  sampleCityNames?: string[];
  plannedCities?: string[];
  sources?: (PriceSourceProvenance & { city: string; cityName: string; source: string; sourceUrl: string; period: string })[];
  fallbackReason?: string;
  source: string;
  sourceUrl: string;
  fetchedAt: string;
  methodology: string;
  priceBasis?: string;
  confidence: PriceConfidence;
  dataStatus?: "official" | "provincial" | "baseline" | "pending-import";
  /** Counts describe the material rows returned by the selected book. */
  materialCount?: number;
  officialMaterialCount?: number;
  fallbackMaterialCount?: number;
  coverage?: "official" | "mixed" | "fallback";
};

export type PriceBook = {
  meta: PriceMeta;
  materials: PriceMaterial[];
  styles: PriceStyle[];
  allowances?: PriceAllowance[];
  fallbackUsed: boolean;
  selectedCity: string;
};

export type PriceBookFile = {
  meta: PriceMeta;
  national?: { materials: PriceMaterial[]; styles: PriceStyle[]; allowances?: PriceAllowance[] };
  cities?: Record<string, { name: string; materials: PriceMaterial[]; styles: PriceStyle[]; status?: string; meta?: PriceMeta }>;
  materials?: PriceMaterial[];
  styles?: PriceStyle[];
  allowances?: PriceAllowance[];
  fallbackUsed?: boolean;
};

const BASELINE = baseline as PriceBookFile;
export const DEFAULT_PRICE_PERIOD = BASELINE.meta.period;
export const DEFAULT_PRICE_CITY = "national";

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validMaterial(value: unknown): value is PriceMaterial {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PriceMaterial>;
  return typeof item.id === "string" && typeof item.name === "string" && typeof item.spec === "string" && item.spec.trim().length > 0 && item.unit === "元/㎡"
    && finite(item.low) && finite(item.mid) && finite(item.high)
    && item.low >= 0 && item.low <= item.mid && item.mid <= item.high
    && (item.labor === undefined || finite(item.labor) && item.labor >= 0);
}

function validStyle(value: unknown): value is PriceStyle {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PriceStyle>;
  return typeof item.id === "string" && typeof item.name === "string" && item.unit === "元/㎡"
    && finite(item.low) && finite(item.mid) && finite(item.high)
    && item.low >= 0 && item.low <= item.mid && item.mid <= item.high;
}

function materials(value: unknown): PriceMaterial[] {
  if (!Array.isArray(value) || !value.every(validMaterial)) throw new Error("Invalid material price rows");
  return value;
}

function styles(value: unknown): PriceStyle[] {
  if (!Array.isArray(value) || !value.every(validStyle)) throw new Error("Invalid style price rows");
  return value;
}

function validSourceUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
}

function validProvenance(value: PriceSourceProvenance): boolean {
  const hasProvenance = [value.downloadUrl, value.downloadedAt, value.sourceFile, value.sourceFileSha256].some((field) => field !== undefined);
  if (!hasProvenance) return true; // Previously archived books retain their legacy contract.
  return typeof value.publishedAt === "string" && Number.isFinite(Date.parse(value.publishedAt))
    && validSourceUrl(value.downloadUrl)
    && typeof value.downloadedAt === "string" && Number.isFinite(Date.parse(value.downloadedAt))
    && typeof value.sourceFileSha256 === "string" && /^[a-f0-9]{64}$/.test(value.sourceFileSha256)
    && typeof value.sourceFile === "string" && value.sourceFile.startsWith("data/price-sources/")
    && !value.sourceFile.includes("\\") && value.sourceFile.split("/").every((part) => part !== ".." && part !== "");
}

function validMeta(value: unknown): value is PriceMeta {
  if (!value || typeof value !== "object") return false;
  const meta = value as Partial<PriceMeta>;
  if (typeof meta.city !== "string" || !/^[a-z][a-z0-9-]{0,30}$/.test(meta.city)
    || typeof meta.cityName !== "string" || !meta.cityName.trim()
    || typeof meta.period !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(meta.period)
    || !["official", "provincial", "fallback"].includes(meta.confidence ?? "")
    || typeof meta.source !== "string" || !meta.source.trim()
    || typeof meta.methodology !== "string" || !meta.methodology.trim()
    || typeof meta.sourceUrl !== "string"
    || typeof meta.fetchedAt !== "string" || !Number.isFinite(Date.parse(meta.fetchedAt))
    || meta.publishedAt != null && (typeof meta.publishedAt !== "string" || !Number.isFinite(Date.parse(meta.publishedAt)))
    || !validProvenance(meta)) return false;
  if (meta.sources !== undefined && (!Array.isArray(meta.sources) || !meta.sources.every((item) => item && typeof item === "object"
    && typeof item.city === "string" && /^[a-z][a-z0-9-]{0,30}$/.test(item.city)
    && typeof item.cityName === "string" && item.cityName.trim()
    && typeof item.source === "string" && item.source.trim()
    && item.period === meta.period && validSourceUrl(item.sourceUrl) && validProvenance(item)))) return false;
  if (meta.sourceUrl !== "" && !validSourceUrl(meta.sourceUrl)) return false;
  return meta.confidence === "fallback"
    || meta.priceBasis === "material-only;waste-excluded" && (validSourceUrl(meta.sourceUrl) || !!meta.sources?.length);
}

function sameNames(actual: unknown, expected: string[]): boolean {
  return Array.isArray(actual) && actual.every((name) => typeof name === "string")
    && actual.length === expected.length && new Set(actual).size === actual.length
    && expected.every((name) => actual.includes(name));
}

/** A national average must be reproducible from its preserved city inputs. */
function validNationalSamples(file: PriceBookFile, national: { materials: PriceMaterial[]; styles: PriceStyle[] }): boolean {
  const sources = file.meta.sources;
  const cities = Object.entries(file.cities ?? {});
  if (!sources?.length || file.meta.sampleCities !== sources.length
    || new Set(sources.map((source) => source.city)).size !== sources.length
    || sources.some((source) => source.city === DEFAULT_PRICE_CITY)
    || cities.length !== sources.length
    || !sameNames(file.meta.sampleCityNames, sources.map((source) => source.cityName))) return false;
  for (const source of sources) {
    const city = file.cities?.[source.city];
    if (!city?.meta || !city.materials.length || city.name !== source.cityName
      || source.cityName !== city.meta.cityName || source.source !== city.meta.source || source.sourceUrl !== city.meta.sourceUrl
      || source.period !== city.meta.period || city.meta.priceBasis !== file.meta.priceBasis
      || ["publishedAt", "downloadUrl", "downloadedAt", "sourceFile", "sourceFileSha256"].some((field) => {
        const key = field as keyof PriceSourceProvenance;
        return source[key] !== undefined && source[key] !== city.meta![key];
      })) return false;
  }
  if (file.meta.confidence !== (cities.every(([, city]) => city.meta?.confidence === "official") ? "official" : "provincial")) return false;
  for (const key of ["materials", "styles"] as const) {
    const rows = national[key];
    const allIds = new Set(cities.flatMap(([, city]) => city[key].map((row) => row.id)));
    if (rows.length !== allIds.size || rows.some((row) => !allIds.has(row.id))) return false;
    for (const row of rows) {
      const participants = cities.flatMap(([, city]) => {
        const item = city[key].find((item) => item.id === row.id);
        return item ? [{ name: city.name, item }] : [];
      });
      if (row.sampleCities !== participants.length || !sameNames(row.sampleCityNames, participants.map((participant) => participant.name))
        || participants.some(({ item }) => item.spec !== row.spec || item.unit !== row.unit)) return false;
      for (const field of ["low", "mid", "high"] as const) {
        const mean = Math.round(participants.reduce((sum, participant) => sum + participant.item[field], 0) / participants.length * 100) / 100;
        if (Math.abs(row[field] - mean) > 0.000001) return false;
      }
    }
  }
  return true;
}

/** Reject a whole malformed import, rather than silently serving partial data. */
export function validatePriceBookFile(file: unknown): file is PriceBookFile {
  if (!file || typeof file !== "object") return false;
  const candidate = file as PriceBookFile;
  const meta = candidate.meta;
  if (!validMeta(meta)) return false;
  try {
    const root = candidate.national ?? { materials: candidate.materials, styles: candidate.styles ?? [] };
    if (!materials(root.materials).length) return false;
    if (meta.confidence !== "fallback" && (meta.priceBasis !== "material-only;waste-excluded" || materials(root.materials).some((row) => !row.spec?.trim()))) return false;
    const rootStyles = styles(root.styles);
    if (new Set(rootStyles.map((row) => row.id)).size !== rootStyles.length) return false;
    for (const [cityId, city] of Object.entries(candidate.cities ?? {})) {
      if (!/^[a-z][a-z0-9-]{0,30}$/.test(cityId) || typeof city.name !== "string" || !city.name.trim()) return false;
      const cityMaterials = materials(city.materials);
      if (new Set(cityMaterials.map((row) => row.id)).size !== cityMaterials.length) return false;
      const cityStyles = styles(city.styles);
      if (new Set(cityStyles.map((row) => row.id)).size !== cityStyles.length) return false;
      // Empty pending-import placeholders are allowed only in the offline
      // baseline. Every usable city source must preserve its own provenance.
      if (city.meta !== undefined || cityMaterials.length || cityStyles.length || meta.confidence !== "fallback") {
        if (!validMeta(city.meta) || city.meta.city !== cityId || city.meta.cityName !== city.name || city.meta.period !== meta.period) return false;
        if (meta.confidence !== "fallback" && city.meta.confidence === "fallback") return false;
      }
    }
    const ids = materials(root.materials).map((row) => row.id);
    if (new Set(ids).size !== ids.length) return false;
    if (meta.city === DEFAULT_PRICE_CITY && meta.confidence !== "fallback" && !validNationalSamples(candidate, { materials: root.materials!, styles: rootStyles })) return false;
    if ((candidate.national?.allowances ?? candidate.allowances ?? []).some((row) => !finite(row.low) || !finite(row.mid) || !finite(row.high) || row.low < 0 || row.low > row.mid || row.mid > row.high || !["元/㎡", "元/间"].includes(row.unit))) return false;
    return true;
  } catch { return false; }
}

function cityMeta(meta: PriceMeta, city: string, cityName: string, fallback: boolean): PriceMeta {
  return {
    ...meta,
    city,
    cityName,
    ...(fallback && !meta.fallbackReason ? { fallbackReason: meta.confidence === "fallback" ? "尚无已导入的官方城市信息价，使用项目内置离线基准。" : "该来源缺少部分材料，缺项按项目内置离线基准补齐。" } : {}),
  };
}

function materialWithProvenance(item: PriceMaterial, meta: PriceMeta, fallback: boolean): PriceMaterial {
  return {
    ...item,
    fallback,
    ...(fallback ? { fallbackSource: "项目内置离线基准", confidence: "fallback" as const, source: "项目内置离线基准", sourceUrl: "", period: BASELINE.meta.period } : {
      confidence: meta.confidence,
      source: meta.source,
      sourceUrl: meta.sourceUrl,
      period: meta.period,
    }),
  };
}

/** Convert the checked-in national/city file to the stable API shape. */
export function loadPriceBook(city = DEFAULT_PRICE_CITY, period = DEFAULT_PRICE_PERIOD, file: PriceBookFile = BASELINE): PriceBook {
  const requested = city.trim().toLowerCase() || DEFAULT_PRICE_CITY;
  const national = file.national ?? { materials: file.materials ?? [], styles: file.styles ?? [] };
  const selected = requested !== DEFAULT_PRICE_CITY ? (file.meta.city === requested && file.materials ? { name: file.meta.cityName, materials: file.materials, styles: file.styles ?? [], meta: file.meta } : file.cities?.[requested]) : undefined;
  const selectedMaterials = materials(selected?.materials ?? []);
  const selectedStyles = styles(selected?.styles ?? []);
  const nationalMaterials = materials(national.materials);
  const nationalStyles = styles(national.styles);
  // Keep the imported source rows intact, then fill every supported baseline
  // material that is absent. This makes estimates complete while preserving
  // row-level provenance (official versus project offline baseline).
  const sourceMeta = selected?.meta ?? file.meta;
  const sourceRows = new Map<string, { item: PriceMaterial; meta: PriceMeta }>();
  // A city with no book explicitly falls back to the national scope. Once a
  // city has its own book, only its real rows are official; gaps use baseline.
  const useNational = requested === DEFAULT_PRICE_CITY || selectedMaterials.length === 0;
  const preferredRows = useNational ? nationalMaterials : selectedMaterials;
  const preferredMeta = useNational ? file.meta : sourceMeta;
  for (const item of preferredRows) sourceRows.set(item.id, { item, meta: preferredMeta });
  const baselineMaterials = materials(BASELINE.national?.materials ?? BASELINE.materials ?? []);
  const pickedSource = [...sourceRows.values()].map(({ item, meta: rowMeta }) => materialWithProvenance(item, rowMeta, rowMeta.confidence === "fallback"));
  const missingMaterialRows = baselineMaterials
    .filter((item) => !sourceRows.has(item.id))
    .map((item) => materialWithProvenance(item, BASELINE.meta, true));
  const pickedMaterials = [...pickedSource, ...missingMaterialRows];
  const missingStyleRows = requested === DEFAULT_PRICE_CITY ? [] : nationalStyles
    .filter((item) => !selectedStyles.some((selectedItem) => selectedItem.id === item.id))
    .map((item) => ({ ...item, fallback: true }));
  const pickedStyles = requested === DEFAULT_PRICE_CITY
    ? nationalStyles
    : [...missingStyleRows, ...selectedStyles.map((item) => ({ ...item, fallback: false }))];
  const fallbackUsed = pickedMaterials.some((item) => item.fallback === true)
    || (requested !== DEFAULT_PRICE_CITY && nationalStyles.some((item) => !selectedStyles.some((selectedItem) => selectedItem.id === item.id)))
    || file.fallbackUsed === true;
  const cityName = selectedMaterials.length ? selected?.name || file.meta.cityName : file.meta.cityName;
  // Never relabel an older book with a requested-but-unavailable period.
  const meta = cityMeta(selectedMaterials.length && selected?.meta ? selected.meta : file.meta, !selectedMaterials.length && fallbackUsed ? DEFAULT_PRICE_CITY : requested, cityName, fallbackUsed || file.fallbackUsed === true);
  void period;
  const allowances = (file.national?.allowances ?? file.allowances ?? BASELINE.national?.allowances ?? []).filter((item) => finite(item.low) && finite(item.mid) && finite(item.high) && item.low >= 0 && item.low <= item.mid && item.mid <= item.high);
  const officialMaterialCount = pickedMaterials.filter((item) => item.confidence === "official").length;
  const fallbackMaterialCount = pickedMaterials.filter((item) => item.confidence === "fallback").length;
  meta.materialCount = pickedMaterials.length;
  meta.officialMaterialCount = officialMaterialCount;
  meta.fallbackMaterialCount = fallbackMaterialCount;
  meta.coverage = fallbackMaterialCount === 0 ? (officialMaterialCount ? "official" : "fallback") : officialMaterialCount ? "mixed" : "fallback";
  if (fallbackMaterialCount > 0 && !meta.fallbackReason && meta.confidence !== "fallback") meta.fallbackReason = "该来源缺少部分材料，缺项按项目内置离线基准补齐。";
  // Imported JSON is reused by Worker isolates. A caller may annotate the
  // returned book without changing the source used by later requests.
  return structuredClone({ meta, materials: pickedMaterials, styles: pickedStyles, allowances, fallbackUsed: fallbackUsed || file.fallbackUsed === true, selectedCity: requested });
}

/** Always-safe data for the budget and viewer when an import is unavailable. */
export function fallbackPriceBook(): PriceBook {
  return loadPriceBook(DEFAULT_PRICE_CITY, DEFAULT_PRICE_PERIOD, BASELINE);
}

export function priceMaterial(book: PriceBook, id: string): PriceMaterial | undefined {
  return book.materials.find((item) => item.id === id);
}

export function priceRange(book: PriceBook, id: string, area: number, waste = 0.05) {
  const material = priceMaterial(book, id);
  if (!material) throw new Error("Unknown price material");
  if (!Number.isFinite(area) || area < 0 || area > 1000000 || !Number.isFinite(waste) || waste < 0 || waste > 0.5) throw new Error("Invalid price range input");
  const factor = 1 + waste;
  const amounts = [material.low, material.mid, material.high].map((unitPrice) => Math.round(area * unitPrice * factor));
  if (!amounts.every(Number.isFinite)) throw new Error("Price range overflow");
  return {
    low: amounts[0], mid: amounts[1], high: amounts[2],
    basis: book.meta,
  };
}

export type PriceEstimateInput = { key: string; materialId: string; area: number; includeInTotal?: boolean };
export type PriceEstimateItem = PriceEstimateInput & {
  low: number;
  mid: number;
  high: number;
  confidence?: PriceConfidence;
  source?: string;
  sourceUrl?: string;
  period?: string;
  fallback?: boolean;
};

/** IDs exposed by the floorplan viewer. A missing row is an honest partial quote,
 * while any other ID is a client contract error. */
export const SUPPORTED_MATERIAL_IDS = ["wood", "walnut", "tile800", "tile600", "marble", "antislip", "terrazzo", "carpet"] as const;
const SUPPORTED_MATERIAL_ID_SET = new Set<string>(SUPPORTED_MATERIAL_IDS);

export function parsePriceEstimateInputs(payload: unknown): PriceEstimateInput[] | null {
  if (!payload || typeof payload !== "object" || !("items" in payload) || !Array.isArray(payload.items) || payload.items.length > 200) return null;
  const items = payload.items as PriceEstimateInput[];
  if (items.some((item) => !item || typeof item.key !== "string" || !item.key || item.key.length > 100 || typeof item.materialId !== "string" || !item.materialId || item.materialId.length > 80 || !finite(item.area) || item.area < 0 || item.area > 1000000 || (item.includeInTotal !== undefined && typeof item.includeInTotal !== "boolean"))) return null;
  return new Set(items.map((item) => item.key)).size === items.length ? items : null;
}

/** Pricing arithmetic is intentionally server-side; clients only submit measured areas and IDs. */
export function calculatePriceEstimate(book: PriceBook, inputs: PriceEstimateInput[], waste = 0.05) {
  if (!Number.isFinite(waste) || waste < 0 || waste > 0.5) throw new Error("Invalid waste allowance");
  const factor = 1 + waste;
  const missingItems: PriceEstimateInput[] = [];
  const items: PriceEstimateItem[] = inputs.flatMap((input) => {
    const { key, materialId, area, includeInTotal = true } = input;
    if (!SUPPORTED_MATERIAL_ID_SET.has(materialId)) throw new Error("Invalid price estimate input");
    if (!Number.isFinite(area) || area < 0 || area > 1000000) throw new Error("Invalid price estimate input");
    const material = priceMaterial(book, materialId);
    if (!material) {
      missingItems.push({ key, materialId, area, ...(input.includeInTotal !== undefined ? { includeInTotal: input.includeInTotal } : {}) });
      return [];
    }
    const amounts = [material.low, material.mid, material.high].map((unitPrice) => Math.round(area * unitPrice * factor));
    if (!amounts.every(Number.isFinite)) throw new Error("Price estimate overflow");
    return [{
      key, materialId, area, includeInTotal,
      low: amounts[0], mid: amounts[1], high: amounts[2],
      confidence: material.confidence,
      source: material.source,
      sourceUrl: material.sourceUrl,
      period: material.period,
      fallback: material.fallback,
    }];
  });
  const totalItems = items.filter((item) => item.includeInTotal !== false);
  const totals = totalItems.length === 0 && missingItems.length > 0 ? null : totalItems.reduce((sum, item) => ({ low: sum.low + item.low, mid: sum.mid + item.mid, high: sum.high + item.high }), { low: 0, mid: 0, high: 0 });
  if (totals && !Object.values(totals).every(Number.isFinite)) throw new Error("Price estimate overflow");
  return {
    city: book.selectedCity,
    period: book.meta.period,
    items,
    totals,
    missingItems,
    partial: missingItems.length > 0,
    basis: book.meta,
    fallbackUsed: book.fallbackUsed,
  };
}

export function priceBookJson(book: PriceBook): string {
  return JSON.stringify(book);
}
