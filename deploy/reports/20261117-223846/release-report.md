# 间筑价格展示与 dev 合并发布

- 线上地址：http://101.37.71.218/design
- Release：`20261117-223846`
- 已部署源码：`fa0b2968acfc0f2faf3b6d65f7d5916e0f9a28ae`
- Merge 双亲：`18211504c0d4c6f20ced4faeac54ddbb252bc902`、`560877c944e5faa60e6c7f77b4c8a6584f5f11a2`。后者为 dev，包含 `679e950`。
- 回滚 Release：`20261117-204740`。旧构建与切换前计划任务 XML 均存在，见 `server-status.json`。
- 发布包 SHA256：`3A9922B321FB102991E2AE5946B5F3E4193A86EDCFE753F0ABF2FA0BD3995453`。

## 线上原文证据

正式公网 GET `/design` 后下载 HTML 引用的去重 JavaScript chunks，再合并计数；原始文件保存在 `design.html`、`design-chunks.json`。页面业务 chunk 为：

`/_next/static/chunks/107-b45dc678ba638072.js`

| 原文 | 次数 | 结果 |
|---|---:|---|
| 返回对话 | 1 | 通过 |
| 修改需求 | 0 | 通过 |
| English / EN | 0 | 通过 |

正式公网 GET `/floorplan-3d.html` 原文保存在同名文件：

| 原文 | 次数 | 结果 |
|---|---:|---|
| 查看全部 | 1 | 通过 |
| 示例 | 5 | 通过 |
| 项目内置离线基准 | 1 | 通过 |

上述相同断言在服务器候选端口 4181、正式端口 80 也分别通过。公网独立验收共 **49 项通过**，详见 `online-verification.json`。

## 界面验收

- Design 顶栏保留品牌，以及返回对话、当前语言下拉、导出；无箭头、修改需求、上传或校准按钮。
- 上传位于对话中的方案卡操作区。仅在 `floorPlan.calibration` 为空时显示校准校对。
- 空态文案：`尚无户型方案，请先上传户型图或描述需求`。
- 默认展示当前方案使用的材料；展开按钮显示全部 8 项。
- 标准示例首屏完整显示 6 项，行高约 50px，两行布局，默认滚动位置为 0。
- 材料行不重复显示来源长句，仅显示官方/示例角标。
- 关于首屏显示期号、覆盖、机构与来源链接；面积说明和全部单价默认折叠。
- 300px 关于抽屉、390px 手机视口无页面横向溢出。

截图：`design-workbench.png`、`design-about.png`、`about-panel.png`、`materials-first-screen.png`、`about-mobile.png`。

## 价格与溯源

`api-prices.json` 为正式接口完整响应。`meta` 保持：

- `period=2026-10`、`confidence=official`、`sampleCities=1`。
- `materialCount=8`、`officialMaterialCount=1`、`fallbackMaterialCount=7`、`coverage=mixed`。
- `publishedAt=2026-10-23`、`priceBasis=material-only;waste-excluded`。
- 大理石 `low=mid=high=402`，原 sourceUrl、downloadUrl、publishedAt、文件 SHA256 均未变。
- 示例行保留 fallback 来源，未改为官方。

与上一 release 相同的 8 种材料、每种 10㎡ 请求对比：

| 预算 | 发布前 | 发布后 |
|---|---:|---:|
| 低位 | ¥18,816 | ¥18,816 |
| 中位 | ¥22,071 | ¥22,071 |
| 高位 | ¥26,691 | ¥26,691 |

私有 JSON、原始 PDF 路径均返回 404。

## 回归与构建

- `npm run lint`、`npm run typecheck` 通过。
- 本地 ECS 构建、服务器生产 webpack 构建通过。
- Edge 界面/价格/渲染：19/19，通过。
- API/价格/几何/布局：98/98，通过。
- 上传、直达工作台、手工描图、校准、移动端与取消：6/6，通过。
- 合计 **123/123**，分组运行，覆盖当前完整测试集。导入测试单独更新了旧持久化/中间页预期，未为通过测试修改产品逻辑。

初次默认浏览器测试因机器未安装 Playwright Chromium 无法启动；改用已安装的 Edge 后完成以上回归。公网验收首次遇到一次 chunk 连接重置，完整重跑成功。

公网浏览器截图中的生成响应使用固定测试方案，以验证已发布 UI，未调用付费模型；页面、chunks、GET 价格及 POST 估价均来自正式服务器。原始证据与此限制同时记录在 `online-verification.json`。
