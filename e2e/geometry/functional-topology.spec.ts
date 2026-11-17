import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

type SourceRoom = { name: string; w: number; l: number; furniture?: { name: string; count: number }[] };
type RoomKey = number | string;
type LayoutRoom = { key: RoomKey; name?: string; rect: number[]; renderPoly?: [number, number][]; virtual?: boolean; source?: SourceRoom };
type Layout = {
  rooms: LayoutRoom[];
  unplacedRooms?: {key: RoomKey; name: string; source: SourceRoom; w: number; l: number; area: number}[];
  virtualZones?: { id: string; kind: string; rect?: number[]; anchor?: string; width?: number }[];
  publicKeys: RoomKey[];
  entryAnchor: { center: [number, number]; side: string };
  width: number;
  height: number;
  exterior?: number[];
  areaLimit?: number | null;
  allowedConnections: RoomKey[][];
  entryKey: RoomKey | null;
  warnings: string[];
  valid?: boolean;
  issues?: string[];
};
const context: { FunctionalTopology?: {
  build: (src: SourceRoom[], origin: { x: number; y: number }, thickness: number, options?: { totalArea: number }) => Layout | null;
  validate: (layout: Layout, source?: SourceRoom[]) => string[];
} } = {};
runInNewContext(readFileSync(resolve("public/functional-topology.js"), "utf8"), context);
const build = (src: SourceRoom[], totalArea?: number) => context.FunctionalTopology!.build(src, { x: 6000, y: 6000 }, 200, totalArea ? { totalArea } : undefined)!;
const area = (rect: number[]) => (rect[2] - rect[0]) * (rect[3] - rect[1]);
const polygonArea = (poly: [number, number][]) => Math.abs(poly.reduce((sum, point, i) => { const next = poly[(i + 1) % poly.length]; return sum + point[0] * next[1] - next[0] * point[1]; }, 0)) / 2;
const geometryArea = (room: LayoutRoom) => room.renderPoly ? polygonArea(room.renderPoly) : area(room.rect);
const adjacent = (a: number[], b: number[]) => (
  (Math.abs(a[2] - b[0]) < .1 || Math.abs(b[2] - a[0]) < .1) && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 1
) || (
  (Math.abs(a[3] - b[1]) < .1 || Math.abs(b[3] - a[1]) < .1) && Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 1
);
const source: SourceRoom[] = [
  { name: "客餐厅", w: 5.5, l: 4 }, { name: "厨房", w: 3, l: 3 }, { name: "生活阳台", w: 2, l: 2 },
  { name: "主卧", w: 4, l: 3.5 }, { name: "次卧", w: 3.2, l: 3 }, { name: "儿童房", w: 3, l: 3 },
  { name: "主卫", w: 2, l: 2 }, { name: "公卫", w: 2.2, l: 2 },
];

// Approximate the screenshot's room areas. The previous layout stretched
// these into a train-car floorplate and spent the living area on a corridor.
const screenshotRooms: SourceRoom[] = [
  { name: "客厅", w: 4.2, l: 4.24 }, { name: "餐厅", w: 2.9, l: 3 },
  { name: "厨房", w: 2.9, l: 3.03 }, { name: "生活阳台", w: 1.4, l: 1.8 },
  { name: "儿童房", w: 2.2, l: 2.3 }, { name: "主卫", w: 1.7, l: 1.9 },
  { name: "主卧", w: 3.1, l: 3.2 }, { name: "次卧", w: 2.8, l: 3 },
  { name: "公卫", w: 1.8, l: 2.05 },
  { name: "玄关", w: 1.2, l: 1.5, furniture: [{ name: "玄关柜", count: 1 }] },
  { name: "走廊", w: 1.2, l: 3 }, { name: "交通走廊", w: 1.2, l: 11.675 },
];

function depthFromPublic(layout: Layout) {
  const depth = new Map<RoomKey, number>(layout.publicKeys.map(key => [key, 0]));
  const queue = [...layout.publicKeys];
  for (let head = 0; head < queue.length; head++) for (const pair of layout.allowedConnections.filter(edge => edge[0] === queue[head])) {
    const child = pair[1];
    if (!depth.has(child)) { depth.set(child, depth.get(pair[0])! + 1); queue.push(child); }
  }
  return depth;
}

test("public circulation and foyer are virtual zones, never additional rooms", () => {
  const layout = build(source);
  expect(layout.valid).toBe(true);
  expect(layout.rooms).toHaveLength(source.length);
  expect(layout.publicKeys).toContain(0);
  expect(layout.rooms.some(room => /走廊|玄关|门厅/.test(room.name || ""))).toBe(false);
  expect(layout.virtualZones).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "navmesh" }), expect.objectContaining({ kind: "foyer" }),
  ]));
  source.forEach((room, key) => expect(geometryArea(layout.rooms.find(item => item.key === key)!) / 1e6).toBeCloseTo(room.w * room.l, 3));
});

