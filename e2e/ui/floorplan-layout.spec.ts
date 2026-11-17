import { readFileSync, existsSync } from "node:fs";
import { extname, resolve } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import type { FloorPlanGeometry, Point } from "../../src/shared/floorplan-geometry";

type Furniture = { id: string; type: string; name: string; cx: number; cy: number; w: number; d: number; rot: number };
type Snapshot = {
  furniture: Furniture[];
  rooms: { id: string; name: string; poly: Point[]; counted?: boolean }[];
  walls: { poly: Point[]; segment: [Point, Point]; thickness: number }[];
  doors: { rect: number[]; segment: [Point, Point]; thickness: number; entry?: boolean; name?: string }[];
  windows: { segment: [Point, Point]; thickness: number }[];
};

const publicRoot = resolve(process.cwd(), "public");

// Run the repository's actual HTML engine. All resources are fulfilled from
// public so these geometry checks do not depend on an old preview build or AI.
test.beforeEach(async ({ page }) => {
  await page.route("http://layout.test/**", async route => {
    const url = new URL(route.request().url());
    const file = resolve(publicRoot, `.${url.pathname}`);
    if (!file.startsWith(`${publicRoot}\\`) && !file.startsWith(`${publicRoot}/`)) return route.abort();
    if (!existsSync(file)) return route.fulfill({ status: 404, body: "Missing test resource" });
    const contentType = extname(file) === ".html" ? "text/html" : extname(file) === ".css" ? "text/css" : "application/javascript";
    await route.fulfill({ body: readFileSync(file), contentType });
  });
});

function geometry(polygon: Point[], openings: FloorPlanGeometry["openings"] = []): FloorPlanGeometry {
  return {
    version: 1, id: "placement-fixture", source: { name: "布置测试.png", width: 1000, height: 800 },
    outline: polygon,
    rooms: [{ id: "room", name: "卧室", polygon }],
    walls: polygon.map((start, i) => ({ id: `wall-${i}`, start, end: polygon[(i + 1) % polygon.length], thicknessMm: 200, structural: "unknown" })),
    openings, calibration: { start: [0, 0], end: [100, 0], lengthMeters: 1, source: "manual" },
    ceilingHeight: 2.8, confirmed: true, warnings: [],
  };
}

async function openPlan(page: Page, g: FloorPlanGeometry, furniture: { name: string; count: number }[], sig: string) {
  const plan = {
    sig, style: "现代简约", totalArea: 30,
    rooms: [{ name: "卧室", width: 6, length: 5, area: 30, furniture }], floorPlan: g,
  };
  await page.goto(`http://layout.test/floorplan-3d.html#plan=${encodeURIComponent(JSON.stringify(plan))}`);
  await expect(page.locator("#gRooms polygon.room")).toHaveCount(1);
  // Playwright serializes arrays by indexed values only, so copy the wall and
  // window metadata into ordinary objects before sending them out of the page.
  return page.evaluate<Snapshot>("({furniture:state.furniture,rooms:ROOMS,walls:WALLS.map(w=>({poly:w.poly,segment:w.segment,thickness:w.thickness})),doors:DOORS,windows:WINS.map(w=>({segment:w.segment,thickness:w.thickness}))})");
}

async function openTextPlan(page: Page, rooms: { name: string; width: number; length: number; area: number; furniture?: { name: string; count: number }[] }[], sig: string) {
  const plan = { sig, style: "现代简约", totalArea: rooms.reduce((sum, room) => sum + room.area, 0), rooms, budget: { total: 0, items: [] } };
  await page.goto(`http://layout.test/floorplan-3d.html#plan=${encodeURIComponent(JSON.stringify(plan))}`);
  await expect(page.locator("#gRooms polygon.room")).toHaveCount(rooms.length);
  return page.evaluate<Snapshot & { edges: string[][] }>("({furniture:state.furniture,rooms:ROOMS,doors:DOORS,walls:WALLS,edges:INJECTED.constraints.graph.edges.map(edge=>[edge.from,edge.to].map(id=>ROOMS.find(room=>room.id===id).name))})");
}

function footprint(f: Furniture): Point[] {
  const angle = f.rot * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  return [[-f.w / 2, -f.d / 2], [f.w / 2, -f.d / 2], [f.w / 2, f.d / 2], [-f.w / 2, f.d / 2]]
    .map(([x, y]) => [f.cx + x * c - y * s, f.cy + x * s + y * c]);
}

function inside(p: Point, polygon: Point[]): boolean {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
  }
  return result;
}

