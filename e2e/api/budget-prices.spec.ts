import { test, expect } from "@playwright/test";
import { calculateBudget } from "../../src/shared/design-tools";
import { fallbackPriceBook, type PriceBook } from "../../src/shared/prices";

function rangedBook(): PriceBook {
  const book = fallbackPriceBook();
  book.styles = [{ id: "modern-minimal", name: "现代简约", unit: "元/㎡", low: 1000, mid: 1200, high: 1600 }];
  book.allowances = [
    { id: "furniture", name: "家具", unit: "元/间", low: 5000, mid: 8000, high: 10000, source: "test fixture", confidence: "fallback" },
    { id: "appliances", name: "家电", unit: "元/间", low: 3000, mid: 6000, high: 9000, source: "test fixture", confidence: "fallback" },
    { id: "soft-furnishing", name: "软装", unit: "元/㎡", low: 100, mid: 300, high: 500, source: "test fixture", confidence: "fallback" },
  ];
  return book;
}

test("按导入的三档风格与分类口径计算，各项中位合计等于总额", () => {
  const budget = calculateBudget({ style: "现代简约", totalArea: 35, roomCount: 3, priceBook: rangedBook() });
  expect(budget).toMatchObject({ low: 62500, mid: 94500, high: 130500, total: 94500 });
  expect(budget.items.reduce((sum, item) => sum + item.cost, 0)).toBe(budget.total);
  for (const item of budget.items) {
    expect(item.low).toBeLessThanOrEqual(item.mid);
    expect(item.mid).toBeLessThanOrEqual(item.high);
    expect(item.cost).toBe(item.mid);
  }
});

test("预算上限只标记超额，不修改单价、区间或总额", () => {
  const input = { style: "现代简约", totalArea: 35, roomCount: 3, priceBook: rangedBook() };
  const original = calculateBudget(input);
  const capped = calculateBudget({ ...input, budgetCap: 60000 });
  expect(capped.items).toEqual(original.items);
  expect(capped.naturalRange).toEqual(original.naturalRange);
  expect(capped).toMatchObject({ total: 94500, budgetCap: 60000, overBudget: true, overBy: 34500 });
});

test("仅有材料信息价时硬装回退独立风格基准，不把材料均价当综合价", () => {
  const priceBook = rangedBook();
  priceBook.meta = { ...priceBook.meta, confidence: "official", source: "fixture source", sourceUrl: "https://test.invalid/sheet", fallbackReason: "南京未收录，按全国均值估算。" };
  priceBook.styles = [];
  priceBook.materials = [{ id: "wood", name: "测试地板", unit: "元/㎡", low: 1, mid: 2, high: 3 }];
  const budget = calculateBudget({ style: "现代简约", totalArea: 35, roomCount: 3, priceBook });
  expect(budget.items[0]).toMatchObject({ cost: 42000 });
  expect(budget.basis.confidence).toBe("fallback");
  expect(budget.basis.source).toContain("离线规划基准");
  expect(budget.basis.fallbackReason).toContain("南京未收录");
  expect(budget.basis.fallbackReason).toContain("硬装使用项目内置");
  expect(budget.basis.sourceUrl).toBe("");
});

test("旧离线规划基准保持原有金额，不虚构市场区间", () => {
  const budget = calculateBudget({ style: "现代简约", totalArea: 35, roomCount: 3 });
  expect(budget).toMatchObject({ total: 94500, low: 94500, mid: 94500, high: 94500 });
  expect(budget.basis.confidence).toBe("fallback");
});

test("导入仅覆盖部分分类时，其余分类保留可追溯离线基准", () => {
  const priceBook = rangedBook();
  priceBook.allowances = [{ id: "furniture", name: "家具", unit: "元/间", low: 4000, mid: 5000, high: 6000, source: "test fixture", confidence: "official" }];
  const budget = calculateBudget({ style: "现代简约", totalArea: 35, roomCount: 3, priceBook });
  expect(budget.items[1].cost).toBe(15000);
  expect(budget.items[2].cost).toBe(18000);
  expect(budget.items[3].cost).toBe(10500);
  expect(budget.basis.confidence).toBe("fallback");
});

test("超大或非有限输入不能成为 null 金额，非法房间数与金额溢出立即失败", () => {
  for (const totalArea of [NaN, Infinity, Number.MAX_VALUE, -1, 0]) {
    expect(() => calculateBudget({ style: "极简", totalArea, roomCount: 1 })).toThrow();
  }
  for (const roomCount of [0, 1.5, 101, Number.MAX_SAFE_INTEGER]) {
    expect(() => calculateBudget({ style: "极简", totalArea: 35, roomCount })).toThrow();
  }
  const priceBook = rangedBook();
  priceBook.styles = [{ id: "minimal", name: "极简", unit: "元/㎡", low: 1e16, mid: 1e16, high: 1e16 }];
  expect(() => calculateBudget({ style: "极简", totalArea: 35, roomCount: 1, priceBook })).toThrow("Invalid budget amount");
});
