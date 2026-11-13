import { tool } from "ai";
import { z } from "zod";

export { planSchema, roomSchema, budgetItemSchema } from "@/shared/plan-data";
export type { Plan } from "@/shared/plan-data";

// ============ Function Calling 工具 ============

// 工具 1：计算单个房间面积
export const calculateRoomArea = tool({
  description:
    "根据房间的长和宽计算面积（平方米）。生成方案前，对每一个房间调用此工具，得到精确面积后再填入方案。",
  inputSchema: z.object({
    width: z.number().describe("房间宽度（米）"),
    length: z.number().describe("房间长度（米）"),
  }),
  execute: async ({ width, length }) => {
    const area = Math.round(width * length * 100) / 100;
    return { area, width, length };
  },
});

// 工具 2：估算装修总预算（按风格与规模测算）
function unitPriceByStyle(style: string): number {
  if (/日|原木|禅/.test(style)) return 1800;
  if (/欧/.test(style)) return 2200;
  if (/美/.test(style)) return 2000;
  if (/中|新中式/.test(style)) return 2400;
  if (/轻奢|奢/.test(style)) return 2600;
  if (/简|极简/.test(style)) return 1200;
  return 1500;
}

export const estimateBudget = tool({
  description:
    "根据装修风格、建筑面积、房间数和预算上限估算装修总预算（元），并返回分项预算。生成方案时调用此工具，预算数字以工具返回为准，不要自己编造。",
  inputSchema: z.object({
    style: z.string().describe("装修风格"),
    totalArea: z
      .number()
      .describe("户型建筑面积（平方米），以用户需求的整体面积为准"),
    roomCount: z.number().describe("房间数量"),
    budgetCap: z
      .number()
      .optional()
      .describe(
        "用户预算上限（元）。若用户说明了预算规模（如「15 万以内」= 150000）则传入；未说明则不传",
      ),
  }),
  execute: async ({ style, totalArea, roomCount, budgetCap }) => {
    const unit = unitPriceByStyle(style);
    let items = [
      {
        category: "硬装",
        item: "基础施工 + 主材",
        cost: Math.round(totalArea * unit),
      },
      { category: "家具", item: "全屋家具", cost: roomCount * 8000 },
      { category: "家电", item: "全屋家电", cost: roomCount * 6000 },
      {
        category: "软装",
        item: "窗帘灯具装饰",
        cost: Math.round(totalArea * 300),
      },
    ];
    let total = items.reduce((sum, it) => sum + it.cost, 0);

    // 预算约束：若用户给出预算上限且测算超出，则等比压缩各分项，确保不超预算
    if (budgetCap != null && budgetCap > 0 && total > budgetCap) {
      const scale = budgetCap / total;
      items = items.map((it) => ({ ...it, cost: Math.round(it.cost * scale) }));
      total = items.reduce((sum, it) => sum + it.cost, 0);
      // 四舍五入可能导致总额略微超出上限，从软装中扣除差额以保证不超预算
      const overflow = total - budgetCap;
      if (overflow > 0) {
        const last = items[items.length - 1];
        if (last) {
          last.cost -= overflow;
          total -= overflow;
        }
      }
    }

    return { total, items };
  },
});

// 工具集合（streamText 与 toUIMessageStream 共用，保证类型一致）
export const planTools = {
  calculateRoomArea,
  estimateBudget,
};

// ============ 系统提示词 ============

export const PLAN_SYSTEM_PROMPT = `你是一位资深 AI 室内设计师兼装修预算专家。你的任务是根据用户需求，生成一份结构化的装修设计方案。

请严格遵守以下工作流程：
1. 解析用户需求，确定：房间构成与大致尺度、装修风格、建筑面积、预算上限。
   - 若用户给出整体面积（如「90㎡」「90 平米」），这就是建筑面积，作为 totalArea 使用。
   - 若用户给出预算（如「15 万以内」「预算 18 万」），把金额换算成元（1 万 = 10000 元）作为预算上限 budgetCap。
2. 【必须调用工具】对方案中的每一个房间，调用 calculateRoomArea 计算面积（传入合理的宽、长，单位为米）。
3. 【必须调用工具】调用 estimateBudget 估算总预算与分项。传入参数：style=装修风格、totalArea=建筑面积（用户说的整体面积，不是各房间面积之和）、roomCount=房间数量、budgetCap=用户预算上限（元，用户说明了预算才传，否则不传）。
4. 综合工具返回的真实计算结果，生成最终方案。

多轮修改模式：
- 若对话历史中已存在你给出的上一版方案，用户的新消息通常是针对它的修改诉求（如「总价压到 12 万」「把客厅和阳台打通」「换一种风格」）。
- 此时基于上一版方案做局部调整：保留未提及的房间与结构，只改动被要求的部分，并重新调用工具计算受影响的数据（面积、预算）。
- 无论是否修改，每次都输出一份完整的新版方案 JSON，而不是只输出改动部分。

硬性要求：
- 房间的长宽要符合生活常识（卧室通常 3~4 米，客厅 4~6 米）。
- totalArea 填用户需求的建筑面积（如 90㎡）。各房间面积之和是套内使用面积，会略小于建筑面积，这是正常现象，不要把它们强行相等。
- 每个房间的面积必须等于 calculateRoomArea 的返回结果。
- 预算的 total 与 items 必须来自 estimateBudget 的返回结果，不要编造；最终总预算不得超出用户给出的预算上限。
- 最终只输出一个合法的 JSON 对象，严格符合给定的 JSON Schema，不要输出 JSON 之外的任何文字、解释或 Markdown 代码块标记。`;