function overlap(a: Point[], b: Point[]): boolean {
  for (const polygon of [a, b]) for (let i = 0; i < polygon.length; i++) {
    const start = polygon[i], end = polygon[(i + 1) % polygon.length], nx = -(end[1] - start[1]), ny = end[0] - start[0];
    const pa = a.map(p => p[0] * nx + p[1] * ny), pb = b.map(p => p[0] * nx + p[1] * ny);
    if (Math.max(...pa) <= Math.min(...pb) + 1 || Math.max(...pb) <= Math.min(...pa) + 1) return false;
  }
  return true;
}

function openingZones(segment: [Point, Point], thickness: number, depth: number): Point[][] {
  const [a, b] = segment, dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy), nx = -dy / length, ny = dx / length;
  return [-1, 1].map(sign => [a, b, [b[0] + nx * sign * (thickness / 2 + depth), b[1] + ny * sign * (thickness / 2 + depth)], [a[0] + nx * sign * (thickness / 2 + depth), a[1] + ny * sign * (thickness / 2 + depth)]]);
}

function distanceToLine(point: Point, [a, b]: [Point, Point]): number {
  return Math.abs((b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0])) / Math.hypot(b[0] - a[0], b[1] - a[1]);
}

test("文字方案使用功能拓扑，卫生间和厨房只按白名单开门", async ({ page }) => {
  const snapshot = await openTextPlan(page, [
    { name: "客餐厅", width: 5.5, length: 4, area: 22, furniture: [{ name: "鞋柜", count: 1 }] },
    { name: "厨房", width: 3, length: 3, area: 9, furniture: [{ name: "冰箱", count: 1 }, { name: "水槽", count: 1 }, { name: "灶台", count: 1 }] },
    { name: "主卧", width: 4, length: 3.5, area: 14, furniture: [{ name: "双人床", count: 1 }, { name: "衣柜", count: 1 }] },
    { name: "次卧", width: 3.2, length: 3, area: 9.6 },
    { name: "儿童房", width: 3, length: 3, area: 9 },
    { name: "主卫", width: 2, length: 2, area: 4 },
    { name: "公卫", width: 2.2, length: 2, area: 4.4 },
  ], "functional-topology-page");
  expect(snapshot.rooms.map(room => room.name)).toEqual(expect.arrayContaining(["客餐厅", "主卧", "主卫", "公卫"]));
  expect(snapshot.rooms.some(room => /走廊|玄关/.test(room.name))).toBe(false);
  expect(snapshot.doors.some(door => door.entry)).toBe(true);
  expect(snapshot.edges.filter(pair => pair.includes("主卫")).map(pair=>pair.slice().sort())).toEqual([["主卧", "主卫"].sort()]);
  expect(snapshot.edges.filter(pair => pair.includes("公卫"))).toEqual([["客餐厅", "公卫"]]);
  expect(snapshot.edges.some(pair => pair.includes("厨房") && pair.some(name => /主卫|公卫/.test(name)))).toBe(false);
});

test("35㎡录屏方案补全公共空间后不重叠，2D与3D均可展示", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const rooms = [
    { name: "卧室区", width: 2.6, length: 3 },
    { name: "厨房", width: 1.9, length: 2.6 },
    { name: "卫生间", width: 1.6, length: 2.2 },
    { name: "生活阳台", width: 1.5, length: 2.4 },
  ].map(room => ({ ...room, area: room.width * room.length }));
  const plan = { sig: "recording-35sqm-ui", style: "现代简约", totalArea: 35, rooms };
  await page.goto(`http://layout.test/floorplan-3d.html#plan=${encodeURIComponent(JSON.stringify(plan))}`);
  await expect(page.locator("#gRooms polygon.room")).toHaveCount(5);
  const snapshot = await page.evaluate<Snapshot & { invalid?: boolean }>("({rooms:ROOMS,furniture:state.furniture,walls:WALLS,doors:DOORS,windows:WINS,invalid:INJECTED.layoutInvalid})");
  expect(snapshot.invalid).not.toBe(true);
  expect(snapshot.rooms.some(room => room.name === "客餐厅")).toBe(true);
  expect(snapshot.rooms.some(room => /玄关|走廊/.test(room.name))).toBe(false);
  for (let i = 0; i < snapshot.rooms.length; i++) {
    for (let j = i + 1; j < snapshot.rooms.length; j++) {
      expect(overlap(snapshot.rooms[i].poly, snapshot.rooms[j].poly)).toBe(false);
    }
  }
  await page.screenshot({ path: testInfo.outputPath("35sqm-2d.png") });
  await page.locator('#viewSeg [data-view="3d"]').click();
  await expect(page.locator("#view3d canvas[data-render-path]")).toBeVisible();
  await expect(page.locator("body")).not.toHaveClass(/busy/);
  await page.screenshot({ path: testInfo.outputPath("35sqm-3d.png") });
  expect(errors).toEqual([]);
});

