'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RotateCw, X, Package, Sparkles, Boxes, Truck, Ban } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api, type OrderSummary } from '@/lib/api';
import { isNewStatus } from '@/lib/status';
import { useRowDetails } from '@/lib/useRowDetails';
import OrdersTable from '@/components/OrdersTable';
import OrderDetailModal from '@/components/OrderDetailModal';
import { cx } from '@/lib/utils';

const PAGE_SIZE = 12;
const TABS = [
  { value: '', label: 'All' },
  { value: 'RFR', label: 'New' },
  { value: 'PK', label: 'Packed' },
  { value: 'SH', label: 'Shipped' },
  { value: 'DL', label: 'Delivered' },
  { value: 'IC', label: 'Cancelled' },
];

async function fetchAllPages(params: { startDate?: string; endDate?: string }): Promise<OrderSummary[]> {
  const first = await api.listOrders({ page: 0, ...params });
  if (!first.ok) throw new Error(first.statusMessage || first.error || 'Failed to load');
  let all = first.orders || [];
  const pages = first.pages || 1;
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, pages - 1) }, (_, i) => api.listOrders({ page: i + 1, ...params })),
  );
  rest.forEach((r) => { if (r.ok) all = all.concat(r.orders || []); });
  return all;
}

export default function AllOrdersPage() {
  const [allOrders, setAllOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  // KPI counts come from the authoritative per-status totals (same source as Overview),
  // not from the loaded summary statuses — keeps the two strips consistent.
  const [kpi, setKpi] = useState<{ total: number; byStatus: Record<string, number> } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    api.stats().then((s) => { if (s.ok) setKpi({ total: s.total, byStatus: s.byStatus }); }).catch(() => {});
    try {
      if (from && to) {
        const days = (new Date(to).getTime() - new Date(from).getTime()) / 86400000;
        if (days < 0) { setError('“From” must be before “To”.'); setLoading(false); return; }
        if (days > 7) { setError('Myntra caps date-filtered search to 7 days. Narrow the range, or clear both dates to see all orders.'); setLoading(false); return; }
        setAllOrders(await fetchAllPages({ startDate: from, endDate: to }));
      } else if (from || to) {
        setError('Set both dates, or clear both.'); setLoading(false); return;
      } else {
        setAllOrders(await fetchAllPages({}));
      }
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const by = kpi?.byStatus || {};

  const filtered = useMemo(() => {
    if (!status) return allOrders;
    if (status === 'RFR') return allOrders.filter((o) => isNewStatus(o.orderLines?.[0]?.status));
    return allOrders.filter((o) => (o.orderLines?.[0]?.status || '').toUpperCase() === status);
  }, [allOrders, status]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageOrders = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const details = useRowDetails(pageOrders);

  useEffect(() => { setPage(0); }, [status, filtered.length]);

  return (
    <>
      <div className="mb-5">
        <h1 className="text-[22px] font-bold text-zinc-900 tracking-tight">Orders</h1>
        <p className="text-[13px] text-zinc-500 mt-0.5">Live order management · EXPERIENCES.DIGITAL on Myntra</p>
      </div>

      {/* KPI strip — authoritative per-status counts (matches Overview) */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-5">
        <StatCard icon={Boxes} label="Total Orders" value={kpi?.total ?? 0} tone="indigo" loading={!kpi} />
        <StatCard icon={Sparkles} label="New" value={by.RFR ?? 0} tone="blue" loading={!kpi} />
        <StatCard icon={Package} label="In Progress" value={by.WP ?? 0} tone="amber" loading={!kpi} />
        <StatCard icon={Boxes} label="Packed" value={by.PK ?? 0} tone="violet" loading={!kpi} />
        <StatCard icon={Truck} label="Shipped" value={by.SH ?? 0} tone="emerald" loading={!kpi} />
        <StatCard icon={Ban} label="Cancelled" value={by.IC ?? 0} tone="rose" loading={!kpi} />
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div className="flex items-center gap-1 flex-wrap bg-white border border-black/[0.06] rounded-xl p-1 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          {TABS.map((t) => (
            <button
              key={t.value || 'all'}
              onClick={() => setStatus(t.value)}
              className={cx(
                'px-3 py-1.5 text-[12px] font-semibold rounded-lg transition-all',
                status === t.value
                  ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm'
                  : 'text-zinc-600 hover:bg-zinc-50',
              )}
            >{t.label}</button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="px-3 py-2 text-[12px] bg-white border border-black/[0.08] rounded-xl focus:border-indigo-400 outline-none" />
          <span className="text-[12px] text-zinc-400">→</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="px-3 py-2 text-[12px] bg-white border border-black/[0.08] rounded-xl focus:border-indigo-400 outline-none" />
          <span className="text-[10px] text-zinc-400" title="Myntra limits date-filtered search to a 7-day window. Leave blank for all orders.">ⓘ 7-day max</span>
          {(from || to || status) && (
            <button onClick={() => { setFrom(''); setTo(''); setStatus(''); }}
              className="flex items-center gap-1 px-2.5 py-2 text-[12px] text-zinc-500 hover:text-zinc-800 border border-black/[0.08] rounded-xl bg-white">
              <X size={12} /> Clear
            </button>
          )}
          <button onClick={load}
            className="flex items-center gap-1.5 px-3.5 py-2 text-[12px] font-semibold bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl hover:opacity-90 transition-opacity shadow-sm">
            <RotateCw size={13} /> Refresh
          </button>
        </div>
      </div>

      <div className="rounded-2xl bg-white border border-black/[0.06] overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.04)]">
        {loading && <div className="px-4 py-16 text-center text-sm text-zinc-400">Fetching from Myntra…</div>}
        {!loading && error && <div className="px-4 py-12 text-center text-sm text-rose-600">{error}</div>}
        {!loading && !error && <OrdersTable orders={pageOrders} onSelect={setSelected} details={details} />}
      </div>

      {!loading && !error && filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-3 mt-4">
          <button disabled={page <= 0} onClick={() => setPage((p) => p - 1)}
            className="px-3 py-1.5 text-[12px] bg-white border border-black/[0.08] rounded-lg disabled:opacity-40 hover:bg-zinc-50">← Prev</button>
          <span className="text-[12px] text-zinc-500">Page {page + 1} of {totalPages} · {filtered.length} orders</span>
          <button disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1.5 text-[12px] bg-white border border-black/[0.08] rounded-lg disabled:opacity-40 hover:bg-zinc-50">Next →</button>
        </div>
      )}

      {selected && <OrderDetailModal sellerOrderId={selected} onClose={() => setSelected(null)} onMutated={load} />}
    </>
  );
}

const TONES: Record<string, string> = {
  indigo: 'bg-indigo-50 text-indigo-600',
  blue: 'bg-blue-50 text-blue-600',
  amber: 'bg-amber-50 text-amber-600',
  violet: 'bg-violet-50 text-violet-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  rose: 'bg-rose-50 text-rose-600',
};

function StatCard({ icon: Icon, label, value, tone, loading }: { icon: LucideIcon; label: string; value: number; tone: string; loading: boolean }) {
  return (
    <div className="bg-white border border-black/[0.06] rounded-2xl p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:shadow-[0_6px_20px_rgba(0,0,0,0.06)] transition-shadow">
      <div className="flex items-center gap-2 mb-2">
        <div className={cx('w-7 h-7 rounded-lg flex items-center justify-center', TONES[tone])}>
          <Icon size={15} />
        </div>
        <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-[26px] font-bold text-zinc-900 tabular-nums leading-none">{loading ? '—' : value}</p>
    </div>
  );
}
