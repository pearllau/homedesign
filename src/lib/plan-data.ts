import { z } from "zod";
import type { UIMessage } from "ai";

// ============ 结构化方案 Schema ============

export const roomSchema = z.object({
  name: z.string().describe("房间名称，例如：主卧、客厅"),
  width: z.number().positive().describe("房间宽度（米）"),
  length: z.number().positive().describe("房间长度（米）"),
  area: z.number().positive().describe("房间面积（平方米），来自 calculateRoomArea 工具的计算结果"),
  furniture: z
    .array(
      z.object({
        name: z.string().describe("家具名称"),
        count: z.number().int().positive().describe("家具数量"),
      }),
    )
    .optional()
    .describe("该房间的家具布置"),
  notes: z.string().optional().describe("该房间的设计说明"),
});

export const budgetItemSchema = z.object({
  category: z.string().describe("预算类别，例如：硬装、家具、家电、软装"),
  item: z.string().describe("具体项目名称"),
  cost: z.number().nonnegative().describe("金额（元）"),
});

export const planSchema = z.object({
  style: z.string().describe("装修风格"),
  overview: z.string().describe("方案的一句话概述"),
  totalArea: z
    .number()
    .positive()
    .describe("户型建筑面积（平方米），以用户需求的整体面积为准（如「90㎡」即 90），而非各房间面积之和"),
  rooms: z.array(roomSchema).min(1).max(100).describe("房间列表"),
  budget: z.object({
    total: z.number().nonnegative().describe("总预算（元）"),
    items: z.array(budgetItemSchema).describe("分项预算明细"),
  }),
  highlights: z.array(z.string()).optional().describe("方案亮点（1-3 条）"),
});

export type Plan = z.infer<typeof planSchema>;

// 模型输出和历史记录都必须先校验，完整方案才能进入卡片和户型视图。
export function extractPlan(text: string): Plan | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const candidates = [
    trimmed,
    trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1],
    trimmed.match(/\{[\s\S]*\}/)?.[0],
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed: unknown = JSON.parse(candidate);
      const result = planSchema.safeParse(parsed);
      if (result.success) return result.data;
    } catch {
      // 流式输出可能尚未形成完整 JSON，继续等待后续消息。
    }
  }
  return null;
}

export function getMessageText(parts: UIMessage["parts"]): string {
  return parts.filter((part) => part.type === "text").map((part) => part.text).join("");
}

