import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Decimal } from 'decimal.js';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  LayoutDashboard,
  Layers3,
  ChartNoAxesCombined,
  History,
  Settings2,
  RefreshCw,
  ArrowUpRight,
  Wallet,
  CircleHelp,
  Download,
  Plus,
  X,
  Check,
  AlertCircle,
} from 'lucide-react';
import type {
  AssetHolding,
  DisplayCurrency,
  ProviderState,
} from '@longview/shared';
import { DISPLAY_CURRENCIES } from '@longview/shared';

type Page = 'Dashboard' | 'Assets' | 'Allocate' | 'History' | 'Settings';
type ValuedAsset = AssetHolding & {
  nativeValue: string | null;
  valueUSD: string | null;
  displayValue: string | null;
  estimated: boolean;
  stale: boolean;
  valuationError: string | null;
};
type Portfolio = {
  assets: ValuedAsset[];
  totalUSD: string | null;
  totalDisplay: string | null;
  incomplete: boolean;
  currency: string;
  empty: boolean;
};
type Settings = {
  displayCurrency: DisplayCurrency;
  autoSync: boolean;
  syncMinutes: number;
  demoMode: boolean;
  okxConfigured: boolean;
  fundNavConfigured: boolean;
};
type Provider = ProviderState & { connected: boolean; configured: boolean };
type HistoryRow = {
  id: string;
  timestamp: string;
  totalValueUSD: string;
  displayValue: string | null;
  byCategoryUSD: Record<string, string>;
};
type Allocation = {
  contribution: string;
  currency: string;
  totalAllocated: string;
  lines: {
    id: string;
    name: string;
    amount: string;
    currentPercent: string;
    targetPercent: string;
    deviationPercent: string;
    reason: string;
  }[];
};
const colors = [
  '#bbab87',
  '#7da6a5',
  '#8a86ae',
  '#b98d86',
  '#82a17e',
  '#ad9baf',
  '#7793ac',
];
const symbols: Record<string, string> = {
  CNY: '¥',
  USD: '$',
  USDT: '₮',
  EUR: '€',
  HKD: 'HK$',
  JPY: '¥',
  GBP: '£',
  SGD: 'S$',
  AUD: 'A$',
  CAD: 'C$',
};
async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...options?.headers },
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
function Money({
  value,
  currency,
  muted = false,
  stale = false,
  estimated = false,
}: {
  value: string | null | undefined;
  currency: string;
  muted?: boolean;
  stale?: boolean;
  estimated?: boolean;
}) {
  if (value === null || value === undefined)
    return <span className="money unavailable">—</span>;
  const digits = currency === 'JPY' ? 0 : 2;
  const rounded = new Decimal(value).toFixed(digits);
  const negative = rounded.startsWith('-');
  const [whole = '0', fraction] = (negative ? rounded.slice(1) : rounded).split(
    '.',
  );
  const formatted = `${negative ? '-' : ''}${BigInt(whole).toLocaleString('en-US')}${digits ? `.${fraction}` : ''}`;
  return (
    <span
      className={`money ${muted ? 'muted' : ''}`}
      title={stale ? '数据可能已过期' : estimated ? '估算值' : undefined}
    >
      {symbols[currency] || ''}
      {formatted}
      {currency === 'USDT' ? ' USDT' : ''}
      {estimated ? <sup>≈</sup> : null}
      {stale ? <sup>†</sup> : null}
    </span>
  );
}
function Card({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={`card ${className}`}>{children}</section>;
}
function Pill({
  children,
  tone = 'normal',
}: {
  children: ReactNode;
  tone?: 'normal' | 'ok' | 'warn';
}) {
  return <span className={`pill ${tone}`}>{children}</span>;
}
function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <CircleHelp size={30} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function formatDate(date: string | null) {
  return date
    ? new Date(date).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '尚未同步';
}

export default function App() {
  const [page, setPage] = useState<Page>('Dashboard');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<ValuedAsset | null>(null);
  const currency = settings?.displayCurrency || 'CNY';
  const reload = useCallback(
    async (displayCurrency?: string) => {
      try {
        const [s, p, states, h] = await Promise.all([
          api<Settings>('/settings'),
          api<Portfolio>(`/portfolio?currency=${displayCurrency || currency}`),
          api<Provider[]>('/providers'),
          api<HistoryRow[]>(`/history?currency=${displayCurrency || currency}`),
        ]);
        setSettings(s);
        setPortfolio(p);
        setProviders(states);
        setHistory(h);
        setNotice(null);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : '无法连接后端');
      } finally {
        setLoading(false);
      }
    },
    [currency],
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  async function updateSettings(changes: Partial<Settings>) {
    try {
      const s = await api<Settings>('/settings', {
        method: 'PUT',
        body: JSON.stringify(changes),
      });
      setSettings((old) => (old ? { ...old, ...s } : s));
      await reload(s.displayCurrency);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '设置失败');
    }
  }
  async function sync() {
    setSyncing(true);
    try {
      await api('/sync', { method: 'POST' });
      await reload();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '同步失败');
    } finally {
      setSyncing(false);
    }
  }
  const total = portfolio?.totalDisplay;
  const categoryMap = useMemo(() => {
    const map = new Map<string, Decimal>();
    for (const asset of portfolio?.assets ?? [])
      if (asset.displayValue !== null)
        map.set(
          asset.category,
          (map.get(asset.category) ?? new Decimal(0)).plus(asset.displayValue),
        );
    return [...map].map(([name, value], index) => ({
      name,
      value: value.toNumber(),
      exact: value.toString(),
      color: colors[index % colors.length],
    }));
  }, [portfolio]);
  const nav: { id: Page; label: string; icon: ReactNode }[] = [
    { id: 'Dashboard', label: '总览', icon: <LayoutDashboard size={19} /> },
    { id: 'Assets', label: '资产', icon: <Layers3 size={19} /> },
    {
      id: 'Allocate',
      label: '本月怎么投',
      icon: <ChartNoAxesCombined size={19} />,
    },
    { id: 'History', label: '历史', icon: <History size={19} /> },
    { id: 'Settings', label: '设置', icon: <Settings2 size={19} /> },
  ];
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            L<span>V</span>
          </div>
          <div>
            <strong>LongView</strong>
            <small>长期资产视野</small>
          </div>
        </div>
        <nav>
          {nav.map((item) => (
            <button
              key={item.id}
              className={page === item.id ? 'active' : ''}
              onClick={() => setPage(item.id)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="dot" /> READ ONLY · 本地数据
        </div>
      </aside>
      <div className="content">
        <header className="topbar">
          <div className="top-title">
            <span className="eyebrow">LONGVIEW / {page.toUpperCase()}</span>
            <h1>{nav.find((n) => n.id === page)?.label}</h1>
          </div>
          <div className="top-actions">
            {settings?.demoMode && <Pill tone="warn">DEMO</Pill>}
            <label className="currency-select">
              <span>显示币种</span>
              <select
                aria-label="显示币种"
                value={currency}
                onChange={(e) =>
                  void updateSettings({
                    displayCurrency: e.target.value as DisplayCurrency,
                  })
                }
              >
                {DISPLAY_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c} {symbols[c]}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="sync-button"
              onClick={() => void sync()}
              disabled={syncing}
            >
              <RefreshCw size={17} className={syncing ? 'spin' : ''} />
              <span>{syncing ? '同步中' : '立即同步'}</span>
            </button>
          </div>
        </header>
        {notice && (
          <div className="notice">
            <AlertCircle size={17} />
            {notice}
            <button onClick={() => setNotice(null)} aria-label="关闭">
              <X size={16} />
            </button>
          </div>
        )}
        {loading ? (
          <div className="skeleton-grid">
            <div className="skeleton" />
            <div className="skeleton" />
            <div className="skeleton" />
          </div>
        ) : page === 'Dashboard' ? (
          <>
            {portfolio?.empty ? (
              <Card className="onboarding">
                <span className="eyebrow">WELCOME TO LONGVIEW</span>
                <h2>看清长期资产的全貌</h2>
                <p>
                  先添加现金或基金，配置 OKX 只读密钥，再设定你自己的目标比例。
                </p>
                <div className="onboarding-steps">
                  <span>01 设置显示币种</span>
                  <span>02 连接 OKX</span>
                  <span>03 添加基金与现金</span>
                  <span>04 设置目标比例</span>
                </div>
                <div className="actions">
                  <button
                    className="primary"
                    onClick={() => setPage('Settings')}
                  >
                    开始设置 <ArrowUpRight size={16} />
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        await api('/demo', { method: 'POST' });
                        await reload();
                      } catch (error) {
                        setNotice(
                          error instanceof Error
                            ? error.message
                            : '演示数据加载失败',
                        );
                      }
                    }}
                  >
                    体验 Demo
                  </button>
                </div>
              </Card>
            ) : (
              <>
                <Card className="hero">
                  <div>
                    <span className="eyebrow">TOTAL PORTFOLIO · 总资产</span>
                    <div className="hero-value">
                      <Money value={total} currency={currency} />
                    </div>
                    <p className="hero-sub">
                      全部长期资产的当前估值{' '}
                      {portfolio?.incomplete && (
                        <Pill tone="warn">部分价格缺失</Pill>
                      )}
                    </p>
                  </div>
                  <div className="hero-meta">
                    <span>基准估值 · USD</span>
                    <strong>
                      <Money value={portfolio?.totalUSD} currency="USD" />
                    </strong>
                    <small>
                      {providers.some(
                        (p) => p.status === 'stale' || p.status === 'error',
                      )
                        ? '部分数据可能已过期'
                        : '同步状态正常'}
                    </small>
                  </div>
                </Card>
                <div className="dashboard-grid">
                  <Card>
                    <div className="section-head">
                      <div>
                        <span className="eyebrow">COMPOSITION</span>
                        <h2>资产结构</h2>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => setPage('Assets')}
                      >
                        查看全部 <ArrowUpRight size={15} />
                      </button>
                    </div>
                    <div className="composition">
                      <div className="donut">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={categoryMap}
                              dataKey="value"
                              innerRadius="67%"
                              outerRadius="90%"
                              stroke="none"
                              paddingAngle={3}
                            >
                              {categoryMap.map((entry) => (
                                <Cell key={entry.name} fill={entry.color} />
                              ))}
                            </Pie>
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="donut-center">
                          <small>类别数</small>
                          <strong>{categoryMap.length}</strong>
                        </div>
                      </div>
                      <div className="legend">
                        {categoryMap.map((row) => (
                          <div key={row.name}>
                            <span className="legend-name">
                              <i style={{ background: row.color }} />
                              {row.name}
                            </span>
                            <strong>
                              <Money value={row.exact} currency={currency} />
                            </strong>
                          </div>
                        ))}
                      </div>
                    </div>
                  </Card>
                  <Card>
                    <div className="section-head">
                      <div>
                        <span className="eyebrow">ALLOCATION GOAL</span>
                        <h2>当前与目标</h2>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => setPage('Settings')}
                      >
                        编辑目标 <ArrowUpRight size={15} />
                      </button>
                    </div>
                    <div className="allocation-list">
                      {portfolio?.assets
                        .filter((a) => a.valueUSD !== null)
                        .slice(0, 6)
                        .map((a) => {
                          const current =
                            portfolio.totalUSD &&
                            new Decimal(portfolio.totalUSD).gt(0)
                              ? new Decimal(a.valueUSD!)
                                  .div(portfolio.totalUSD)
                                  .mul(100)
                              : new Decimal(0);
                          const target = new Decimal(a.targetAllocation);
                          return (
                            <div className="allocation-row" key={a.id}>
                              <div className="allocation-row-head">
                                <span>{a.name}</span>
                                <span>
                                  {current.toFixed(1)}%{' '}
                                  <small>/ {target.toFixed(1)}%</small>
                                </span>
                              </div>
                              <div className="track">
                                <span
                                  style={{
                                    width: `${Math.min(100, current.toNumber())}%`,
                                  }}
                                />
                                <i
                                  style={{
                                    left: `${Math.min(100, target.toNumber())}%`,
                                  }}
                                />
                              </div>
                              <small className="deviation">
                                偏差 {current.minus(target).gte(0) ? '+' : ''}
                                {current.minus(target).toFixed(1)}%
                              </small>
                            </div>
                          );
                        })}
                    </div>
                  </Card>
                </div>
                <Card className="status-strip">
                  <div>
                    <span className="eyebrow">DATA STATUS</span>
                    <h2>数据连接</h2>
                  </div>
                  <div className="status-items">
                    {providers.map((p) => (
                      <div key={p.id}>
                        <span className={`status-dot ${p.status}`} />
                        <strong>
                          {p.id === 'okx'
                            ? 'OKX'
                            : p.id === 'fund'
                              ? '基金净值'
                              : p.id === 'fx'
                                ? '汇率'
                                : 'USDT/USD'}
                        </strong>
                        <small>
                          {p.status === 'success'
                            ? '正常'
                            : p.status === 'idle'
                              ? '未同步'
                              : '可能过期'}
                        </small>
                      </div>
                    ))}
                  </div>
                </Card>
              </>
            )}
          </>
        ) : page === 'Assets' ? (
          <AssetsPage
            portfolio={portfolio}
            currency={currency}
            onSelect={setSelected}
          />
        ) : page === 'Allocate' ? (
          <AllocatePage portfolio={portfolio} currency={currency} />
        ) : page === 'History' ? (
          <HistoryPage
            history={history}
            currency={currency}
            onRefresh={() => void reload()}
          />
        ) : (
          <SettingsPage
            settings={settings}
            providers={providers}
            assets={portfolio?.assets ?? []}
            onUpdate={updateSettings}
            onRefresh={() => void reload()}
            onNotice={setNotice}
          />
        )}
      </div>
      <div className="mobile-nav">
        {nav.map((item) => (
          <button
            key={item.id}
            className={page === item.id ? 'active' : ''}
            onClick={() => setPage(item.id)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </div>
      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <div className="detail-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelected(null)}>
              <X size={20} />
            </button>
            <span className="eyebrow">ASSET DETAIL</span>
            <h2>{selected.name}</h2>
            <p>
              {selected.symbol} · {selected.provider} · {selected.assetType}
            </p>
            <div className="detail-grid">
              <div>
                <small>持有数量</small>
                <strong>
                  {selected.quantity} {selected.nativeCurrency}
                </strong>
              </div>
              <div>
                <small>当前单价</small>
                <strong>
                  {selected.currentPrice ?? '—'} {selected.priceCurrency}
                </strong>
              </div>
              <div>
                <small>原始价值</small>
                <strong>
                  {selected.nativeValue ?? '—'} {selected.priceCurrency}
                </strong>
              </div>
              <div>
                <small>显示价值</small>
                <strong>
                  <Money
                    value={selected.displayValue}
                    currency={currency}
                    stale={selected.stale}
                    estimated={selected.estimated}
                  />
                </strong>
              </div>
              <div>
                <small>目标比例</small>
                <strong>{selected.targetAllocation}%</strong>
              </div>
              <div>
                <small>最后更新</small>
                <strong>{formatDate(selected.lastUpdatedAt)}</strong>
              </div>
            </div>
            {selected.stale && (
              <p className="warning">数据可能已过期。最近可用价格仍被保留。</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AssetsPage({
  portfolio,
  currency,
  onSelect,
}: {
  portfolio: Portfolio | null;
  currency: string;
  onSelect: (a: ValuedAsset) => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('全部');
  const categories = [
    '全部',
    ...new Set((portfolio?.assets ?? []).map((a) => a.category)),
  ];
  const rows = (portfolio?.assets ?? []).filter(
    (a) =>
      (filter === '全部' || a.category === filter) &&
      `${a.name} ${a.symbol}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <div className="page-intro">
        <span className="eyebrow">YOUR HOLDINGS</span>
        <h2>每一份资产，都在一处。</h2>
        <p>价格与汇率只用于估值；持仓数量始终按原始单位保存。</p>
      </div>
      <Card>
        <div className="filters">
          <input
            placeholder="搜索资产名称或代码"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="chips">
            {categories.map((c) => (
              <button
                key={c}
                className={filter === c ? 'selected' : ''}
                onClick={() => setFilter(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        {rows.length ? (
          <div className="asset-list">
            {rows.map((a, i) => (
              <button
                className="asset-item"
                key={a.id}
                onClick={() => onSelect(a)}
              >
                <span
                  className="asset-icon"
                  style={{ background: colors[i % colors.length] }}
                >
                  {a.symbol.slice(0, 1)}
                </span>
                <span className="asset-name">
                  <strong>{a.name}</strong>
                  <small>
                    {a.quantity} {a.nativeCurrency} · {a.provider}
                    {a.source === 'Demo' ? ' · DEMO' : ''}
                  </small>
                </span>
                <span className="asset-value">
                  <strong>
                    <Money
                      value={a.displayValue}
                      currency={currency}
                      stale={a.stale}
                      estimated={a.estimated}
                    />
                  </strong>
                  <small>
                    {a.stale ? '数据可能已过期' : formatDate(a.lastUpdatedAt)}
                  </small>
                </span>
                <ArrowUpRight size={17} />
              </button>
            ))}
          </div>
        ) : (
          <Empty title="暂无匹配资产">到设置页添加基金、现金或手动资产。</Empty>
        )}
      </Card>
    </>
  );
}

function AllocatePage({
  portfolio,
  currency,
}: {
  portfolio: Portfolio | null;
  currency: string;
}) {
  const [amount, setAmount] = useState('1000');
  const [inputCurrency, setInputCurrency] = useState(currency);
  const [result, setResult] = useState<Allocation | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function calculate(e: FormEvent) {
    e.preventDefault();
    try {
      setResult(
        await api<Allocation>('/allocation/calculate', {
          method: 'POST',
          body: JSON.stringify({
            contribution: amount,
            currency: inputCurrency,
          }),
        }),
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '计算失败');
      setResult(null);
    }
  }
  return (
    <>
      <div className="page-intro">
        <span className="eyebrow">CONTRIBUTION REBALANCING</span>
        <h2>下一笔资金，怎样靠近目标？</h2>
        <p>只分配新增资金，不减少已有持仓。</p>
      </div>
      <div className="allocate-grid">
        <Card>
          <span className="eyebrow">01 / INPUT</span>
          <h2>本月新增资金</h2>
          <form onSubmit={(e) => void calculate(e)}>
            <div className="amount-field">
              <input
                aria-label="新增资金"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <select
                aria-label="投入币种"
                value={inputCurrency}
                onChange={(e) => setInputCurrency(e.target.value)}
              >
                {DISPLAY_CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
            <button
              className="primary wide"
              type="submit"
              disabled={!portfolio?.assets.length}
            >
              计算资金分配 <ArrowUpRight size={17} />
            </button>
          </form>
          <p className="fine-print">
            请先在设置中为所有启用资产设置合计 100% 的目标比例。
          </p>
          {error && <p className="warning">{error}</p>}
        </Card>
        <Card className="result-card">
          <span className="eyebrow">02 / ALLOCATION</span>
          <h2>本轮分配</h2>
          {result ? (
            <>
              <div className="result-total">
                <span>投入金额</span>
                <strong>
                  <Money
                    value={result.totalAllocated}
                    currency={result.currency}
                  />
                </strong>
              </div>
              {result.lines.map((line) => (
                <div className="result-line" key={line.id}>
                  <div>
                    <strong>{line.name}</strong>
                    <small>{line.reason}</small>
                  </div>
                  <b>
                    <Money value={line.amount} currency={result.currency} />
                  </b>
                </div>
              ))}
            </>
          ) : (
            <Empty title="等待计算">输入金额后，按你设定的目标比例计算。</Empty>
          )}
        </Card>
      </div>
      <div className="disclaimer">
        <CircleHelp size={18} />
        这是根据你自己设定的目标资产比例进行的数学分配，不代表对任何资产未来表现的预测或投资建议。你需自行在对应平台执行。
      </div>
    </>
  );
}

function HistoryPage({
  history,
  currency,
  onRefresh,
}: {
  history: HistoryRow[];
  currency: string;
  onRefresh: () => void;
}) {
  const [range, setRange] = useState('ALL');
  const days = (
    { '1M': 31, '3M': 93, '6M': 186, '1Y': 366 } as Record<string, number>
  )[range];
  const data = history
    .filter(
      (h) => !days || Date.parse(h.timestamp) >= Date.now() - days * 86400_000,
    )
    .map((h) => ({
      ...h,
      label: new Date(h.timestamp).toLocaleDateString(),
      value: h.displayValue === null ? null : Number(h.displayValue),
    }));
  async function snapshot() {
    await api('/history/snapshot', { method: 'POST' });
    onRefresh();
  }
  return (
    <>
      <div className="page-intro">
        <span className="eyebrow">PORTFOLIO HISTORY</span>
        <h2>看长期变化，不看短线噪声。</h2>
        <p>历史图表使用快照当时的汇率，不用今天的汇率重算。</p>
      </div>
      <Card>
        <div className="section-head">
          <div>
            <span className="eyebrow">NET WORTH</span>
            <h2>总资产轨迹</h2>
          </div>
          <div className="range-tabs">
            {['1M', '3M', '6M', '1Y', 'ALL'].map((r) => (
              <button
                key={r}
                className={range === r ? 'selected' : ''}
                onClick={() => setRange(r)}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        {data.length ? (
          <div className="chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data}>
                <defs>
                  <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#b9a77b" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#b9a77b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  stroke="#27303c"
                  strokeDasharray="3 6"
                  vertical={false}
                />
                <XAxis dataKey="label" stroke="#83909c" tickLine={false} />
                <YAxis
                  stroke="#83909c"
                  tickLine={false}
                  tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
                />
                <Tooltip
                  formatter={(value) => [`${value} ${currency}`, '总资产']}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#b9a77b"
                  strokeWidth={2}
                  fill="url(#area)"
                  connectNulls={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <Empty title="尚无历史快照">
            同步后每天最多自动保存一份，也可以手动创建。
          </Empty>
        )}
        <div className="card-footer">
          <button onClick={() => void snapshot()}>创建当前快照</button>
          <small>历史估值基准：USD · 展示：{currency}</small>
        </div>
      </Card>
      <Card>
        <div className="section-head">
          <div>
            <span className="eyebrow">ALLOCATION TREND</span>
            <h2>配置变化</h2>
          </div>
        </div>
        {data.length ? (
          <div className="history-list">
            {data
              .slice(-8)
              .reverse()
              .map((h) => (
                <div key={h.id}>
                  <span>{h.label}</span>
                  <strong>
                    <Money value={h.displayValue} currency={currency} />
                  </strong>
                  <small>
                    {Object.entries(h.byCategoryUSD)
                      .map(
                        ([name, value]) =>
                          `${name} ${new Decimal(value).div(h.totalValueUSD).mul(100).toFixed(0)}%`,
                      )
                      .join(' · ')}
                  </small>
                </div>
              ))}
          </div>
        ) : (
          <p className="fine-print">等待首个快照。</p>
        )}
      </Card>
    </>
  );
}

function SettingsPage({
  settings,
  providers,
  assets,
  onUpdate,
  onRefresh,
  onNotice,
}: {
  settings: Settings | null;
  providers: Provider[];
  assets: ValuedAsset[];
  onUpdate: (s: Partial<Settings>) => Promise<void>;
  onRefresh: () => void;
  onNotice: (s: string | null) => void;
}) {
  const [fundCode, setFundCode] = useState('');
  const [fundName, setFundName] = useState('');
  const [shares, setShares] = useState('');
  const [nav, setNav] = useState('');
  const [editingFundId, setEditingFundId] = useState<string | null>(null);
  const [cashCurrency, setCashCurrency] = useState('CNY');
  const [cashAmount, setCashAmount] = useState('');
  const [editingCashId, setEditingCashId] = useState<string | null>(null);
  const [manualName, setManualName] = useState('');
  const [manualCategory, setManualCategory] = useState('其他');
  const [manualValue, setManualValue] = useState('');
  const [manualCurrency, setManualCurrency] = useState('CNY');
  const [targets, setTargetsState] = useState<Record<string, string>>({});
  useEffect(() => {
    setTargetsState(
      Object.fromEntries(assets.map((a) => [a.id, a.targetAllocation])),
    );
  }, [assets]);
  const targetTotal = assets.reduce(
    (sum, a) => sum.plus(targets[a.id] || 0),
    new Decimal(0),
  );
  async function submit(
    path: string,
    body: object,
    clear: () => void,
    method: 'POST' | 'PUT' = 'POST',
  ) {
    try {
      await api(path, { method, body: JSON.stringify(body) });
      clear();
      onRefresh();
      onNotice('已保存');
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '保存失败');
    }
  }
  async function remove(path: string) {
    try {
      await api(path, { method: 'DELETE' });
      onRefresh();
      onNotice('已删除');
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '删除失败');
    }
  }
  async function saveTargets() {
    try {
      await api('/targets', {
        method: 'PUT',
        body: JSON.stringify({
          targets: assets.map((a) => ({
            assetId: a.id,
            percent: targets[a.id] || '0',
          })),
        }),
      });
      onRefresh();
      onNotice('目标比例已保存');
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '目标保存失败');
    }
  }
  return (
    <>
      <div className="page-intro">
        <span className="eyebrow">PREFERENCES & SOURCES</span>
        <h2>让数据按你的方式呈现。</h2>
        <p>密钥只存放在服务器环境变量中，此处只显示连接状态。</p>
      </div>
      <div className="settings-grid">
        <Card>
          <span className="eyebrow">PREFERENCES</span>
          <h2>显示与同步</h2>
          <label className="form-row">
            默认显示币种
            <select
              value={settings?.displayCurrency || 'CNY'}
              onChange={(e) =>
                void onUpdate({
                  displayCurrency: e.target.value as DisplayCurrency,
                })
              }
            >
              {DISPLAY_CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="form-row">
            自动同步
            <input
              type="checkbox"
              checked={settings?.autoSync ?? true}
              onChange={(e) => void onUpdate({ autoSync: e.target.checked })}
            />
          </label>
          <label className="form-row">
            同步频率
            <select
              value={settings?.syncMinutes || 60}
              onChange={(e) =>
                void onUpdate({ syncMinutes: Number(e.target.value) })
              }
            >
              {[
                [15, '15 分钟'],
                [60, '1 小时'],
                [360, '6 小时'],
                [1440, '每天'],
              ].map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </Card>
        <Card>
          <span className="eyebrow">CONNECTIONS</span>
          <h2>数据连接</h2>
          {providers.map((p) => (
            <div className="provider-row" key={p.id}>
              <div>
                <strong>
                  {p.id === 'okx'
                    ? 'OKX 只读资产'
                    : p.id === 'fund'
                      ? '基金净值 · 理杏仁'
                      : p.id === 'fx'
                        ? '法币汇率 · ECB'
                        : 'USDT/USD · OKX'}
                </strong>
                <small>上次成功：{formatDate(p.lastSuccessfulSync)}</small>
              </div>
              <Pill
                tone={
                  p.status === 'success'
                    ? 'ok'
                    : p.status === 'idle'
                      ? 'normal'
                      : 'warn'
                }
              >
                {p.status === 'success'
                  ? '正常'
                  : p.status === 'idle'
                    ? '待同步'
                    : p.status === 'syncing'
                      ? '同步中'
                      : '可能过期'}
              </Pill>
            </div>
          ))}
          <p className="fine-print">
            OKX：{settings?.okxConfigured ? '环境变量已配置' : '未配置'}。基金
            NAV：{settings?.fundNavConfigured ? 'Token 已配置' : '手动模式'}。
          </p>
        </Card>
      </div>
      <Card>
        <div className="section-head">
          <div>
            <span className="eyebrow">TARGET ALLOCATION</span>
            <h2>长期目标比例</h2>
          </div>
          <Pill tone={targetTotal.eq(100) ? 'ok' : 'warn'}>
            {targetTotal.toString()}% / 100%
          </Pill>
        </div>
        {assets.length ? (
          <>
            <div className="target-grid">
              {assets.map((a) => (
                <label key={a.id}>
                  <span>{a.name}</span>
                  <div>
                    <input
                      inputMode="decimal"
                      value={targets[a.id] ?? '0'}
                      onChange={(e) =>
                        setTargetsState((old) => ({
                          ...old,
                          [a.id]: e.target.value,
                        }))
                      }
                    />
                    <small>%</small>
                  </div>
                </label>
              ))}
            </div>
            <div className="card-footer">
              <span>
                {targetTotal.eq(100)
                  ? '配置完整'
                  : targetTotal.lt(100)
                    ? `还差 ${new Decimal(100).minus(targetTotal).toString()}%`
                    : `超出 ${targetTotal.minus(100).toString()}%`}
              </span>
              <button
                className="primary"
                disabled={!targetTotal.eq(100)}
                onClick={() => void saveTargets()}
              >
                保存目标 <Check size={16} />
              </button>
            </div>
          </>
        ) : (
          <Empty title="先添加资产">资产加入后即可分配目标比例。</Empty>
        )}
      </Card>
      <div className="settings-grid">
        <Card>
          <span className="eyebrow">FUND POSITION</span>
          <h2>{editingFundId ? '修改基金' : '添加基金'}</h2>
          <form
            className="stack-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submit(
                editingFundId ? `/funds/${editingFundId}` : '/funds',
                { fundCode, fundName, shares, latestNav: nav || null },
                () => {
                  setFundCode('');
                  setFundName('');
                  setShares('');
                  setNav('');
                  setEditingFundId(null);
                },
                editingFundId ? 'PUT' : 'POST',
              );
            }}
          >
            <input
              placeholder="6 位基金代码"
              value={fundCode}
              onChange={(e) => setFundCode(e.target.value)}
              disabled={!!editingFundId}
              required
            />
            <input
              placeholder="基金名称"
              value={fundName}
              onChange={(e) => setFundName(e.target.value)}
              required
            />
            <input
              placeholder="持有份额"
              inputMode="decimal"
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              required
            />
            <input
              placeholder="单位净值（可选，手动兜底）"
              inputMode="decimal"
              value={nav}
              onChange={(e) => setNav(e.target.value)}
            />
            <button type="submit">
              <Plus size={16} /> {editingFundId ? '保存基金' : '添加基金'}
            </button>
            {editingFundId && (
              <button
                type="button"
                onClick={() => {
                  setEditingFundId(null);
                  setFundCode('');
                  setFundName('');
                  setShares('');
                  setNav('');
                }}
              >
                取消编辑
              </button>
            )}
          </form>
          <p className="fine-print">
            份额手动维护。配置理杏仁 Token 后自动刷新净值；失败时保留上次净值。
          </p>
          {assets
            .filter((a) => a.assetType === 'FUND')
            .map((a) => (
              <div className="edit-row" key={a.id}>
                <span>{a.name}</span>
                <button
                  onClick={() => {
                    setEditingFundId(a.id.slice(5));
                    setFundCode(a.symbol);
                    setFundName(a.name);
                    setShares(a.quantity);
                    setNav(a.currentPrice ?? '');
                  }}
                >
                  编辑份额
                </button>
                <button onClick={() => void remove(`/funds/${a.id.slice(5)}`)}>
                  删除
                </button>
              </div>
            ))}
        </Card>
        <Card>
          <span className="eyebrow">CASH HOLDING</span>
          <h2>{editingCashId ? '修改现金' : '添加现金'}</h2>
          <form
            className="stack-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submit(
                editingCashId ? `/cash/${editingCashId}` : '/cash',
                { currency: cashCurrency, amount: cashAmount },
                () => {
                  setCashAmount('');
                  setEditingCashId(null);
                },
                editingCashId ? 'PUT' : 'POST',
              );
            }}
          >
            <select
              value={cashCurrency}
              onChange={(e) => setCashCurrency(e.target.value)}
            >
              {DISPLAY_CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <input
              placeholder="余额"
              inputMode="decimal"
              value={cashAmount}
              onChange={(e) => setCashAmount(e.target.value)}
              required
            />
            <button type="submit">
              <Plus size={16} /> {editingCashId ? '保存现金' : '添加现金'}
            </button>
            {editingCashId && (
              <button
                type="button"
                onClick={() => {
                  setEditingCashId(null);
                  setCashAmount('');
                }}
              >
                取消编辑
              </button>
            )}
          </form>
          {assets
            .filter((a) => a.assetType === 'CASH' && a.source === 'Manual')
            .map((a) => (
              <div className="edit-row" key={a.id}>
                <span>{a.name}</span>
                <button
                  onClick={() => {
                    setEditingCashId(a.id.slice(5));
                    setCashCurrency(a.nativeCurrency);
                    setCashAmount(a.quantity);
                  }}
                >
                  编辑余额
                </button>
                <button onClick={() => void remove(`/cash/${a.id.slice(5)}`)}>
                  删除
                </button>
              </div>
            ))}
        </Card>
      </div>
      <div className="settings-grid">
        <Card>
          <span className="eyebrow">OTHER ASSETS</span>
          <h2>手动资产</h2>
          <form
            className="stack-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submit(
                '/manual-assets',
                {
                  name: manualName,
                  category: manualCategory,
                  value: manualValue,
                  currency: manualCurrency,
                },
                () => {
                  setManualName('');
                  setManualValue('');
                },
              );
            }}
          >
            <input
              placeholder="名称，如黄金"
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
              required
            />
            <input
              placeholder="类别"
              value={manualCategory}
              onChange={(e) => setManualCategory(e.target.value)}
              required
            />
            <input
              placeholder="原始价值"
              inputMode="decimal"
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value)}
              required
            />
            <select
              value={manualCurrency}
              onChange={(e) => setManualCurrency(e.target.value)}
            >
              {DISPLAY_CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <button type="submit">
              <Plus size={16} /> 添加资产
            </button>
          </form>
          {assets
            .filter((a) => a.id.startsWith('manual:'))
            .map((a) => (
              <div className="edit-row" key={a.id}>
                <span>{a.name}</span>
                <button
                  onClick={() => void remove(`/manual-assets/${a.id.slice(7)}`)}
                >
                  删除
                </button>
              </div>
            ))}
        </Card>
        <Card>
          <span className="eyebrow">YOUR DATA</span>
          <h2>备份与安全</h2>
          <p className="fine-print">
            备份包含设置、手动资产、基金持仓、目标比例与历史快照，不包含 OKX
            密钥或基金 Token。
          </p>
          <a className="download" href="/api/backup" download>
            <Download size={17} /> 导出 JSON 备份
          </a>
          <div className="security-note">
            <Wallet size={20} />
            <span>LongView 只读取资产，不下单、不转账、不保管钱包私钥。</span>
          </div>
        </Card>
      </div>
    </>
  );
}
