# DESIGN.md — 间筑

视觉基线来源：`E:\design-references` 中的 `impeccable`（方法论/质量下限）+ `taste-skill` 的 `minimalist-ui`（风格与约束）+ `ui-ux-pro-max` 的 `design-system`（token 落地）+ `awesome-design-md`（品牌参考，如 Notion/Linear 的暖色调工具界面）。

## 一、视觉方向

**温暖极简 · 编辑感工具界面**（Minimalist，mode = Operate）

- 面向普通装修用户：亲和、克制、信息清晰优先于表达。
- 硬性拒绝：渐变、重阴影（`shadow-md/lg/xl`）、大面积高饱和底色、玻璃拟态、`rounded-full` 大容器、emoji、模板化文案（"Elevate/Seamless/解锁" 等）。

## 二、色彩（Warm Monochrome + 淡彩点缀）

| 语义 | 色值 |
|---|---|
| 画布背景 canvas | `#FAF9F6` |
| 卡片表面 surface | `#FAF9F6` |
| 弱表面 surface-muted | `#F5F4ED` |
| 正文 ink | `#3D3D3A` |
| 强调 ink-strong | `#3D3D3A` |
| 次要 muted | `#5E5D59` |
| 结构边框 line | `#E8E6DC`（恒 `1px solid`） |

强调色统一赤陶色 `#C96442`，单屏只用一种强调色。间距以 8px 为基准（8/16/24/32/48）；窄屏侧栏以覆盖抽屉呈现，中央画布不挤成窄列。标题使用 500 字重衬线体，控件用 Sans、数字用 Mono。

淡彩点缀（仅用于语义标签/徽标）：

| 用途 | 背景 | 前景 |
|---|---|---|
| 绿色（面积/成功/预算合计） | `#EDF3EC` | `#346538` |
| 蓝色（工具卡/计算中） | `#E1F3FE` | `#1F6C9F` |
| 黄色（金额/预算） | `#FBF3DB` | `#956400` |
| 红色（错误/超预算） | `#FDEBEB` | `#9F2F2D` |

## 三、字体

- 正文/UI：`Geist Sans` + 中文字体栈（`PingFang SC` / `Microsoft YaHei`）。
- 数字/金额/代码：`Geist Mono`。
- 禁用：Inter、Roboto、Open Sans。

## 四、几何边界、边框、阴影

- 全站组件与容器统一 `border-radius: 0`，卡片只用线框和分割线切割层级，禁止卡片嵌套。
- 边框恒 `1px solid #EAEAEA`。
- 阴影：默认无；hover 微显 `0 2px 8px rgba(0,0,0,0.04)`，`200ms` 过渡。

## 五、动效（invisible motion）

- 统一时序：按压反馈 `140ms`、视图切换 `240ms`、内容入场 `360ms`、错峰 `55ms`，共用 `cubic-bezier(0.16,1,0.3,1)`。
- 参考 `E:\design-references\inspira-ui` 的 Blur Reveal、Animated List 和 Multi-Step Loader：内容只做一次轻微上移/淡入；错峰由节点顺序驱动；生成步骤只跟随真实 API 状态，不用计时器伪造进度。
- 参考 `E:\design-references\lottie-web`：生成中使用本地 Lottie 户型线稿，完成后使用一次性完成标记；播放器按可见状态暂停，加载失败时显示内置 SVG 静态图。Lottie MIT 许可证随资源保留在 `public/vendor/lottie-web/LICENSE.md`。
- 对话与户型视图保持挂载，进入与返回使用相同的水平路径反向播放；这样保留对话滚动位置、3D iframe 镜头和来源按钮焦点。切换页面时暂停 3D 渲染循环，返回后从原视角继续。
- `prefers-reduced-motion` 下关闭 Lottie 和入场动画，功能与静态状态保持完整；按钮按下时使用 `scale(0.97)`。
- 动效实现：`src/components/studio/plan-activity.tsx`、`inspira-reveal.tsx`、`generation-feedback.tsx`、`studio-views.tsx` 与 `src/lib/studio-motion.ts`。
