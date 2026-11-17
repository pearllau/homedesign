/// <reference types="vite/client" />
import { selectPriceBook } from "../shared/price-book-selection";

// Vite embeds every archived book into the server bundle. Neither the imports
// nor source files are emitted into public assets or fetched from a client URL.
const modules = import.meta.glob("../../data/prices/*.json", { eager: true, import: "default" });
const books = Object.fromEntries(Object.entries(modules).map(([path, book]) => [path.slice(path.lastIndexOf("/") + 1), book]));

export function getWorkerPriceBook(city = "national", period?: string) {
  return selectPriceBook({ filenames: Object.keys(books), read: (filename) => books[filename] }, city, period);
}
