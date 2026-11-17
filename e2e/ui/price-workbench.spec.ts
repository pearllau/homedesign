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
  await expect(about.locator(".price-summary")).toContainText("2026-10 期 · 北京 1 城 · 1 项官方 · 7 项离线基准");
  await expect(about.locator(".price-summary a")).toHaveAttribute("href", partialMeta.sourceUrl);
  await expect(about).toContainText(partialMeta.methodology);
  await expect(about).toContainText(partialMeta.priceBasis);
  await expect(about).toContainText("16mm 进口大板（含税）");
  await expect(about).toContainText("官方刊物样本不代表全部材料覆盖");
  await expect(about).toContainText(partialMeta.publishedAt);
  await expect(about).toContainText(partialMeta.downloadedAt);
  await expect(about).toContainText(partialMeta.sourceFileSha256);
  await expect(about.locator("a", { hasText: "下载原始价目表" })).toHaveAttribute("href", partialMeta.downloadUrl);
  await expect(page.locator("#priceCitySelect option[value=national]")).toHaveText("全国参考（1 城官方样本 + 7 项离线基准）");
  const priceRows=about.locator("table tbody tr");
  await expect(priceRows).toHaveCount(8);
  await expect(priceRows.filter({hasText:"阿曼米黄大理石"})).toContainText("官方 · 北京工程造价信息 建设工程");
  await expect(priceRows.filter({hasText:"橡木地板"})).toContainText("回退 · 项目内置离线基准");
  await expect(page.locator("#panel .flooring-list")).toContainText("离线回退 · 项目内置离线基准");
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
  await expect(page.locator("#panel .detail-note").last()).toContainText("2026-11");
});
