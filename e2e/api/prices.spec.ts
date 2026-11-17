import { test, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { calculatePriceEstimate, fallbackPriceBook, loadPriceBook, parsePriceEstimateInputs, priceRange, validatePriceBookFile, type PriceBookFile } from "../../src/shared/prices";
import { selectPriceBook } from "../../src/shared/price-book-selection";
import { getPriceBook } from "../../src/server/prices";

function official(city = "national", period = "2026-12", amount = 100): PriceBookFile {
  const cityName = ({ national: "全国平均", beijing: "北京", shanghai: "上海", nanjing: "南京" } as Record<string, string>)[city] || city;
  const meta = { city, cityName, period, source: "Test fixture, not production data", sourceUrl: "https://example.invalid/monthly", publishedAt: "2026-11-17", downloadUrl: "https://example.invalid/test-source.csv", downloadedAt: "2026-11-17T10:00:00Z", sourceFile: "data/price-sources/test-fixture.csv", sourceFileSha256: "a".repeat(64), fetchedAt: "2026-11-17T10:00:00Z", methodology: "test", confidence: "official" as const, priceBasis: "material-only;waste-excluded" };
  const row = (value: number) => ({ id: "wood", name: "test wood", spec: "same", unit: "元/㎡", low: value, mid: value, high: value });
  if (city !== "national") return { meta, materials: [row(amount)], styles: [] };
  const beijingMeta = { ...meta, city: "beijing", cityName: "北京" };
  const source = { city: "beijing", cityName: "北京", source: beijingMeta.source, sourceUrl: beijingMeta.sourceUrl, period, publishedAt: beijingMeta.publishedAt, downloadUrl: beijingMeta.downloadUrl, downloadedAt: beijingMeta.downloadedAt, sourceFile: beijingMeta.sourceFile, sourceFileSha256: beijingMeta.sourceFileSha256 };
  const nationalRow = { ...row(amount), sampleCities: 1, sampleCityNames: ["北京"] };
  return {
    meta: { ...meta, scope: "national", sampleCities: 1, sampleCityNames: ["北京"], sources: [source] },
    national: { materials: [nationalRow], styles: [] },
    cities: { beijing: { name: "北京", materials: [row(amount)], styles: [], meta: beijingMeta } },
    fallbackUsed: false,
  };
}

test("server totals exclude room display rows and reject unknown materials and overflow", () => {
  const book = loadPriceBook("national", "2026-12", official());
  const result = calculatePriceEstimate(book, [{key:"total", materialId:"wood", area:10}, {key:"room", materialId:"wood", area:10, includeInTotal:false}]);
  expect(result.totals).toEqual({low:1050, mid:1050, high:1050});
  expect(result.items).toHaveLength(2);
  expect(result.partial).toBe(false);
  expect(result.missingItems).toEqual([]);
  expect(() => priceRange(book, "missing", 10)).toThrow("Unknown price material");
  expect(() => calculatePriceEstimate(book, [{key:"huge",materialId:"wood",area:Number.MAX_VALUE}])).toThrow();
  expect(parsePriceEstimateInputs({items:[{key:"duplicate",materialId:"wood",area:1},{key:"duplicate",materialId:"wood",area:1}]})).toBeNull();
  const partialBook = loadPriceBook("beijing", "2026-12", {
    ...official("beijing"),
    materials: [{ id: "marble", name: "大理石", spec: "同规格", unit: "元/㎡", low: 500, mid: 500, high: 500 }],
    cities: undefined,
  });
  const partial = calculatePriceEstimate(partialBook, [
    { key: "marble-room", materialId: "marble", area: 10 },
    { key: "wood-room", materialId: "wood", area: 10 },
  ]);
  expect(partial.partial).toBe(false);
  expect(partial.missingItems).toEqual([]);
  expect(partial.items).toHaveLength(2);
  expect(partial.totals).toEqual({ low: 8190, mid: 8610, high: 9240 });
  expect(partial.items.find((item) => item.materialId === "marble")).toMatchObject({ confidence: "official", source: "Test fixture, not production data", fallback: false });
  expect(partial.items.find((item) => item.materialId === "wood")).toMatchObject({ confidence: "fallback", source: "项目内置离线基准", fallback: true });
  const empty = calculatePriceEstimate(partialBook, [{ key: "wood-room", materialId: "wood", area: 10 }]);
  expect(empty.partial).toBe(false);
  expect(empty.totals).toEqual({ low: 2940, mid: 3360, high: 3990 });
  expect(empty.missingItems).toEqual([]);
  expect(() => calculatePriceEstimate(partialBook, [{ key: "bad-area", materialId: "wood", area: Number.MAX_VALUE }])).toThrow("Invalid price estimate input");
  expect(() => calculatePriceEstimate(partialBook, [{ key: "bad", materialId: "unknown", area: 1 }])).toThrow("Invalid price estimate input");
  const overflowingBook = { ...book, materials: [{ ...book.materials[0], low: 1e308, mid: 1e308, high: 1e308 }] };
  expect(() => calculatePriceEstimate(overflowingBook, [{ key: "a", materialId: "wood", area: 1 }, { key: "b", materialId: "wood", area: 1 }], 0)).toThrow("Price estimate overflow");
});

test("baseline and missing-city fallback keep honest source, samples and period", () => {
  const baseline = fallbackPriceBook();
  expect(baseline.meta.confidence).toBe("fallback");
  expect(baseline.meta.sampleCities).toBe(0);
  expect(baseline.meta.sampleCityNames).toEqual([]);
  expect(baseline.meta).toMatchObject({ materialCount: 8, officialMaterialCount: 0, fallbackMaterialCount: 8, coverage: "fallback" });
  expect(baseline.materials.every((row) => row.fallback && row.fallbackSource === "项目内置离线基准" && row.confidence === "fallback")).toBe(true);
  const national = loadPriceBook("national", "2026-12", official());
  expect(national.fallbackUsed).toBe(true);
  expect(national.meta).toMatchObject({ materialCount: 8, officialMaterialCount: 1, fallbackMaterialCount: 7, coverage: "mixed" });
  expect(national.materials.find((row) => row.id === "wood")).toMatchObject({ fallback: false, confidence: "official" });
  expect(national.materials.filter((row) => row.fallback)).toHaveLength(7);
  const offlineCity = loadPriceBook("beijing");
  expect(offlineCity.materials.every((row) => row.fallback && row.fallbackSource === "项目内置离线基准")).toBe(true);
  const book = loadPriceBook("unlisted", "2026-10", official());
  expect(book.fallbackUsed).toBe(true);
  expect(book.meta.city).toBe("national");
  expect(book.meta.period).toBe("2026-12");
  expect(book.meta.confidence).toBe("official");
  expect(book.meta.fallbackReason).toContain("项目内置离线基准");
});

test("Beijing 2026-10 exposes one official sample plus offline rows for every supported material", async () => {
  const book = await getPriceBook("national", "2026-10");
  expect(book.meta).toMatchObject({ period: "2026-10", sampleCities: 1, materialCount: 8, officialMaterialCount: 1, fallbackMaterialCount: 7, coverage: "mixed" });
  expect(book.materials.find((row) => row.id === "marble")).toMatchObject({ confidence: "official", source: "北京市建设工程造价管理总站（主管单位：北京市住房和城乡建设委员会）", period: "2026-10", fallback: false });
  expect(book.materials.filter((row) => row.confidence === "fallback")).toHaveLength(7);
  const estimate = calculatePriceEstimate(book, ["wood", "walnut", "tile800", "tile600", "marble", "antislip", "terrazzo", "carpet"].map((materialId) => ({ key: materialId, materialId, area: 1 })));
  expect(estimate.items).toHaveLength(8);
  expect(estimate.missingItems).toEqual([]);
  expect(estimate.totals).not.toBeNull();
});

test("malformed imports are rejected as a whole", () => {
  const valid = official();
  expect(validatePriceBookFile(valid)).toBe(true);
  expect(validatePriceBookFile({ ...valid, cities: { beijing: { name: "北京", materials: valid.national!.materials, styles: [] } } })).toBe(false);
  expect(validatePriceBookFile({ ...valid, cities: { beijing: { name: "北京", materials: valid.national!.materials, styles: [], meta: { ...valid.meta, city: "beijing", cityName: "北京" } } } })).toBe(true);
  expect(validatePriceBookFile({...valid,national:{materials:[{...valid.national!.materials[0],low:200}],styles:[]}})).toBe(false);
  expect(validatePriceBookFile({...valid,national:{materials:[{...valid.national!.materials[0],unit:"元/吨"}],styles:[]}})).toBe(false);
  expect(validatePriceBookFile({...valid,meta:{...valid.meta,sourceUrl:"javascript:alert(1)"}})).toBe(false);
  for (const patch of [{ downloadUrl: "javascript:bad" }, { downloadedAt: "yesterday" }, { sourceFileSha256: "123" }, { sourceFile: "public/price.csv" }, { sourceFile: "data/price-sources/../private.csv" }, { publishedAt: null }]) {
    expect(validatePriceBookFile({ ...valid, meta: { ...valid.meta, ...patch } })).toBe(false);
  }
});

test("national samples and per-material participants must match preserved city inputs", () => {
  const valid = official();
  expect(validatePriceBookFile(valid)).toBe(true);
  expect(validatePriceBookFile({ ...valid, meta: { ...valid.meta, sampleCities: 8 } })).toBe(false);
  expect(validatePriceBookFile({ ...valid, meta: { ...valid.meta, sampleCityNames: ["北京", "上海"] } })).toBe(false);
  expect(validatePriceBookFile({ ...valid, meta: { ...valid.meta, sources: [...valid.meta.sources!, ...valid.meta.sources!] } })).toBe(false);
  expect(validatePriceBookFile({ ...valid, national: { materials: [{ ...valid.national!.materials[0], sampleCities: 2 }], styles: [] } })).toBe(false);
  expect(validatePriceBookFile({ ...valid, national: { materials: [{ ...valid.national!.materials[0], mid: 101 }], styles: [] } })).toBe(false);
  const missingMaterialCity = { ...valid, cities: {
    beijing: valid.cities!.beijing,
    shanghai: { name: "上海", materials: [], styles: [], meta: { ...valid.cities!.beijing.meta!, city: "shanghai", cityName: "上海" } },
  }, meta: { ...valid.meta, sampleCities: 2, sampleCityNames: ["北京", "上海"], sources: [...valid.meta.sources!, { ...valid.meta.sources![0], city: "shanghai", cityName: "上海" }] } };
  expect(validatePriceBookFile(missingMaterialCity)).toBe(false);
  const tile = { ...valid.cities!.beijing.materials[0], id: "tile", low: 200, mid: 200, high: 200 };
  missingMaterialCity.cities.shanghai.materials = [tile];
  const partial = { ...missingMaterialCity, national: { materials: [valid.national!.materials[0], { ...tile, sampleCities: 1, sampleCityNames: ["上海"] }], styles: [] } };
  expect(validatePriceBookFile(partial)).toBe(true);
  expect(validatePriceBookFile({ ...partial, national: { ...partial.national, materials: partial.national.materials.map((row) => row.id === "wood" ? { ...row, sampleCityNames: ["上海"] } : row) } })).toBe(false);
});

test("shared selection picks the same newest city and period from bundled filenames", async () => {
  const baseline = fallbackPriceBook();
  const books = new Map([
    ["national-2026-12.json", official("national", "2026-12", 100)],
    ["beijing-2026-12.json", official("beijing", "2026-12", 200)],
    ["national-2027-01.json", official("national", "2027-01", 300)],
    ["beijing-2027-01.json", official("beijing", "2027-01", 400)],
    ["national-2027-02.json", { ...baseline, meta: { ...baseline.meta, period: "2027-02" } }],
  ]);
  const selected = await selectPriceBook({ filenames: [...books.keys()], read: (filename) => books.get(filename) }, "beijing");
  expect(selected.meta.period).toBe("2027-01");
  expect(selected.materials[0].mid).toBe(400);
  const archived = await selectPriceBook({ filenames: [...books.keys()], read: (filename) => books.get(filename) }, "beijing", "2026-12");
  expect(archived.meta.period).toBe("2026-12");
  expect(archived.materials[0].mid).toBe(200);
  const unknown = await selectPriceBook({ filenames: [...books.keys()], read: (filename) => books.get(filename) }, "unknown");
  expect(unknown.meta.city).toBe("national");
  expect(unknown.meta.period).toBe("2027-01");
  expect(unknown.fallbackUsed).toBe(true);
  const unavailablePeriod = await selectPriceBook({ filenames: [...books.keys()], read: (filename) => books.get(filename) }, "national", "2027-03");
  expect(unavailablePeriod.meta.period).toBe("2027-01");
  expect(unavailablePeriod.meta.confidence).toBe("official");
  expect(unavailablePeriod.meta.fallbackReason).toContain("2027-03");
  const explicitBaseline = await selectPriceBook({ filenames: [...books.keys()], read: (filename) => books.get(filename) }, "national", "2027-02");
  expect(explicitBaseline.meta.period).toBe("2027-02"); expect(explicitBaseline.meta.confidence).toBe("fallback");
  selected.materials[0].mid = 999;
  selected.meta.source = "caller annotation";
  const nextRequest = await selectPriceBook({ filenames: [...books.keys()], read: (filename) => books.get(filename) }, "beijing");
  expect(nextRequest.materials[0].mid).toBe(400);
  expect(nextRequest.meta.source).not.toBe("caller annotation");
});

test("nested city metadata must include complete provenance matching the city and period", () => {
  const valid = official();
  const cityMeta = { ...valid.meta, city: "beijing", cityName: "北京" };
  const book = (meta: unknown) => ({ ...valid, cities: { beijing: { name: "北京", materials: valid.national!.materials, styles: [], meta } } });
  for (const field of ["city", "cityName", "period", "source", "sourceUrl", "fetchedAt", "methodology", "confidence", "priceBasis"]) {
    expect(validatePriceBookFile(book({ ...cityMeta, [field]: undefined })), `missing city.meta.${field}`).toBe(false);
  }
  expect(validatePriceBookFile(book({ ...cityMeta, city: "shanghai" }))).toBe(false);
  expect(validatePriceBookFile(book({ ...cityMeta, period: "2027-01" }))).toBe(false);
  expect(validatePriceBookFile(book({ ...cityMeta, sourceUrl: "javascript:alert(1)" }))).toBe(false);
  expect(validatePriceBookFile(book({ ...cityMeta, sources: "invalid" }))).toBe(false);
  expect(validatePriceBookFile(book(cityMeta))).toBe(true);
  expect(validatePriceBookFile(fallbackPriceBook())).toBe(true);
});

test("loader discovers latest valid period, merges national gaps and ignores mismatched filename metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "jianzhu-price-loader-"));
  const oldCwd = process.cwd();
  try {
    const prices=join(root,"data","prices"); await mkdir(prices,{recursive:true});
    await writeFile(join(prices,"national-2026-12.json"), JSON.stringify(official()));
    await writeFile(join(prices,"beijing-2026-12.json"), JSON.stringify(official("beijing","2026-12",200)));
    await writeFile(join(prices,"national-2027-01.json"), JSON.stringify(official("national","2026-12",999)));
    process.chdir(root);
    const latest=await getPriceBook("beijing");
    expect(latest.meta.period).toBe("2026-12"); expect(latest.materials[0].mid).toBe(200);
    expect(latest.meta.city).toBe("beijing");
    const missing=await getPriceBook("unknown");
    expect(missing.meta.city).toBe("national"); expect(missing.fallbackUsed).toBe(true); expect(missing.materials[0].mid).toBe(100);
    const wrongPeriod=await getPriceBook("national","2027-02");
    expect(wrongPeriod.meta.period).toBe("2026-12"); expect(wrongPeriod.meta.fallbackReason).toContain("2027-02");
  } finally { process.chdir(oldCwd); await rm(root,{recursive:true,force:true}); }
});

