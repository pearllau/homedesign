import { test, expect } from "@playwright/test";
import { checkOpenAICompatibleVisionConfig, createOpenAICompatibleFloorPlanVision } from "../../src/server/ai/vision-provider";
import { handleFloorPlanRecognition, type FloorPlanVisionInput } from "../../src/server/ai/floorplan-recognition";

const input: FloorPlanVisionInput = {
  messages: [{ role: "user", content: [
    { type: "text", text: "Trace this floor plan." },
    { type: "image_url", image_url: { url: "data:image/png;base64,AA==" } },
  ] }],
  guided_json: { type: "object", properties: { rooms: { type: "array" } } },
  max_tokens: 1200,
  temperature: 0,
};

test("OpenAI-compatible visual provider sends server credentials, image and JSON schema", async () => {
  let endpoint = "";
  let headers: Headers | undefined;
  let payload: Record<string, unknown> | undefined;
  let signal: AbortSignal | undefined;
  const provider = createOpenAICompatibleFloorPlanVision({ apiKey: "test-secret", model: "account-enabled-vl", baseUrl: "https://vision.example/v1/" }, async (url, init) => {
    endpoint = String(url);
    headers = new Headers(init?.headers);
    payload = JSON.parse(String(init?.body));
    signal = init?.signal as AbortSignal;
    return Response.json({ choices: [{ message: { content: "{\"isFloorplan\":false}" } }] });
  });
  const controller = new AbortController();
  const result = await provider.run("@cf/mistralai/mistral-small-3.1-24b-instruct", input, { signal: controller.signal });

  expect(endpoint).toBe("https://vision.example/v1/chat/completions");
  expect(headers?.get("authorization")).toBe("Bearer test-secret");
  expect(signal).toBe(controller.signal);
  expect(payload).toMatchObject({ model: "account-enabled-vl", response_format: { type: "json_object" }, temperature: 0 });
  const messages = payload?.messages as { content: { type: string; text?: string; image_url?: { url: string } }[] }[];
  expect(messages[0].content).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "text", text: expect.stringContaining(JSON.stringify(input.guided_json)) }),
    expect.objectContaining({ type: "image_url", image_url: { url: "data:image/png;base64,AA==" } }),
  ]));
  expect(result).toEqual({ response: "{\"isFloorplan\":false}" });
});

test("provider disables model reasoning only when latency mode is enabled", async () => {
  let payload: Record<string, unknown> | undefined;
  const provider = createOpenAICompatibleFloorPlanVision({
    apiKey: "test-secret", model: "doubao-seed-vision", baseUrl: "https://vision.example/v1", disableThinking: true,
  }, async (_url, init) => {
    payload = JSON.parse(String(init?.body));
    return Response.json({ choices: [{ message: { content: "{}" } }] });
  });
  await provider.run("@cf/mistralai/mistral-small-3.1-24b-instruct", input);
  expect(payload).toMatchObject({ thinking: { type: "disabled" } });

  const defaultProvider = createOpenAICompatibleFloorPlanVision({ apiKey: "test-secret", model: "other-vl", baseUrl: "https://vision.example/v1" }, async (_url, init) => {
    payload = JSON.parse(String(init?.body));
    return Response.json({ choices: [{ message: { content: "{}" } }] });
  });
  await defaultProvider.run("@cf/mistralai/mistral-small-3.1-24b-instruct", input);
  expect(payload).not.toHaveProperty("thinking");
});

test("official Doubao defaults to fast tracing and supports an explicit opt-out", async () => {
  for (const disableThinking of [undefined, false]) {
    let payload: Record<string, unknown> | undefined;
    const provider = createOpenAICompatibleFloorPlanVision({
      apiKey: "test-secret", model: "doubao-seed-2-1-lite-260915",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3", disableThinking,
    }, async (_url, init) => {
      payload = JSON.parse(String(init?.body));
      return Response.json({ choices: [{ message: { content: "{}" } }] });
    });
    await provider.run("@cf/mistralai/mistral-small-3.1-24b-instruct", input);
    if (disableThinking === false) expect(payload).not.toHaveProperty("thinking");
    else expect(payload).toMatchObject({ thinking: { type: "disabled" } });
    expect(payload).toMatchObject({ max_tokens: input.max_tokens, temperature: input.temperature });
  }
});

test("recognition retry can override configured Doubao fast mode", async () => {
  let payload: Record<string, unknown> | undefined;
  const provider = createOpenAICompatibleFloorPlanVision({
    apiKey: "test-secret", model: "doubao-seed-2-1-lite-260915",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3", disableThinking: true,
  }, async (_url, init) => {
    payload = JSON.parse(String(init?.body));
    return Response.json({ choices: [{ message: { content: "{}" } }] });
  });
  await provider.run("@cf/mistralai/mistral-small-3.1-24b-instruct", input, { disableThinking: false });
  expect(payload).not.toHaveProperty("thinking");
});

