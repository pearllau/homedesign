# 北京2026-10官方样本混合估价发布验收

已按用户调整后的「至少1项官方 + 缺项逐行离线回退」门槛发布。

- 在线：http://101.37.71.218
- Release：`20261117-204740`；回滚：`20261117-184707`（远程 BUILD_ID 确认存在）。
- 公网验收时间：2026-11-17T12:57:20.412Z，即北京时间2026-11-17 20:57，早于21:00。
- 部署包SHA256：`f8c9fd5c28b21b79848eab875fa4acc56aef9c659e0dd4a2b5d970ff5bfa32c1`。
- 15分钟补查未取得可无歧义映射的新官方行，不继续凑数，不使用近似映射。

## 数据与来源

API共8项：1项官方、7项内置离线基准，`coverage=mixed`。meta.confidence=official指已核验官方数据源，不代表8项全部官方；每行另有confidence/source/sourceUrl/period/fallback，counts明确披露覆盖率。

官方marble：阿曼米黄进口大板16mm，含税402元/㎡，low=mid=high；北京2026-10 PDF第52页，代码0801000001。其余wood/walnut/tile800/tile600/antislip/terrazzo/carpet不做近似匹配，使用并标记「项目内置离线基准」。离线行period=2026-11只表示基准版本，非官方发布期号。原始官方JSON仍只有1项，不将离线价写进官方原表。

口径为material-only;waste-excluded；官方原价已含运输损耗，未含铺装人工及现场裁切损耗，后端另计5%现场损耗。全屋风格规划预算仍单独标注离线基准。

## 验收

| 项目 | 实测 |
|---|---|
| /api/prices | 200，2026-10，official，sampleCities=1，materials=8，官方1/离线7 |
| 全部8种既有材料估价 | POST 200，partial=false，missingItems=[]，总价非空 |
| 任意未知材料 | POST 422，拒绝猜价 |
| 默认工作台 | 材料估算 ¥20,787–¥29,691，未收录0项，无页面JS异常 |
| 关于 | 期号、北京1城、1项官方/7项离线基准、完整机构名与来源链接；逐行来源 |
| 测试 | 原26项覆盖在本次31/31通过中；类型检查、Lint通过 |
| 生产构建 | 本地及Windows ECS均通过 |
| 私有资产 | 4条公网JSON/PDF/留档路径均404 |
| 回滚 | 20261117-184707构建保留，正式计划任务指向20261117-204740且Running |

截图：`deploy/reports/20261117-204740/about.png`与`about-panel.png`。完整公网记录：`deploy/reports/20261117-204740/online-verification.json`。

## 同一方案导入前后

固定35㎡、3空间、全部选择marble、5%现场损耗，保持参数不变。用于复算，不代表推荐厨卫铺石材；官方样本仅适用于指定规格。

| | low | mid | high |
|---|---:|---:|---:|
| 上线前内置基准 | ¥19,110 | ¥23,888 | ¥30,135 |
| 上线后官方样本 | ¥14,774 | ¥14,774 | ¥14,774 |

中位减少¥9,114。仅为地面主材费用，不是全屋工程总价。

## dry-run

零错误；材料diff新增0、变更0、删除0、保留1（marble），官方原表仍缺7项。缺项由服务端runtime合并内置基准，不改写官方源表。原命令`changes`总标志为true，但行级diff无变化；该总标志使用对象序列化比较，不能当成材料价变更。未正式重导入原表，也未更改线上价格。

## 线上 /api/prices meta 全文

```json
{
  "city": "national",
  "cityName": "全国平均",
  "period": "2026-10",
  "scope": "national",
  "sampleCities": 1,
  "sampleCityNames": [
    "北京"
  ],
  "source": "北京市建设工程造价管理总站（主管单位：北京市住房和城乡建设委员会）",
  "sourceUrl": "https://zjw.beijing.gov.cn/bjjs/gczj14/zjxx/index.shtml",
  "sources": [
    {
      "city": "beijing",
      "cityName": "北京",
      "source": "北京市建设工程造价管理总站（主管单位：北京市住房和城乡建设委员会）",
      "sourceUrl": "https://zjw.beijing.gov.cn/bjjs/gczj14/zjxx/index.shtml",
      "period": "2026-10",
      "publishedAt": "2026-10-23",
      "downloadUrl": "https://zjw.beijing.gov.cn/bjjs/resource/cms/article/743943530/744147668/2026102316261254725.pdf",
      "downloadedAt": "2026-11-17T11:30:13+00:00",
      "sourceFile": "data/price-sources/beijing-2026-10.pdf",
      "sourceFileSha256": "4fcf340367cf900038e444e8f6846ff7c6fe71c612f784ed9353413ef360084b"
    }
  ],
  "publishedAt": "2026-10-23",
  "fetchedAt": "2026-11-17T11:34:13.650Z",
  "downloadUrl": "https://zjw.beijing.gov.cn/bjjs/resource/cms/article/743943530/744147668/2026102316261254725.pdf",
  "downloadedAt": "2026-11-17T11:30:13+00:00",
  "sourceFile": "data/price-sources/beijing-2026-10.pdf",
  "sourceFileSha256": "4fcf340367cf900038e444e8f6846ff7c6fe71c612f784ed9353413ef360084b",
  "methodology": "全国参考价 = 已收录 1 个城市同规格、同单位、同价格口径材料信息价的算术平均；每项显示实际有效样本数，缺项不补造。 单一样本的适用规格与价格口径：北京市建设工程造价管理总站《北京工程造价信息（建设工程）》2026-10 市场参考价专栏；仅导入PDF第52页代码0801000001阿曼米黄大理石（进口大板，厚度16mm）含税402元/㎡。原表总说明注明材料价含原价、运杂费、运输损耗费和采购保管费；本口径仅表示材料单价，不含铺装人工与现场裁切/铺装损耗。其他材料没有同规格明确映射，保持缺项。",
  "priceBasis": "material-only;waste-excluded",
  "confidence": "official",
  "dataStatus": "official",
  "fallbackReason": "该来源缺少部分材料，缺项按项目内置离线基准补齐。",
  "materialCount": 8,
  "officialMaterialCount": 1,
  "fallbackMaterialCount": 7,
  "coverage": "mixed"
}
```
