# LongView · 长投

跨平台长期投资资产管理与配置控制台。它汇总分散在 OKX、基金与现金中的长期资产，用用户自己的目标比例计算“下一笔新增资金怎样分配”。LongView **不交易、不预测价格、不推荐资产**。

## 架构

```
longview/
  apps/web/          React + Vite 响应式 PWA
  apps/api/          Fastify API + SQLite/Drizzle 持久化与同步调度
  packages/core/     Decimal 汇率图、估值和新增资金分配
  packages/providers/ OKX 只读、ECB 汇率、理杏仁基金净值
  packages/shared/   共享类型
  docs/              开源及数据源研究
```

第一版使用 pnpm workspace、TypeScript strict、React、Recharts、Fastify、Drizzle、SQLite、decimal.js 和 Vitest。核心计算与 UI、HTTP 框架解耦。所有数据库时间为 UTC，前端按浏览器本地时区显示。

## 安装与开发

需要 Node.js 22+ 和 pnpm 11+。

```bash
cd longview
cp .env.example .env
pnpm install
pnpm dev
```

前端：`http://127.0.0.1:5173`，API：`http://127.0.0.1:3001`。空白数据库可手工添加资产，也可点击 Demo 载入显著标注的示例数据；Demo 只允许空白资产库启用。无 OKX Key 可启动。

验收命令：

```bash
pnpm lint
pnpm test
pnpm build
```

生产本机运行：`pnpm build && pnpm --filter @longview/api start`，访问 API 的端口（默认 3001）。构建后的 API 可提供静态前端。

## 环境变量

| 变量                                                | 说明                                             |
| --------------------------------------------------- | ------------------------------------------------ |
| `DATABASE_URL`                                      | SQLite 文件路径，默认 `./data/longview.db`       |
| `OKX_API_KEY` / `OKX_API_SECRET` / `OKX_PASSPHRASE` | 仅后端读取；仅使用 Read 权限                     |
| `OKX_REGION`                                        | `GLOBAL`、`EU` 或 `US`；对应官方区域域名         |
| `LIXINGER_TOKEN`                                    | 可选，理杏仁开放平台 Token，用于大陆公募基金 NAV |
| `PORT` / `HOST`                                     | API 监听端口与地址，默认 3001 / 127.0.0.1        |

`.env` 和数据库文件被 Git 忽略。不要把真实凭据提交、粘贴进网页或上传备份。前端只获取连接状态，不获取密钥。

### OKX Read-only API

在 OKX 账户 API 管理中创建新 Key，**只勾选 Read**，建议绑定部署主机 IP。将凭据写入服务器 `.env`，设置账户注册区域对应 `OKX_REGION`。启动同步先调用 `GET /api/v5/account/config` 校验返回的 `perm` **仅为 `read_only`**；如果包含 `trade`/`withdraw` 或权限未知，拒绝余额同步。再读取交易账户 `GET /api/v5/account/balance` 和资金账户 `GET /api/v5/asset/balances`，合并所有非零币种。行情只访问 `GET /api/v5/market/ticker`。代码中没有交易、下单、转账、提现或 WebSocket 写调用。

OKX 两个账户请求只有同时成功才更新余额；失败保留上次值并标记状态。市场报价缺失时保留最后可用价，标记 stale。当前仅汇总现货币种余额；合约、理财、借贷不纳入。区域可用交易对可能不同，缺价格会使总资产估值显示为不完整，而非假装为零。

## 基金净值与现金