test("screenshot regression keeps the open living/dining area usable and compact", () => {
  const layout = build(screenshotRooms, 100);
  expect(layout.valid).toBe(true);
  const publicRooms = layout.rooms.filter(room => layout.publicKeys.includes(room.key));
  expect(publicRooms.map(room => room.name)).toEqual(expect.arrayContaining(["客厅", "餐厅"]));
  expect(publicRooms.every(room => room.rect[2] - room.rect[0] >= 2999)).toBe(true);
  for (const room of publicRooms) expect(Math.min(room.rect[2] - room.rect[0], room.rect[3] - room.rect[1])).toBeGreaterThanOrEqual(1999);
  expect(Math.max(layout.width, layout.height) / Math.min(layout.width, layout.height)).toBeLessThanOrEqual(1.65);
  expect(layout.rooms.some(room => /走廊|玄关|门厅/.test(room.name || ""))).toBe(false);
  for (const room of layout.rooms) expect(room.renderPoly?.length || 4).toBe(4);
});

test("every legal doorway has a real shared edge and all rooms have depth at most two", () => {
  const layout = build(screenshotRooms, 100);
  const depth = depthFromPublic(layout);
  expect(depth.size).toBe(layout.rooms.length);
  for (const room of layout.rooms) expect(depth.get(room.key)).toBeLessThanOrEqual(2);
  for (const [parentKey, childKey] of layout.allowedConnections) {
    const parent = layout.rooms.find(room => room.key === parentKey)!, child = layout.rooms.find(room => room.key === childKey)!;
    expect(adjacent(parent.rect, child.rect)).toBe(true);
    if (depth.get(childKey) === 2) {
      expect((/卧|儿童房/.test(parent.name || "") && /主卫/.test(child.name || "")) || (/厨/.test(parent.name || "") && /生活阳台|家政/.test(child.name || ""))).toBe(true);
    }
  }
});

test("master bath is private and no kitchen door connects directly to a bath", () => {
  const layout = build(source);
  expect(layout.allowedConnections.filter(pair => pair.includes(6))).toEqual([[3, 6]]);
  const kitchen = layout.rooms.find(room => room.key === 1)!;
  for (const key of [6, 7]) {
    expect(adjacent(kitchen.rect, layout.rooms.find(room => room.key === key)!.rect)).toBe(false);
    expect(layout.allowedConnections.some(pair => pair.includes(1) && pair.includes(key))).toBe(false);
  }
  for (const key of [3, 4, 5, 7]) expect(layout.allowedConnections.some(([parent, child]) => layout.publicKeys.includes(parent) && child === key)).toBe(true);
});

test("entry and invisible foyer are bound to the living-room exterior at the bottom", () => {
  const layout = build(screenshotRooms, 100);
  expect(layout.entryAnchor.side).toBe("bottom");
  expect(layout.entryAnchor.center.every(Number.isFinite)).toBe(true);
  expect(layout.entryAnchor.center[1]).toBeCloseTo(layout.exterior![3], 1);
  const living = layout.rooms.find(room => room.name === "客厅")!;
  expect(layout.entryAnchor.center[0]).toBeGreaterThanOrEqual(living.rect[0]);
  expect(layout.entryAnchor.center[0]).toBeLessThanOrEqual(living.rect[2]);
  const foyer = layout.virtualZones!.find(zone => zone.kind === "foyer")!;
  expect(foyer.rect).toBeDefined();
  const [x0, y0, x1, y1] = foyer.rect!;
  expect(Math.hypot((x0+x1)/2-layout.entryAnchor.center[0],(y0+y1)/2-layout.entryAnchor.center[1])).toBeLessThanOrEqual(2000);
});

test("all bedrooms and balconies have a usable exterior edge", () => {
  const layout = build(screenshotRooms, 100), [x0, y0, x1, y1] = layout.exterior!;
  for (const room of layout.rooms.filter(item => /卧|儿童房|阳台/.test(item.name || ""))) {
    const [a, b, c, d] = room.rect;
    const exteriorEdges = [Math.abs(a-x0)<.1 ? d-b : 0,Math.abs(b-y0)<.1 ? c-a : 0,Math.abs(c-x1)<.1 ? d-b : 0,Math.abs(d-y1)<.1 ? c-a : 0];
    expect(Math.max(...exteriorEdges)).toBeGreaterThanOrEqual(800);
  }
});

