import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { selectPriceBook } from "../shared/price-book-selection";
export { validPriceQuery } from "../shared/price-book-selection";

/** Node host loader. Each request chooses the newest validated import on disk. */
export async function getPriceBook(city = "national", period?: string) {
  const directory = join(process.cwd(), "data", "prices");
  let names: string[] = [];
  try { names = await readdir(directory); } catch { /* bundled baseline remains available */ }
  return selectPriceBook({ filenames: names, read: async (filename) => JSON.parse(await readFile(join(directory, filename), "utf8")) }, city, period);
}
