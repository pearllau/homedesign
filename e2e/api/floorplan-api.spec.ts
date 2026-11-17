import { test, expect } from "@playwright/test";
import { deflateSync } from "node:zlib";
import { handleFloorPlanRecognition, FLOORPLAN_VISION_MODEL, type FloorPlanVisionBinding } from "../../src/server/ai/floorplan-recognition";
import type { FloorPlanGeometry } from "../../src/shared/floorplan-geometry";

// A real PNG fixture with its dimensions in IHDR, rather than a declared MIME
// string alone, lets the endpoint exercise its own byte-level image checks.
function png(width = 1000, height = 800) {
  const chunk = (name: string, data: Buffer) => {
    const type = Buffer.from(name);
    const bytes = Buffer.concat([type, data]);
    let crc = 0xffffffff;
    for (const byte of bytes) { crc ^= byte; for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, bytes, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc((width * 3 + 1) * height, 255);
  for (let row = 0; row < height; row++) pixels[row * (width * 3 + 1)] = 0;
  const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

const image = png();
const input = { image, name: "测试户型.png", width: 1000, height: 800 };
const outline = [[100, 100], [900, 100], [900, 600], [600, 600], [600, 900], [100, 900]];
const detection = {
  isFloorplan: true,
  outline,
  rooms: [{ name: "客厅", polygon: outline }],
  walls: outline.map((start, i) => ({ id: `w${i}`, start, end: outline[(i + 1) % outline.length] })),
  openings: [{ wallId: "w0", kind: "window", offset: 0.2, width: 0.3, swing: 1 }],
  calibration: null,
  warnings: [],
};

function request(body: unknown = input, headers: Record<string, string> = {}, signal?: AbortSignal) {
  return new Request("https://test.invalid/api/floorplan/recognize", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://test.invalid", ...headers }, body: JSON.stringify(body), signal });
}
function binding(result: unknown = detection): FloorPlanVisionBinding { return { run: async () => ({ response: JSON.stringify(result) }) }; }

test("Node 监听地址与公网 Host 不同时仍允许真实同源上传", async () => {
  const req = new Request("http://0.0.0.0:80/api/floorplan/recognize", {
    method: "POST", headers: { "content-type": "application/json", host: "101.37.71.218", origin: "http://101.37.71.218" }, body: JSON.stringify(input),
  });
  expect((await handleFloorPlanRecognition(req, { ai: binding() })).status).toBe(200);
});

test("Host 校验保留协议与端口限制且不信任伪造的 Forwarded-Host", async () => {
  let calls = 0;
  const ai: FloorPlanVisionBinding = { run: async () => { calls++; return detection; } };
  for (const origin of ["https://101.37.71.218", "http://101.37.71.218:8080", "http://foreign.invalid", "null"]) {
    const req = new Request("http://0.0.0.0:80/api/floorplan/recognize", {
      method: "POST", headers: { "content-type": "application/json", host: "101.37.71.218", origin, "x-forwarded-host": "foreign.invalid" }, body: JSON.stringify(input),
    });
    expect((await handleFloorPlanRecognition(req, { ai })).status).toBe(403);
  }
  expect(calls).toBe(0);
});

test("识别接口保留不规则边界，将归一化坐标还原为像素，等待校准确认", async () => {
  let calls = 0;
  const ai: FloorPlanVisionBinding = { run: async (model, payload, options) => {
    calls++;
    expect(model).toBe(FLOORPLAN_VISION_MODEL);
    expect(payload.messages[0].content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "image_url", image_url: { url: image } })]));
    expect(payload.guided_json).toEqual(expect.objectContaining({ type: "object" }));
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    return { response: JSON.stringify(detection) };
  } };
  const response = await handleFloorPlanRecognition(request(), { ai });
  const body = await response.json() as { geometry: FloorPlanGeometry };
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(calls).toBe(1);
  expect(body.geometry.source).toEqual({ name: "测试户型.png", width: 1000, height: 800 });
  expect(body.geometry.outline).toEqual([[100, 80], [900, 80], [900, 480], [600, 480], [600, 720], [100, 720]]);
  expect(body.geometry.outline).toHaveLength(6);
  expect(body.geometry.calibration).toBeNull();
  expect(body.geometry.confirmed).toBe(false);
  expect(body.geometry.walls.every((wall: { structural: string }) => wall.structural === "unknown")).toBe(true);
  expect(body.geometry.openings[0].wallId).toBe(body.geometry.walls[0].id);
  expect(body.geometry.warnings.join(" ")).toContain("校准");
});

