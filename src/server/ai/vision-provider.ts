import type { FloorPlanVisionBinding, FloorPlanVisionInput } from "./floorplan-recognition";

export type OpenAICompatibleVisionConfig = {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  /** 是否关闭思考；默认 true，实测比默认思考快一个数量级。 */
  disableThinking?: boolean;
  /** 关闭 disableThinking 后的思考强度，用于需要更强空间推算的场景。 */
  reasoningEffort?: "low" | "medium" | "high";
};

export type VisionProviderConfigStatus = { ready: true } | { ready: false; reason: "missing_settings" | "invalid_base_url" };

/** Report only configuration readiness; never return key, endpoint or model ID. */
export function checkOpenAICompatibleVisionConfig(config: OpenAICompatibleVisionConfig): VisionProviderConfigStatus {
  if (!config.apiKey?.trim() || !config.baseUrl?.trim() || !config.model?.trim()) return { ready: false, reason: "missing_settings" };
  try {
    apiUrl(config.baseUrl);
    return { ready: true };
  } catch {
    return { ready: false, reason: "invalid_base_url" };
  }
}

type ChatCompletion = {
  choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }>;
  usage?: { completion_tokens?: number; total_tokens?: number };
};
const MAX_PROVIDER_RESPONSE_BYTES = 256 * 1024;

function readTextContent(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return null;
  const text = value
    .filter((item): item is { type: "text"; text: string } =>
      Boolean(item && typeof item === "object" && "type" in item && item.type === "text" && "text" in item && typeof item.text === "string"),
    )
    .map(item => item.text)
    .join("\n");
  return text || null;
}

function apiUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  const url = new URL(normalized);
  const localHttp = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if ((url.protocol !== "https:" && !localHttp) || url.username || url.password || url.search || url.hash) {
    throw new Error("Vision provider URL must use HTTPS and omit URL credentials, query, and fragment");
  }
  return `${normalized}/chat/completions`;
}

async function readProviderJson(response: Response): Promise<ChatCompletion> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > MAX_PROVIDER_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new Error("Vision provider response is too large");
  }
  if (!response.body) throw new Error("Vision provider returned invalid JSON");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        text += decoder.decode();
        break;
      }
      size += value.byteLength;
      if (size > MAX_PROVIDER_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Vision provider response is too large");
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text) as ChatCompletion;
  } catch (error) {
    if (error instanceof Error && error.message === "Vision provider response is too large") throw error;
    throw new Error("Vision provider returned invalid JSON");
  } finally {
    reader.releaseLock();
  }
}

/**
 * Adapt an OpenAI-compatible multimodal chat endpoint (such as Alibaba Cloud
 * Model Studio's DashScope compatible-mode API) to the binding shape consumed
 * by the shared recognizer. Keep credentials server-side and pass cancellation
 * through to fetch.
 */
export function createOpenAICompatibleFloorPlanVision(
  config: OpenAICompatibleVisionConfig,
  fetcher: typeof fetch = fetch,
): FloorPlanVisionBinding {
  return {
    async run(_cloudflareModel: string, input: FloorPlanVisionInput, options?: { signal?: AbortSignal }) {
      // Validate during invocation so the shared handler can return a safe
      // service error rather than leaking a configuration exception.
      const baseUrl = config.baseUrl?.trim();
      const model = config.model?.trim();
      if (!config.apiKey.trim() || !baseUrl || !model) throw new Error("Vision provider configuration is incomplete");
      const endpoint = apiUrl(baseUrl);
      // 默认关闭思考：实测同一张户型图，默认思考 40–70 秒，关闭后稳定 6 秒左右，
      // 坐标精度由图片叠加的参考网格 + 后端端点吸附兜底。
      // 需要更稳的几何推算时，显式关闭 disableThinking 并设置 reasoningEffort 走低强度思考。
      const arkDoubao = new URL(baseUrl).hostname === "ark.cn-beijing.volces.com" && /^doubao-seed-/i.test(model);
      const disableThinking = config.disableThinking ?? true;
      const reasoningEffort = config.disableThinking === true ? null : (config.reasoningEffort ?? (arkDoubao ? "low" : null));
      const prompt = input.messages.flatMap(message => {
        if (typeof message.content === "string") return [message.content];
        return message.content.flatMap(part => part.type === "text" && part.text ? [part.text] : []);
      }).join("\n\n");
      const image = input.messages.flatMap(message => {
        if (typeof message.content === "string") return [];
        return message.content.flatMap(part => part.type === "image_url" && part.image_url?.url ? [part.image_url.url] : []);
      })[0];
      if (!prompt || !image) throw new Error("Vision request is missing prompt or image");
      const response = await fetcher(endpoint, {
        method: "POST",
        signal: options?.signal,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [{
            role: "user",
            content: [
              { type: "text", text: `${prompt}\n\n请严格遵守以下 JSON Schema，只输出 JSON 对象：\n${JSON.stringify(input.guided_json)}` },
              { type: "image_url", image_url: { url: image } },
            ],
          }],
          max_tokens: input.max_tokens,
          temperature: input.temperature,
          response_format: { type: "json_object" },
          // 低强度思考：留出 2–3 秒做墙体坐标推算，又不会像默认模式那样消耗上千 token。
          ...(disableThinking ? { thinking: { type: "disabled" } } : reasoningEffort ? { thinking: { type: "enabled" }, reasoning_effort: reasoningEffort } : {}),
        }),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        // Keep upstream body, URL and credential out of application logs/errors.
        throw new Error(`Vision provider returned HTTP ${response.status}`);
      }

      const data = await readProviderJson(response);
      const content = readTextContent(data.choices?.[0]?.message?.content);
      if (!content || content.length > 200000) throw new Error("Vision provider returned no usable content");
      // The existing geometry parser performs the authoritative JSON/schema
      // validation and reports a safe 422 message for malformed model output.
      return { response: content };
    },
  };
}