test("provider rejects unsafe HTTP endpoints and missing model content without leaking upstream data", async () => {
  const unsafe = createOpenAICompatibleFloorPlanVision({ apiKey: "test", model: "vl", baseUrl: "http://example.com/v1" });
  await expect(unsafe.run("@cf/mistralai/mistral-small-3.1-24b-instruct", input)).rejects.toThrow("HTTPS");
  const provider = createOpenAICompatibleFloorPlanVision({ apiKey: "test", model: "vl", baseUrl: "https://vision.example/v1" }, async () => Response.json({ choices: [{ message: { content: null } }] }));
  await expect(provider.run("@cf/mistralai/mistral-small-3.1-24b-instruct", input)).rejects.toThrow("no usable content");
  const failed = createOpenAICompatibleFloorPlanVision({ apiKey: "test", model: "vl", baseUrl: "https://vision.example/v1" }, async () => new Response("private upstream details", { status: 401 }));
  await expect(failed.run("@cf/mistralai/mistral-small-3.1-24b-instruct", input)).rejects.toThrow("HTTP 401");
  await expect(failed.run("@cf/mistralai/mistral-small-3.1-24b-instruct", input)).rejects.not.toThrow("private upstream details");
});

test("provider forwards cancellation and rejects malformed completion payloads", async () => {
  const controller = new AbortController();
  let fetchSignal: AbortSignal | null | undefined;
  const provider = createOpenAICompatibleFloorPlanVision({ apiKey: "test-secret", model: "vl", baseUrl: "https://vision.example/v1" }, async (_url, init) => {
    fetchSignal = init?.signal;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
  });
  const pending = provider.run("@cf/mistralai/mistral-small-3.1-24b-instruct", input, { signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(fetchSignal?.aborted).toBe(true);

  const malformed = createOpenAICompatibleFloorPlanVision({ apiKey: "test-secret", model: "vl", baseUrl: "https://vision.example/v1" }, async () => new Response("private malformed body"));
  await expect(malformed.run("@cf/mistralai/mistral-small-3.1-24b-instruct", input)).rejects.toThrow("invalid JSON");
});

test("readiness check distinguishes incomplete and invalid configuration without exposing values", () => {
  expect(checkOpenAICompatibleVisionConfig({ apiKey: "", model: "", baseUrl: "" })).toEqual({ ready: false, reason: "missing_settings" });
  expect(checkOpenAICompatibleVisionConfig({ apiKey: "not-for-output", model: "vl", baseUrl: "http://example.com/v1" })).toEqual({ ready: false, reason: "invalid_base_url" });
  expect(checkOpenAICompatibleVisionConfig({ apiKey: "not-for-output", model: "vl", baseUrl: "https://dashscope.example/v1" })).toEqual({ ready: true });
  expect(checkOpenAICompatibleVisionConfig({ apiKey: "not-for-output", model: "doubao-vision-endpoint", baseUrl: "https://ark.cn-beijing.volces.com/api/v3" })).toEqual({ ready: true });
  expect(checkOpenAICompatibleVisionConfig({ apiKey: "k", model: "vl", baseUrl: "https://user:password@example.com/v1?token=x" })).toEqual({ ready: false, reason: "invalid_base_url" });
});

test("provider bounds response bodies before parsing model output", async () => {
  let bodyCancelled = false;
  const tooLarge = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(256 * 1024 + 1)); },
    cancel() { bodyCancelled = true; },
  });
  const provider = createOpenAICompatibleFloorPlanVision({ apiKey: "test-secret", model: "vl", baseUrl: "https://vision.example/v1" }, async () => new Response(tooLarge));
  await expect(provider.run("@cf/mistralai/mistral-small-3.1-24b-instruct", input)).rejects.toThrow("response is too large");
  expect(bodyCancelled).toBe(true);
});

test("shared recognizer keeps API failure, missing configuration and timeout responses safe", async () => {
  const makeRequest = () => new Request("https://test.invalid/api/floorplan/recognize", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://test.invalid" },
    body: JSON.stringify({
      image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+iBF8AAAAASUVORK5CYII=",
      name: "test.png", width: 1, height: 1,
    }),
  });
  const failed = createOpenAICompatibleFloorPlanVision({ apiKey: "test-secret", model: "vl", baseUrl: "https://vision.example/v1" }, async () => new Response("private provider details", { status: 401 }));
  const response = await handleFloorPlanRecognition(makeRequest(), { vision: failed });
  expect(response.status).toBe(502);
  expect(await response.text()).not.toMatch(/test-secret|private provider details|vision\.example/);
  expect((await handleFloorPlanRecognition(makeRequest())).status).toBe(503);

  let stopped = false;
  const pending = createOpenAICompatibleFloorPlanVision({ apiKey: "test-secret", model: "vl", baseUrl: "https://vision.example/v1" }, async (_url, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => { stopped = true; reject(new DOMException("Aborted", "AbortError")); }, { once: true });
  }));
  const timedOut = await handleFloorPlanRecognition(makeRequest(), { vision: pending, timeoutMs: 10 });
  expect(timedOut.status).toBe(504);
  expect(await timedOut.json()).toMatchObject({ code: "recognition_timeout" });
  expect(stopped).toBe(true);
});