test("快速模式返回无效结构时重试完整模式并恢复有效户型", async () => {
  const optionsSeen: Array<{ disableThinking?: boolean }> = [];
  let calls = 0;
  const ai: FloorPlanVisionBinding = { run: async (_model, _payload, options) => {
    calls++;
    optionsSeen.push(options || {});
    return { response: JSON.stringify(calls === 1 ? { ...detection, rooms: [], walls: [] } : detection) };
  } };
  const response = await handleFloorPlanRecognition(request(), { ai });
  const body = await response.json() as { geometry: FloorPlanGeometry };
  expect(response.status).toBe(200);
  expect(body.geometry.rooms).toHaveLength(1);
  expect(calls).toBe(2);
  expect(optionsSeen[0]?.disableThinking).toBeUndefined();
  expect(optionsSeen[1]?.disableThinking).toBe(false);
});

test("可读尺寸仅作为 detected 建议，模型不能自动确认或猜承重墙", async () => {
  const response = await handleFloorPlanRecognition(request(), { ai: binding({ ...detection, confirmed: true, walls: detection.walls.map(wall => ({ ...wall, structural: "bearing" })), calibration: { start: [100, 100], end: [900, 100], lengthMeters: 8 } }) });
  const body = await response.json() as { geometry: FloorPlanGeometry };
  expect(response.status).toBe(200);
  expect(body.geometry.calibration).toEqual({ start: [100, 80], end: [900, 80], lengthMeters: 8, source: "detected" });
  expect(body.geometry.confirmed).toBe(false);
  expect(body.geometry.walls[0].structural).toBe("unknown");
});

test("兼容 Workers AI 的对象响应，并将 0–1 坐标转换为 0–1000", async () => {
  const fraction = (point: number[]) => point.map(value => value / 1000);
  const fractional = {
    ...detection,
    outline: detection.outline.map(fraction),
    rooms: detection.rooms.map(room => ({ ...room, polygon: room.polygon.map(fraction) })),
    walls: detection.walls.map(wall => ({ ...wall, start: fraction(wall.start), end: fraction(wall.end) })),
    calibration: { start: [0.1, 0.1], end: [0.9, 0.1], lengthMeters: 8 },
  };
  const ai: FloorPlanVisionBinding = { run: async () => ({ response: fractional }) };
  const response = await handleFloorPlanRecognition(request(), { ai });
  const body = await response.json() as { geometry: FloorPlanGeometry };
  expect(response.status).toBe(200);
  expect(body.geometry.outline).toEqual([[100, 80], [900, 80], [900, 480], [600, 480], [600, 720], [100, 720]]);
  expect(body.geometry.calibration).toEqual({ start: [100, 80], end: [900, 80], lengthMeters: 8, source: "detected" });
  expect(body.geometry.rooms[0].polygon).toEqual(body.geometry.outline);
  expect(body.geometry.walls[0].start).toEqual([100, 80]);
  expect(body.geometry.walls[0].end).toEqual([900, 80]);
  expect(body.geometry.openings[0].offset).toBe(0.2);
  expect(body.geometry.openings[0].width).toBe(0.3);

  const standard = await handleFloorPlanRecognition(request(), { ai: { run: async () => ({ response: detection }) } });
  const standardBody = await standard.json() as { geometry: FloorPlanGeometry };
  expect(standard.status).toBe(200);
  expect(standardBody.geometry.outline).toEqual(body.geometry.outline);
});

test("兼容代码围栏包裹的 JSON 和闭合轮廓的重复末点", async () => {
  const closed = {
    ...detection,
    outline: [...outline, outline[0]],
    rooms: detection.rooms.map(room => ({ ...room, polygon: [...room.polygon, room.polygon[0]] })),
  };
  let calls = 0;
  const ai: FloorPlanVisionBinding = { run: async () => {
    calls++;
    return { response: `\`\`\`json\n${JSON.stringify(closed)}\n\`\`\`` };
  } };
  const response = await handleFloorPlanRecognition(request(), { ai });
  const body = await response.json() as { geometry: FloorPlanGeometry };
  expect(response.status).toBe(200);
  expect(calls).toBe(1);
  expect(body.geometry.outline).toHaveLength(outline.length);
  expect(body.geometry.rooms[0].polygon).toHaveLength(outline.length);
  expect(body.geometry.warnings.some(warning => warning.includes("边界交叉"))).toBe(false);
});

