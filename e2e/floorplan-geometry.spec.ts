import { test, expect } from "@playwright/test";
import { pixelsPerMeter, roomMetrics, validateGeometry, polygonSelfIntersects } from "../src/lib/floorplan-geometry";
import { compactDesignMessages } from "../src/lib/floorplan-chat";
import { recognizedGeometry, recognizedPlan } from "./fixtures/recognized-plan";
import { handleDesignChat } from "../src/server/design-chat";

test("L 形房间按实际多边形计算面积，保留真实坐标", () => {
  expect(pixelsPerMeter(recognizedGeometry)).toBe(100);
  expect(roomMetrics(recognizedGeometry.rooms[0], recognizedGeometry)).toEqual({ width: 5, length: 6, area: 28.38 });
  expect(validateGeometry(recognizedGeometry)).toEqual([]);
  expect(polygonSelfIntersects([[0,0],[100,100],[0,100],[100,0]])).toBe(true);
});

test("无比例、越界、重叠门窗和交叉房间必须先修正", () => {
  expect(validateGeometry({ ...recognizedGeometry, calibration: null })).toContain("请选择一段已知长度，完成尺寸校准。");
  const geometry = structuredClone(recognizedGeometry);
  geometry.rooms[0].polygon[0] = [999,799];
  expect(validateGeometry(geometry).join(" ")).toMatch(/交叉|轮廓/);
  geometry.openings.push({ ...geometry.openings[0], id: "overlap" });
  expect(validateGeometry(geometry)).toContain("同一面墙上的门窗重叠，请调整位置。");
});

test("请求仅传一份几何，浏览器中原有消息保持完整", () => {
  const message = { id: "a", role: "assistant" as const, parts: [{ type: "text" as const, text: JSON.stringify(recognizedPlan) }] };
  const messages = [message, { ...message, id: "b" }];
  const packed = compactDesignMessages(messages);
  expect(JSON.parse(packed[0].parts[0].type === "text" ? packed[0].parts[0].text : "{}").floorPlan).toBeUndefined();
  expect(JSON.parse(packed[1].parts[0].type === "text" ? packed[1].parts[0].text : "{}").floorPlan).toEqual(recognizedPlan.floorPlan);
  expect(messages[0].parts[0].text).toContain('"floorPlan"');
});

test("对话修改保留确认的墙体门窗，并覆盖模型虚构的房间尺寸", async () => {
  const request = new Request("https://test.invalid/api/chat", { method: "POST", body: JSON.stringify({ messages: [
    { role: "assistant", parts: [{ type: "text", text: JSON.stringify(recognizedPlan) }] },
    { role: "user", parts: [{ type: "text", text: "换成原木风" }] },
  ] }) });
  const response = await handleDesignChat(request, { apiKey: "test", fetcher: async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    expect(body.messages[0].content).toContain("禁止重新排布房间");
    expect(body.messages[1].content).not.toContain('"floorPlan"');
    const proposal = { ...recognizedPlan, floorPlan: undefined, rooms: [{ name: "客厅", width: 99, length: 99, area: 9801, furniture: [{ name: "沙发", count: 1 }] }] };
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(proposal) }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
  } });
  const events = (await response.text()).split("\n").filter(line => line.startsWith("data: {")).map(line => JSON.parse(line.slice(6)));
  const plan = JSON.parse(events.filter(event => event.type === "text-delta").map(event => event.delta).join(""));
  expect(plan.floorPlan).toEqual(recognizedPlan.floorPlan);
  expect(plan.rooms).toHaveLength(2);
  expect(plan.rooms[0].area).toBe(28.38);
  expect(plan.rooms[1].name).toBe("卧室");
});