test("无法留出公共枢纽时显示原因，不叠放或伪造房间", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const plan = {
    sig: "invalid-budget-ui", totalArea: 25,
    rooms: [
      { name: "卧室", width: 4, length: 4, area: 16 },
      { name: "厨房", width: 3, length: 3, area: 9 },
    ],
  };
  await page.goto(`http://layout.test/floorplan-3d.html#plan=${encodeURIComponent(JSON.stringify(plan))}`);
  await expect(page.locator("#layout-status")).toBeVisible();
  await expect(page.locator("#panel")).not.toContainText("布局检查");
  await expect(page.locator("#gRooms polygon.room")).toHaveCount(0);
  expect(await page.evaluate("INJECTED.layoutInvalid")).toBe(true);
  expect(errors).toEqual([]);
});

test("截图方案渲染保持开放客餐厅、外窗和入口侧墙玄关", async ({ page }) => {
  const rooms = [
    { name: "客厅", width: 4.2, length: 4.24 },
    { name: "餐厅", width: 2.9, length: 3 },
    { name: "厨房", width: 2.9, length: 3.03 },
    { name: "生活阳台", width: 1.4, length: 1.8 },
    { name: "儿童房", width: 2.2, length: 2.3 },
    { name: "主卫", width: 1.7, length: 1.9 },
    { name: "主卧", width: 3.1, length: 3.2 },
    { name: "次卧", width: 2.8, length: 3 },
    { name: "公卫", width: 1.8, length: 2.05 },
    { name: "玄关", width: 1.2, length: 1.5, furniture: [{ name: "鞋柜", count: 1 }] },
    { name: "走廊", width: 1.2, length: 3 },
    { name: "交通走廊", width: 1.2, length: 11.675 },
  ].map(room => ({ ...room, area: room.width * room.length }));
  const plan = { sig: "screenshot-open-hub-regression", style: "现代简约", totalArea: 100, rooms };
  await page.goto(`http://layout.test/floorplan-3d.html#plan=${encodeURIComponent(JSON.stringify(plan))}`);
  await expect(page.locator("#gRooms polygon.room")).toHaveCount(9);
  const snapshot = await page.evaluate<Snapshot & {
    openings: { id: string; kind: string; entry?: boolean; p0: Point; p1: Point }[];
    graph: { edges: { from: string; to: string; openingId: string }[] };
    invalid?: boolean;
  }>("({furniture:state.furniture,rooms:ROOMS,walls:WALLS.map(w=>({poly:w.poly,segment:w.segment,thickness:w.thickness})),doors:DOORS,openings:INJECTED.openings,graph:INJECTED.constraints.graph,invalid:INJECTED.layoutInvalid})");
  expect(snapshot.invalid).not.toBe(true);
  expect(snapshot.rooms.some(room => /走廊|玄关|门厅/.test(room.name))).toBe(false);
  const bounds = (poly: Point[]) => [Math.min(...poly.map(p => p[0])), Math.min(...poly.map(p => p[1])), Math.max(...poly.map(p => p[0])), Math.max(...poly.map(p => p[1]))];
  const living = snapshot.rooms.find(room => room.name === "客厅")!;
  const dining = snapshot.rooms.find(room => room.name === "餐厅")!;
  const lb = bounds(living.poly), db = bounds(dining.poly);
  const seamY = lb[1];
  expect(db[3]).toBeCloseTo(seamY, 1);
  const seam: Point[] = [[Math.max(lb[0], db[0]) + 200, seamY - 10], [Math.min(lb[2], db[2]) - 200, seamY - 10], [Math.min(lb[2], db[2]) - 200, seamY + 10], [Math.max(lb[0], db[0]) + 200, seamY + 10]];
  expect(snapshot.walls.some(wall => overlap(wall.poly, seam))).toBe(false);
  expect(snapshot.doors.some(door => overlap([[door.rect[0], door.rect[1]], [door.rect[2], door.rect[1]], [door.rect[2], door.rect[3]], [door.rect[0], door.rect[3]]], seam))).toBe(false);
  expect(snapshot.graph.edges.some(edge => (
    (edge.from === living.id && edge.to === dining.id) || (edge.from === dining.id && edge.to === living.id)
  ) && snapshot.openings.some(opening => opening.id === edge.openingId && opening.kind === "passage"))).toBe(true);

  const exterior = bounds(snapshot.rooms.flatMap(room => room.poly));
  for (const room of snapshot.rooms.filter(room => /卧|儿童房|阳台/.test(room.name))) {
    const box = bounds(room.poly);
    expect(snapshot.openings.some(opening => {
      if (opening.kind !== "window" || Math.hypot(opening.p1[0] - opening.p0[0], opening.p1[1] - opening.p0[1]) < 800) return false;
      const [a, b] = [opening.p0, opening.p1];
      return (Math.abs(a[0] - b[0]) < 1 && [0, 2].some(side => Math.abs(a[0] - box[side]) < 1 && Math.abs(a[0] - exterior[side]) < 1) && Math.min(a[1], b[1]) >= box[1] - 1 && Math.max(a[1], b[1]) <= box[3] + 1)
        || (Math.abs(a[1] - b[1]) < 1 && [1, 3].some(side => Math.abs(a[1] - box[side]) < 1 && Math.abs(a[1] - exterior[side]) < 1) && Math.min(a[0], b[0]) >= box[0] - 1 && Math.max(a[0], b[0]) <= box[2] + 1);
    }), `${room.name}应有至少 800 mm 的实际外窗`).toBe(true);
  }
  const entry = snapshot.openings.find(opening => opening.entry === true)!;
  expect(entry).toBeDefined();
  const entryCenter: Point = [(entry.p0[0] + entry.p1[0]) / 2, (entry.p0[1] + entry.p1[1]) / 2];
  expect(entryCenter[1]).toBeCloseTo(exterior[3], 1);
  expect(entryCenter[0]).toBeGreaterThan(lb[0]);
  expect(entryCenter[0]).toBeLessThan(lb[2]);
  const cabinet = snapshot.furniture.find(item => item.type === "shoecab");
  expect(cabinet).toBeDefined();
  expect(Math.hypot(cabinet!.cx - entryCenter[0], cabinet!.cy - entryCenter[1])).toBeLessThanOrEqual(1500);
  expect(footprint(cabinet!).every(point => inside(point, living.poly))).toBe(true);
});

