import { readFileSync, existsSync } from "node:fs";
import { extname, resolve } from "node:path";
import { test, expect } from "@playwright/test";
import type { Route } from "@playwright/test";

async function serveViewerFile(route: Route) {
  const publicRoot = resolve(process.cwd(), "public");
  const file = resolve(publicRoot, `.${new URL(route.request().url()).pathname}`);
  if (!file.startsWith(`${publicRoot}\\`) && !file.startsWith(`${publicRoot}/`)) return route.abort();
  if (!existsSync(file)) return route.fulfill({ status: 404, body: "Missing test resource" });
  return route.fulfill({ body: readFileSync(file), contentType: extname(file) === ".html" ? "text/html" : "application/javascript" });
}

const partialMeta = {
  city: "national", cityName: "全国平均", period: "2026-10", scope: "national", sampleCities: 1, sampleCityNames: ["北京"],
  materialCount: 8, officialMaterialCount: 1, fallbackMaterialCount: 7, coverage: "mixed", fallbackSource: "项目内置离线基准",
  source: "北京工程造价信息 建设工程", sourceUrl: "https://example.invalid/official-publication", publishedAt: "2026-11-01",
  downloadUrl: "https://example.invalid/original.pdf", downloadedAt: "2026-11-17T20:00:00+08:00", fetchedAt: "2026-11-17T20:00:00+08:00",
  sourceFile: "beijing-2026-10.pdf", sourceFileSha256: "a".repeat(64), confidence: "official", priceBasis: "material-only;waste-excluded",
  methodology: "北京工程造价信息 建设工程 2026-10 市场参考价；PDF第52页0801000001阿曼米黄大理石，16mm进口大板含税402；原价含运杂/运输损耗/采购保管，不含铺装人工与现场损耗；仅该规格样本，非其他石材通用价",
};
const partialMaterials = [
  { id: "wood", name: "橡木地板", spec: "三层实木复合", unit: "元/㎡", low: 280, mid: 320, high: 380, fallback: true, fallbackSource: "项目内置离线基准", confidence: "fallback" },
  { id: "walnut", name: "胡桃木地板", spec: "实木复合", unit: "元/㎡", low: 320, mid: 380, high: 460, fallback: true, fallbackSource: "项目内置离线基准", confidence: "fallback" },
  { id: "tile800", name: "800 地砖", spec: "800×800mm", unit: "元/㎡", low: 180, mid: 220, high: 280, fallback: true, fallbackSource: "项目内置离线基准", confidence: "fallback" },
  { id: "tile600", name: "600 地砖", spec: "600×600mm", unit: "元/㎡", low: 130, mid: 160, high: 200, fallback: true, fallbackSource: "项目内置离线基准", confidence: "fallback" },
  { id: "marble", name: "阿曼米黄大理石", spec: "16mm 进口大板（含税）", unit: "元/㎡", low: 402, mid: 402, high: 402, sampleCities: 1, sampleCityNames: ["北京"], confidence: "official", source: "北京工程造价信息 建设工程", sourceUrl: "https://example.invalid/official-publication", period: "2026-10" },
  { id: "antislip", name: "300 防滑砖", spec: "300×300mm", unit: "元/㎡", low: 110, mid: 140, high: 180, fallback: true, fallbackSource: "项目内置离线基准", confidence: "fallback" },
  { id: "terrazzo", name: "水磨石", spec: "预制水磨石", unit: "元/㎡", low: 220, mid: 280, high: 360, fallback: true, fallbackSource: "项目内置离线基准", confidence: "fallback" },
  { id: "carpet", name: "满铺地毯", spec: "家用混纺", unit: "元/㎡", low: 150, mid: 200, high: 280, fallback: true, fallbackSource: "项目内置离线基准", confidence: "fallback" },
];