test("import dry-run writes nothing, real import computes actual city samples and rejects mixed specs atomically", async () => {
  await mkdir(join(process.cwd(),".tmp"),{recursive:true});
  const root=await mkdtemp(join(process.cwd(),".tmp","price-import-"));
  try {
    const script=join(root,"scripts","import-price-book.mjs"); await mkdir(join(root,"scripts"),{recursive:true});
    await copyFile(join(process.cwd(),"scripts","import-price-book.mjs"),script);
    const input=join(root,"city.json"); await writeFile(input,JSON.stringify(official("beijing","2026-12",100)));
    const run=(city:string, extra:string[]=[])=>spawnSync(process.execPath,[script,"--input",input,"--city",city,"--period","2026-12","--source","Test fixture","--source-url","https://example.invalid/price","--source-file",input,...extra],{encoding:"utf8"});
    const dry=run("beijing",["--dry-run"]); expect(dry.status,dry.stderr).toBe(0);
    expect(JSON.parse(dry.stdout).diff).toMatchObject({ added: [{ id: "wood" }], changed: [], removed: [], unchanged: [] });
    expect(await readFile(join(root,"data","prices","national-2026-12.json")).catch(()=>null)).toBeNull();
    expect(run("beijing").status).toBe(0);
    const unchangedDry = run("beijing", ["--dry-run"]);
    expect(unchangedDry.status, unchangedDry.stderr).toBe(0);
    expect(JSON.parse(unchangedDry.stdout)).toMatchObject({ changes: false, diff: { added: [], changed: [], removed: [], unchanged: ["wood"] } });
    await writeFile(input,JSON.stringify(official("shanghai","2026-12",200)));
    expect(run("shanghai").status).toBe(0);
    const nationalPath=join(root,"data","prices","national-2026-12.json"), before=await readFile(nationalPath,"utf8");
    const national=JSON.parse(before); expect(national.meta.sampleCities).toBe(2); expect(national.meta.sampleCityNames).toEqual(["北京", "上海"]); expect(national.national.materials[0].mid).toBe(150); expect(national.meta.sources).toHaveLength(2);
    expect(national.meta.publishedAt).toBe("2026-11-17"); expect(national.meta.sourceUrl).toBe("https://example.invalid/price");
    expect(validatePriceBookFile(national)).toBe(true);
    const mismatch=official("nanjing","2026-12",500); mismatch.materials![0].spec="different"; await writeFile(input,JSON.stringify(mismatch));
    expect(run("nanjing").status).toBe(1);
    expect(await readFile(nationalPath,"utf8")).toBe(before);
    expect(await readFile(join(root,"data","prices","nanjing-2026-12.json")).catch(()=>null)).toBeNull();
  } finally { await rm(root,{recursive:true,force:true}); }
});

