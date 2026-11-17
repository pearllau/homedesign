# 独立合并审计

时间：2026-11-17T14:34:35.171Z。只读源文件审计；未stage、未改source、未提交。

- HEAD：18211504c0d4c6f20ced4faeac54ddbb252bc902
- MERGE_HEAD：560877c944e5faa60e6c7f77b4c8a6584f5f11a2（当前dev，包含用户指定679e950）
- index仍有39个unmerged路径：工作树内容已完成决策，但尚需显式git add登记为resolved，不能把index状态当成源码仍含冲突。
- 39个文件均存在，冲突标记：0。
- worker与HEAD文本完全一致：true；价格路由/服务端价格书/64KiB上限/查询校验均保留。
- 价格服务及data/prices、data/price-sources共19个文件内容与HEAD一致：true。402元/㎡及溯源元数据未改。
- 本代理后端34/34测试、分配文件ESLint已通过；根代理正在跑完整UI验收，本审计不冒充线上通过。

完整SHA256与双亲决策见同目录JSON；哈希比较统一CRLF为LF，未写回源码。

| 文件 | 决策 | 原因 |
|---|---|---|
| DESIGN.md | integrated | Integrated current tokens and accurate SVG/reduced-motion/timing contract; no runtime capability removed. |
| README.md | integrated | Integrated real project summary; retains API keys server-side, strict geometry/security, server price book and side-effect-free readiness. |
| e2e/api/design-api.spec.ts | HEAD | HEAD retains server-authoritative price/budget and malformed output regression tests. |
| e2e/api/floorplan-api.spec.ts | integrated | HEAD security/image/geometry cases plus cache isolation and explicit fallback provider tests. |
| e2e/api/vision-provider.spec.ts | integrated | HEAD compatibility, override, bounded response and safe errors plus explicit low-effort test. |
| e2e/geometry/functional-topology.spec.ts | HEAD | HEAD preserves public-hub/nonoverlap/infeasible-space tests removed by dev. |
| e2e/ui/floorplan-import.spec.ts | HEAD | HEAD matches retained calibration/manual tracing interface and image fidelity. |
| e2e/ui/floorplan-layout.spec.ts | HEAD | HEAD matches deployed viewer and preserves invalid-layout and editing checks. |
| e2e/ui/page-stability.spec.ts | integrated | Integrated return-to-chat/language/export thin header and conditional calibration; preserves session/render/mobile coverage. |
| e2e/ui/render-performance.spec.ts | HEAD | HEAD matches current 2D/3D selectors and keeps high-performance WebGL/on-demand render checks. |
| public/floorplan-3d.html | integrated | HEAD editor/2D/3D with compact source badges, used/all material toggle, metadata-first about, preserved API-backed estimate and scroll reset. |
| public/functional-topology.js | HEAD | HEAD preserves deployed public-hub placement and impossible-layout behavior; dev removes those fixes. |
| src/app/api/chat/route.ts | HEAD | HEAD injects server getPriceBook into chat. |
| src/app/api/floorplan/recognize/route.ts | integrated | HEAD safe readiness plus explicit fallback provider and provider namespace for bounded successful cache. |
| src/app/globals.css | integrated | Integrated warm right-angle design and slim header/compact controls; existing editor rules retained. |
| src/app/layout.tsx | dev | dev improves warm right-angle resource-failure and noscript notice; retains startup and children. |
| src/app/loading.tsx | dev | dev uses current brand name in loading status. |
| src/app/page.tsx | integrated | Integrated dev target-language select, message/view motion and exports; latest user thin header, plan-card upload/conditional calibration, exact empty text; preserves authoritative budget and existing import. |
| src/features/studio/components/design-workspace.tsx | HEAD | HEAD keeps the existing 2D/3D workspace bridge removed by dev. |
| src/features/studio/components/floorplan-import.css | HEAD | HEAD keeps full calibration/manual tracing presentation compatible with retained importer. |
| src/features/studio/components/floorplan-import.tsx | HEAD | HEAD keeps current recognized/manual/calibration workflow and API rather than incompatible dev initialFile interface. |
| src/features/studio/components/generation-feedback.tsx | dev | dev makes request states and safe errors clearer; retains retry and plan activity. |
| src/features/studio/components/icon.tsx | HEAD | HEAD keeps icon utility removed by dev; referenced by retained components. |
| src/features/studio/components/plan-activity.tsx | integrated | HEAD continuous SVG path plus dev visibility-pause effect. |
| src/features/studio/components/room-scene.tsx | HEAD | HEAD keeps room scene dependency removed by dev. |
| src/features/studio/components/studio-views.tsx | dev | dev retains mounted context/inert/reduced-motion/focus callback and uses 240/180ms transitions. |
| src/features/studio/lib/floorplan-image.ts | HEAD | HEAD keeps original higher-resolution image fidelity instead of dev 896px grid conversion. |
| src/features/studio/lib/plan-config.ts | HEAD | HEAD keeps retained workspace configuration removed by dev. |
| src/features/studio/lib/store.ts | HEAD | HEAD preserves validated memory-only conversation behavior; avoids API mismatch. |
| src/features/studio/lib/studio-motion.ts | dev | dev adds explicit leave timing/ease to shared motion tokens. |
| src/server/ai/design-chat.ts | integrated | HEAD authoritative pricing/security; dev compatible one JSON-repair attempt; no automatic room resizing. |
| src/server/ai/design-prompt.ts | HEAD | HEAD truthful budgets and area/topology constraints; dev arbitrary budget compression rejected. |
| src/server/ai/floorplan-design.ts | integrated | dev normalized uncalibrated source anchors plus corrected approximate-scale description; real walls preserved. |
| src/server/ai/floorplan-recognition.ts | integrated | HEAD strict structure/Host/image/cancellation and retry; dev bounded success cache and fallback provider adopted without geometry fabrication. |
| src/server/ai/vision-provider.ts | integrated | HEAD generic compatibility and call override; explicit dev reasoningEffort adopted for configured fallback. |
| src/shared/design-tools.ts | HEAD | HEAD monthly book, ranges, provenance and over-budget; reject dev hardcoded prices and cap rescaling. |
| src/shared/floorplan-geometry.ts | dev | dev adds opt-in no-scale validation and explicitly estimated temporary metrics; defaults remain strict. |
| src/shared/viewer-contract.ts | integrated | HEAD viewer contract with static resource version bump prices-density-2 to invalidate old cache. |
| src/worker.ts | HEAD | Reviewed full file and dev diff: HEAD retains /api/prices GET/POST, query validation, 64KiB limit and server price-book chat injection; dev removes these, so HEAD is intentional. |

## staging前提

本次39个路径已逐项审阅，工作树无源码冲突标记。对这些明确路径执行git add会登记已审阅内容，不会丢弃任一分支提交历史；后续必须正常merge commit保留双亲。若源码再变，应重跑audit-merge.mjs更新证据。