test("工作台只显示服务端估价，城市切换和离线回退保留同一依据", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  let offline = false;
  let revision = 1;
  const requests: { city: string; payload: unknown }[] = [];
  const publicRoot = resolve(process.cwd(), "public");
  await page.route("http://price.test/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/prices") {
      if (offline) return route.abort();
      const city = url.searchParams.get("city") || url.searchParams.get("scope") || "national";
      const meta = { city, cityName: city === "nanjing" ? "南京" : "全国平均", period: "2026-11", scope: city, sampleCities: 2, sampleCityNames: ["南京", "杭州"], source: "测试原始价目表", sourceUrl: "https://example.invalid/source", fetchedAt: "2026-11-17T00:00:00Z", methodology: "测试口径", confidence: "official" };
      if (request.method() === "GET") return route.fulfill({ json: { meta, selectedCity: city, materials: [{ id: "wood", name: "橡木地板", spec: "三层实木复合", unit: "元/㎡", low: 100, mid: 200, high: 300 }], styles: [], fallbackUsed: false } });
      const payload = request.postDataJSON();
      requests.push({ city, payload });
      // Deliberately unrelated to area and unit prices: the UI must display
      // these server totals, rather than silently recalculate them locally.
      const mid = (city === "nanjing" ? 7000 : 9000) + revision;
      return route.fulfill({ json: { city, period: meta.period, basis: meta, fallbackUsed: false, wasteRate: .05, items: payload.items.map((item: { key: string }) => ({ ...item, low: 111, mid: 222, high: 333 })), totals: { low: mid - 1000, mid, high: mid + 1000 } } });
    }
    const file = resolve(publicRoot, `.${url.pathname}`);
    if (!file.startsWith(`${publicRoot}\\`) && !file.startsWith(`${publicRoot}/`)) return route.abort();
    if (!existsSync(file)) return route.fulfill({ status: 404, body: "Missing test resource" });
    return route.fulfill({ body: readFileSync(file), contentType: extname(file) === ".html" ? "text/html" : "application/javascript" });
  });

  const plan = { sig: "price-server-render", style: "现代简约", totalArea: 30, rooms: [{ name: "客厅", width: 5, length: 4, area: 20 }] };
  await page.goto(`http://price.test/floorplan-3d.html#plan=${encodeURIComponent(JSON.stringify(plan))}`);
  await expect(page.locator(".flooring-total")).toContainText("8,001");
  await expect(page.locator(".flooring-total")).toContainText("10,001");
  await expect(page.locator("#panel")).not.toContainText("布局检查");
  await page.locator("#drawer-about > summary").click();
  await expect(page.locator("#drawer-about")).toContainText("测试原始价目表");
  await expect(page.locator("#drawer-about")).toContainText("2026-11");
  await page.locator("#priceCitySelect").selectOption("nanjing");
  await expect(page.locator(".flooring-total")).toContainText("6,001");
  expect(requests.at(-1)?.city).toBe("nanjing");
  revision = 2;
  await page.locator("#refreshPrices").click();
  await expect(page.locator(".flooring-total")).toContainText("6,002");
  offline = true;
  await page.locator("#refreshPrices").click();
  await expect(page.locator("#drawer-about .price-status")).toContainText("离线");
  await expect(page.locator(".flooring-total")).toContainText("6,002");
  expect(errors).toEqual([]);
});

test("单规格官方样本与逐行离线回退保留完整请求并公开各自来源", async ({ page }) => {
  const requests: { items: { key: string; materialId: string; includeInTotal?: boolean }[] }[] = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("http://price.test/**", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname !== "/api/prices") return serveViewerFile(route);
    if (request.method() === "GET") return route.fulfill({ json: { meta: partialMeta, materials: partialMaterials, styles: [], selectedCity: "national", fallbackUsed: false } });
    expect(url.searchParams.get("period")).toBe(partialMeta.period);
    const payload = request.postDataJSON(); requests.push(payload);
    return route.fulfill({ json: { city: "national", period: partialMeta.period, basis: partialMeta, partial: false, missingItems: [], items: payload.items.map((item: { key: string; materialId: string }) => ({ ...item, low: 1234, mid: 2345, high: 3456, ...partialMaterials.find(material => material.id === item.materialId) })), totals: { low: 1234, mid: 2345, high: 3456 }, fallbackUsed: false } });
  });
  // The bundled plan exercises the official marble row and offline fallback rows.
  await page.goto("http://price.test/floorplan-3d.html");
  await expect(page.locator(".flooring-total")).toContainText("1,234");
  await expect(page.locator(".flooring-total")).toContainText("3,456");
  await expect(page.locator(".price-partial-note")).toHaveCount(0);
  expect(requests[0].items.some(item => item.materialId === "wood")).toBe(true);
  expect(requests[0].items.some(item => item.materialId === "marble")).toBe(true);
  await page.locator("#drawer-about > summary").click();
  const about = page.locator("#drawer-about");
  await expect(about.locator(".price-summary")).toHaveText("1 项官方 · 7 项示例");
  await expect(about.locator(".price-meta-grid")).toContainText("2026-10");
  await expect(about.locator(".price-meta-grid")).toContainText(partialMeta.publishedAt);
  await expect(about.locator(".price-source-links a", { hasText: "发布页" })).toHaveAttribute("href", partialMeta.sourceUrl);
  await expect(about.locator("a", { hasText: "原始价目表 (PDF)" })).toHaveAttribute("href", partialMeta.downloadUrl);
  await expect(page.locator("#priceCitySelect option[value=national]")).toHaveText("全国参考");
  await expect(about.locator("#about-area")).not.toHaveAttribute("open", "");
  await expect(about.locator("#about-prices")).not.toHaveAttribute("open", "");
  const metrics=await about.locator(".rail-content").evaluate(node=>{
    const r=node.getBoundingClientRect(), source=node.querySelector('.price-source-links')!.getBoundingClientRect();
    return {height:r.height,scrollTop:node.scrollTop,sourceVisible:source.bottom<=r.bottom};
  });
  expect(metrics.height).toBeLessThanOrEqual(640);
  expect(metrics.scrollTop).toBe(0);
  expect(metrics.sourceVisible).toBe(true);
  expect((await page.locator("body").innerText()).split("项目内置离线基准").length).toBe(2);
  await expect(page.locator("#panel .flooring-list")).not.toContainText("回退");
  await expect(page.locator("#panel .flooring-list")).not.toContainText("离线基准");
  await expect(page.locator("#panel .flooring-list")).not.toContainText("项目内置");
  const usedRows=page.locator("#panel .material-row");
  const usedCount=await usedRows.count();
  expect(usedCount).toBeGreaterThanOrEqual(5);
  await expect(page.locator("#toggleAllMaterials")).toHaveAttribute("aria-expanded","false");
  await page.locator("#toggleAllMaterials").click();
  await expect(usedRows).toHaveCount(8);
  await expect(page.locator("#toggleAllMaterials")).toHaveAttribute("aria-expanded","true");
  const rowMetrics=await usedRows.evaluateAll(nodes=>nodes.map(node=>({height:node.getBoundingClientRect().height,titleHeight:node.querySelector('.material-title')!.getBoundingClientRect().height,metricsHeight:node.querySelector('.material-metrics')!.getBoundingClientRect().height})));
  expect(rowMetrics.every(row=>row.height<=58&&row.titleHeight<=21&&row.metricsHeight<=20)).toBe(true);
  await page.locator("#toggleAllMaterials").click();
  await expect(usedRows).toHaveCount(usedCount);
  await expect(page.locator("#panel .estimate-mid")).toContainText("按中位");
  await expect(page.locator("#panel .estimate-basis")).toContainText("全国参考 · 2026-10 · 1 项官方 / 7 项示例");
  await about.locator("#about-prices > summary").click();
  const priceRows=about.locator("table tbody tr");
  await expect(priceRows).toHaveCount(8);
  await expect(priceRows.first()).toContainText("阿曼米黄大理石");
  await expect(priceRows.first().locator('.source-badge')).toHaveText("官方");
  await expect(priceRows.filter({hasText:"橡木地板"}).locator('.source-badge')).toHaveText("示例");
  await expect(about.locator("table thead")).not.toContainText("样本数");
  await expect(about.locator(".price-audit")).toContainText("1 项官方 · 7 项离线基准");
  await expect(about.locator(".price-audit")).toContainText(partialMeta.priceBasis);
  await expect(about.locator(".price-audit")).toContainText(partialMeta.sourceFileSha256);
  await about.locator('.rail-content').evaluate(node=>node.scrollTop=node.scrollHeight);
  await page.locator('#drawer-about > summary').click();
  await page.locator('#drawer-about > summary').click();
  expect(await about.locator('.rail-content').evaluate(node=>node.scrollTop)).toBe(0);
  expect(errors).toEqual([]);
});

