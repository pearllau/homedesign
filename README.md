# 间筑 · AI 空间设计

面向普通装修用户的 AI 户型设计与 3D 预览工具：一句话生成装修方案，上传户型图自动识别墙体、门窗与房间，再进入可编辑的 2D/3D 工作台校准尺寸、布置家具并导出。

技术栈：Next.js 16（App Router）+ React 19 + AI SDK（DeepSeek 文本 / OpenAI 兼容视觉）+ three.js 0.160（本地 vendor）+ vinext（Cloudflare Workers 运行时）。

## Cloudflare Deployment

The app runs on Cloudflare Workers through vinext, including the `/api/chat` DeepSeek endpoint. The published URL is https://ai-decor-designer.ai-decor-designer.workers.dev — no custom domain is required.

Put `DEEPSEEK_API_KEY` and, optionally, `DEEPSEEK_MODEL` in the ignored `.env.local` file. In PowerShell, use the project's existing authenticated CLI profile and deploy with:

```powershell
$env:XDG_CONFIG_HOME = Join-Path (Get-Location) '.tmp/cf-config'
$env:CF_SEND_TELEMETRY = 'false'
npm run typecheck
npm run build:vinext
npm run deploy:vinext
```

The deploy command uploads variables listed in `.env.local` as server-side secrets. Keep that file limited to the two DeepSeek settings, and keep it out of version control. The API key is not included in browser assets. `.tmp/cf-config` contains local authentication and is also ignored; a new machine must run `npx cf auth login` using the same configuration directory.

This deployment uses Workers, static assets, and a Workers AI binding for floor-plan image recognition. It does not provision KV, R2, or image optimization. Run `npm run build:vinext` before every deploy because `deploy:vinext` publishes the prebuilt output.

Floor-plan recognition has its own `POST /api/floorplan/recognize` endpoint; the existing text-only `/api/chat` endpoint remains independent. It accepts same-origin JSON requests with `{ image, name, width, height }`: a PNG/JPEG/WebP data URI of at most 2 MiB, with each image side at most 2048 pixels. Actual file signatures and image dimensions are checked before inference. The client resizes the long edge to 896px, encodes the preview and the recognition image from a single decode, and never uploads the original file. Successful results are cached in-process for 10 minutes by image fingerprint, so re-running the same upload does not call the model again.

The Cloudflare Worker continues to use its `AI: bindings.ai()` binding and does not need a separate vision key. Standard local Node.js development (`npm run dev`) can instead call an OpenAI-compatible multimodal endpoint. Configure all three server-side settings (`VISION_API_KEY`, `VISION_BASE_URL`, `VISION_MODEL`) in the ignored `.env.local`. Missing settings return a clear 503 response without calling an external vision provider. The sample values in `.env.example` use Alibaba Cloud Model Studio (DashScope)'s mainland compatibility endpoint and `qwen3-vl-plus` as a candidate vision model; they are not guarantees that a particular account or region has that endpoint/model enabled. Volcengine Ark / Doubao can use the same adapter with `https://ark.cn-beijing.volces.com/api/v3` and the visual model endpoint ID created in the Ark console. The selected model must support image understanding and JSON output. This development environment could not reach Alibaba's documentation to verify current account availability. Check the current [Qwen-VL API guide](https://help.aliyun.com/zh/model-studio/qwen-vl-api) and [OpenAI-compatible API guide](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope), then set the endpoint and model ID available to your account. Never expose the key with a `NEXT_PUBLIC_` prefix. For a future Alibaba Cloud deployment, configure these values as server-side secrets and wire the same adapter into the server entrypoint.

A successful response contains a geometry draft in original image pixels, `confirmed: false`, and unknown structural wall properties. Detected length annotations are suggestions that must be checked; images without readable lengths require manual calibration. Invalid/non-floor-plan model output returns 422 and never substitutes a template layout.

## Local Development

Use `npm run dev` for local development with the configured vision API, or `npm run dev:vinext` to test the Cloudflare runtime and its Workers AI binding locally. On the Node.js route, `GET /api/floorplan/recognize` is a readiness check: it returns 200 only when all three settings are present and the base URL is valid, otherwise 503. Without parameters it never calls the model and never returns the key, base URL, or model ID; `?warm=1` additionally fires one tiny 64×64-pixel request (throttled to once every three minutes) so the client can absorb the provider's idle cold start while the user is still choosing a file. A successful readiness check confirms configuration only, not model access or billing status.

For an Alibaba Cloud Node.js host, use Node.js 20.9 or later (the installed Next.js version's declared minimum), install dependencies with `npm ci`, inject `VISION_API_KEY`, `VISION_BASE_URL`, and `VISION_MODEL` through the host's server-side environment/secret manager, then run `npm run build` and `npm run start`. Do not put the key in browser variables or source control. Before enabling image upload, verify the compatible API URL for the selected region and that the account can invoke the chosen vision model; then check `GET /api/floorplan/recognize`. The Cloudflare deployment configuration remains separate and continues using its existing AI binding.

## Reliability checks

The first screen is rendered visibly on the server, without waiting for animation or client hydration. Failed JavaScript loads show a reload notice, and incomplete AI plans are validated before rendering. The conversation is intentionally kept in memory only: every page load starts from an empty session, and no saved conversation is restored. Browsers without WebGL retain the 2D editor when 3D initialization fails.

Three.js 0.160.0 and its required addons are copied from the pinned npm dependency by `npm run prepare:assets` and served from `/vendor/three-0.160.0/`. The 3D page does not require jsDelivr. Plan data is passed to the editor in the URL fragment, so opening a generated plan also works when LocalStorage is unavailable.

```powershell
npm run lint
npm run typecheck
npm run build:vinext
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) '.tmp/playwright-browsers'
npx playwright install chromium --only-shell
npm run test:e2e
```

The Playwright suite covers plan validation, first visits with an empty session, JavaScript disabled or blocked, generation and view switching, refreshing into a clean session, storage restrictions with no external 3D resources, WebGL fallback, floor-plan upload/recognition states, and mobile input. ESLint passes without disabling the source rules. Reachability of `workers.dev` can still vary by visitor network; application checks cannot guarantee access from every network.

## 项目结构

- `src/app/page.tsx`：首页、对话、工作台外壳与视图切换
- `src/features/studio/`：动效、生成反馈、户型上传、内存 store、viewer 契约
- `src/server/ai/`：DeepSeek 对话（`design-chat.ts`）、视觉识别与修复（`floorplan-recognition.ts`）、提示词
- `src/shared/`：方案 zod 校验、户型几何校验、计价工具
- `public/floorplan-3d.html`：单文件 2D/3D 编辑器（three.js 由 `prepare:assets` 复制到本地 vendor）
