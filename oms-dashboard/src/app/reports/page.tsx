'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  RefreshCw, FileSpreadsheet, Download, TrendingUp, TrendingDown, ShoppingBag, Boxes,
  Coins, Undo2, Ban, Layers, MapPin, CreditCard, AlertTriangle, Loader2, Gauge, Package,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api, type SalesReport, type SkuRow } from '@/lib/api';
import { formatINR, cx } from '@/lib/utils';
import { skuImage } from '@/lib/skuImage';
import HoverImage from '@/components/HoverImage';

const pct = (n: number | null | undefined) => (n == null ? '—' : `${n}%`);
const num = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-IN'));

export default function ReportsPage() {
  const [rep, setRep] = useState<SalesReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (refresh = false) => {
    setLoading(true); setError('');
    try {
      const r = await api.report(refresh);
      if (!r.ok) setError(r.error || 'Failed to build report');
      else setRep(r);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, []);

  useEffect(() => { load(false); }, [load]);

  const exportExcel = async () => {
    if (!rep) return;
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const add = (name: string, rows: any[]) => {
      if (!rows || !rows.length) return;
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name.slice(0, 31));
    };
    const s = rep.summary;
    add('Summary', [
      { Metric: 'Gross Sales (GMV)', Value: s.grossSales },
      { Metric: 'Net Sales', Value: s.netSales },
      { Metric: 'Cancelled Value', Value: s.cancelledValue },
      { Metric: 'Return Value', Value: s.returnValue },
      { Metric: 'Tax Collected', Value: s.taxCollected },
      { Metric: 'Orders', Value: s.ordersCount },
      { Metric: 'Units Sold', Value: s.unitsSold },
      { Metric: 'Average Order Value', Value: s.aov },
      { Metric: 'Items per Order', Value: s.itemsPerOrder },
      { Metric: 'Cancelled Orders', Value: s.cancelledOrders },
      { Metric: 'Cancel Rate %', Value: s.cancelRate },
      { Metric: 'Return Count', Value: s.returnCount },
      { Metric: 'Return Rate %', Value: s.returnRate },
      { Metric: 'Revenue Growth % (MoM)', Value: s.revenueGrowthPct },
      { Metric: 'Stock on Hand', Value: s.totalCurrentStock },
      { Metric: 'Out-of-stock SKUs', Value: s.outOfStockCount },
      { Metric: 'Sell-through Rate %', Value: s.sellThroughRate },
      { Metric: 'Inventory Turnover', Value: s.inventoryTurnover },
    ]);
    add('SKU Performance', rep.bySku);
    add('Categories', rep.byCategory);
    add('Regions', rep.byRegion);
    add('Payments', rep.byPayment);
    add('Status', rep.byStatus);
    add('Revenue by Day', rep.revenueByDay);
    add('Revenue by Week', rep.revenueByWeek);
    add('Revenue by Month', rep.revenueByMonth);
    add('Returns', rep.returns);
    add('Orders', rep.orders);
    XLSX.writeFile(wb, `myntra_sales_report_${(rep.window.to || 'all')}.xlsx`);
  };

  const exportCsv = (rows: any[], name: string) => {
    if (!rows?.length) return;
    const cols = Object.keys(rows[0]);
    const esc = (v: any) => { const x = v == null ? '' : String(v); return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
    const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="flex items-end justify-between flex-wrap gap-3 mb-5">
        <div>
          <h1 className="text-[22px] font-bold text-zinc-900 tracking-tight">Sales Report</h1>
          <p className="text-[13px] text-zinc-500 mt-0.5">
            360° view · EXPERIENCES.DIGITAL on Myntra
            {rep && <> · {rep.window.from && rep.window.to ? `${rep.window.from} → ${rep.window.to}` : 'all orders'} · {rep.summary.ordersCount} orders</>}
            {rep?.cached && <span className="ml-1 text-zinc-400">· cached</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => exportCsv(rep?.bySku || [], 'sku_performance.csv')} disabled={!rep}
            className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold bg-white border border-black/[0.08] text-zinc-700 rounded-xl hover:bg-zinc-50 disabled:opacity-50">
            <Download size={13} /> SKU CSV
          </button>
          <button onClick={exportExcel} disabled={!rep}
            className="flex items-center gap-1.5 px-3.5 py-2 text-[12px] font-semibold bg-gradient-to-r from-emerald-600 to-green-600 text-white rounded-xl hover:opacity-90 disabled:opacity-50 shadow-sm">
            <FileSpreadsheet size={13} /> Export Excel
          </button>
          <button onClick={() => load(true)} disabled={loading}
            className="flex items-center gap-1.5 px-3.5 py-2 text-[12px] font-semibold bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl hover:opacity-90 disabled:opacity-50 shadow-sm">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {error && <div className="mb-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm px-4 py-3">{error}</div>}

      {loading && !rep && (
        <div className="rounded-2xl bg-white border border-black/[0.06] px-4 py-20 text-center text-sm text-zinc-400">
          <Loader2 size={18} className="animate-spin inline mr-2" /> Crunching every order, SKU and stock level…
        </div>
      )}

      {rep && (
        <div className="space-y-6">
          {/* KPI grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
            <Kpi icon={Coins} label="Gross Sales (GMV)" value={formatINR(rep.summary.grossSales)} tone="indigo" />
            <Kpi icon={TrendingUp} label="Net Sales" value={formatINR(rep.summary.netSales)} tone="emerald"
              sub={rep.summary.revenueGrowthPct != null ? `${rep.summary.revenueGrowthPct >= 0 ? '▲' : '▼'} ${Math.abs(rep.summary.revenueGrowthPct)}% MoM` : undefined}
              subTone={rep.summary.revenueGrowthPct != null && rep.summary.revenueGrowthPct < 0 ? 'down' : 'up'} />
            <Kpi icon={ShoppingBag} label="Orders" value={num(rep.summary.ordersCount)} tone="violet" />
            <Kpi icon={Package} label="Units Sold" value={num(rep.summary.unitsSold)} tone="blue" sub={`${rep.summary.itemsPerOrder}/order · ${num(rep.summary.skuCount)} SKUs`} />
            <Kpi icon={Gauge} label="Avg Order Value" value={formatINR(rep.summary.aov)} tone="amber" />
            <Kpi icon={Coins} label="Seller Settlement" value={formatINR(rep.summary.sellerSettlement)} tone="emerald" sub="net of Myntra charges" />
            <Kpi icon={Coins} label="Tax Collected" value={formatINR(rep.summary.taxCollected)} tone="zinc" />
            <Kpi icon={Undo2} label="Returns" value={num(rep.summary.returnCount)} tone="pink" sub={`${pct(rep.summary.returnRate)} · ${formatINR(rep.summary.returnValue)}`} />
            <Kpi icon={Ban} label="Cancellations" value={num(rep.summary.cancelledOrders)} tone="rose" sub={`${pct(rep.summary.cancelRate)} · ${formatINR(rep.summary.cancelledValue)}`} />
            <Kpi icon={Boxes} label="Stock on Hand" value={num(rep.summary.totalCurrentStock)} tone="emerald" sub={rep.summary.outOfStockCount != null ? `${rep.summary.outOfStockCount} out of stock` : 'live stock N/A'} />
            <Kpi icon={Gauge} label="Sell-through" value={pct(rep.summary.sellThroughRate)} tone="indigo" />
            <Kpi icon={Layers} label="Inventory Turnover" value={rep.summary.inventoryTurnover != null ? `${rep.summary.inventoryTurnover}×` : '—'} tone="violet" />
          </div>

          {/* Revenue trend + category split */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title="Revenue by month" icon={TrendingUp}>
              {rep.revenueByMonth.length === 0 ? <Empty /> : (
                <BarList rows={rep.revenueByMonth.map((m) => ({ label: m.key, value: m.revenue, badge: m.growthPct != null ? `${m.growthPct >= 0 ? '+' : ''}${m.growthPct}%` : undefined, badgeDown: (m.growthPct ?? 0) < 0 }))} />
              )}
              {!rep.window.hasDates && <p className="text-[11px] text-amber-600 mt-2">Dates weren’t in the API payload — trend uses best-available timestamps.</p>}
            </Card>
            <Card title="Revenue by category" icon={Layers}>
              {rep.byCategory.length === 0 ? <Empty /> : (
                <BarList rows={rep.byCategory.map((c) => ({ label: c.category, value: c.revenue, badge: `${c.contributionPct}%` }))} />
              )}
            </Card>
          </div>

          {/* Status mix + payment + region */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card title="Order status mix" icon={ShoppingBag}>
              <MiniTable head={['Status', 'Orders', 'Revenue']} rows={rep.byStatus.map((s) => [s.status, num(s.orders), formatINR(s.revenue)])} />
            </Card>
            <Card title="Payment split" icon={CreditCard}>
              <MiniTable head={['Method', 'Orders', 'Revenue']} rows={rep.byPayment.map((p) => [p.method, num(p.orders), formatINR(p.revenue)])} />
            </Card>
            <Card title="Top regions" icon={MapPin}>
              <MiniTable head={['Region', 'Orders', 'Revenue']} rows={rep.byRegion.slice(0, 8).map((r) => [r.region, num(r.orders), formatINR(r.revenue)])} />
            </Card>
          </div>

          {/* Movers */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <Movers title="Top selling" icon={TrendingUp} tone="emerald" rows={rep.topSkus} metric={(s) => formatINR(s.revenue)} />
            <Movers title="Bottom selling" icon={TrendingDown} tone="rose" rows={rep.bottomSkus} metric={(s) => formatINR(s.revenue)} />
            <Movers title="Fast moving" icon={TrendingUp} tone="indigo" rows={rep.fastMoving} metric={(s) => `${s.velocity}/day`} />
            <Movers title="Slow moving" icon={TrendingDown} tone="amber" rows={rep.slowMoving} metric={(s) => `${s.velocity}/day`} />
          </div>

          {/* SKU performance table */}
          <Card title={`SKU performance (${rep.bySku.length})`} icon={Boxes}
            action={<button onClick={() => exportCsv(rep.bySku, 'sku_performance.csv')} className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"><Download size={12} /> CSV</button>}>
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="w-full text-[13px] min-w-[860px]">
                <thead className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide border-b border-black/[0.06]">
                  <tr>
                    {['#', 'SKU', 'Category', 'Units', 'Orders', 'Revenue', 'Contrib%', 'Avg ₹', 'Ret%', 'Stock', 'Days Inv', 'Sell-thru', 'Velocity'].map((h, i) => (
                      <th key={h} className={cx('py-2 px-2 whitespace-nowrap', i >= 3 ? 'text-right' : 'text-left')}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {rep.bySku.map((s) => (
                    <tr key={s.sku} className="hover:bg-indigo-50/40">
                      <td className="py-2 px-2 text-zinc-400 tabular-nums">{s.rank}</td>
                      <td className="py-2 px-2">
                        <div className="flex items-center gap-2">
                          <HoverImage src={skuImage(s.sku)}>
                            {skuImage(s.sku)
                              // eslint-disable-next-line @next/next/no-img-element
                              ? <img src={skuImage(s.sku) as string} alt="" className="w-9 h-9 rounded-lg object-cover border border-zinc-200 shrink-0 cursor-zoom-in" />
                              : <div className="w-9 h-9 rounded-lg bg-zinc-100 shrink-0" />}
                          </HoverImage>
                          <span className="font-semibold text-zinc-800 whitespace-nowrap">{s.sku}</span>
                        </div>
                      </td>
                      <td className="py-2 px-2 text-zinc-500 whitespace-nowrap">{s.category}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{num(s.units)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{num(s.orders)}</td>
                      <td className="py-2 px-2 text-right font-semibold tabular-nums">{formatINR(s.revenue)}</td>
                      <td className="py-2 px-2 text-right tabular-nums text-zinc-500">{s.contributionPct}%</td>
                      <td className="py-2 px-2 text-right tabular-nums">{formatINR(s.avgPrice)}</td>
                      <td className={cx('py-2 px-2 text-right tabular-nums', s.returnRate > 0 ? 'text-rose-600' : 'text-zinc-400')}>{s.returnRate}%</td>
                      <td className={cx('py-2 px-2 text-right tabular-nums', s.currentStock === 0 ? 'text-rose-600 font-semibold' : '')}>{s.currentStock == null ? '—' : num(s.currentStock)}</td>
                      <td className="py-2 px-2 text-right tabular-nums text-zinc-500">{s.daysOfInventory == null ? '—' : s.daysOfInventory}</td>
                      <td className="py-2 px-2 text-right tabular-nums text-zinc-500">{s.sellThrough == null ? '—' : `${s.sellThrough}%`}</td>
                      <td className="py-2 px-2 text-right tabular-nums text-zinc-500">{s.velocity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Category table + inventory health */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title="Category performance" icon={Layers}>
              <MiniTable
                head={['Category', 'SKUs', 'Units', 'Revenue', 'Contrib%', 'Ret%', 'Stock']}
                rows={rep.byCategory.map((c) => [c.category, num(c.skus), num(c.units), formatINR(c.revenue), `${c.contributionPct}%`, `${c.returnRate}%`, num(c.currentStock)])}
              />
            </Card>
            <Card title="Inventory health" icon={AlertTriangle}>
              {rep.outOfStock.length === 0 && rep.bySku.filter((s) => s.daysOfInventory != null && s.daysOfInventory <= 14).length === 0 ? (
                <p className="text-[13px] text-zinc-500 py-4 text-center">No stock-out or low-cover SKUs. 🎉</p>
              ) : (
                <>
                  {rep.outOfStock.length > 0 && (
                    <div className="mb-3">
                      <div className="text-[11px] font-semibold text-rose-600 uppercase tracking-wide mb-1.5">Out of stock ({rep.outOfStock.length})</div>
                      <div className="flex flex-wrap gap-1.5">
                        {rep.outOfStock.map((s) => <span key={s.sku} className="text-[11px] font-medium px-2 py-1 rounded-md bg-rose-50 text-rose-700 border border-rose-200">{s.sku}</span>)}
                      </div>
                    </div>
                  )}
                  <div className="text-[11px] font-semibold text-amber-600 uppercase tracking-wide mb-1.5">Low stock cover (≤ 14 days)</div>
                  <MiniTable
                    head={['SKU', 'Stock', 'Days left', 'Velocity']}
                    rows={rep.bySku.filter((s) => s.daysOfInventory != null && s.daysOfInventory <= 14)
                      .sort((a, b) => (a.daysOfInventory! - b.daysOfInventory!))
                      .map((s) => [s.sku, num(s.currentStock), String(s.daysOfInventory), `${s.velocity}/day`])}
                  />
                </>
              )}
            </Card>
          </div>

          {/* Returns */}
          {rep.returns.length > 0 && (
            <Card title={`Returns (${rep.returns.length})`} icon={Undo2}
              action={<button onClick={() => exportCsv(rep.returns, 'returns.csv')} className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"><Download size={12} /> CSV</button>}>
              <MiniTable
                head={['Return ID', 'SKU', 'Category', 'Value', 'Type', 'Status', 'Reason']}
                rows={rep.returns.map((r) => [r.id, r.sku || '—', r.category || '—', formatINR(r.value), r.type || '—', r.status || '—', r.reason || '—'])}
              />
            </Card>
          )}

          {/* Orders (order-wise) */}
          <Card title={`Orders (${rep.orders.length})`} icon={ShoppingBag}
            action={<button onClick={() => exportCsv(rep.orders, 'orders.csv')} className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"><Download size={12} /> CSV</button>}>
            <div className="max-h-[480px] overflow-auto -mx-4 px-4">
              <table className="w-full text-[13px] min-w-[820px]">
                <thead className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide border-b border-black/[0.06] sticky top-0 bg-white">
                  <tr>
                    {['Date', 'Order', 'Status', 'Region', 'Payment', 'Units', 'Gross', 'Net', 'SKUs'].map((h, i) => (
                      <th key={h} className={cx('py-2 px-2 whitespace-nowrap', i >= 5 && i <= 7 ? 'text-right' : 'text-left')}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {rep.orders.map((o) => (
                    <tr key={o.sellerOrderId} className="hover:bg-indigo-50/40">
                      <td className="py-2 px-2 text-zinc-500 whitespace-nowrap">{o.date ? o.date.slice(0, 10) : '—'}</td>
                      <td className="py-2 px-2 font-mono text-[11px] text-zinc-500 whitespace-nowrap">{o.sellerOrderId.slice(0, 12)}…</td>
                      <td className="py-2 px-2 whitespace-nowrap">{o.status}</td>
                      <td className="py-2 px-2 text-zinc-500 whitespace-nowrap">{o.region}{o.city ? ` · ${o.city}` : ''}</td>
                      <td className="py-2 px-2 text-zinc-500">{o.payment}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{o.units}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{formatINR(o.gross)}</td>
                      <td className="py-2 px-2 text-right font-semibold tabular-nums">{formatINR(o.net)}</td>
                      <td className="py-2 px-2 text-zinc-500 max-w-[200px] truncate" title={o.skus}>{o.skus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {rep.notes.length > 0 && (
            <div className="rounded-2xl bg-zinc-50 border border-black/[0.06] p-4 text-[12px] text-zinc-500 space-y-1">
              {rep.notes.map((n, i) => <div key={i}>· {n}</div>)}
              <div className="text-[11px] text-zinc-400 pt-1">Generated {new Date(rep.generatedAt).toLocaleString()}</div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

const TONES: Record<string, string> = {
  indigo: 'bg-indigo-50 text-indigo-600', violet: 'bg-violet-50 text-violet-600',
  emerald: 'bg-emerald-50 text-emerald-600', amber: 'bg-amber-50 text-amber-600',
  rose: 'bg-rose-50 text-rose-600', pink: 'bg-pink-50 text-pink-600',
  blue: 'bg-blue-50 text-blue-600', zinc: 'bg-zinc-100 text-zinc-600',
};

function Kpi({ icon: Icon, label, value, tone, sub, subTone }: { icon: LucideIcon; label: string; value: string; tone: string; sub?: string; subTone?: 'up' | 'down' }) {
  return (
    <div className="bg-white border border-black/[0.06] rounded-2xl p-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="flex items-center gap-2 mb-2">
        <span className={cx('w-7 h-7 rounded-lg flex items-center justify-center', TONES[tone])}><Icon size={14} /></span>
        <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider leading-tight">{label}</span>
      </div>
      <div className="text-[20px] font-bold text-zinc-900 tabular-nums leading-none">{value}</div>
      {sub && <div className={cx('text-[11px] mt-1 font-medium', subTone === 'down' ? 'text-rose-500' : subTone === 'up' ? 'text-emerald-600' : 'text-zinc-400')}>{sub}</div>}
    </div>
  );
}

function Card({ title, icon: Icon, action, children }: { title: string; icon: LucideIcon; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-black/[0.06] rounded-2xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider"><Icon size={13} className="text-zinc-400" /> {title}</div>
        {action}
      </div>
      {children}
    </div>
  );
}

function Empty() { return <p className="text-[13px] text-zinc-400 py-6 text-center">No data.</p>; }

function BarList({ rows }: { rows: Array<{ label: string; value: number; badge?: string; badgeDown?: boolean }> }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-3">
          <div className="w-24 shrink-0 text-[12px] text-zinc-600 truncate" title={r.label}>{r.label}</div>
          <div className="flex-1 h-6 bg-zinc-100 rounded-md overflow-hidden">
            <div className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-md transition-all" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          </div>
          <div className="w-24 shrink-0 text-right text-[12px] font-semibold text-zinc-800 tabular-nums">{formatINR(r.value)}</div>
          {r.badge && <div className={cx('w-14 shrink-0 text-right text-[11px] font-semibold tabular-nums', r.badgeDown ? 'text-rose-500' : 'text-emerald-600')}>{r.badge}</div>}
        </div>
      ))}
    </div>
  );
}

function MiniTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  if (!rows.length) return <Empty />;
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-[12px]">
        <thead className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide border-b border-black/[0.06]">
          <tr>{head.map((h, i) => <th key={h} className={cx('py-1.5 px-2 whitespace-nowrap', i === 0 ? 'text-left' : 'text-right')}>{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.map((r, ri) => (
            <tr key={ri} className="hover:bg-zinc-50">
              {r.map((c, ci) => <td key={ci} className={cx('py-1.5 px-2 tabular-nums', ci === 0 ? 'text-left font-medium text-zinc-700' : 'text-right text-zinc-600', ci === 0 && 'whitespace-nowrap')}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Movers({ title, icon: Icon, tone, rows, metric }: { title: string; icon: LucideIcon; tone: string; rows: SkuRow[]; metric: (s: SkuRow) => string }) {
  return (
    <div className="bg-white border border-black/[0.06] rounded-2xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-2.5"><Icon size={13} className={TONES[tone].split(' ')[1]} /> {title}</div>
      {rows.length === 0 ? <Empty /> : (
        <div className="space-y-1.5">
          {rows.slice(0, 5).map((s) => (
            <div key={s.sku} className="flex items-center gap-2">
              <HoverImage src={skuImage(s.sku)}>
                {skuImage(s.sku)
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={skuImage(s.sku) as string} alt="" className="w-8 h-8 rounded-md object-cover border border-zinc-200 shrink-0 cursor-zoom-in" />
                  : <div className="w-8 h-8 rounded-md bg-zinc-100 shrink-0" />}
              </HoverImage>
              <span className="flex-1 min-w-0 text-[12px] font-medium text-zinc-700 truncate">{s.sku}</span>
              <span className="text-[12px] font-semibold text-zinc-800 tabular-nums shrink-0">{metric(s)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