test("import rejects mismatched city identities and duplicate samples before publishing", async () => {
  await mkdir(join(process.cwd(), ".tmp"), { recursive: true });
  const root = await mkdtemp(join(process.cwd(), ".tmp", "price-identity-"));
  try {
    const script = join(root, "scripts", "import-price-book.mjs"), input = join(root, "city.json");
    await mkdir(join(root, "scripts"), { recursive: true });
    await copyFile(join(process.cwd(), "scripts", "import-price-book.mjs"), script);
    const run = (city: string, file = input) => spawnSync(process.execPath, [script, "--input", file, "--city", city, "--period", "2026-12", "--source", "Test fixture", "--source-url", "https://example.invalid/price", "--source-file", file], { encoding: "utf8" });
    await writeFile(input, JSON.stringify(official("beijing")));
    expect(run("shanghai").stderr).toContain("meta.city must match shanghai");
    await writeFile(input, JSON.stringify({ ...official("beijing"), meta: { ...official("beijing").meta, cityName: "上海" } }));
    expect(run("beijing").stderr).toContain("meta.cityName must be 北京");
    const mismatchedFilename = join(root, "shanghai-2026-12.json");
    await writeFile(mismatchedFilename, JSON.stringify(official("beijing")));
    expect(run("beijing", mismatchedFilename).stderr).toContain("input filename must match beijing-2026-12.json");
    await writeFile(input, JSON.stringify(official("beijing")));
    expect(run("beijing").status).toBe(0);
    const prices = join(root, "data", "prices"), nationalPath = join(prices, "national-2026-12.json");
    const before = await readFile(nationalPath, "utf8");
    await writeFile(input, JSON.stringify(official("shanghai")));
    await writeFile(join(prices, "nanjing-2026-12.json"), JSON.stringify(official("beijing")));
    const duplicate = run("shanghai");
    expect(duplicate.status).toBe(1);
    expect(duplicate.stderr).toContain("duplicate city beijing");
    expect(await readFile(nationalPath, "utf8")).toBe(before);
    await rm(join(prices, "nanjing-2026-12.json"));
    await writeFile(join(prices, "shanghai-2026-12.json"), JSON.stringify(official("nanjing")));
    const mismatch = run("shanghai");
    expect(mismatch.status).toBe(1);
    expect(mismatch.stderr).toContain("meta.city must match shanghai");
    expect(await readFile(nationalPath, "utf8")).toBe(before);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("official CSV imports require original-file provenance and use its computed SHA256", async () => {
  const root = await mkdtemp(join(process.cwd(), ".tmp", "price-provenance-"));
  try {
    const script = join(root, "scripts", "import-price-book.mjs"), input = join(root, "beijing-2026-12.csv"), original = join(root, "downloaded-source.csv");
    await mkdir(join(root, "scripts"), { recursive: true });
    await copyFile(join(process.cwd(), "scripts", "import-price-book.mjs"), script);
    await writeFile(input, "id,name,spec,unit,low,mid,high\nwood,Test fixture,same,元/㎡,100,100,100\n");
    const originalBytes = Buffer.from("Test raw official download fixture, not production data\r\n", "utf8");
    await writeFile(original, originalBytes);
    const args = [script, "--input", input, "--city", "beijing", "--period", "2026-12", "--source", "Test fixture", "--source-url", "https://example.invalid/price", "--confidence", "official", "--price-basis", "material-only;waste-excluded"];
    const run = (extra: string[]) => spawnSync(process.execPath, [...args, ...extra], { encoding: "utf8" });
    expect(run([]).stderr).toContain("--source-file is required");
    expect(run(["--source-file", original]).stderr).toContain("publishedAt must be a valid date");
    const provenance = ["--source-file", original, "--published-at", "2026-12-01", "--download-url", "https://example.invalid/download.csv", "--downloaded-at", "2026-12-02T01:00:00Z"];
    const dry = run([...provenance, "--dry-run"]); expect(dry.status, dry.stderr).toBe(0);
    expect(await readFile(join(root, "data", "prices", "beijing-2026-12.json")).catch(() => null)).toBeNull();
    const imported = run(provenance); expect(imported.status, imported.stderr).toBe(0);
    const book = JSON.parse(await readFile(join(root, "data", "prices", "national-2026-12.json"), "utf8"));
    expect(book.meta).toMatchObject({ source: "Test fixture", sourceUrl: "https://example.invalid/price", publishedAt: "2026-12-01", downloadUrl: "https://example.invalid/download.csv", downloadedAt: "2026-12-02T01:00:00Z", sourceFileSha256: createHash("sha256").update(originalBytes).digest("hex"), sampleCities: 1 });
    expect(book.meta.sources[0]).toMatchObject({ sourceFileSha256: book.meta.sourceFileSha256, sourceFile: book.meta.sourceFile });
    expect(await readFile(join(root, book.meta.sourceFile))).toEqual(originalBytes);
    expect(validatePriceBookFile(book)).toBe(true);
    await writeFile(input, "id,name,spec,unit,low,mid,high\nunknown,Test fixture,same,元/㎡,100,100,100\n");
    expect(run(provenance).stderr).toContain("material ID is not used by the application");
    await writeFile(input, "id,name,spec,unit,low,mid,high\nwood,Test fixture,same,元/㎡,100,110,120\n");
    expect(run(provenance).stderr).toContain("source material quotes must use low=mid=high");
  } finally { await rm(root, { recursive: true, force: true }); }
});
