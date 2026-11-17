# 官方月度信息价留档与导入

应用真源位于 `data/prices/`，通过 `/api/prices` 提供；前端仅提交材料 ID、面积与地区，价格计算在服务器完成。`public/` 下没有价格表。

把住建局、建设工程造价信息网或省级标准定额站发布的原始 Excel/CSV/PDF 留在本目录。当前版本仅直接解析 **UTF-8 CSV / JSON**；Excel 请先导出 CSV，并保留原工作簿；PDF 请人工整理后保留原文档。不能把网页目录、登录页或示例链接当作实际价目表来源。

示例命令（把 `<官方原价目表URL>` 换成经核验的实际来源；不要原样运行）：

```text
node scripts/import-price-book.mjs --input data/price-sources/nanjing-2026-11.csv --city nanjing --period 2026-11 --source "实际发布机构名称" --source-url "<官方原价目表URL>" --confidence official --price-basis "material-only;waste-excluded" --dry-run
```

核对 dry-run 输出后删掉 `--dry-run` 正式导入。省级兜底使用 `--confidence provincial`。JSON 可在 `meta` 中明确写入 `confidence`、`priceBasis`、`publishedAt`、`cityName`、`methodology`；命令行可覆盖前两个字段。

CSV 必须包含 `id,name,spec,unit,low,mid,high`，可选 `labor,brandTier,type`。`type=style` 表示已核验的综合风格单价，空白或 `material` 表示材料。单位必须提前转换为元/㎡；单个官方价可将 `low=mid=high`，不编造价格区间。脚本拒绝空值、负数、重复 ID、无效区间、混合单位、同 ID 不同规格、未声明价格口径以及与既有城市数据不一致的口径。

本期材料接口仅接受 **主材、未另计铺装损耗** 的口径（`material-only;waste-excluded`）。不把人工费与材料均价混为综合单价，也不擅自扣除原发布机构已经计入的税费、运杂费或流通损耗。人工费若单列仅留档，不叠加到当前地面主材预算。材料的施工裁切损耗由估算接口另计 5%；源表口径若已包含同类损耗，须先核对转换并在 methodology 说明。

`--dry-run` 全流程校验并显示差异，**不落盘**。正式导入先验证全部城市，再逐文件原子替换；发布失败会恢复旧城市表与全国表。输入文件自动按 SHA-256 短摘要留档。原始 Excel/PDF 仍需人工存档。

全国表由同一期真实已导入城市、同 ID/规格/单位/口径的材料求算术平均；每种材料有自己的有效样本数。候选城市为北京、上海、广州、深圳、成都、杭州、南京、武汉，**候选不等于已导入**。不使用地区乘数，不把 1 城样本写成 8 城。运行时对官方书缺少的既有材料 ID 合并内置离线基准，逐行标记 `confidence=fallback`、来源“项目内置离线基准”与基准版本。官方行保留 `confidence=official`、机构、来源链接与期号，meta 记录官方/离线数量和 `coverage=mixed`。不把离线行写入官方原始 JSON。

`national-2026-11.json` 仍是项目内置离线基准，`confidence=fallback`、`sampleCities=0`；文件名中的年月是基准版本，**不是官方发布期号**。默认接口优先最近一期有效官方书，不会因离线基准版本较新而遮蔽官方书。

## 已核验官方样本：北京 2026-10

- 发布机构：北京市建设工程造价管理总站；主管单位：北京市住房和城乡建设委员会。
- 原始发布页：<https://zjw.beijing.gov.cn/bjjs/gczj14/zjxx/index.shtml>，实测 HTTP 200。该页真实 HTML 标题为“造价信息”；机构全称见官方页页眉/页脚与 PDF 第 2 页署名。本次任务用户已明确接受以官方署名替代“标题含机构名”的核验方式，未改写原始标题。
- 期号：2026-10，官方列表发布日期 2026-10-23；截至 2026-11-17 核验时为该页最新刊。
- 下载 URL：<https://zjw.beijing.gov.cn/bjjs/resource/cms/article/743943530/744147668/2026102316261254725.pdf>，实测 HTTP 200。
- 下载时间：2026-11-17T11:30:13+00:00；PDF 原件 4,175,801 字节。
- SHA256：`4fcf340367cf900038e444e8f6846ff7c6fe71c612f784ed9353413ef360084b`。
- 留档：`beijing-2026-10.pdf`、原始发布页快照 `beijing-2026-10-source.html`、完整核验记录 `beijing-2026-10-provenance.json`、转换表 `beijing-2026-10.csv`。
- 映射：PDF 第 52 页“市场参考价”专栏，原代码 `0801000001` 阿曼米黄大理石，进口大板、厚度 16mm，原单位 m²，含税单价 402.00 元；仅映射到已有 `marble` ID。此单一规格是样本，不代表所有大理石品种的通用价格，不对原表不同石材品种求平均。
- 价格口径：`material-only;waste-excluded`。原表总说明第 6 页已含材料原价、运杂费、运输损耗费和采购保管费；“waste-excluded”只指尚未加现场裁切/铺装损耗，不从原表倒扣运输损耗。没有铺装人工。估算接口另外计 5% 现场裁切/铺装损耗。
- 缺项：未找到能明确匹配 `wood/walnut/tile800/tile600/antislip/terrazzo/carpet` 的同规格室内地面材料，全部留空。金属复合装配式地砖、室外透水砖不能近似普通室内地砖。风格综合造价不属于该官方材料样本；全屋规划预算仍单独标记离线基准。
- 全国表由脚本生成，实际样本数为 1；单项价格 `low=mid=high=402`。用户将发布门槛调整为至少1项官方，缺项允许逐项离线回退。因此线上材料接口返回8项（官方1、离线7），所有既有材料可计算总价；未知ID仍拒绝。原表缺项保持缺项，不插值、不借离线价冒充官方价。
- 已上线 release `20261117-204740`，公网验收北京时间20:57通过；回滚 `20261117-184707`。详见 `beijing-2026-10-release-review.md/json` 与 `deploy/reports/20261117-204740/`。

重现导入（先追加 `--dry-run`，零错误后正式执行）：

```powershell
node scripts/import-price-book.mjs --input data/price-sources/beijing-2026-10.csv --city beijing --period 2026-10 --source "北京市建设工程造价管理总站（主管单位：北京市住房和城乡建设委员会）" --source-url "https://zjw.beijing.gov.cn/bjjs/gczj14/zjxx/index.shtml" --confidence official --price-basis "material-only;waste-excluded" --source-file data/price-sources/beijing-2026-10.pdf --published-at 2026-10-23 --download-url "https://zjw.beijing.gov.cn/bjjs/resource/cms/article/743943530/744147668/2026102316261254725.pdf" --downloaded-at 2026-11-17T11:30:13+00:00 --methodology "北京市建设工程造价管理总站《北京工程造价信息（建设工程）》2026-10 市场参考价专栏；仅导入PDF第52页代码0801000001阿曼米黄大理石（进口大板，厚度16mm）含税402元/㎡。原表总说明注明材料价含原价、运杂费、运输损耗费和采购保管费；本口径仅表示材料单价，不含铺装人工与现场裁切/铺装损耗。其他材料没有同规格明确映射，保持缺项。"
```