基金账户级持仓没有可确认的通用官方开放接口；基金代码、名称、份额由用户手动维护。配置 `LIXINGER_TOKEN` 后，使用[理杏仁有文档的基金净值 API](https://www.lixinger.com/api/open-api/html-doc/cn/fund/net-value) 刷新 NAV，市值 = 份额 × NAV。未配置 Token 时可输入手动 NAV。同步失败保留最后净值与市值并显示过期。没有未授权 Cookie、模拟登录或私有接口。Provider 接口支持主源、备用源和手动模式；备用源目前为手动数据。用户需自行核查理杏仁授权条款及配额。

现金可保存 CNY、USD、USDT 等多币种原始余额。其他资产可按原币种价值手动添加。设置页可删除手动基金、现金及其他资产；资产总览显示原始数量和估值。

## 汇率、估值与显示币种

ECB 的公开 EUR 参考汇率形成法币转换图。USDT/USD 优先使用 OKX `USDT-USD` 现货报价；不可用时优先使用最后可用价格，首次无记录才回退 `1`，并标记估算。汇率无路径时显示估值缺失，不把资产归零。

```
原始持仓 × 原始单价 → 原币价值 → 汇率图 → USD 基准价值 → 显示币种
```

切换 CNY / USDT / USD / EUR / HKD / JPY / GBP / SGD / AUD / CAD 只更改展示层，设置持久化；原始 BTC 数量、基金份额、现金余额不变。金额运算使用 Decimal，界面在最后一步按币种格式化。基金 NAV 通常按交易日更新；ECB 是参考汇率，不是实时可成交价格。

## 目标配置与“本月怎么投”

所有启用资产的目标比例须合计 100%。设现值总和为 `T`，新增资金为 `C`，目标价值为 `(T+C)×目标比例`。仅对正缺口分配：`C×gap_i/ΣpositiveGap`。超配资产本轮为零。最终展示按币种小数位舍入，尾项补足余数，使显示总和精确等于投入金额。结果是数学分配，不是投资建议；用户自行在外部平台操作。

## 同步与历史

应用启动、手动按钮以及后台定时触发同步。设置有 15 分钟、1 小时、6 小时、每天；默认 1 小时。每类数据保留上次可用值及 Provider 状态（idle/syncing/success/stale/error）。自动快照每 UTC 日最多一份；手动快照不限。快照保存当时的 USD 总值、各资产数量/价格/USD 值和 FX，因此历史显示币种按快照时汇率转换。历史图支持 1M、3M、6M、1Y、ALL。长期历史从使用本应用开始积累，不回填过去的虚构持仓。

## PWA、备份与 Docker

前端有 manifest、图标占位、service worker 和移动端安全区适配。首次访问需在线；离线时已缓存界面可打开，但同步/API 不可用。`设置 → 导出 JSON 备份` 导出非秘密数据；目前**仅支持导出，不支持自动导入**。请同时备份 SQLite 数据库；JSON 快照导出目前供审阅与将来迁移使用。

```bash
docker compose up --build
```

访问 `http://localhost:3001`。Compose 把 SQLite 保存在 Docker 卷。公网部署应置于 HTTPS 反向代理和访问认证之后；第一版是**单用户自托管应用，没有登录系统**，不要把 API 端口直接暴露到互联网。

## 数据库

表：`assets`（统一资产）、`fund_positions`、`cash_holdings`、`provider_connections`、`provider_sync_state`、`settings`、`target_allocations`、`fx_rates`、`portfolio_snapshots`、`asset_snapshots`、`fx_snapshots`。金额、份额与汇率作为十进制字符串保存，便于以后迁移 PostgreSQL。当前建表在启动时执行；正式生产迁移系统为下一阶段工作。

## 主要 API

`GET /api/portfolio`、`GET /api/assets`、`POST /api/sync`、`GET /api/providers`、`GET /api/providers/:id/status`、`GET /api/fx`、`GET/PUT /api/settings`、`POST /api/allocation/calculate`、`GET /api/history`、`POST /api/history/snapshot`、基金/现金 CRUD、`PUT /api/targets`、`GET /api/backup`。

## 当前限制与路线图

- 未配置理杏仁 Token 时基金 NAV 只能手动更新；没有基金平台账户自动同步。
- 目前仅支持 OKX 现货币种余额；少见币种如无现货报价会显示估值不完整。
- 价格刷新目前跟随全局同步频率；独立的币价 1–5 分钟 TTL 与基金交易日调度仍待完善。
- 单用户本机部署，无登录、无多账户隔离。外部访问需自行加 HTTPS 和认证。
- JSON 备份导入、正式数据库迁移、嵌套资产组目标、更多官方 Provider 和更完善的服务端访问控制留待后续。优先保持可用的只读保底版。

## 参考与许可证

见 [开源研究记录](docs/open-source-review.md)。Ghostfolio AGPL-3.0 仅用于产品与架构参考；OKX SDK 与 DcaPal 为 MIT，但未复制任何源码，也未直接依赖。LongView 源码目前为独立原创实现；所用 npm 依赖遵循各自许可证。外部数据遵循 OKX、ECB 和理杏仁各自服务条款。
