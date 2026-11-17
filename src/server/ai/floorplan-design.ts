import { floorPlanGeometrySchema, geometryRooms, pixelsPerMeter, validateGeometry, type FloorPlanGeometry, type Point } from "../../shared/floorplan-geometry";

export function sourceGeometry(text: string): FloorPlanGeometry | null {
  if (!text.includes('"floorPlan"')) return null;
  try {
    const result = floorPlanGeometrySchema.safeParse(JSON.parse(text).floorPlan);
    // 旧版「校准并校对」页已删除，识别后直接进入工作台；几何结构完整即可继续对话，
    // 比例尺由用户在工作台「测量 · 尺寸校准」中随时修正，不能因为未校准就把对话锁死。
    return result.success && validateGeometry(result.data, { requireScale: false }).length === 0 ? result.data : null;
  } catch { return null; }
}

export function omitGeometry(text: string): string {
  if (!text.includes('"floorPlan"')) return text;
  try { const plan = JSON.parse(text); delete plan.floorPlan; return JSON.stringify(plan); }
  catch { return text; }
}

export function geometryDesignPrompt(geometry: FloorPlanGeometry): string {
  const scale = pixelsPerMeter(geometry);
  const meters = (point: Point) => point.map(value => Math.round(value / (scale || 1) * 1000) / 1000);
  const calibrationNote = scale
    ? "以下房间名称、边界、门窗位置与面积已经确认。"
    : "这张图纸还没有校准比例尺：房间名称、边界与门窗位置已确认，但面积是按整张图纸宽约 12 米的临时预览比例估算的，不是工程数据。可以正常做家具、材料与风格设计，但必须在 notes 里提醒用户先用「测量 · 尺寸校准」标定一面已知墙长，再确认预算。";
  const normalized = (point: Point) => [Math.round(point[0] / geometry.source.width * 1000) / 1000, Math.round(point[1] / geometry.source.height * 1000) / 1000];
  const anchors = scale ? {
    units: "meters", origin: "图纸左上角，x向右、y向下；坐标仅用于理解结构，不要写入输出JSON",
    rooms: geometry.rooms.map(room => ({ id: room.id, name: room.name, polygon: room.polygon.map(meters) })),
    walls: geometry.walls.map(wall => ({ id: wall.id, start: meters(wall.start), end: meters(wall.end), thickness: wall.thicknessMm / 1000, structural: wall.structural })),
    openings: geometry.openings.map(opening => ({ id: opening.id, wallId: opening.wallId, kind: opening.kind, offset: opening.offset, widthRatio: opening.width, entry: opening.entry })),
  } : {
    units: "normalized", origin: "图纸左上角，0–1 比例坐标（未校准），仅用于理解相邻关系，不要写入输出JSON",
    rooms: geometry.rooms.map(room => ({ id: room.id, name: room.name, polygon: room.polygon.map(normalized) })),
    walls: geometry.walls.map(wall => ({ id: wall.id, start: normalized(wall.start), end: normalized(wall.end), structural: wall.structural })),
    openings: geometry.openings.map(opening => ({ id: opening.id, wallId: opening.wallId, kind: opening.kind, offset: opening.offset, widthRatio: opening.width, entry: opening.entry })),
  };
  return `用户已上传真实户型图。${calibrationNote}禁止重新排布房间、编造房间或改变墙体。只设计家具、材料、风格与预算。真实图纸优先于文字户型的隐式空间补全规则：不得因为三室通常建议双卫就增造主卫，也不得补造图纸里没有的厨房、阳台或过道；缺少这些功能时，只能在 notes 说明现状与待确认的需求。若用户要求结构改造，在notes说明需要回到「校对户型」确认，不能声称已移动墙体或厨卫。
对现有门窗和墙线保留锚点：先确定门洞间的连续通路，再建议家具。门洞前约 1000 mm、窗前约 800 mm 不安排家具；主通道约 1000 mm，房内通道约 800 mm，餐桌椅后约 600 mm，主卧床侧约 700 mm。以真实可用面积为准，放不下时减少或缩小家具，并在 notes 标明未满足的目标，不得声称已通过寻路或碰撞校验。主卫只从主卧进入、公卫避开餐桌等要求若与图纸门向冲突，只说明问题与需人工确认的改造建议，不移动门洞。
玄关家具仅在已确认入户门侧墙附近规划；门窗数据没有标明哪个是入户门时，不得从开门朝向或房名猜定入户位置，必须在 notes 标明待确认。床头、衣柜、冰箱等高柜贴实墙，避开门窗；沙发与电视对齐，观看区域不要被通道横穿；可用矮柜或沙发背作软分区，但仍保留通路。厨房按取物、清洗、备餐、烹饪顺序安排，沿原有厨房边界规划。用户要求厨卫不相邻，但真实上传户型若原本相邻，必须保留原图，在 notes 明确标记并提示需要另行确认结构改造，不擅自移动、不承诺已经消除相邻关系。检测到开门见床或入口直视窗户等既有问题时如实提示；不能声称已经移动厨卫、改门或添加屏风解决，除非确有位置且后续布局可验证。
房间width/length为外接尺寸，area为不规则多边形面积（已校准时为真实面积，未校准时 estimated:true 表示估算值），不必等于width*length，无需调用calculateRoomArea重新计算它们。estimateBudget可使用用户提供的建筑面积；未提供则使用已确认房间面积之和，概述中说明按套内面积估算。只输出原装修方案JSON，不要输出floorPlan，也不要新增布局坐标字段。已确认房间：${JSON.stringify(geometryRooms(geometry))}\n已确认结构锚点：${JSON.stringify(anchors)}`;
}

export function attachSourceGeometry(text: string, geometry: FloorPlanGeometry): string {
  const plan = JSON.parse(text);
  const proposedRooms: Array<{ name: string; furniture?: unknown[]; notes?: string }> = plan.rooms;
  plan.rooms = geometryRooms(geometry).map(room => {
    const proposed = proposedRooms.find(item => item.name === room.name);
    return { name: room.name, width: room.width, length: room.length, area: room.area, furniture: proposed?.furniture || [], notes: proposed?.notes };
  });
  plan.floorPlan = geometry;
  return JSON.stringify(plan);
}
