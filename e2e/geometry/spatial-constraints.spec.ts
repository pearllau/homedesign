import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test, expect } from "@playwright/test";

const context: Record<string, unknown> = {};
vm.runInNewContext(readFileSync("public/spatial-constraints.js", "utf8"), context);
const constraints = context.SpaceConstraints as {
  prepare: (input: unknown) => { rooms: { id: string; poly: [number, number][] }[]; walls: { segment?: [[number, number], [number, number]]; thickness?: number; poly?: [number, number][] }[]; zones: { type: string; roomId: string; polygon: [number, number][] }[]; routes: { roomId: string; width: number; points: [number, number][] }[]; graph: { portals: { entry: boolean }[] }; warnings: string[] };
  audit: (scene: unknown, furniture: unknown[]) => string[];
};

const room = { id: "living", name: "客厅", poly: [[0, 0], [5000, 0], [5000, 4000], [0, 4000]] };
const openings = [
  { id: "entry", kind: "door", entry: true, p0: [2000, 0], p1: [2900, 0] },
  { id: "passage", kind: "passage", p0: [2000, 4000], p1: [2900, 4000] },
  { id: "window", kind: "window", p0: [5000, 1000], p1: [5000, 2200] },
];

test("door and window openings receive measured interior keep-out zones", () => {
  const result = constraints.prepare({ rooms: [room], openings });
  expect(result.zones.some(zone => zone.type === "door-clearance" && zone.roomId === "living")).toBe(true);
  expect(result.zones.some(zone => zone.type === "window-clearance" && zone.roomId === "living")).toBe(true);
  expect(result.graph.portals.some(portal => portal.entry)).toBe(true);
  expect(result.zones.filter(zone => zone.type === "door-clearance").every(zone => zone.polygon.every(point => point[1] <= 1000 || point[1] >= 3000))).toBe(true);
});

test("clearance depth begins at the inner wall face and entry status is explicit", () => {
  const result = constraints.prepare({
    rooms: [room],
    openings: [
      { id: "entry", kind: "door", entry: false, thickness: 200, p0: [2000, 0], p1: [2900, 0] },
      { id: "window", kind: "window", thickness: 300, p0: [5000, 1000], p1: [5000, 2200] },
    ],
  });
  const doorZone = result.zones.find(zone => zone.type === "door-clearance")!;
  const windowZone = result.zones.find(zone => zone.type === "window-clearance")!;
  const doorDepth = Math.max(...doorZone.polygon.map(point => point[1])) - Math.min(...doorZone.polygon.map(point => point[1]));
  const windowDepth = Math.max(...windowZone.polygon.map(point => point[0])) - Math.min(...windowZone.polygon.map(point => point[0]));
  expect(doorDepth).toBe(1000);
  expect(windowDepth).toBe(800);
  expect(Math.min(...doorZone.polygon.map(point => point[1]))).toBe(100);
  expect(Math.max(...windowZone.polygon.map(point => point[0]))).toBe(4850);
  expect(result.graph.portals.some(portal => portal.entry)).toBe(false);
});

test("room doors connect through a clearance-preserving navigation route", () => {
  const result = constraints.prepare({ rooms: [room], openings });
  const route = result.routes.find(item => item.roomId === "living");
  expect(route).toBeDefined();
  expect(route?.width).toBe(1000);
  expect(route?.points.length).toBeGreaterThan(1);
  expect(result.zones.some(zone => zone.type === "route" && zone.roomId === "living")).toBe(true);
});

test("an open public boundary connects navigation without reserving an entire wall as a door", () => {
  const dining = { id: "dining", name: "餐厅", poly: [[0, 4000], [5000, 4000], [5000, 7000], [0, 7000]] };
  const result = constraints.prepare({ rooms: [room, dining], openings: [
    openings[0],
    { id: "public-passage", kind: "passage", virtual: true, p0: [2000, 4000], p1: [3000, 4000], thickness: 0 },
  ] });
  expect(result.zones.filter(zone => zone.type === "door-clearance")).toHaveLength(1);
  expect(result.routes.map(route => route.roomId)).toEqual(expect.arrayContaining(["living", "dining"]));
  expect(result.routes.every(route => route.width === 1000)).toBe(true);
  expect(result.warnings).toEqual([]);
});

test("audit reports furniture blocking a door, window, or circulation zone", () => {
  const result = constraints.prepare({ rooms: [room], openings });
  const warnings = constraints.audit(result, [
    { name: "鞋柜", cx: 2450, cy: 450, w: 1000, d: 600, rot: 0 },
    { name: "沙发", cx: 4550, cy: 1600, w: 900, d: 1400, rot: 0 },
  ]);
  expect(warnings.some(message => message.includes("鞋柜") && message.includes("门前"))).toBe(true);
  expect(warnings.some(message => message.includes("沙发") && message.includes("窗前"))).toBe(true);
});

test("a narrow room reports an impossible target instead of inventing space", () => {
  const narrow = { id: "narrow", name: "过道", poly: [[0, 0], [900, 0], [900, 5000], [0, 5000]] };
  const result = constraints.prepare({ rooms: [narrow], openings: [{ id: "door", kind: "door", p0: [0, 2000], p1: [0, 2900] }] });
  expect(result.routes).toHaveLength(0);
  expect(result.warnings.some(message => message.includes("1000 mm"))).toBe(true);
});

test("audit reports furniture collisions, blocked dining clearance, wall anchoring and room overflow", () => {
  const wall = { segment: [[0, 0], [5000, 0]] as [[number, number], [number, number]], thickness: 200, poly: [[0, -100], [5000, -100], [5000, 100], [0, 100]] as [number, number][] };
  const layout = constraints.prepare({ rooms: [room], walls: [wall] });
  const warnings = constraints.audit(layout, [
    { name: "餐桌", type: "table", cx: 2500, cy: 2000, w: 1400, d: 800, rot: 0 },
    { name: "餐椅", type: "chair", cx: 1700, cy: 2000, w: 450, d: 480, rot: 0 },
    { name: "沙发", type: "sofa", cx: 3900, cy: 2000, w: 1000, d: 700, rot: 0 },
    { name: "双人床", type: "bed", cx: 1000, cy: 1500, w: 1800, d: 2000, rot: 0 },
    { name: "越界柜", type: "wardrobe", cx: 5100, cy: 2000, w: 500, d: 500, rot: 0 },
  ]);
  expect(warnings.some(message => message.includes("沙发") && message.includes("餐桌周围"))).toBe(true);
  expect(warnings.some(message => message.includes("双人床") && message.includes("未贴靠"))).toBe(true);
  expect(warnings.some(message => message.includes("越界柜") && message.includes("房间边界"))).toBe(true);
});

test("a cabinet snapped to the solid wall passes the wall-anchor audit", () => {
  const wall = { segment: [[0, 0], [5000, 0]] as [[number, number], [number, number]], thickness: 200, poly: [[0, -100], [5000, -100], [5000, 100], [0, 100]] as [number, number][] };
  const layout = constraints.prepare({ rooms: [room], walls: [wall] });
  const warnings = constraints.audit(layout, [{ name: "衣柜", type: "wardrobe", cx: 1500, cy: 400, w: 1800, d: 600, rot: 0 }]);
  expect(warnings.some(message => message.includes("衣柜") && message.includes("未贴靠"))).toBe(false);
});
