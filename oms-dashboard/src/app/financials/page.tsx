'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Landmark, Loader2, Download, Clock, Search, ChevronRight,
  ShoppingBag, CheckCircle2, Coins, Lightbulb, ArrowUpDown, Shield, FileSpreadsheet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api, type FinancialsResponse, type FinOrder, type FinSku } from '@/lib/api';
import { skuImage } from '@/lib/skuImage';
import HoverImage from '@/components/HoverImage';
import InvoiceDetails from '@/components/InvoiceDetails';
import { useNotifications } from '@/components/NotificationProvider';
import { formatINR, cx } from '@/lib/utils';

const MONTHS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
const MONTH_NAMES = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const REPORTS: [string, string, boolean][] = [
  ['Sales_Revenue_Packed_B2C', 'Sales revenue', true], ['PG_Forward_Settled', 'Forward settlement', true],
  ['PG_Reverse_Settled', 'Reverse settlement (returns)', true], ['Non_Order_Deduction_Settled', 'Non-order deductions', true],
  ['Online_Goodwill_Recovery', 'Goodwill recovery', true], ['Failed_to_Supply_Charges', 'Failed-to-supply charges', true],
  ['COD_Goodwill_Recovery', 'COD goodwill recovery', true], ['SPF_Accepted', 'SPF accepted (one-time)', false],
];
type ViewMode = 'all' | 'settled' | 'awaiting';
type MainTab = 'orders' | 'skus' | 'products' | 'returns' | 'settlements' | 'nonorder';
type SortKey = 'date' | 'value' | 'fees' | 'net' | 'status';
const inr = (n: number) => formatINR(n);
const monthLabel = (ms: string) => { const [y, m] = ms.split('-'); return `${MONTH_NAMES[Number(m)]} ${y}`; };
const dateLabel = (dstr?: string | null) => { if (!dstr) return null; const [y, m, d] = dstr.split('-'); return `${d} ${MONTH_NAMES[Number(m)]} ${y}`; };

interface WorkOrder {
  key: string; sku: string; orderId: string; article: string; date: string;
  value: number; fees: number | null; taxes: number | null; net: number;
  status: 'Settled' | 'Awaiting'; packetId?: string; profit?: number | null; raw?: FinOrder;
}

