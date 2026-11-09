# DESIGN.md — AI 智能装修设计师

视觉基线来源：`E:\design-references` 中的 `impeccable`（方法论/质量下限）+ `taste-skill` 的 `minimalist-ui`（风格与约束）+ `ui-ux-pro-max` 的 `design-system`（token 落地）+ `awesome-design-md`（品牌参考，如 Notion/Linear 的暖色调工具界面）。

## 一、视觉方向

**温暖极简 · 编辑感工具界面**（Minimalist，mode = Operate）

- 面向普通装修用户：亲和、克制、信息清晰优先于表达。
- 硬性拒绝：渐变、重阴影（`shadow-md/lg/xl`）、大面积高饱和底色、玻璃拟态、`rounded-full` 大容器、emoji、模板化文案（"Elevate/Seamless/解锁" 等）。

## 二、色彩（Warm Monochrome + 淡彩点缀）

| 语义 | 色值 |
|---|---|
| 画布背景 canvas | `#F7F6F3` |
| 卡片表面 surface | `#FFFFFF` |
| 弱表面 surface-muted | `#F9F9F8` |
| 正文 ink | `#2F3437`（非纯黑） |
| 强调 ink-strong | `#111111` |
| 次要 muted | `#787774` |
| 结构边框 line | `#EAEAEA`（恒 `1px solid`） |

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

## 四、圆角、边框、阴影

- 卡片：`8px` / `12px`；按钮：`6px`；标签/徽标：`9999px`（pill，允许）。
- 边框恒 `1px solid #EAEAEA`。
- 阴影：默认无；hover 微显 `0 2px 8px rgba(0,0,0,0.04)`，`200ms` 过渡。

## 五、动效（invisible motion）

- 入场 fade-up：`translateY(12px)→0` + `opacity 0→1`，`600ms`，`cubic-bezier(0.16,1,0.3,1)`。
- 错峰 stagger：`--index * 80ms`。
- 仅动画 `transform` / `opacity`；按钮 `:active` 时 `scale(0.98)`。