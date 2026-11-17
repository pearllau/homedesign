import { test, expect } from "@playwright/test";

const plan = {
  style: "现代简约",
  overview: "空间布局测试",
  totalArea: 20,
  rooms: [{ name: "客厅", width: 5, length: 4, area: 20, furniture: [{ name: "沙发", count: 1 }] }],
  budget: { total: 30000, items: [{ category: "家具", item: "沙发", cost: 30000 }] },
};

test("3D 优先请求高性能 WebGL，静止时按需绘制并能恢复和导出", async ({ page }) => {
  await page.goto(`/floorplan-3d.html#plan=${encodeURIComponent(JSON.stringify({ ...plan, sig: "render-perf" }))}`);
  await expect(page.locator("html")).toHaveAttribute("data-scene-ready", "true");
  await page.locator('#viewSeg [data-view="3d"]').click();

  const canvas = page.locator("#view3d canvas[data-render-path]");
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute("data-render-path", /^(high-performance|compatible-webgl)$/);
  const stage = page.locator("#view3d");
  await expect(page.locator("#stage")).toHaveClass(/is3d/);
  await expect(page.locator("#stage")).not.toHaveClass(/animating/);
  await expect(stage).toHaveAttribute("data-render-state", "idle", { timeout: 10000 });
  // The entrance transition has a short cross-fade before the camera animation;
  // sample twice after it has settled so this assertion cannot catch that gap.
  await page.waitForTimeout(500);
  const settledFrames = await stage.getAttribute("data-render-frames");
  await page.waitForTimeout(300);
  await expect(stage).toHaveAttribute("data-render-frames", settledFrames ?? "0");

  await page.evaluate(() => (window as typeof window & { View3D: { setVisible: (visible: boolean) => void } }).View3D.setVisible(false));
  await expect(stage).toHaveAttribute("data-render-state", "paused");
  await page.evaluate(() => (window as typeof window & { View3D: { setVisible: (visible: boolean) => void } }).View3D.setVisible(true));
  await expect(stage).toHaveAttribute("data-render-state", "idle", { timeout: 10000 });

  const downloadPromise = page.waitForEvent("download");
  await page.locator("details.menu > summary").click();
  await page.locator("#exportPng").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/-3D\.png$/);
});

test("缺少 WebGL 时保留可操作的 2D 户型", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
      if (String(args[0]).startsWith("webgl") || String(args[0]) === "experimental-webgl") return null;
      return original.apply(this, args);
    } as typeof original;
  });
  await page.goto(`/floorplan-3d.html#plan=${encodeURIComponent(JSON.stringify({ ...plan, sig: "render-no-webgl" }))}`);
  await page.locator('#viewSeg [data-view="3d"]').click();
  await expect(page.locator("#toast")).toContainText("可以继续编辑 2D 户型");
  await expect(page.locator("#plan")).toBeVisible();
  await page.locator('#viewSeg [data-view="3d"]').click();
  await expect(page.locator("#plan")).toBeVisible();
});