export default function FinancialsPage() {
  const twoBack = new Date(); twoBack.setMonth(twoBack.getMonth() - 2);
  const now = new Date();
  const [year, setYear] = useState(String(twoBack.getFullYear()));
  const [month, setMonth] = useState(String(twoBack.getMonth() + 1).padStart(2, '0'));
  const [data, setData] = useState<FinancialsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [available, setAvailable] = useState<string[]>([]);
  const [awaiting, setAwaiting] = useState<Awaited<ReturnType<typeof api.awaitingSettlement>> | null>(null);
  const [awLoading, setAwLoading] = useState(true);
  const [view, setView] = useState<ViewMode>('all');
  const [mainTab, setMainTab] = useState<MainTab>('orders');
  const [q, setQ] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);
  const [reportName, setReportName] = useState('PG_Forward_Settled');
  const [allMode, setAllMode] = useState(true); // "All months" is the default view
  const { pushToast } = useNotifications();
  const PAGE_SIZE = 25;
  const years = Array.from({ length: now.getFullYear() - 2023 }, (_, i) => String(now.getFullYear() - i));

  const loadMonth = useCallback(async (y: string, m: string) => {
    setLoading(true); setError('');
    try { const r = await api.financials(y, m); if (!r.ok) { setError(r.error || 'Failed to load.'); setData(null); } else setData(r); }
    catch (e: any) { setError(e.message); setData(null); }
    setLoading(false);
  }, []);
  const loadAll = useCallback(async () => {
    setLoading(true); setError('');
    try { const r = await api.financials(String(now.getFullYear()), 'all'); if (!r.ok) { setError(r.error || 'Failed to load.'); setData(null); } else setData(r); }
    catch (e: any) { setError(e.message); setData(null); }
    setLoading(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const load = () => { setAllMode(false); loadMonth(year, month); };
  const jump = (ms: string) => { setAllMode(false); const [y, m] = ms.split('-'); setYear(y); setMonth(m); loadMonth(y, m); };
  const jumpAll = () => { setAllMode(true); loadAll(); };

  useEffect(() => {
    api.financialsMonths().then((r) => { setAvailable(r.months || []); }).catch(() => {});
    loadAll(); // default to the aggregated all-months statement
    api.awaitingSettlement().then((r) => { if (r.ok) setAwaiting(r); }).finally(() => setAwLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const s = data?.summary;
  const d = data?.deductions; const g = data?.gstBreakdown;
  const workOrders: WorkOrder[] = useMemo(() => {
    const settled = (data?.orders || []).map((o, i): WorkOrder => ({ key: 's' + i, sku: o.sellerSku || o.sku, orderId: o.orderId, article: o.article, date: o.deliveredDate, value: o.sellerAmount, fees: o.commission + o.logistics, taxes: o.gst + o.tcs + o.tds, net: o.netSettled, status: 'Settled', packetId: o.packetId, profit: o.cogs ? o.profit : null, raw: o }));
    const wait = (awaiting?.awaiting || []).map((o, i): WorkOrder => ({ key: 'a' + i, sku: o.sku, orderId: o.orderId, article: '', date: o.invoiceDate || '', value: o.value, fees: null, taxes: null, net: o.value, status: 'Awaiting' }));
    return [...settled, ...wait];
  }, [data, awaiting]);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    let out = workOrders.filter((o) => (view === 'all' || (view === 'settled' ? o.status === 'Settled' : o.status === 'Awaiting')) && (!n || o.sku.toLowerCase().includes(n) || o.orderId.includes(n)));
    const dir = sortDir === 'asc' ? 1 : -1;
    out = out.sort((a, b) => sortKey === 'status' ? a.status.localeCompare(b.status) * dir : sortKey === 'date' ? String(a.date || '').localeCompare(String(b.date || '')) * dir : (((a[sortKey] as number) ?? -1) - ((b[sortKey] as number) ?? -1)) * dir);
    return out;
  }, [workOrders, view, q, sortKey, sortDir]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  useEffect(() => { setPage(0); }, [view, q, sortKey, sortDir, mainTab]);

  const awCount = awaiting?.count || 0;
  const awValue = awaiting?.totalValue || 0;
  // Account-wide order pipeline (rolling settlement status, not month-scoped).
  const settledOrders = awaiting?.settledOrders || 0;
  const totalDelivered = settledOrders + awCount;
  const settledPct = totalDelivered ? Math.round((settledOrders / totalDelivered) * 100) : 0;
  const totalOrders = workOrders.length; // rows shown across the orders table (settled + awaiting)
  const taxTotal = s ? s.gst + (d?.tcs || 0) + (d?.tds || 0) : 0;
  const feeBars = data?.feeBreakdown || [];
  const openAwaiting = () => { setMainTab('orders'); setView('awaiting'); };

  function exportCsv() {
    const cols = ['status', 'sku', 'orderId', 'value', 'fees', 'taxes', 'net'];
    const rows = filtered.map((o) => cols.map((c) => `"${String((o as any)[c] ?? '')}"`).join(','));
    const blob = new Blob([[cols.join(','), ...rows].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `myntra_financial_status.csv`; a.click(); URL.revokeObjectURL(a.href);
  }
  const toggleSort = (k: SortKey) => { if (sortKey === k) setSortDir((x) => (x === 'asc' ? 'desc' : 'asc')); else { setSortKey(k); setSortDir('desc'); } };

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center shadow-sm"><Landmark size={20} className="text-white" /></div>
          <div>
            <h1 className="text-[22px] font-bold text-zinc-900 tracking-tight leading-none">Financial Status</h1>
            <p className="text-[13px] text-zinc-500 mt-1.5">Each order&apos;s money — settled vs awaiting, fees, taxes, and net payout</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Period picker — one unified pill */}
          <div className="flex items-center bg-white border border-black/[0.08] rounded-xl h-9 overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
            <select value={month} onChange={(e) => setMonth(e.target.value)} className={SELECT}>{MONTHS.map((m) => <option key={m} value={m}>{MONTH_NAMES[Number(m)]}</option>)}</select>
            <span className="w-px h-4 bg-black/[0.08]" />
            <select value={year} onChange={(e) => setYear(e.target.value)} className={SELECT}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
          </div>
          <button onClick={load} disabled={loading} className={BTN}>{loading ? <Loader2 size={13} className="animate-spin" /> : <Landmark size={13} />} Load</button>

          {/* Secondary — muted ghost actions */}
          <button onClick={exportCsv} title="Download this month as CSV" className={GHOST}><Download size={13} /> Export</button>

          {/* Raw Myntra report generator */}
          <div className="flex items-center bg-white border border-black/[0.08] rounded-xl h-9 overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.03)] ml-0.5">
            <select value={reportName} onChange={(e) => setReportName(e.target.value)} title="Myntra report" className={cx(SELECT, 'max-w-[150px]')}>{REPORTS.map(([n, l]) => <option key={n} value={n}>{l}</option>)}</select>
            <span className="w-px h-4 bg-black/[0.08]" />
            <Link href={`/financials/reports?report=${reportName}&year=${year}&month=${month}`} title="Open the full report" className="flex items-center gap-1.5 px-3 h-full text-[12px] font-semibold text-emerald-700 hover:bg-emerald-50"><FileSpreadsheet size={13} /> Open</Link>
          </div>
        </div>
      </div>

      {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700 mb-5">{error}</div>}

      {/* 1 — Order pipeline: where ALL your orders stand (rolling, account-wide) */}
      <div className="rounded-2xl border border-black/[0.06] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4 mb-4">
        <div className="flex items-center justify-between mb-3.5 flex-wrap gap-1"><p className="text-[10.5px] font-semibold text-zinc-400 uppercase tracking-wider">Order pipeline · all delivered orders</p><span className="text-[11px] text-zinc-400">live status — not tied to a month</span></div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-y-4 sm:divide-x sm:divide-black/[0.06]">
          <PipeMetric icon={ShoppingBag} label="Total orders" value={awLoading ? '…' : totalDelivered.toLocaleString('en-IN')} sub="delivered" tone="indigo" />
          <PipeMetric icon={CheckCircle2} label="Settled" value={awLoading ? '…' : settledOrders.toLocaleString('en-IN')} sub={`${settledPct}% paid out`} tone="emerald" />
          <PipeMetric icon={Clock} label="Awaiting payout" value={awLoading ? '…' : awCount.toLocaleString('en-IN')} sub={awValue > 0 ? `${inr(awValue)} pending` : 'not yet settled'} tone="amber" onClick={openAwaiting} />
          <PipeMetric icon={Shield} label="Settled through" value={awLoading ? '…' : (awaiting?.finalizedThrough ? (dateLabel(awaiting.finalizedThrough) || '—') : 'up to date')} sub={awaiting?.firstUnsettled ? `next awaiting ${dateLabel(awaiting.firstUnsettled)}` : 'all paid'} tone="sky" />
        </div>
      </div>

      {/* 2 — This month's money: the full flow from sales to profit, in one card */}
      {loading ? (
        <Card><Busy label="Loading settlement…" /></Card>
      ) : (s && data?.found?.forward) ? (
        <div className="grid lg:grid-cols-2 gap-4 mb-4 items-stretch">
          <div className="rounded-2xl border border-black/[0.06] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-5 flex flex-col">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <p className="text-[10.5px] font-semibold text-zinc-400 uppercase tracking-wider">{allMode ? 'Settled · all months' : `Settled in ${monthLabel(`${year}-${month}`)}`}</p>
              <div className="flex items-center gap-1 flex-wrap">
                <button onClick={jumpAll} className={cx('px-2 py-0.5 rounded-md text-[11px] font-semibold transition-colors', allMode ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-zinc-500 hover:text-zinc-700')}>All</button>
                {available.map((ms) => <button key={ms} onClick={() => jump(ms)} className={cx('px-2 py-0.5 rounded-md text-[11px] font-semibold transition-colors', !allMode && `${year}-${month}` === ms ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-zinc-500 hover:text-zinc-700')}>{monthLabel(ms)}</button>)}
              </div>
            </div>
            <div className="flex items-baseline gap-2.5 flex-wrap"><span className="text-[30px] font-bold text-emerald-600 tabular-nums leading-none">{inr(s.netForward)}</span><span className="text-[13px] text-zinc-500">net settled · {s.orderCount} orders paid{allMode ? ' · all months' : ''}</span></div>
            <div className="mt-4 font-mono text-[13px] space-y-2">
              <Row label="Gross sales" value={inr(s.sellerValue)} tone="emerald" />
              <Row label="− Myntra fees" value={inr(s.totalDeductions - d!.tcs - d!.tds)} tone="rose" />
              {(d!.tcs + d!.tds) > 0 && <Row label="− TCS / TDS" value={inr(d!.tcs + d!.tds)} tone="amber" />}
              <div className="border-t border-black/[0.1] my-1" />
              <Row label="= Net settled" value={inr(s.netForward)} tone="emerald" bold />
              {s.returns > 0 && <Row label="− Returns" value={inr(s.returns)} tone="amber" />}
              {s.nonOrder !== 0 && <Row label="± Non-order" value={inr(s.nonOrder)} tone="amber" />}
              <div className="border-t border-black/[0.1] my-1" />
              <Row label="= Net receivable" value={inr(s.netReceivable)} tone={s.netReceivable >= 0 ? 'emerald' : 'rose'} bold big={!s.cogsKnown} />
              {s.cogsKnown && <><Row label="− COGS" value={inr(s.cogs)} tone="rose" /><Row label={`= Net profit · ${s.marginPct}% margin`} value={inr(s.grossProfit)} tone={s.grossProfit >= 0 ? 'emerald' : 'rose'} bold big /></>}
            </div>
            {!s.cogsKnown && <p className="mt-auto pt-3 flex items-center gap-1.5 text-[11.5px] text-zinc-400"><Coins size={12} className="text-zinc-300" /> Costs auto-sync from Alya — profit &amp; margin appear once prices land.</p>}
          </div>
          <div className="rounded-2xl border border-black/[0.06] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-5 flex flex-col">
            <p className="text-[10.5px] font-semibold text-zinc-400 uppercase tracking-wider mb-3">Where the money went</p>
            <div className="space-y-2.5 flex-1 flex flex-col justify-center">
              <BreakRow l="Commission" v={inr(d!.commission)} tone="rose" />
              <BreakRow l="Logistics" v={inr(d!.logistics)} tone="rose" />
              <BreakRow l="Platform fees" v={inr(d!.platformFees)} tone="rose" />
              <BreakRow l="Marketing" v={inr(d!.marketing)} tone="rose" />
              <div className="border-t border-black/[0.06] my-1" />
              <BreakRow l="GST (IGST+CGST+SGST)" v={inr(s.gst)} tone="violet" />
              <BreakRow l="TCS" v={inr(d!.tcs)} tone="violet" />
              <BreakRow l="TDS" v={inr(d!.tds)} tone="violet" />
              <div className="border-t border-black/[0.06] my-1" />
              <BreakRow l={`Returns (${s.returnCount})`} v={inr(s.returns)} tone="amber" />
            </div>
          </div>
        </div>
      ) : !error && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 mb-4 text-[13px] text-amber-800">
          <span className="font-semibold">{monthLabel(`${year}-${month}`)} isn&apos;t settled yet.</span> Myntra settles a month a few weeks after it ends.
          {available.length > 0 && <> Settled: {available.map((ms) => <button key={ms} onClick={() => jump(ms)} className="underline font-semibold mx-0.5">{monthLabel(ms)}</button>)}.</>} See <button onClick={openAwaiting} className="underline font-semibold">Awaiting payout</button> for unpaid money.
        </div>
      )}

      {(data?.insights || []).length > 0 && (
        <div className="grid md:grid-cols-3 gap-3 mb-4">
          {(data?.insights || []).map((ins, i) => <Insight key={i} tone={ins.tone} title={ins.title} detail={ins.detail} />)}
        </div>
      )}

      {/* Order workspace */}
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div className="inline-flex rounded-xl bg-zinc-100 p-0.5 flex-wrap">
          {([['orders', `Orders (${totalOrders})`], ['skus', `SKUs (${data?.bySku?.length || 0})`], ['products', 'Products'], ['returns', `Returns (${s?.returnCount || 0})`], ['settlements', `Settlements (${data?.settlements?.length || 0})`], ['nonorder', `Non-order (${data?.nonOrder?.length || 0})`]] as [MainTab, string][]).map(([t, label]) => (
            <button key={t} onClick={() => setMainTab(t)} className={cx('px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all', mainTab === t ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700')}>{label}</button>
          ))}
        </div>
        {mainTab === 'orders' && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex rounded-xl bg-zinc-100 p-0.5">
              {([['all', 'All'], ['settled', 'Settled'], ['awaiting', 'Awaiting']] as [ViewMode, string][]).map(([v, label]) => (
                <button key={v} onClick={() => setView(v)} className={cx('px-2.5 py-1.5 rounded-lg text-[12px] font-semibold transition-all', view === v ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700')}>{label}</button>
              ))}
            </div>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search SKU / order…" className="w-52 pl-8 pr-3 py-2 text-[12px] bg-white border border-black/[0.08] rounded-xl focus:border-indigo-400 outline-none" />
            </div>
          </div>
        )}
      </div>

      <Card>
        <div className="overflow-x-auto">
          {mainTab === 'orders' && (awLoading && view === 'awaiting'
            ? <Busy label="Checking every live order against settlement (first load ~1 min)…" />
            : <OrderWorkspace rows={pageRows} onSort={toggleSort} sortKey={sortKey} sortDir={sortDir} />)}
          {mainTab !== 'orders' && (!s || !data?.found?.forward
            ? <div className="px-4 py-12 text-center text-sm text-zinc-400">No settled data for {monthLabel(`${year}-${month}`)}.</div>
            : <>
              {mainTab === 'skus' && <SkuTable rows={data?.bySku || []} cogsKnown={!!s?.cogsKnown} />}
              {mainTab === 'products' && <ProductsTable rows={data?.byArticle || []} />}
              {mainTab === 'returns' && <ReturnsTable rows={data?.returns || []} />}
              {mainTab === 'settlements' && <SettlementsTable rows={data?.settlements || []} />}
              {mainTab === 'nonorder' && <NonOrderTable rows={data?.nonOrder || []} />}
            </>)}
        </div>
      </Card>

      {mainTab === 'orders' && filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-3 mt-4">
          <button disabled={page <= 0} onClick={() => setPage((p) => p - 1)} className="px-3 py-1.5 text-[12px] bg-white border border-black/[0.08] rounded-lg disabled:opacity-40 hover:bg-zinc-50">← Prev</button>
          <span className="text-[12px] text-zinc-500">Page {page + 1} of {totalPages} · {filtered.length} orders</span>
          <button disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 text-[12px] bg-white border border-black/[0.08] rounded-lg disabled:opacity-40 hover:bg-zinc-50">Next →</button>
        </div>
      )}
    </>
  );
}

// ── Order workspace ──
function OrderWorkspace({ rows, onSort, sortKey, sortDir }: { rows: WorkOrder[]; onSort: (k: SortKey) => void; sortKey: SortKey; sortDir: 'asc' | 'desc' }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [inv, setInv] = useState<Record<string, any>>({});
  async function toggle(o: WorkOrder) {
    setOpen((s) => { const n = new Set(s); n.has(o.key) ? n.delete(o.key) : n.add(o.key); return n; });
    const pid = o.packetId;
    if (pid && inv[pid] === undefined) {
      setInv((c) => ({ ...c, [pid]: 'loading' }));
      try { const r = await api.invoiceDetails(pid); setInv((c) => ({ ...c, [pid]: r.ok ? r.details : { _err: r.message || 'Invoice unavailable' } })); }
      catch { setInv((c) => ({ ...c, [pid]: { _err: 'Failed to load invoice' } })); }
    }
  }
  const SortTh = ({ k, label, cls }: { k: SortKey; label: string; cls?: string }) => (
    <th className={cx('px-4 py-3 cursor-pointer hover:text-zinc-700 select-none', cls)} onClick={() => onSort(k)}><span className="inline-flex items-center gap-1">{label}<ArrowUpDown size={11} className={sortKey === k ? 'text-indigo-500' : 'text-zinc-300'} /></span></th>
  );
  return (
    <table className="w-full text-[14px]">
      <thead className="bg-zinc-50/80 text-[11px] font-semibold text-zinc-500 uppercase tracking-wide">
        <tr>
          <th className="px-4 py-3 text-left">Order · Product</th>
          <SortTh k="date" label="Order date" cls="text-left w-28" />
          <SortTh k="value" label="Value" cls="text-right w-28" />
          <SortTh k="fees" label="Fees" cls="text-right w-24" />
          <th className="px-4 py-3 text-right w-24">Taxes</th>
          <SortTh k="net" label="Net" cls="text-right w-28" />
          <SortTh k="status" label="Status" cls="text-left w-32" />
          <th className="px-4 py-3 w-8" />
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-100">
        {rows.length === 0 && <tr><td colSpan={8} className="px-4 py-14 text-center text-sm text-zinc-400">No orders for this view.</td></tr>}
        {rows.map((o) => {
          const isOpen = open.has(o.key);
          return (
            <FragmentRow key={o.key}>
              <tr onClick={() => toggle(o)} className="group hover:bg-indigo-50/40 cursor-pointer transition-colors">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <HoverImage src={skuImage(o.sku)}>
                      {skuImage(o.sku)
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={skuImage(o.sku) as string} alt="" className="w-9 h-9 rounded-lg object-cover border border-zinc-200 shrink-0 cursor-zoom-in" />
                        : <div className="w-9 h-9 rounded-lg bg-zinc-100 border border-zinc-200 shrink-0" />}
                    </HoverImage>
                    <div className="min-w-0"><div className="font-mono text-[12px] text-zinc-800 truncate">{o.sku || '—'}</div><div className="font-mono text-[11px] text-zinc-400 truncate">{o.article ? o.article + ' · ' : ''}{o.orderId.slice(0, 12)}</div></div>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-[12px] text-zinc-500 tabular-nums">{o.date ? dateLabel(o.date) : '—'}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700">{inr(o.value)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-rose-500">{o.fees == null ? <span className="text-zinc-300">—</span> : `−${inr(o.fees)}`}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-zinc-500">{o.taxes == null ? <span className="text-zinc-300">—</span> : inr(o.taxes)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-zinc-900">{inr(o.net)}</td>
                <td className="px-4 py-2.5"><StatusBadge status={o.status} /></td>
                <td className="px-2 text-zinc-300 group-hover:text-indigo-400"><ChevronRight size={16} className={cx('transition-transform', isOpen && 'rotate-90')} /></td>
              </tr>
              {isOpen && (
                <tr className="bg-zinc-50/40"><td colSpan={8} className="px-4 py-3">
                  {o.status === 'Awaiting' ? (
                    <div className="text-[12.5px] text-zinc-600 flex items-center gap-2"><Clock size={14} className="text-amber-500" /> Delivered &amp; invoiced, awaiting Myntra settlement. Expected payout <span className="font-semibold text-amber-700">{inr(o.value)}</span> — full fee breakdown appears once settled.</div>
                  ) : (
                    <>
                      {o.packetId && inv[o.packetId] === 'loading' && <div className="flex items-center gap-2 text-[12px] text-zinc-400 py-3"><Loader2 size={14} className="animate-spin" /> Loading tax invoice…</div>}
                      {o.packetId && inv[o.packetId] && inv[o.packetId] !== 'loading' && !inv[o.packetId]._err && <InvoiceDetails data={inv[o.packetId]} />}
                      {(!o.packetId || inv[o.packetId]?._err) && o.raw && <SettlementDetail o={o.raw} />}
                    </>
                  )}
                </td></tr>
              )}
            </FragmentRow>
          );
        })}
      </tbody>
    </table>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-2">{children}</p>;
}
function SettlementDetail({ o }: { o: FinOrder }) {
  const inv = (o.invoiceNumber || '').replace(/^\\+|\\+$/g, '') || '—';
  const take = (o.customerPaid || 0) - (o.netSettled || 0); // what Myntra kept vs. what the customer paid
  return (
    <div className="grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.7fr)] gap-3 text-[12.5px]">
      {/* Outcome */}
      <div className="rounded-xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50/70 to-white p-4 flex flex-col">
        <GroupLabel>Settlement</GroupLabel>
        <div className="space-y-1.5">
          <Detail l="Customer paid" v={inr(o.customerPaid)} />
          <Detail l="Seller value" v={inr(o.sellerAmount)} />
        </div>
        <div className="mt-3 pt-3 border-t border-emerald-200/60">
          <p className="text-[10px] font-semibold text-emerald-600/70 uppercase tracking-wider">Net settled</p>
          <p className="text-[23px] font-bold text-emerald-600 tabular-nums leading-tight">{inr(o.netSettled)}</p>
          {take > 0.5 && <p className="text-[11px] text-zinc-400 mt-0.5">Myntra kept {inr(take)} of the {inr(o.customerPaid)} paid</p>}
        </div>
        <div className="mt-auto pt-3 flex items-baseline gap-1.5 text-[11px]">
          <span className="font-semibold text-zinc-400 uppercase tracking-wider">Invoice</span>
          <span className="font-mono text-zinc-600 truncate" title={inv}>{inv}</span>
        </div>
      </div>
      {/* Component breakdown */}
      <div className="rounded-xl border border-black/[0.06] bg-white p-4 grid sm:grid-cols-2 gap-x-8 gap-y-4">
        <div>
          <GroupLabel>Marketplace fees</GroupLabel>
          <div className="space-y-1.5">
            <Detail l="Commission" v={inr(o.commission)} neg />
            <Detail l="Logistics" v={inr(o.logistics)} neg />
            <Detail l="Shipping fee" v={inr(o.shippingFee)} neg />
            <Detail l="Fixed fee" v={inr(o.fixedFee)} neg />
            <Detail l="Pick & pack" v={inr(o.pickPackFee)} neg />
            <Detail l="Payment gateway" v={inr(o.pgFee)} neg />
          </div>
        </div>
        <div className="space-y-4">
          <div>
            <GroupLabel>Taxes withheld</GroupLabel>
            <div className="space-y-1.5">
              <Detail l="TCS" v={inr(o.tcs)} neg />
              <Detail l="TDS" v={inr(o.tds)} neg />
            </div>
          </div>
          <div>
            <GroupLabel>GST on invoice</GroupLabel>
            <div className="space-y-1.5">
              <Detail l="IGST" v={inr(o.igst)} />
              <Detail l="CGST" v={inr(o.cgst)} />
              <Detail l="SGST" v={inr(o.sgst)} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── detail tables ──
function SkuTable({ rows, cogsKnown }: { rows: FinSku[]; cogsKnown: boolean }) {
  return (
    <table className="w-full text-[14px]">
      <thead className="bg-zinc-50/80 text-[11px] font-semibold text-zinc-500 uppercase tracking-wide">
        <tr><th className="px-4 py-3 text-left">SKU</th><th className="px-4 py-3 text-right w-16">Units</th><th className="px-4 py-3 text-right w-28">Sales</th><th className="px-4 py-3 text-right w-28">Net settled</th>{cogsKnown && <th className="px-4 py-3 text-right w-28">Profit</th>}{cogsKnown && <th className="px-4 py-3 text-right w-20">Margin</th>}<th className="px-4 py-3 text-right w-20">Take</th><th className="px-4 py-3 text-right w-24">Returns</th></tr>
      </thead>
      <tbody className="divide-y divide-zinc-100">
        {rows.length === 0 && <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-zinc-400">No data.</td></tr>}
        {rows.map((a) => (
          <tr key={a.sku} className="hover:bg-indigo-50/40 transition-colors">
            <td className="px-4 py-2.5"><div className="flex items-center gap-2.5"><HoverImage src={skuImage(a.sku)}>{skuImage(a.sku)
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={skuImage(a.sku) as string} alt="" className="w-8 h-8 rounded-md object-cover border border-zinc-200 shrink-0 cursor-zoom-in" /> : <div className="w-8 h-8 rounded-md bg-zinc-100 border border-zinc-200 shrink-0" />}</HoverImage><span className="font-mono text-[12px] text-zinc-800">{a.sku || '—'}</span></div></td>
            <td className="px-4 py-2.5 text-right tabular-nums text-zinc-600">{a.units}</td>
            <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700">{inr(a.sales)}</td>
            <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-zinc-900">{inr(a.netSettled)}</td>
            {cogsKnown && <td className={cx('px-4 py-2.5 text-right tabular-nums font-semibold', a.profit >= 0 ? 'text-emerald-600' : 'text-rose-600')}>{a.cogs ? inr(a.profit) : <span className="text-zinc-300">—</span>}</td>}
            {cogsKnown && <td className="px-4 py-2.5 text-right tabular-nums text-zinc-500">{a.cogs ? `${a.margin}%` : '—'}</td>}
            <td className="px-4 py-2.5 text-right tabular-nums text-zinc-400">{a.takeRate}%</td>
            <td className="px-4 py-2.5 text-right tabular-nums">{a.returnUnits ? <span className="text-amber-600">{a.returnUnits} · {inr(a.returns)}</span> : <span className="text-zinc-300">—</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function ProductsTable({ rows }: { rows: { article: string; units: number; sales: number; netSettled: number; deductions: number; takeRate: number }[] }) {
  return (
    <table className="w-full text-[14px]">
      <thead className="bg-zinc-50/80 text-[11px] font-semibold text-zinc-500 uppercase tracking-wide"><tr><th className="px-4 py-3 text-left">Article type</th><th className="px-4 py-3 text-right w-24">Units</th><th className="px-4 py-3 text-right w-32">Sales</th><th className="px-4 py-3 text-right w-32">Deductions</th><th className="px-4 py-3 text-right w-32">Net settled</th><th className="px-4 py-3 text-right w-24">Take-rate</th></tr></thead>
      <tbody className="divide-y divide-zinc-100">
        {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-zinc-400">No data.</td></tr>}
        {rows.map((a) => (<tr key={a.article} className="hover:bg-indigo-50/40 transition-colors"><td className="px-4 py-3 font-medium text-zinc-800">{a.article}</td><td className="px-4 py-3 text-right tabular-nums text-zinc-600">{a.units}</td><td className="px-4 py-3 text-right tabular-nums text-zinc-700">{inr(a.sales)}</td><td className="px-4 py-3 text-right tabular-nums text-rose-500">−{inr(a.deductions)}</td><td className="px-4 py-3 text-right tabular-nums font-semibold text-zinc-900">{inr(a.netSettled)}</td><td className="px-4 py-3 text-right tabular-nums text-zinc-500">{a.takeRate}%</td></tr>))}
      </tbody>
    </table>
  );
}
function ReturnsTable({ rows }: { rows: { orderId: string; sku: string; sellerSku: string; article: string; returnType: string; returnDate: string; reverseAmount: number }[] }) {
  return (
    <table className="w-full text-[14px]">
      <thead className="bg-zinc-50/80 text-[11px] font-semibold text-zinc-500 uppercase tracking-wide"><tr><th className="px-4 py-3 text-left">Order · SKU</th><th className="px-4 py-3 text-left w-24">Article</th><th className="px-4 py-3 text-left w-32">Return type</th><th className="px-4 py-3 text-left w-28">Date</th><th className="px-4 py-3 text-right w-32">Reverse ₹</th></tr></thead>
      <tbody className="divide-y divide-zinc-100">
        {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-12 text-center text-sm text-zinc-400">No returns this month.</td></tr>}
        {rows.map((r, i) => (<tr key={r.orderId + i} className="hover:bg-indigo-50/40 transition-colors"><td className="px-4 py-2.5"><div className="flex items-center gap-2.5"><HoverImage src={skuImage(r.sellerSku || r.sku)}>{skuImage(r.sellerSku || r.sku)
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={skuImage(r.sellerSku || r.sku) as string} alt="" className="w-8 h-8 rounded-md object-cover border border-zinc-200 shrink-0 cursor-zoom-in" /> : <div className="w-8 h-8 rounded-md bg-zinc-100 border border-zinc-200 shrink-0" />}</HoverImage><div><div className="font-mono text-[12px] text-zinc-800">{r.sellerSku || r.sku || '—'}</div><div className="font-mono text-[11px] text-zinc-400">{r.orderId.slice(0, 12)}</div></div></div></td><td className="px-4 py-2.5 text-zinc-600 text-[13px]">{r.article}</td><td className="px-4 py-2.5 text-zinc-600 text-[13px]">{r.returnType || '—'}</td><td className="px-4 py-2.5 text-zinc-500 tabular-nums">{r.returnDate || '—'}</td><td className="px-4 py-2.5 text-right tabular-nums text-rose-500 font-semibold">{inr(r.reverseAmount)}</td></tr>))}
      </tbody>
    </table>
  );
}
function SettlementsTable({ rows }: { rows: { utr: string; date: string; orders: number; netSettled: number }[] }) {
  return (
    <table className="w-full text-[14px]">
      <thead className="bg-zinc-50/80 text-[11px] font-semibold text-zinc-500 uppercase tracking-wide"><tr><th className="px-4 py-3 text-left w-32">Settled on</th><th className="px-4 py-3 text-left">Bank UTR</th><th className="px-4 py-3 text-right w-24">Orders</th><th className="px-4 py-3 text-right w-32">Net paid</th></tr></thead>
      <tbody className="divide-y divide-zinc-100">
        {rows.length === 0 && <tr><td colSpan={4} className="px-4 py-12 text-center text-sm text-zinc-400">No disbursed settlements yet.</td></tr>}
        {rows.map((r, i) => (<tr key={r.utr + i} className="hover:bg-indigo-50/40 transition-colors"><td className="px-4 py-3 text-zinc-700 tabular-nums">{r.date || '—'}</td><td className="px-4 py-3 font-mono text-[12px] text-zinc-500 truncate max-w-[320px]" title={r.utr}>{r.utr}</td><td className="px-4 py-3 text-right tabular-nums text-zinc-600">{r.orders}</td><td className="px-4 py-3 text-right tabular-nums font-semibold text-emerald-600">{inr(r.netSettled)}</td></tr>))}
      </tbody>
    </table>
  );
}
function NonOrderTable({ rows }: { rows: { type: string; amount: number; description: string; utr: string; date: string }[] }) {
  return (
    <table className="w-full text-[14px]">
      <thead className="bg-zinc-50/80 text-[11px] font-semibold text-zinc-500 uppercase tracking-wide"><tr><th className="px-4 py-3 text-left w-40">Type</th><th className="px-4 py-3 text-left">Description</th><th className="px-4 py-3 text-left w-28">Date</th><th className="px-4 py-3 text-right w-32">Amount</th></tr></thead>
      <tbody className="divide-y divide-zinc-100">
        {rows.length === 0 && <tr><td colSpan={4} className="px-4 py-12 text-center text-sm text-zinc-400">No non-order settlements.</td></tr>}
        {rows.map((n, i) => (<tr key={i} className="hover:bg-indigo-50/40 transition-colors"><td className="px-4 py-2.5 text-zinc-700 text-[13px]">{n.type || '—'}</td><td className="px-4 py-2.5 text-zinc-600 text-[13px] truncate max-w-[420px]" title={n.description}>{n.description || '—'}</td><td className="px-4 py-2.5 text-zinc-500 tabular-nums">{n.date || '—'}</td><td className={cx('px-4 py-2.5 text-right tabular-nums font-semibold', n.amount < 0 ? 'text-rose-500' : 'text-zinc-900')}>{inr(n.amount)}</td></tr>))}
      </tbody>
    </table>
  );
}

// ── native shared ──
const SELECT = 'px-3 h-full text-[12px] font-medium text-zinc-700 bg-transparent outline-none appearance-none cursor-pointer hover:bg-zinc-50 truncate';
const GHOST = 'flex items-center gap-1.5 px-3 h-9 text-[12px] font-semibold text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100/80 rounded-xl transition-colors disabled:opacity-50';
const BTN = 'flex items-center gap-1.5 px-4 h-9 text-[12px] font-semibold bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl hover:opacity-90 shadow-sm disabled:opacity-50';
function FragmentRow({ children }: { children: React.ReactNode }) { return <>{children}</>; }
function Card({ children, className }: { children: React.ReactNode; className?: string }) { return <div className={cx('rounded-2xl bg-white border border-black/[0.06] overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.04)]', className)}>{children}</div>; }
function Busy({ label }: { label: string }) { return <div className="px-4 py-16 text-center text-sm text-zinc-400 flex items-center justify-center gap-2"><Loader2 size={15} className="animate-spin text-indigo-400" /> {label}</div>; }
function StatusBadge({ status }: { status: 'Settled' | 'Awaiting' }) {
  return status === 'Settled'
    ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-emerald-50 text-emerald-700"><CheckCircle2 size={11} /> Settled</span>
    : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-amber-50 text-amber-700"><Clock size={11} /> Awaiting</span>;
}
function Detail({ l, v, neg, strong }: { l: string; v: string; neg?: boolean; strong?: boolean }) { return <div className="flex items-center justify-between"><span className="text-zinc-400">{l}</span><span className={cx('tabular-nums', neg ? 'text-rose-500' : 'text-zinc-700', strong && 'font-bold text-zinc-900')}>{neg && v !== '₹0' ? '−' : ''}{v}</span></div>; }
function Row({ label, value, tone, bold, big }: { label: string; value: string; tone: 'rose' | 'emerald' | 'amber'; bold?: boolean; big?: boolean }) {
  const color = { rose: 'text-rose-500', emerald: 'text-emerald-600', amber: 'text-amber-600' }[tone];
  return <div className="flex items-center justify-between"><span className={cx('text-zinc-500', bold && 'font-semibold text-zinc-700')}>{label}</span><span className={cx('tabular-nums', color, bold && 'font-bold', big && 'text-[17px]')}>{value}</span></div>;
}
function PipeMetric({ icon: Icon, label, value, sub, tone, onClick }: { icon: LucideIcon; label: string; value: string; sub?: string; tone: string; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={cx('flex items-center gap-3 px-4', onClick && 'cursor-pointer group')}>
      <div className={cx('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', TONES[tone] || TONES.indigo)}><Icon size={18} /></div>
      <div className="min-w-0">
        <p className="text-[10.5px] font-semibold text-zinc-400 uppercase tracking-wider">{label}</p>
        <p className="text-[19px] font-bold text-zinc-900 tabular-nums leading-tight">{value}</p>
        {sub && <p className="text-[11px] text-zinc-400 truncate">{sub}</p>}
      </div>
      {onClick && <ChevronRight size={15} className="ml-auto text-zinc-300 group-hover:text-indigo-400 transition-colors shrink-0" />}
    </div>
  );
}
function BreakRow({ l, v, tone }: { l: string; v: string; tone: 'rose' | 'violet' | 'amber' }) {
  const c = { rose: 'text-rose-500', violet: 'text-violet-600', amber: 'text-amber-600' }[tone];
  return <div className="flex items-center justify-between text-[12.5px]"><span className="text-zinc-500">{l}</span><span className={cx('font-medium tabular-nums', c)}>{v}</span></div>;
}
const TONES: Record<string, string> = { indigo: 'bg-indigo-50 text-indigo-600', emerald: 'bg-emerald-50 text-emerald-600', amber: 'bg-amber-50 text-amber-600', violet: 'bg-violet-50 text-violet-600', rose: 'bg-rose-50 text-rose-600', sky: 'bg-sky-50 text-sky-600' };
function Insight({ tone, title, detail }: { tone: 'info' | 'warning' | 'critical'; title: string; detail: string }) {
  const st = { info: 'border-indigo-200 bg-indigo-50 text-indigo-900', warning: 'border-amber-200 bg-amber-50 text-amber-900', critical: 'border-rose-200 bg-rose-50 text-rose-900' }[tone];
  return <div className={cx('rounded-2xl border px-4 py-3', st)}><div className="flex items-center gap-1.5 text-[12.5px] font-semibold"><Lightbulb size={13} /> {title}</div><p className="text-[12px] opacity-80 mt-0.5">{detail}</p></div>;
}
