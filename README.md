This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

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

This deployment uses Workers with static assets only; it does not provision KV or image optimization. Run `npm run build:vinext` before every deploy because `deploy:vinext` publishes the prebuilt output.

## Local Development

Use `npm run dev` for the original Next.js development server or `npm run dev:vinext` to test the Cloudflare runtime locally.

## Reliability checks

The first screen is rendered visibly on the server, without waiting for animation or client hydration. Failed JavaScript loads show a reload notice, and invalid saved messages or incomplete AI plans are validated before rendering. Browsers without WebGL retain the 2D editor when 3D initialization fails.

Three.js 0.160.0 and its required addons are copied from the pinned npm dependency by `npm run prepare:assets` and served from `/vendor/three-0.160.0/`. The 3D page does not require jsDelivr. Plan data is passed to the editor in the URL fragment, so opening a generated plan also works when LocalStorage is unavailable.

```powershell
npm run lint
npm run typecheck
npm run build:vinext
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) '.tmp/playwright-browsers'
npx playwright install chromium --only-shell
npm run test:e2e
```

The nine regression checks cover plan validation, corrupt history, first visits, JavaScript disabled or blocked, generation and refresh, storage restrictions with no external 3D resources, WebGL fallback, and mobile input. ESLint passes without disabling the source rules. Reachability of `workers.dev` can still vary by visitor network; application checks cannot guarantee access from every network.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