test("areas, room bounds and deterministic rebuild survive topology changes", () => {
  const layout = build(source);
  expect(JSON.stringify(build(source))).toBe(JSON.stringify(layout));
  source.forEach((room, key) => expect(geometryArea(layout.rooms.find(item => item.key === key)!) / 1e6).toBeCloseTo(room.w * room.l, 3));
  const [x0,y0,x1,y1] = layout.exterior!;
  layout.rooms.forEach((room, index) => {
    const a = room.rect;
    expect(a[0]).toBeGreaterThanOrEqual(x0-.1); expect(a[1]).toBeGreaterThanOrEqual(y0-.1);
    expect(a[2]).toBeLessThanOrEqual(x1+.1); expect(a[3]).toBeLessThanOrEqual(y1+.1);
    layout.rooms.slice(index+1).forEach(other => {
      const b=other.rect;
      expect(Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0])) * Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]))).toBe(0);
    });
  });
});

test("a compact one-room plan keeps its existing dimensions", () => {
  const layout = build([{name:"单身公寓",w:4,l:3}]);
  expect(layout.rooms).toHaveLength(1);
  expect(layout.width).toBe(4000); expect(layout.height).toBe(3000);
  expect(layout.allowedConnections).toEqual([]);
});

test("a master bath without a bedroom is invalid instead of receiving a public door", () => {
  const layout=build([{name:"客厅",w:4,l:4},{name:"主卫",w:2,l:2}]);
  expect(layout.valid).toBe(false);
  expect(layout.warnings.join(" ")).toMatch(/缺少可匹配的卧室|未接入/);
  expect(layout.allowedConnections.some(pair=>pair.includes(1))).toBe(false);
});

test("functional completion adds only rooms that fit the supplied building area", () => {
  const layout=build([
    {name:"客餐厅",w:5,l:4},{name:"主卧",w:3.6,l:3.2},{name:"次卧",w:3,l:3},{name:"儿童房",w:3,l:3},{name:"公卫",w:1.8,l:2},
  ],80);
  expect(layout.rooms.map(room=>room.name)).toEqual(expect.arrayContaining(["厨房","生活阳台","主卫"]));
  const constrained=build([{name:"客厅",w:3,l:3},{name:"主卧",w:2.5,l:2.5}],19);
  expect(constrained.warnings.some(message=>/总面积不足|超过建筑面积|无法/.test(message))).toBe(true);
});

test("35㎡ studio from the recording receives a public hub without stacking rooms", () => {
  const input = [
    {name:"卧室区",w:2.6,l:3}, {name:"厨房",w:1.9,l:2.6},
    {name:"卫生间",w:1.6,l:2.2}, {name:"生活阳台",w:1.5,l:2.4},
  ];
  const layout = build(input, 35);
  expect(layout.valid).toBe(true);
  expect(layout.rooms).toHaveLength(5);
  expect(layout.rooms.find(room => room.key === layout.entryKey)!.name).toBe("客餐厅");
  expect(layout.rooms.reduce((sum,room) => sum + geometryArea(room), 0)).toBeLessThanOrEqual(35e6);
  input.forEach((room,key) => expect(geometryArea(layout.rooms.find(item => item.key === key)!) / 1e6).toBeCloseTo(room.w * room.l, 3));
  expect(depthFromPublic(layout).size).toBe(layout.rooms.length);
  expect(context.FunctionalTopology!.validate(layout)).toEqual([]);
});

test("the public hub reserves area before optional functional additions", () => {
  const layout = build([{name:"卧室",w:4,l:3.5},{name:"卫生间",w:2,l:2}],26);
  expect(layout.valid).toBe(true);
  expect(layout.rooms.map(room => room.name)).toContain("客餐厅");
  // Rounded millimetre coordinates share the validator's 1000 mm² tolerance.
  expect(layout.rooms.reduce((sum,room) => sum + geometryArea(room),0)).toBeLessThanOrEqual(26e6 + 1000);
});

test("an impossible public budget preserves source rooms without overlapping geometry", () => {
  const input = [{name:"卧室",w:4,l:4},{name:"厨房",w:3,l:3}];
  const layout = build(input,25);
  expect(layout.valid).toBe(false);
  expect(layout.rooms).toEqual([]);
  expect(layout.allowedConnections).toEqual([]);
  expect(layout.entryKey).toBeNull();
  expect(layout.unplacedRooms?.map(room => room.source)).toEqual(input);
  expect(layout.warnings.join(" ")).toMatch(/原始房间尺寸已保留/);
});

