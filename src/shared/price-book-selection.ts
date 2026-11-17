import { DEFAULT_PRICE_PERIOD, fallbackPriceBook, loadPriceBook, validatePriceBookFile, type PriceBook, type PriceBookFile } from "./prices";

export type PriceBookSource = {
  filenames: readonly string[];
  read: (filename: string) => unknown | Promise<unknown>;
};

export function validPriceQuery(city: string, period?: string) {
  return /^[a-z][a-z0-9-]{0,30}$/.test(city) && (period === undefined || /^\d{4}-(0[1-9]|1[0-2])$/.test(period));
}

/** The disk and Worker adapters share selection, validation and fallback rules. */
export async function selectPriceBook(source: PriceBookSource, city = "national", period?: string) {
  if (!validPriceQuery(city, period)) return fallbackPriceBook();
  const names = new Set(source.filenames);
  const periods = [...new Set(source.filenames.flatMap((name) => {
    const match = /^[a-z][a-z0-9-]{0,30}-(\d{4}-(?:0[1-9]|1[0-2]))\.json$/.exec(name);
    return match ? [match[1]] : [];
  }))].sort().reverse();
  const choices = [...new Set([...(period ? [period] : []), ...periods, DEFAULT_PRICE_PERIOD])];
  const readBook = async (cityId: string, chosen: string): Promise<PriceBookFile | null> => {
    const filename = `${cityId}-${chosen}.json`;
    if (!names.has(filename)) return null;
    try {
      const parsed = await source.read(filename);
      return validatePriceBookFile(parsed) && parsed.meta.city === cityId && parsed.meta.period === chosen ? parsed : null;
    } catch { return null; }
  };
  const withRequestedPeriod = (book: PriceBook) => {
    if (period && book.meta.period !== period) {
      book.fallbackUsed = true;
      book.meta.fallbackReason = `未找到 ${period} 期有效数据，当前显示 ${book.meta.period} ${book.meta.confidence === "fallback" ? "离线基准版本（非官方期号）" : "期已归档参考价"}。`;
    }
    return book;
  };
  let archivedFallback: PriceBook | undefined;
  for (const chosen of choices) {
    const [national, local] = await Promise.all([readBook("national", chosen), city === "national" ? null : readBook(city, chosen)]);
    if (!national && !local) continue;
    const file = national ?? local!;
    const merged: PriceBookFile = local && national ? {
      ...national,
      cities: { ...national.cities, [city]: { name: local.meta.cityName, materials: local.materials ?? local.national?.materials ?? [], styles: local.styles ?? local.national?.styles ?? [], meta: local.meta } },
    } : file;
    const book = loadPriceBook(city, chosen, merged);
    // An explicitly requested archived version is honored. Without one, a
    // newer offline baseline must never hide a recent verified monthly source.
    if (period === chosen || book.meta.confidence !== "fallback") return withRequestedPeriod(book);
    archivedFallback ??= book;
  }
  return withRequestedPeriod(archivedFallback ?? { ...fallbackPriceBook(), selectedCity: city });
}
