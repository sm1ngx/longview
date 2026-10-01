# 开源与数据源研究（2026-09-30）

| 项目               | GitHub URL                               | License  | 研究内容                                                   | 实际引用 | 仅参考                     | 不采用                                                                                              |
| ------------------ | ---------------------------------------- | -------- | ---------------------------------------------------------- | -------- | -------------------------- | --------------------------------------------------------------------------------------------------- |
| Ghostfolio         | https://github.com/ghostfolio/ghostfolio | AGPL-3.0 | Dashboard、净资产、配置、历史、多币种、PWA、数据提供者分层 | 无代码   | 信息层级和多资产聚合思路   | 源码、样式、组件、数据库结构                                                                        |
| OKX TypeScript SDK | https://github.com/sieblyio/okx-api      | MIT      | REST、认证、余额、Ticker、错误、限流、类型                 | 无代码   | SDK 封装边界               | 直接依赖：其 REST 客户端同时暴露交易/转账等写操作，与本项目最小权限目标冲突；WebSocket 第一版不需要 |
| DcaPal             | https://github.com/dcapal/dcapal         | MIT      | 定投、目标配置、投入再平衡                                 | 无代码   | 只以新增资金调配的产品思想 | 源码、优化器、账户系统                                                                              |

LongView 原创实现，无上述项目代码复用。未来如复制代码，须另行记录文件、版本、著作权与许可证义务；Ghostfolio 的 AGPL 代码默认不纳入。

## 官方接口及可信度

- [OKX V5 官方文档](https://www.okx.com/docs-v5/en/)：私有 GET 签名；`GET /api/v5/account/config` 返回当前密钥 `perm`；`GET /api/v5/account/balance` 为交易账户余额；`GET /api/v5/asset/balances` 为资金账户余额；`GET /api/v5/market/ticker` 为公开行情。全局、EU、US/AU 域名不同，部署时显式选择。LongView 只实现上述 GET，权限不是纯 `read_only` 即拒绝同步。
- [ECB 汇率参考数据](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html)：公开 EUR 基准 XML，工作日更新；经 EUR 构建交叉汇率，非实时报价。
- [理杏仁基金净值 API](https://www.lixinger.com/api/open-api/html-doc/cn/fund/net-value) 与 [基金信息 API](https://www.lixinger.com/api/open-api/html-doc/cn/fund)：有文档，需用户自行申请 Token 并遵守服务条款。第一版为可选主数据源，无 Token 则使用手动 NAV / last known NAV，不伪称自动更新。
- [上交所 LOF 净值页面](https://www.sse.com.cn/assortment/fund/lof/netvalue/)：仅部分基金，不作为通用基金 API fallback。

未找到覆盖全部大陆公募基金且明确允许程序化访问、无需凭据的官方统一 NAV API。因此基金账户份额保持手动维护；通用净值自动更新依赖用户配置的理杏仁 Token。
