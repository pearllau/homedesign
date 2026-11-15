# 间筑 (AI-Powered Furniture Design)

An AI-powered interior design application built with Next.js, featuring chat-based design generation, floor plan recognition, and 3D visualization.

## Features

- **AI Design Chat**: Generate interior design plans through natural language conversations using DeepSeek
- **Floor Plan Recognition**: Upload floor plan images and convert them to editable layouts using vision AI
- **2D Editor**: Modify room layouts, furniture placement, and dimensions
- **3D Visualization**: View designs in interactive 3D with Three.js
- **Cross-Platform**: Runs on Cloudflare Workers or local Node.js

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **3D Rendering**: Three.js 0.160.0
- **AI**: DeepSeek API, Workers AI (Cloudflare)
- **Vision**: OpenAI-compatible vision models (Qwen-VL, Doubao)
- **Testing**: Playwright
- **Deployment**: Cloudflare Workers via vinext

## Getting Started

### Prerequisites

- Node.js 20.9+
- npm

### Installation

```bash
npm ci
```

### Local Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Environment Variables

Create a `.env.local` file:

```bash
# For Cloudflare deployment
DEEPSEEK_API_KEY=your_key
DEEPSEEK_MODEL=deepseek-chat

# For local vision API (optional)
VISION_API_KEY=your_key
VISION_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
VISION_MODEL=qwen3-vl-plus
```

## Deployment

### Cloudflare Workers

```powershell
$env:XDG_CONFIG_HOME = Join-Path (Get-Location) '.tmp/cf-config'
$env:CF_SEND_TELEMETRY = 'false'
npm run typecheck
npm run build:vinext
npm run deploy:vinext
```

The app will be available at: https://ai-decor-designer.ai-decor-designer.workers.dev

### Vercel

The easiest way to deploy is using the [Vercel Platform](https://vercel.com/new).

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /api/chat` | AI design chat with DeepSeek |
| `POST /api/floorplan/recognize` | Floor plan image recognition |
| `GET /api/floorplan/recognize` | Readiness check for vision API |

## Floor Plan Recognition

Upload a floor plan image (PNG/JPEG/WebP, max 2MB, max 2048px per side) to convert it to an editable layout.

**Request:**
```json
{
  "image": "data:image/png;base64,...",
  "name": "my-floorplan",
  "width": 1000,
  "height": 800
}
```

**Response:**
```json
{
  "rooms": [...],
  "openings": [...],
  "confirmed": false
}
```

## Project Structure

```
├── src/
│   ├── app/              # Next.js app router pages
│   │   ├── api/          # API routes
│   │   ├── design/       # Design editor page
│   │   └── page.tsx      # Home/chat page
│   ├── features/         # Feature components
│   ├── server/           # Server-side logic
│   │   └── ai/           # AI integration
│   └── shared/           # Shared utilities
├── public/
│   ├── floorplan-3d.html # 3D viewer
│   └── vendor/           # Third-party assets
└── e2e/                  # End-to-end tests
```

## Reliability Features

- Server-side rendering for first screen paint
- JavaScript error handling with reload notices
- Plan data validation before rendering
- WebGL fallback to 2D editor
- URL-based plan sharing (works without LocalStorage)

## Testing

```bash
npm run lint
npm run typecheck
npm run build:vinext
npx playwright install chromium --only-shell
npm run test:e2e
```

## License

MIT