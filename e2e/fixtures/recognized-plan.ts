import type { FloorPlanGeometry } from "../../src/lib/floorplan-geometry";

export const recognizedGeometry: FloorPlanGeometry = {
  version: 1, id: "l-shaped-fixture", source: { name: "L形测试户型.png", width: 1000, height: 800 },
  outline: [[150,100],[900,100],[900,400],[600,400],[600,700],[100,700],[100,150]],
  rooms: [
    { id: "living", name: "客厅", polygon: [[150,100],[550,100],[550,400],[600,400],[600,700],[100,700],[100,150]] },
    { id: "bed", name: "卧室", polygon: [[550,100],[900,100],[900,400],[550,400]] },
  ],
  walls: [
    { id: "outer0", start: [150,100], end: [900,100], thicknessMm: 200, structural: "unknown" },
    { id: "outer1", start: [900,100], end: [900,400], thicknessMm: 200, structural: "unknown" },
    { id: "outer2", start: [900,400], end: [600,400], thicknessMm: 200, structural: "unknown" },
    { id: "outer3", start: [600,400], end: [600,700], thicknessMm: 200, structural: "unknown" },
    { id: "outer4", start: [600,700], end: [100,700], thicknessMm: 200, structural: "unknown" },
    { id: "outer5", start: [100,700], end: [100,150], thicknessMm: 200, structural: "unknown" },
    { id: "diagonal", start: [100,150], end: [150,100], thicknessMm: 200, structural: "unknown" },
    { id: "interior", start: [550,100], end: [550,400], thicknessMm: 120, structural: "partition" },
  ],
  openings: [
    { id: "door1", wallId: "interior", kind: "door", offset: .5, width: .3, swing: 1 },
    { id: "window1", wallId: "outer0", kind: "window", offset: .7, width: .2, swing: 1 },
    { id: "entry", wallId: "outer4", kind: "door", offset: .2, width: .18, swing: -1 },
  ],
  calibration: { start: [150,100], end: [900,100], lengthMeters: 7.5, source: "detected" },
  ceilingHeight: 2.8, confirmed: false, warnings: [],
};

export const recognizedPlan = {
  style: "现代简约", overview: "保留原图凹凸轮廓与门窗", totalArea: 38.875,
  rooms: [
    { name: "客厅", width: 5, length: 6, area: 28.375, furniture: [{ name: "沙发", count: 1 }] },
    { name: "卧室", width: 3.5, length: 3, area: 10.5, furniture: [{ name: "床", count: 1 }] },
  ],
  budget: { total: 60000, items: [{ category: "装修", item: "材料", cost: 60000 }] },
  floorPlan: { ...recognizedGeometry, confirmed: true },
};
