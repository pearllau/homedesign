import { z } from "zod";

export const pointSchema = z.tuple([z.number().finite(), z.number().finite()]);
const polygonSchema = z.array(pointSchema).min(3).max(128);
export const floorPlanGeometrySchema = z.object({
  version: z.literal(1),
  id: z.string().min(1).max(100),
  source: z.object({ name: z.string().max(200), width: z.number().positive().max(8192), height: z.number().positive().max(8192) }),
  outline: polygonSchema,
  rooms: z.array(z.object({ id: z.string().min(1).max(60), name: z.string().min(1).max(60), polygon: polygonSchema })).min(1).max(60),
  walls: z.array(z.object({ id: z.string().min(1).max(60), start: pointSchema, end: pointSchema, thicknessMm: z.number().min(60).max(1000).default(200), structural: z.enum(["unknown", "bearing", "partition"]).default("unknown") })).min(1).max(300),
  openings: z.array(z.object({ id: z.string().min(1).max(60), wallId: z.string().min(1).max(60), kind: z.enum(["door", "window", "passage"]), offset: z.number().min(0).max(1), width: z.number().positive().max(1), swing: z.union([z.literal(1), z.literal(-1)]).default(1), entry: z.boolean().optional() })).max(160),
  calibration: z.object({ start: pointSchema, end: pointSchema, lengthMeters: z.number().positive().max(200), source: z.enum(["detected", "manual"]) }).nullable().default(null),
  ceilingHeight: z.number().min(2).max(6).default(2.8),
  confirmed: z.boolean().default(false),
  warnings: z.array(z.string().max(300)).max(30).default([]),
});

export type Point = z.infer<typeof pointSchema>;
export type FloorPlanGeometry = z.infer<typeof floorPlanGeometrySchema>;
export type FloorPlanRoom = FloorPlanGeometry["rooms"][number];
export type FloorPlanWall = FloorPlanGeometry["walls"][number];
export type FloorPlanOpening = FloorPlanGeometry["openings"][number];

export function pixelArea(polygon: Point[]): number {
  return Math.abs(polygon.reduce((sum, point, i) => { const next = polygon[(i + 1) % polygon.length]; return sum + point[0] * next[1] - next[0] * point[1]; }, 0)) / 2;
}

export function pixelsPerMeter(geometry: FloorPlanGeometry): number | null {
  const calibration = geometry.calibration;
  if (!calibration) return null;
  const length = Math.hypot(calibration.end[0] - calibration.start[0], calibration.end[1] - calibration.start[1]);
  return length > 1 ? length / calibration.lengthMeters : null;
}

export function roomMetrics(room: FloorPlanRoom, geometry: FloorPlanGeometry) {
  const scale = pixelsPerMeter(geometry);
  if (!scale) return null;
  const xs = room.polygon.map(p => p[0]), ys = room.polygon.map(p => p[1]);
  const round = (value: number) => Math.round(value * 100) / 100;
  return { width: round((Math.max(...xs) - Math.min(...xs)) / scale), length: round((Math.max(...ys) - Math.min(...ys)) / scale), area: round(pixelArea(room.polygon) / (scale * scale)) };
}

function orientation(a: Point, b: Point, c: Point) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
function onSegment(point: Point, a: Point, b: Point) {
  return Math.abs(orientation(a, b, point)) < .001 && point[0] >= Math.min(a[0], b[0]) - .001 && point[0] <= Math.max(a[0], b[0]) + .001 && point[1] >= Math.min(a[1], b[1]) - .001 && point[1] <= Math.max(a[1], b[1]) + .001;
}
export function pointInPolygon(point: Point, polygon: Point[], includeBoundary = true): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i];
    if (onSegment(point, a, b)) return includeBoundary;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function segmentsCross(a: Point, b: Point, c: Point, d: Point) {
  return orientation(a, b, c) * orientation(a, b, d) < 0 && orientation(c, d, a) * orientation(c, d, b) < 0;
}
export function polygonSelfIntersects(polygon: Point[]): boolean {
  for (let i = 0; i < polygon.length; i++) for (let j = i + 1; j < polygon.length; j++) {
    if (j === i + 1 || (i === 0 && j === polygon.length - 1)) continue;
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], c = polygon[j], d = polygon[(j + 1) % polygon.length];
    if (segmentsCross(a, b, c, d) || onSegment(a, c, d) || onSegment(b, c, d) || onSegment(c, a, b) || onSegment(d, a, b)) return true;
  }
  return false;
}

