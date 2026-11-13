import { bindings, defineConfig, defineWorker } from "cf/config";

export default defineConfig({
  accountId: "11f8a051aa981c88ed084fb2fa9198ed",
  worker: defineWorker({
    name: "ai-decor-designer",
    entrypoint: "./src/worker.ts",
    compatibilityDate: "2026-11-08",
    compatibilityFlags: ["nodejs_compat"],
    observability: {
      enabled: true,
      logs: { enabled: true, headSamplingRate: 1, invocationLogs: true },
      traces: { enabled: true, headSamplingRate: 0.1 },
    },
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    env: {
      ASSETS: bindings.assets(),
      AI: bindings.ai(),
      DEEPSEEK_API_KEY: bindings.secret(),
      DEEPSEEK_MODEL: bindings.secret(),
    },
  }),
});