test("非法来源、图片魔数、尺寸和格式被拒绝且不会调用模型", async () => {
  let calls = 0;
  const ai: FloorPlanVisionBinding = { run: async () => { calls++; return {}; } };
  for (const [req, status] of [
    [request(input, { Origin: "https://foreign.invalid" }), 403],
    [request(input, { Origin: "" }), 403],
    [request(input, { "sec-fetch-site": "cross-site" }), 403],
    [request(input, { "Content-Type": "text/plain" }), 415],
    [request({ ...input, image: "data:image/png;base64,SGVsbG8=" }), 400],
    [request({ ...input, width: 999 }), 400],
    [request({ ...input, image: image.replace("image/png", "image/jpeg") }), 400],
    [request({ ...input, image: "data:image/svg+xml;base64,PHN2Zy8+" }), 415],
  ] as const) expect((await handleFloorPlanRecognition(req, { ai })).status).toBe(status);
  expect(calls).toBe(0);
});

test("超过体积限制的流式请求和图片在推理前停止", async () => {
  let called = false;
  const ai: FloorPlanVisionBinding = { run: async () => { called = true; return {}; } };
  const large = request({ ...input, image: `data:image/png;base64,${"A".repeat(2800000)}` });
  expect((await handleFloorPlanRecognition(large, { ai })).status).toBe(413);
  const req = new Request("https://test.invalid/api/floorplan/recognize", { method: "POST", headers: { Origin: "https://test.invalid", "Content-Type": "application/json" }, body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(3 * 1024 * 1024 + 1)); controller.close(); } }), duplex: "half" } as RequestInit);
  expect((await handleFloorPlanRecognition(req, { ai })).status).toBe(413);
  expect(called).toBe(false);
});

test("非户型图、损坏输出和严重缺失几何返回 422，不会替换为模板", async () => {
  for (const ai of [
    binding({ ...detection, isFloorplan: false, outline: [], rooms: [], walls: [], openings: [] }),
    binding({ ...detection, rooms: [] }),
    binding({ ...detection, walls: [] }),
    binding({ ...detection, outline: [[0, 0], [1000, 1000], [0, 1000], [1000, 0]] }),
    binding({ ...detection, openings: [{ ...detection.openings[0], wallId: "missing" }] }),
    { run: async () => ({ response: '{"rooms":' }) },
  ]) {
    const response = await handleFloorPlanRecognition(request(), { ai });
    const body = await response.json() as { geometry?: unknown; error?: unknown };
    expect(response.status).toBe(422);
    expect(body.geometry).toBeUndefined();
    expect(typeof body.error).toBe("string");
  }
});

test("轻微几何问题保留供用户校对并标记，不自动篡改图纸", async () => {
  const response = await handleFloorPlanRecognition(request(), { ai: binding({ ...detection, openings: [{ ...detection.openings[0], offset: 0.8, width: 0.4 }] }) });
  const body = await response.json() as { geometry: FloorPlanGeometry };
  expect(response.status).toBe(200);
  expect(body.geometry.openings[0].offset).toBe(0.8);
  expect(body.geometry.warnings.join(" ")).toContain("门窗超出");
  expect(body.geometry.confirmed).toBe(false);
});

test("取消和超时会传递给识别请求，不泄露上游异常", async () => {
  const controller = new AbortController();
  let upstream: AbortSignal | undefined;
  const pending: FloorPlanVisionBinding = { run: async (_model, _input, options) => { upstream = options?.signal; return new Promise(() => {}); } };
  const result = handleFloorPlanRecognition(request(input, {}, controller.signal), { ai: pending });
  await expect.poll(() => Boolean(upstream)).toBe(true);
  controller.abort();
  expect((await result).status).toBe(499);
  expect(upstream?.aborted).toBe(true);
  expect((await handleFloorPlanRecognition(request(), { ai: pending, timeoutMs: 10 })).status).toBe(504);
  const failed = await handleFloorPlanRecognition(request(), { ai: { run: async () => { throw new Error("private-provider-data"); } } });
  expect(failed.status).toBe(502);
  expect(await failed.text()).not.toContain("private-provider-data");
  expect((await handleFloorPlanRecognition(request())).status).toBe(503);
});
