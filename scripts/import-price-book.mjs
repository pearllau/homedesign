#!/usr/bin/env node
import { readFile, readdir, mkdir, writeFile, rename, rm } from "node:fs/promises";
import { basename, extname, join, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const CITY_NAMES = Object.freeze({
  national: "全国平均",
  beijing: "北京",
  shanghai: "上海",
  guangzhou: "广州",
  shenzhen: "深圳",
  chengdu: "成都",
  hangzhou: "杭州",
  nanjing: "南京",
  wuhan: "武汉",
});
const CITY_NAME_ALIASES = Object.freeze({ national: new Set(["全国平均", "全国基准"]) });
const CITY_ID_PATTERN = /^[a-z][a-z0-9-]{0,30}$/;
const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const MATERIAL_IDS = new Set(["wood", "walnut", "tile800", "tile600", "marble", "antislip", "terrazzo", "carpet"]);

const args = process.argv.slice(2);
function fail(message) { throw new Error(message); }
function arg(name, required = false) {
  const index = args.indexOf(name), value = index >= 0 ? args[index + 1] : undefined;
  if (required && (!value || value.startsWith("--"))) fail(`${name} is required`);
  return value;
}
function number(value, label) {
  if (value == null || String(value).trim() === "") fail(`${label} is required`);
  const parsed = Number(String(value).replaceAll(",", "").trim());
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100000) fail(`${label} is outside 0..100000`);
  return parsed;
}
function text(value, label) { if (!String(value ?? "").trim()) fail(`${label} is required`); return String(value).trim(); }
function sourceUrl(value) { try { if (["http:", "https:"].includes(new URL(value).protocol)) return value; } catch {} fail("source-url must be a valid http(s) URL"); }
function timestamp(value, label) {
  if (typeof value !== "string" || !value.trim() || !Number.isFinite(Date.parse(value))) fail(`${label} must be a valid date`);
  return value;
}
function privateSourcePath(value) {
  return typeof value === "string" && value.startsWith("data/price-sources/") && !value.includes("\\") && !isAbsolute(value) && !value.split("/").some((part) => part === ".." || !part);
}
function validateProvenance(meta, label) {
  if (meta.confidence !== "official") return;
  timestamp(meta.publishedAt, `${label}.publishedAt`);
  sourceUrl(meta.downloadUrl);
  timestamp(meta.downloadedAt, `${label}.downloadedAt`);
  if (!/^[a-f0-9]{64}$/.test(meta.sourceFileSha256 || "")) fail(`${label}.sourceFileSha256 must be a full SHA256`);
  if (!privateSourcePath(meta.sourceFile)) fail(`${label}.sourceFile must stay in data/price-sources/`);
}
function canonicalFile(name) {
  const match = name.match(/^([a-z][a-z0-9-]{0,30})-(\d{4}-(?:0[1-9]|1[0-2]))\.json$/);
  return match ? { city: match[1], period: match[2] } : null;
}
function validateMetaIdentity(meta, city, period, label) {
  if (meta.city !== undefined && meta.city !== city) fail(`${label}: meta.city must match ${city}`);
  if (meta.period !== undefined && meta.period !== period) fail(`${label}: meta.period must match ${period}`);
  const expected = CITY_NAMES[city];
  if (expected && meta.cityName !== undefined && meta.cityName !== expected && !(CITY_NAME_ALIASES[city]?.has(meta.cityName))) {
    fail(`${label}: meta.cityName must be ${expected}`);
  }
  if (!expected && meta.cityName !== undefined && !String(meta.cityName).trim()) fail(`${label}: meta.cityName is required for an unlisted city`);
}
function cityNameFor(meta, city, label) {
  const expected = CITY_NAMES[city];
  const value = String(meta.cityName || expected || "").trim();
  if (!value) fail(`${label}: meta.cityName is required for an unlisted city`);
  if (expected && value !== expected && !(CITY_NAME_ALIASES[city]?.has(value))) fail(`${label}: meta.cityName must be ${expected}`);
  return expected || value;
}
function csvRows(input) {
  const rows = []; let row = [], cell = "", quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"' && quoted && input[i + 1] === '"') { cell += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((ch === "\n" || ch === "\r") && !quoted) { if (ch === "\r" && input[i + 1] === "\n") i++; row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (quoted) fail("CSV contains an unclosed quoted field");
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) fail("CSV requires headers and data");
  const headers = rows.shift().map((v) => v.replace(/^\uFEFF/, "").toLowerCase());
  if (new Set(headers).size !== headers.length) fail("CSV headers must be unique");
  return rows.map((values) => { if (values.length !== headers.length) fail("CSV column count does not match headers"); return Object.fromEntries(values.map((v, i) => [headers[i], v])); });
}
function normalise(row, label) {
  const id = text(row.id ?? row.material_id, `${label}.id`), name = text(row.name ?? row.material, `${label}.name`);
  if (!/^[a-z][a-z0-9-]{0,79}$/.test(id)) fail(`${id}: use a safe lowercase ID`);
  if (!label.includes("styles") && !MATERIAL_IDS.has(id)) fail(`${id}: material ID is not used by the application; do not approximate an unmapped material`);
  const low = number(row.low, `${id}.low`), mid = number(row.mid, `${id}.mid`), high = number(row.high, `${id}.high`);
  if (low > mid || mid > high) fail(`${id}: low <= mid <= high is required`);
  if (!label.includes("styles") && (low !== mid || mid !== high)) fail(`${id}: source material quotes must use low=mid=high; do not invent a price interval`);
  if (!["元/㎡", "元/m²", "元/平方米", "CNY/m²"].includes(row.unit)) fail(`${id}: convert unit to 元/㎡ before import`);
  return { id, name, spec: label.includes("styles") ? String(row.spec || "").trim() : text(row.spec, `${id}.spec`), unit: "元/㎡", low, mid, high, ...(row.labor !== undefined && row.labor !== "" ? { labor: number(row.labor, `${id}.labor`) } : {}), ...(row.brandTier || row.brandtier ? { brandTier: row.brandTier || row.brandtier } : {}) };
}
function rows(value, label, required = false) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  const result = value.map((row) => normalise(row, label));
  if (required && !result.length) fail("at least one material is required");
  if (new Set(result.map((row) => row.id)).size !== result.length) fail(`${label} IDs must be unique`);
  return result;
}
function average(books, key) {
  const grouped = new Map();
  for (const book of books) for (const item of book[key] || []) {
    const previous = grouped.get(item.id) || [];
    if (previous.some((p) => p.item.spec !== item.spec || p.item.unit !== item.unit || p.book.meta.priceBasis !== book.meta.priceBasis)) fail(`${item.id}: mismatched specification, unit or price basis across cities; use distinct material IDs`);
    previous.push({ item, book }); grouped.set(item.id, previous);
  }
  return [...grouped.values()].map((list) => {
    const avg = (field) => Math.round(list.reduce((sum, p) => sum + p.item[field], 0) / list.length * 100) / 100;
    const first = list[0].item;
    return { ...first, low: avg("low"), mid: avg("mid"), high: avg("high"), ...(list.every((p) => Number.isFinite(p.item.labor)) ? { labor: avg("labor") } : { labor: undefined }), sampleCities: list.length, sampleCityNames: list.map((p) => p.book.meta.cityName) };
  });
}
async function atomic(path, bytes) { const temp = `${path}.${process.pid}.tmp`; try { await writeFile(temp, bytes, "utf8"); await rename(temp, path); } finally { await rm(temp, { force: true }); } }

