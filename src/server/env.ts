/**
 * 服务端环境变量集中读取。
 * 只在 Node.js 运行时（app/api/**）使用；Cloudflare Worker 走自己的 binding，见 src/worker.ts。
 */

function read(name: string): string {
  return process.env[name]?.trim() ?? "";
}

export function deepseekEnv() {
  return {
    apiKey: read("DEEPSEEK_API_KEY") || undefined,
    model: read("DEEPSEEK_MODEL") || undefined,
  };
}

export function visionEnv() {
  return {
    apiKey: read("VISION_API_KEY"),
    baseUrl: read("VISION_BASE_URL"),
    model: read("VISION_MODEL"),
    disableThinking: read("VISION_DISABLE_THINKING") ? read("VISION_DISABLE_THINKING").toLowerCase() === "true" : undefined,
  };
}