test("validation rejects a foyer detached from the entrance even inside the public hub", () => {
  const layout = build(source);
  const hub = layout.rooms.find(room => room.key === layout.entryKey)!;
  const foyer = layout.virtualZones!.find(zone => zone.kind === "foyer")!;
  foyer.rect = [hub.rect[0] + 100, hub.rect[1] + 100, hub.rect[0] + 600, hub.rect[1] + 600];
  const [x0, y0, x1, y1] = foyer.rect;
  expect(Math.hypot((x0 + x1) / 2 - layout.entryAnchor.center[0], (y0 + y1) / 2 - layout.entryAnchor.center[1])).toBeGreaterThan(2000);
  expect(context.FunctionalTopology!.validate(layout)).toContain("玄关虚拟区块距离入户门超过 2 米。");
});

test("validation rejects a nearby foyer that extends outside the public hub", () => {
  const layout = build(source);
  const [x, y] = layout.entryAnchor.center;
  layout.virtualZones!.find(zone => zone.kind === "foyer")!.rect = [x - 250, y - 500, x + 250, y + 200];
  const issues = context.FunctionalTopology!.validate(layout);
  expect(issues).toContain("玄关或动线虚拟区块超出了公共枢纽。");
  expect(issues).not.toContain("玄关虚拟区块距离入户门超过 2 米。");
});

test("validation rejects overlapping entity rooms", () => {
  const layout = build(source);
  const bedroom = layout.rooms.find(room => room.name === "主卧")!;
  bedroom.rect = [...layout.rooms.find(room => room.name === "次卧")!.rect];
  expect(context.FunctionalTopology!.validate(layout).some(issue => /主卧与次卧|次卧与主卧/.test(issue) && /重叠/.test(issue))).toBe(true);
});

test("validation rejects an entity room outside the building exterior", () => {
  const layout = build(source);
  const bedroom = layout.rooms.find(room => room.name === "主卧")!;
  bedroom.rect = bedroom.rect.map(value => value + 50000);
  expect(context.FunctionalTopology!.validate(layout)).toContain("主卧超出建筑外轮廓。");
});

for (const name of ["主卧", "生活阳台"]) {
  test(`validation rejects ${name} with less than 800 mm of exterior wall`, () => {
    const layout = build(source);
    const [x, y] = layout.exterior!;
    layout.rooms.find(room => room.name === name)!.rect = [x, y + 1000, x + 700, y + 1600];
    expect(context.FunctionalTopology!.validate(layout)).toContain(`${name}没有至少 800 mm 的可用外墙采光边。`);
  });
}

test("validation rejects entity area above the building budget", () => {
  const layout = build(source);
  layout.areaLimit = layout.rooms.reduce((sum, room) => sum + geometryArea(room), 0) - 1e6;
  expect(context.FunctionalTopology!.validate(layout)).toContain("实体房间面积超过建筑面积，需重新分配空间。");
});

test("explicit virtual room areas never inflate entity rooms or the exterior", () => {
  const layout = build(screenshotRooms, 100);
  const entities = screenshotRooms.filter(room => !/走廊|玄关|门厅/.test(room.name));
  const withoutVirtualRooms = build(entities, 100);
  expect(layout.valid).toBe(true);
  expect(layout.rooms).toHaveLength(entities.length);
  for (const room of entities) {
    const placed = layout.rooms.find(item => item.name === room.name)!;
    expect(geometryArea(placed) / 1e6).toBeCloseTo(room.w * room.l, 3);
    expect(placed.rect).toEqual(withoutVirtualRooms.rooms.find(item => item.name === room.name)!.rect);
  }
  expect(layout.exterior).toEqual(withoutVirtualRooms.exterior);
});

test("validation rejects a master bathroom opening directly into the public hub", () => {
  const layout = build(source);
  expect(context.FunctionalTopology!.validate(layout)).toEqual([]);
  const masterBath = layout.rooms.find(room => room.name === "主卫")!;
  layout.allowedConnections = layout.allowedConnections.map(([parent, child]) => child === masterBath.key ? [layout.entryKey!, child] : [parent, child]);
  expect(context.FunctionalTopology!.validate(layout).length).toBeGreaterThan(0);
});

test("validation rejects a multiroom layout without an entry anchor or circulation zones", () => {
  const layout = build(source);
  expect(context.FunctionalTopology!.validate(layout)).toEqual([]);
  Reflect.deleteProperty(layout, "entryAnchor");
  layout.virtualZones = [];
  expect(context.FunctionalTopology!.validate(layout).length).toBeGreaterThan(0);
});

test("validation rejects a circulation network narrower than 1000 mm", () => {
  const layout = build(source);
  expect(context.FunctionalTopology!.validate(layout)).toEqual([]);
  layout.virtualZones!.find(zone => zone.kind === "navmesh")!.width = 100;
  expect(context.FunctionalTopology!.validate(layout).length).toBeGreaterThan(0);
});
