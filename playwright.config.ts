import { defineConfig } from "@playwright/test";
import { join } from "node:path";

// 默认用 Next.js 生产预览跑 e2e：不需要 Cloudflare 登录，离线也能复现。
// 需要验证 Workers 运行时（Workers AI、vinext）时，用 E2E_SERVER=vinext，并先完成 `cf auth login`。
const useVinext = process.env.E2E_SERVER === "vinext";

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4175",
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: useVinext
      ? "npm run start:vinext -- --host 127.0.0.1 --port 4175"
      : "npm run build && npm run start -- --port 4175",
    url: "http://127.0.0.1:4175",
    reuseExistingServer: !process.env.CI,
    timeout: 180000,
    env: {
      XDG_CONFIG_HOME: join(process.cwd(), ".tmp/cf-config"),
      CF_SEND_TELEMETRY: "false",
    },
  },
});