test("800 mm balcony facade receives a bounded daylight opening", async ({ page }) => {
  const rooms = [
    { name: "客厅", width: 6.8, length: 3.4 },
    { name: "厨房", width: 4.1, length: 2 },
    { name: "主卧", width: 5, length: 5.9 },
    { name: "公卫", width: 2.9, length: 3.5 },
    { name: "生活阳台", width: 1, length: 1.2 },
  ].map(room => ({ ...room, area: room.width * room.length }));
  const plan = { sig: "short-balcony-window-regression", style: "现代简约", totalArea: 100, rooms };
  await page.goto(`http://layout.test/floorplan-3d.html#plan=${encodeURIComponent(JSON.stringify(plan))}`);
  await expect(page.locator("#gRooms polygon.room")).toHaveCount(5);
  const snapshot = await page.evaluate<Snapshot & { openings: { kind: string; p0: Point; p1: Point }[] }>("({rooms:ROOMS, furniture:state.furniture, walls:WALLS.map(w=>({poly:w.poly,segment:w.segment,thickness:w.thickness})), doors:DOORS, windows:WINS.map(w=>({segment:w.segment,thickness:w.thickness})), openings:INJECTED.openings})");
  const balcony = snapshot.rooms.find(room => room.name === "生活阳台")!;
  const box = (poly: Point[]) => [Math.min(...poly.map(point => point[0])), Math.min(...poly.map(point => point[1])), Math.max(...poly.map(point => point[0])), Math.max(...poly.map(point => point[1]))];
  const [x0, y0, x1, y1] = box(snapshot.rooms.flatMap(room => room.poly));
  const [a0, b0, a1, b1] = box(balcony.poly);
  const opening = snapshot.openings.find(item => item.kind === "window" && Math.hypot(item.p1[0] - item.p0[0], item.p1[1] - item.p0[1]) >= 800 && (
    (Math.abs(item.p0[0] - item.p1[0]) < 1 && (Math.abs(item.p0[0] - a0) < 1 || Math.abs(item.p0[0] - a1) < 1) && (Math.abs(item.p0[0] - x0) < 1 || Math.abs(item.p0[0] - x1) < 1) && Math.min(item.p0[1], item.p1[1]) >= b0 - 1 && Math.max(item.p0[1], item.p1[1]) <= b1 + 1)
    || (Math.abs(item.p0[1] - item.p1[1]) < 1 && (Math.abs(item.p0[1] - b0) < 1 || Math.abs(item.p0[1] - b1) < 1) && (Math.abs(item.p0[1] - y0) < 1 || Math.abs(item.p0[1] - y1) < 1) && Math.min(item.p0[0], item.p1[0]) >= a0 - 1 && Math.max(item.p0[0], item.p1[0]) <= a1 + 1)
  ));
  expect(opening, "生活阳台应生成至少 800 mm 的实际外窗").toBeDefined();
  const length = Math.hypot(opening!.p1[0] - opening!.p0[0], opening!.p1[1] - opening!.p0[1]);
  expect(length).toBeLessThanOrEqual(Math.max(a1 - a0, b1 - b0) + 1);
});