export function validateGeometry(geometry: FloorPlanGeometry): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  const all = [...geometry.rooms, ...geometry.walls, ...geometry.openings];
  for (const item of all) { if (ids.has(item.id)) issues.push("图元编号重复，请重新识别或修正。"); ids.add(item.id); }
  const polygons = [{ name: "户型外轮廓", polygon: geometry.outline }, ...geometry.rooms];
  if (new Set(geometry.rooms.map(room => room.name.trim())).size !== geometry.rooms.length) issues.push("房间名称重复，请给每个房间设置不同的名称。");
  for (const item of polygons) {
    if (!item.name.trim()) issues.push("房间名称不能为空。");
    if (pixelArea(item.polygon) < 4) issues.push(`${item.name}面积过小，请检查边界。`);
    if (polygonSelfIntersects(item.polygon)) issues.push(`${item.name}边界交叉，请调整顶点。`);
    if (item.polygon.some(p => p[0] < 0 || p[1] < 0 || p[0] > geometry.source.width || p[1] > geometry.source.height)) issues.push(`${item.name}超出原图范围。`);
    if (item.polygon.some((p, i) => Math.hypot(p[0] - item.polygon[(i + 1) % item.polygon.length][0], p[1] - item.polygon[(i + 1) % item.polygon.length][1]) < .1)) issues.push(`${item.name}存在重复顶点，请删除或移动。`);
  }
  for (const room of geometry.rooms) {
    if (room.polygon.some((point, i) => {
      const next = room.polygon[(i + 1) % room.polygon.length];
      return !pointInPolygon(point, geometry.outline) || !pointInPolygon([(point[0] + next[0]) / 2, (point[1] + next[1]) / 2], geometry.outline) || geometry.outline.some((a, j) => segmentsCross(point, next, a, geometry.outline[(j + 1) % geometry.outline.length]));
    })) issues.push(`${room.name}超出户型外轮廓，请检查边界。`);
    const metric = roomMetrics(room, geometry);
    if (metric && (metric.width <= 0 || metric.length <= 0 || metric.area <= 0)) issues.push(`${room.name}校准后面积过小，请检查比例。`);
  }
  for (let i = 0; i < geometry.rooms.length; i++) for (let j = i + 1; j < geometry.rooms.length; j++) {
    const a = geometry.rooms[i], b = geometry.rooms[j];
    const centroid: Point = [a.polygon.reduce((sum, p) => sum + p[0], 0) / a.polygon.length, a.polygon.reduce((sum, p) => sum + p[1], 0) / a.polygon.length];
    if (a.polygon.some(p => pointInPolygon(p, b.polygon, false)) || b.polygon.some(p => pointInPolygon(p, a.polygon, false)) || a.polygon.some((p, k) => b.polygon.some((q, l) => segmentsCross(p, a.polygon[(k + 1) % a.polygon.length], q, b.polygon[(l + 1) % b.polygon.length]))) || (pointInPolygon(centroid, a.polygon, false) && pointInPolygon(centroid, b.polygon, false))) issues.push(`${a.name}与${b.name}边界重叠，请调整。`);
  }
  for (const wall of geometry.walls) if (Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]) < 2) issues.push("存在过短的墙线，请调整或删除。");
  for (const opening of geometry.openings) {
    if (opening.entry && opening.kind !== "door") issues.push("入户门标记只能用于门，请修正类型。");
    if (!geometry.walls.some(w => w.id === opening.wallId)) issues.push("门窗未关联墙体，请重新选择所属墙体。");
    if (opening.offset + opening.width > 1.001) issues.push("门窗超出所属墙体，请调整位置或宽度。");
  }
  if (geometry.openings.filter(opening => opening.entry).length > 1) issues.push("请只选择一个主入户门。");
  for (let i = 0; i < geometry.openings.length; i++) for (let j = i + 1; j < geometry.openings.length; j++) {
    const a = geometry.openings[i], b = geometry.openings[j];
    if (a.wallId === b.wallId && Math.max(a.offset, b.offset) < Math.min(a.offset + a.width, b.offset + b.width) - .001) issues.push("同一面墙上的门窗重叠，请调整位置。");
  }
  if (!pixelsPerMeter(geometry)) issues.push("请选择一段已知长度，完成尺寸校准。");
  return [...new Set(issues)];
}

// Attach the confirmed geometry to later decoration proposals without regenerating walls.
export function geometryRooms(geometry: FloorPlanGeometry) {
  return geometry.rooms.map(room => ({ id: room.id, name: room.name, ...roomMetrics(room, geometry)! }));
}