test("全部材料缺价时不显示零元合计", async ({ page }) => {
  await page.route("http://price.test/**", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname !== "/api/prices") return serveViewerFile(route);
    if (request.method() === "GET") return route.fulfill({ json: { meta: partialMeta, materials: [partialMaterials.find(material=>material.id==="marble")], styles: [], selectedCity: "national", fallbackUsed: false } });
    const payload = request.postDataJSON();
    return route.fulfill({ json: { city: "national", period: partialMeta.period, basis: partialMeta, partial: true, missingItems: payload.items.filter((item: {materialId:string})=>item.materialId!=="marble"), items: [], totals: null, fallbackUsed: false } });
  });
  const plan = { sig: "price-no-covered-material", style: "现代简约", totalArea: 20, rooms: [{ name: "客厅", width: 4, length: 5, area: 20 }] };
  await page.goto(`http://price.test/floorplan-3d.html#plan=${encodeURIComponent(JSON.stringify(plan))}`);
  await expect(page.locator(".flooring-total")).toContainText("暂无已收录材料估价");
  await expect(page.locator(".flooring-total")).not.toContainText("¥0");
  await expect(page.locator(".price-partial-note").first()).toContainText("1项材料未收录，合计仅含已收录材料");
});

test("刷新到新期号后接口失败不套用旧期缓存金额", async ({ page }) => {
  let period = "2026-10", failEstimate = false;
  await page.route("http://price.test/**", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname !== "/api/prices") return serveViewerFile(route);
    const meta = { ...partialMeta, period };
    if (request.method() === "GET") return route.fulfill({ json: { meta, materials: partialMaterials, styles: [], selectedCity: "national", fallbackUsed: false } });
    if (failEstimate) return route.abort();
    const payload = request.postDataJSON();
    return route.fulfill({ json: { city: "national", period, basis: meta, partial: false, missingItems: [], items: payload.items.map((item: { key: string }) => ({ ...item, low: 8001, mid: 9001, high: 10001 })), totals: { low: 8001, mid: 9001, high: 10001 }, fallbackUsed: false } });
  });
  await page.goto("http://price.test/floorplan-3d.html");
  await expect(page.locator(".flooring-total")).toContainText("8,001");
  await page.locator("#drawer-about > summary").click();
  period = "2026-11"; failEstimate = true;
  await page.locator("#refreshPrices").click();
  await expect(page.locator("#drawer-about .price-status")).toContainText("价格服务暂不可用");
  await expect(page.locator(".flooring-total")).not.toContainText("8,001");
  await expect(page.locator(".flooring-total")).toContainText("暂不可估价");
  await expect(page.locator("#panel .estimate-basis")).toContainText("2026-11");
});