test("碰撞校验随编辑更新，但不在方案详细重复展示检查列表", async ({ page }) => {
  const opening = { id: "front-door", wallId: "wall-2", kind: "door" as const, entry: true, offset: .4, width: .15, swing: 1 as const };
  const g = geometry([[0, 0], [600, 0], [600, 500], [0, 500]], [opening]);
  const snapshot = await openPlan(page, g, [{ name: "鞋柜", count: 1 }], "live-constraint-audit");
  const shoecab = snapshot.furniture.find(item => item.type === "shoecab");
  expect(shoecab).toBeDefined();
  const entry = await page.evaluate<{p0:Point;p1:Point}>("INJECTED.openings.find(item=>item.entry===true)");
  expect(Math.hypot(shoecab!.cx-(entry.p0[0]+entry.p1[0])/2, shoecab!.cy-(entry.p0[1]+entry.p1[1])/2)).toBeLessThanOrEqual(1500);
  await page.evaluate(`(() => { const opening = INJECTED.openings.find(item => item.entry === true); const cx = (opening.p0[0] + opening.p1[0]) / 2, cy = (opening.p0[1] + opening.p1[1]) / 2; mutate(() => { const furniture = state.furniture.find(item => item.id === ${JSON.stringify(shoecab!.id)}); furniture.cx = cx; furniture.cy = cy; }); })()`);
  expect(await page.evaluate("currentLayoutWarnings().some(message=>message.includes('门前'))")).toBe(true);
  await expect(page.locator("#panel")).not.toContainText("布局检查");
  await page.evaluate("undo()");
  expect(await page.evaluate("currentLayoutWarnings().some(message=>message.includes('鞋柜占用了门前'))")).toBe(false);
  await page.reload();
  expect(await page.evaluate("currentLayoutWarnings().some(message=>message.includes('鞋柜占用了门前'))")).toBe(false);
});

test("未确认入户门时不猜玄关位置，方案详细不显示方向确认", async ({ page }) => {
  const g = geometry([[0, 0], [600, 0], [600, 500], [0, 500]], [
    { id: "entry", wallId: "wall-2", kind: "door", offset: .4, width: .15, swing: 1 },
  ]);
  const snapshot = await openPlan(page, g, [{ name: "鞋柜", count: 1 }], "unknown-entry-foyer");
  expect(snapshot.doors.some(door => door.entry)).toBe(false);
  expect(snapshot.furniture.some(item => item.type === "shoecab")).toBe(false);
  await expect(page.locator("#panel")).not.toContainText("入户门尚未确认");
  await expect(page.locator("#panel")).not.toContainText("布局检查");
});

test("识别户型家具保留门前 1m、窗前 0.8m，且位于真实房间内", async ({ page }) => {
  const g = geometry([[0, 0], [600, 0], [600, 500], [0, 500]], [
    { id: "entry", wallId: "wall-2", kind: "door", offset: .4, width: .15, swing: 1 },
    { id: "window", wallId: "wall-0", kind: "window", offset: .3, width: .4, swing: 1 },
  ]);
  const snapshot = await openPlan(page, g, [{ name: "双人床", count: 1 }, { name: "衣柜", count: 1 }, { name: "书桌", count: 1 }], "keepout-layout");
  expect(snapshot.furniture.map(f => f.type)).toEqual(expect.arrayContaining(["bed", "wardrobe"]));
  const zones = [
    ...snapshot.doors.flatMap(o => openingZones(o.segment, o.thickness, 1000)),
    ...snapshot.windows.flatMap(o => openingZones(o.segment, o.thickness, 800)),
  ];
  for (const f of snapshot.furniture) {
    const shape = footprint(f);
    expect(shape.every(p => inside(p, snapshot.rooms[0].poly))).toBe(true);
    expect(zones.some(zone => overlap(shape, zone))).toBe(false);
    expect(snapshot.walls.some(wall => overlap(shape, wall.poly))).toBe(false);
  }
});