try {
  const input = resolve(arg("--input", true)), city = arg("--city", true).toLowerCase(), period = arg("--period", true);
  const source = arg("--source", true), url = sourceUrl(arg("--source-url", true)), dryRun = args.includes("--dry-run");
  if (!CITY_ID_PATTERN.test(city) || city === "national") fail("city must be a city ID, not national");
  if (!PERIOD_PATTERN.test(period)) fail("period must be YYYY-MM");
  if (![".csv", ".json"].includes(extname(input).toLowerCase())) fail("This release imports CSV/JSON. Export Excel to UTF-8 CSV first; keep the original workbook in data/price-sources.");
  const raw = await readFile(input, "utf8");
  const csv = extname(input).toLowerCase() === ".csv" ? csvRows(raw) : null;
  const parsed = csv ? { materials: csv.filter((row)=>!row.type || row.type==="material"), styles: csv.filter((row)=>row.type==="style") } : JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("input must be a JSON object");
  if (parsed.meta !== undefined && (!parsed.meta || typeof parsed.meta !== "object" || Array.isArray(parsed.meta))) fail("input.meta must be an object");
  const originalMeta = parsed.meta || {}, inputFile = canonicalFile(basename(input));
  if (inputFile && (inputFile.city !== city || inputFile.period !== period)) fail(`input filename must match ${city}-${period}.json`);
  validateMetaIdentity(originalMeta, city, period, "input");
  const now = new Date().toISOString();
  const confidence = arg("--confidence") || originalMeta.confidence, priceBasis = arg("--price-basis") || originalMeta.priceBasis;
  if (!["official", "provincial"].includes(confidence)) fail("only official/provincial source books may be imported");
  const root = fileURLToPath(new URL("../", import.meta.url)), outputDir = join(root, "data", "prices");
  const materials = rows(parsed.materials ?? parsed.national?.materials ?? [], "materials", true), styles = rows(parsed.styles ?? [], "styles");
  const sourceFileInput = arg("--source-file"), sourceFileInputPath = sourceFileInput ? resolve(sourceFileInput) : null;
  if (confidence === "official" && !sourceFileInputPath) fail("--source-file is required for official imports so SHA256 is computed from the downloaded original file");
  const sourceFileBytes = sourceFileInputPath ? await readFile(sourceFileInputPath) : null;
  if (sourceFileBytes && !sourceFileBytes.length) fail("source-file is empty");
  const sourceFileSha256 = sourceFileBytes ? createHash("sha256").update(sourceFileBytes).digest("hex") : undefined;
  const relativeInputPath = sourceFileInputPath ? relative(root, sourceFileInputPath).replaceAll("\\", "/") : null;
  const archivedSourcePath = sourceFileInputPath ? privateSourcePath(relativeInputPath) ? relativeInputPath : `data/price-sources/${city}-${period}-${sourceFileSha256.slice(0, 12)}-${basename(sourceFileInputPath)}` : undefined;
  const provenance = {
    ...(arg("--download-url") || originalMeta.downloadUrl ? { downloadUrl: sourceUrl(arg("--download-url") || originalMeta.downloadUrl) } : {}),
    ...(arg("--downloaded-at") || originalMeta.downloadedAt ? { downloadedAt: timestamp(arg("--downloaded-at") || originalMeta.downloadedAt, "downloadedAt") } : {}),
    ...(sourceFileSha256 ? { sourceFileSha256, sourceFile: archivedSourcePath } : {}),
  };
  const output = { meta: { city, cityName: cityNameFor(originalMeta, city, "input"), period, source, sourceUrl: url, publishedAt: arg("--published-at") || originalMeta.publishedAt || null, fetchedAt: now, ...provenance, methodology: arg("--methodology") || originalMeta.methodology || "地面主材月度信息价，不含单列人工；损耗由估算接口另计5%。", priceBasis, confidence, dataStatus: confidence }, materials, styles, fallbackUsed: false };
  if (output.meta.priceBasis !== "material-only;waste-excluded") fail("this estimate API requires material-only;waste-excluded prices; convert/identify the source basis before import");
  if (output.meta.publishedAt && !Number.isFinite(Date.parse(output.meta.publishedAt))) fail("publishedAt must be a valid date");
  validateProvenance(output.meta, "input.meta");
  let files = []; try { files = await readdir(outputDir); } catch {}
  const bookByCity = new Map(), existingCityFiles = new Map();
  for (const name of files.sort()) {
    if (extname(name).toLowerCase() !== ".json") continue;
    const file = canonicalFile(name);
    if (file && file.period !== period) continue;
    let book;
    try { book = JSON.parse(await readFile(join(outputDir, name), "utf8")); }
    catch (error) { fail(`${name}: invalid JSON (${error.message})`); }
    if (!file && book?.meta?.period !== period) continue;
    if (!book || typeof book !== "object" || Array.isArray(book) || !book.meta || typeof book.meta !== "object" || Array.isArray(book.meta)) fail(`${name}: meta must be an object`);
    if (book.meta.period === period && book.meta.city !== "national") {
      const previousFile = existingCityFiles.get(book.meta.city);
      if (previousFile) fail(`${name}: duplicate city ${book.meta.city} for period ${period} (also in ${previousFile})`);
      existingCityFiles.set(book.meta.city, name);
    }
    if (!file) fail(`${name}: price-book filename must be <city>-<YYYY-MM>.json`);
    validateMetaIdentity(book.meta, file.city, file.period, name);
    if (book.meta.city !== file.city || book.meta.period !== file.period) fail(`${name}: meta.city and meta.period must match its filename`);
    if (file.city === "national") continue;
    if (!["official", "provincial"].includes(book.meta.confidence)) fail(`${name}: invalid source confidence/period`);
    sourceUrl(book.meta.sourceUrl);
    validateProvenance(book.meta, `${name}.meta`);
    book.meta.cityName = cityNameFor(book.meta, file.city, name);
    book.materials = rows(book.materials, `${name}.materials`, true); book.styles = rows(book.styles || [], `${name}.styles`);
    if (book.meta.priceBasis !== "material-only;waste-excluded") fail(`${name}: explicitly identify material-only;waste-excluded price basis`);
    if (file.city === city) continue;
    if (bookByCity.has(file.city)) fail(`${name}: duplicate city ${file.city} for period ${period}`);
    bookByCity.set(file.city, book);
  }
  if (bookByCity.has(city)) fail(`duplicate city ${city} for period ${period}`);
  bookByCity.set(city, output);
  const books = [...bookByCity.values()];
  books.sort((a,b) => a.meta.city.localeCompare(b.meta.city));
  const sources = books.map(({meta}) => ({city:meta.city,cityName:meta.cityName,source:meta.source,sourceUrl:meta.sourceUrl,period:meta.period,publishedAt:meta.publishedAt,...(meta.downloadUrl ? {downloadUrl:meta.downloadUrl,downloadedAt:meta.downloadedAt,sourceFile:meta.sourceFile,sourceFileSha256:meta.sourceFileSha256} : {})}));
  const firstSource = sources[0], publishedDates = sources.map((item)=>item.publishedAt).filter(Boolean).sort((a,b)=>Date.parse(a)-Date.parse(b));
  const meanMethodology = `全国参考价 = 已收录 ${books.length} 个城市同规格、同单位、同价格口径材料信息价的算术平均；每项显示实际有效样本数，缺项不补造。`;
  const nationalMethodology = books.length === 1 ? `${meanMethodology} 单一样本的适用规格与价格口径：${books[0].meta.methodology}` : meanMethodology;
  const national = { meta: { city:"national",cityName:"全国平均",period,scope:"national",sampleCities:books.length,sampleCityNames:books.map((b)=>b.meta.cityName),source:books.length===1?firstSource.source:"已导入城市月度信息价算术平均",sourceUrl:firstSource.sourceUrl,sources,publishedAt:publishedDates.at(-1)||null,fetchedAt:now,...(books.length===1 && firstSource.downloadUrl ? {downloadUrl:firstSource.downloadUrl,downloadedAt:firstSource.downloadedAt,sourceFile:firstSource.sourceFile,sourceFileSha256:firstSource.sourceFileSha256} : {}),methodology:nationalMethodology,priceBasis:output.meta.priceBasis,confidence:books.every((b)=>b.meta.confidence==="official")?"official":"provincial",dataStatus:books.every((b)=>b.meta.confidence==="official")?"official":"provincial" },national:{materials:average(books,"materials"),styles:average(books,"styles")},cities:Object.fromEntries(books.map((book)=>[book.meta.city,{name:book.meta.cityName,materials:book.materials,styles:book.styles,meta:book.meta}])),fallbackUsed:false };
  const target = join(outputDir,`${city}-${period}.json`), nationalTarget = join(outputDir,`national-${period}.json`);
  const previous = await readFile(target,"utf8").catch(()=>null), previousNational = await readFile(nationalTarget,"utf8").catch(()=>null);
  const after = JSON.stringify(output,null,2)+"\n", nationalAfter = JSON.stringify(national,null,2)+"\n";
  if (dryRun) {
    const previousBook = previous ? JSON.parse(previous) : null;
    const oldRows = new Map((previousBook?.materials || []).map((row) => [row.id, row]));
    const newRows = new Map(materials.map((row) => [row.id, row]));
    const added = materials.filter((row) => !oldRows.has(row.id));
    const changed = materials.filter((row) => oldRows.has(row.id) && JSON.stringify(oldRows.get(row.id)) !== JSON.stringify(row)).map((row) => ({ id: row.id, before: oldRows.get(row.id), after: row }));
    const removed = [...oldRows.values()].filter((row) => !newRows.has(row.id));
    const unchanged = materials.filter((row) => oldRows.has(row.id) && JSON.stringify(oldRows.get(row.id)) === JSON.stringify(row)).map((row) => row.id);
    const meaningful = (book) => book ? { ...book, meta: { ...book.meta, fetchedAt: undefined } } : null;
    console.log(JSON.stringify({dryRun:true,city,period,target,materials:materials.length,styles:styles.length,nationalSamples:books.length,previous:oldRows.size,changes:JSON.stringify(meaningful(previousBook))!==JSON.stringify(meaningful(output)),diff:{added,changed,removed,unchanged,missingMaterialIds:[...MATERIAL_IDS].filter((id)=>!newRows.has(id))}},null,2));
    process.exit(0);
  }
  const archive=join(root,"data","price-sources"); await mkdir(archive,{recursive:true});
  if (sourceFileBytes && sourceFileInputPath !== resolve(root, archivedSourcePath)) await writeFile(resolve(root, archivedSourcePath), sourceFileBytes);
  const hash=createHash("sha256").update(raw).digest("hex").slice(0,12);
  await writeFile(join(archive,`${city}-${period}-${hash}-${basename(input)}`),raw,"utf8");
  await mkdir(outputDir,{recursive:true});
  // Validate everything before writing. Each replacement is atomic; rollback keeps
  // the previous pair if publishing either file fails.
  try { await atomic(target,after); await atomic(nationalTarget,nationalAfter); }
  catch(error) { if(previous===null) await rm(target,{force:true}); else await atomic(target,previous); if(previousNational===null) await rm(nationalTarget,{force:true}); else await atomic(nationalTarget,previousNational); throw error; }
  console.log(JSON.stringify({target,city,period,materials:materials.length,styles:styles.length,nationalSamples:books.length},null,2));
} catch (error) { console.error(`price import failed: ${error.message}`); process.exitCode=1; }
