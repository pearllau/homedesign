// Pure calculations shared by both the AI SDK tools and the lightweight Worker API.
export function calculateArea({ width, length }: { width: number; length: number }) {
  return { area: Math.round(width * length * 100) / 100, width, length };
}

export function calculateBudget({ style, totalArea, roomCount, budgetCap }: { style: string; totalArea: number; roomCount: number; budgetCap?: number }) {
  const unit = /日|原木|禅/.test(style) ? 1800 : /欧/.test(style) ? 2200 : /美/.test(style) ? 2000 : /中|新中式/.test(style) ? 2400 : /轻奢|奢/.test(style) ? 2600 : /简|极简/.test(style) ? 1200 : 1500;
  let items = [
    { category: "硬装", item: "基础施工 + 主材", cost: Math.round(totalArea * unit) },
    { category: "家具", item: "全屋家具", cost: roomCount * 8000 },
    { category: "家电", item: "全屋家电", cost: roomCount * 6000 },
    { category: "软装", item: "窗帘灯具装饰", cost: Math.round(totalArea * 300) },
  ];
  let total = items.reduce((sum, item) => sum + item.cost, 0);
  if (budgetCap != null && budgetCap > 0 && total > budgetCap) {
    const scale = budgetCap / total;
    items = items.map((item) => ({ ...item, cost: Math.round(item.cost * scale) }));
    total = items.reduce((sum, item) => sum + item.cost, 0);
    const overflow = total - budgetCap;
    if (overflow > 0) { items[items.length - 1].cost -= overflow; total -= overflow; }
  }
  return { total, items };
}