test("窄房间可旋转床头贴实墙，手工属性、撤销和刷新保持可用", async ({ page }) => {
  const g = geometry([[0, 0], [280, 0], [280, 180], [0, 180]]);
  const snapshot = await openPlan(page, g, [{ name: "单人床", count: 1 }], "rotated-bed-layout");
  expect(snapshot.furniture).toHaveLength(1);
  const bed = snapshot.furniture[0], shape = footprint(bed);
  expect(Math.abs(bed.rot % 180 - 90)).toBeLessThan(.01);
  expect(shape.every(p => inside(p, snapshot.rooms[0].poly))).toBe(true);
  const angle = bed.rot * Math.PI / 180, back: Point = [bed.cx + bed.d / 2 * Math.sin(angle), bed.cy - bed.d / 2 * Math.cos(angle)];
  expect(Math.min(...snapshot.walls.map(wall => Math.abs(distanceToLine(back, wall.segment) - wall.thickness / 2)))).toBeLessThan(2);

  await page.locator(`#gFurn [data-fid="${bed.id}"]`).click({ force: true });
  await page.locator('#fab [data-a="prop"]').click();
  await expect(page.locator("#objectEditor")).toBeVisible();
  await page.locator("#fX").fill(String(bed.cx + 100));
  await page.locator("#fX").press("Tab");
  await page.locator("#objectEditor #back").click();
  await page.locator("#drawer-edit > summary").click();
  await page.locator("#undo").click();
  expect(await page.evaluate("state.furniture[0].cx")).toBe(bed.cx);
  await page.locator("#redo").click();
  expect(await page.evaluate("state.furniture[0].cx")).toBe(bed.cx + 100);
  await page.reload();
  expect(await page.evaluate("state.furniture[0].cx")).toBe(bed.cx + 100);
});

test("高柜沿斜实墙旋转，避免退回房间外接矩形的错误贴墙", async ({ page }) => {
  const g = geometry([[0, 0], [600, 0], [500, 400], [100, 400]], [
    { id: "top-window", wallId: "wall-0", kind: "window", offset: 0, width: 1, swing: 1 },
    { id: "bottom-window", wallId: "wall-2", kind: "window", offset: 0, width: 1, swing: 1 },
  ]);
  const snapshot = await openPlan(page, g, [{ name: "书架", count: 1 }], "diagonal-wall-layout");
  expect(snapshot.furniture).toHaveLength(1);
  const cabinet = snapshot.furniture[0], shape = footprint(cabinet);
  expect(Math.min(cabinet.rot % 90, 90 - cabinet.rot % 90)).toBeGreaterThan(5);
  expect(shape.every(p => inside(p, snapshot.rooms[0].poly))).toBe(true);
  expect(snapshot.walls.some(wall => overlap(shape, wall.poly))).toBe(false);
  const angle = cabinet.rot * Math.PI / 180, back: Point = [cabinet.cx + cabinet.d / 2 * Math.sin(angle), cabinet.cy - cabinet.d / 2 * Math.cos(angle)];
  expect(Math.min(...snapshot.walls.map(wall => Math.abs(distanceToLine(back, wall.segment) - wall.thickness / 2)))).toBeLessThan(2);
});

test("无法容纳家具时保留校验与家具编辑能力，方案详细不展示检查列表", async ({ page }) => {
  const snapshot = await openPlan(page, geometry([[0, 0], [180, 0], [180, 180], [0, 180]]), [{ name: "单人床", count: 1 }], "infeasible-layout");
  expect(snapshot.furniture).toHaveLength(0);
  expect(await page.evaluate("currentLayoutWarnings().some(message=>message.includes('单人床')&&message.includes('实墙位置'))")).toBe(true);
  await expect(page.locator("#panel")).not.toContainText("布局检查");
  await page.locator("#tgLib").click();
  await page.locator("#lib .furniture-category > summary").first().click();
  await expect(page.locator("#lib .item").first()).toBeVisible();
});
