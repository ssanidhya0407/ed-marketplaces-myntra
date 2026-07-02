'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  RotateCw, Package, Truck, CheckCircle2, Ban, Undo2, Boxes, Inbox as InboxIcon,
  ArrowRight, AlertTriangle, ShoppingBag, Loader2, Archive,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api, type OrderSummary } from '@/lib/api';
import { useRowDetails } from '@/lib/useRowDetails';
import OrdersTable from '@/components/OrdersTable';
import OrderDetailModal from '@/components/OrderDetailModal';
import { cx, formatINR, sortByNewest } from '@/lib/utils';

interface Stats { total: number; byStatus: Record<string, number>; completed: number; inboxOrders: number; returns: number }
// ₹ value per state, derived from the (cached) sales report's per-status revenue.
interface Values { total: number; WP: number; PK: number; SH: number; DL: number; C: number; IC: number; returns: number }

export default function OverviewPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [values, setValues] = useState<Values | null>(null);
  const [recent, setRecent] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const details = useRowDetails(recent);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [s, list] = await Promise.all([api.stats(), api.listOrders({ page: 0 })]);
      if (!s.ok) { setError(s.error || 'Failed to load stats'); }
      else setStats({ total: s.total, byStatus: s.byStatus, completed: s.completed, inboxOrders: s.inboxOrders, returns: s.returns });
      setRecent(sortByNewest(list.orders || []).slice(0, 8));
      setLastSync(new Date());
    } catch (e: any) { setError(e.message); }
    setLoading(false);

    // Enrich with ₹ per state from the cached sales report — non-blocking, so the
    // counts above never wait on the heavier (but cached) report build.
    api.report().then((r) => {
      if (!r || !r.ok) return;
      const rev: Record<string, number> = {};
      for (const s of r.byStatus || []) rev[s.status] = s.revenue;
      setValues({
        total: (r.byStatus || []).reduce((a, s) => a + (s.revenue || 0), 0),
        WP: rev['In Progress'] || 0,
        PK: rev['Packed'] || 0,
        SH: rev['Shipped'] || 0,
        DL: rev['Delivered'] || 0,
        C: rev['Completed'] || 0,
        IC: r.summary?.cancelledValue ?? rev['Cancelled'] ?? 0,
        returns: r.summary?.returnValue ?? 0,
      });
    }).catch(() => { /* values are best-effort */ });
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  const by = stats?.byStatus || {};
  const actionable = (by.WP || 0) + (by.RFR || 0);

  return (
    <>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-6">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-zinc-900">Overview</h1>
          <p className="text-[13px] text-zinc-500 mt-0.5">{lastSync ? 'Synced ' + lastSync.toLocaleTimeString() : 'Syncing…'}</p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 px-3.5 py-2 text-[12px] font-semibold bg-white border border-black/[0.08] text-zinc-700 rounded-xl hover:bg-zinc-50 transition-colors disabled:opacity-50">
          <RotateCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && <div className="mb-6 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm px-4 py-3">{error}</div>}

      <div className="space-y-6">
        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
          <Kpi href="/orders" icon={ShoppingBag} label="Total orders" value={stats?.total} tone="zinc" loading={loading} sub={values ? formatINR(values.total) : undefined} />
          <Kpi href="/orders?status=WP" icon={Package} label="In progress" value={by.WP} tone="amber" loading={loading} sub={values ? formatINR(values.WP) : undefined} />
          <Kpi href="/orders?status=PK" icon={Boxes} label="Packed" value={by.PK} tone="violet" loading={loading} sub={values ? formatINR(values.PK) : undefined} />
          <Kpi href="/orders?status=SH" icon={Truck} label="Shipped" value={by.SH} tone="emerald" loading={loading} sub={values ? formatINR(values.SH) : undefined} />
          <Kpi href="/orders?status=DL" icon={CheckCircle2} label="Delivered" value={by.DL} tone="green" loading={loading} sub={values ? formatINR(values.DL) : undefined} />
          <Kpi href="/orders?status=C" icon={Archive} label="Completed" value={stats?.completed} tone="emerald" loading={loading} sub={values ? formatINR(values.C) : undefined} />
          <Kpi href="/orders?status=IC" icon={Ban} label="Cancelled" value={by.IC} tone="rose" loading={loading} sub={values ? formatINR(values.IC) : undefined} />
          <Kpi href="/returns" icon={Undo2} label="Returns" value={stats?.returns} tone="pink" loading={loading} sub={values ? formatINR(values.returns) : undefined} />
        </div>

        {/* Action needed */}
        {actionable > 0 && (
          <Link href="/inbox" className="block group">
            <div className="rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-4 flex items-center justify-between gap-3 hover:shadow-sm transition-shadow">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center"><AlertTriangle size={18} className="text-amber-600" /></div>
                <div>
                  <div className="text-[14px] font-semibold text-zinc-900">{actionable} order{actionable !== 1 ? 's' : ''} need your attention</div>
                  <div className="text-[12px] text-zinc-600">{by.WP || 0} ready to dispatch · {by.RFR || 0} awaiting Myntra release</div>
                </div>
              </div>
              <span className="flex items-center gap-1 text-[12px] font-semibold text-amber-700 group-hover:gap-2 transition-all">Open New Orders <ArrowRight size={14} /></span>
            </div>
          </Link>
        )}

        {/* Quick links */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          <Tile href="/inbox" icon={InboxIcon} title="Inbox" desc={`${stats?.inboxOrders ?? 0} pushed by Myntra`} />
          <Tile href="/returns" icon={Undo2} title="Returns" desc={`${stats?.returns ?? 0} to handle`} />
          <Tile href="/inventory" icon={Boxes} title="Update inventory" desc="Push stock to Myntra" />
        </div>

        {/* Recent orders */}
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Recent orders</h3>
            <Link href="/orders" className="text-[12px] font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1">View all <ArrowRight size={13} /></Link>
          </div>
          <div className="rounded-2xl bg-white border border-black/[0.06] overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.04)]">
            {loading && recent.length === 0
              ? <div className="px-4 py-12 text-center text-sm text-zinc-400"><Loader2 size={16} className="animate-spin inline mr-2" /> Loading…</div>
              : recent.length === 0
                ? <div className="px-4 py-12 text-center text-sm text-zinc-400">No orders yet.</div>
                : <OrdersTable orders={recent} onSelect={setSelected} details={details} />}
          </div>
        </div>
      </div>

      {selected && <OrderDetailModal sellerOrderId={selected} onClose={() => setSelected(null)} onMutated={load} />}
    </>
  );
}

const TONES: Record<string, string> = {
  zinc: 'text-zinc-700 bg-zinc-100',
  blue: 'text-blue-700 bg-blue-100',
  amber: 'text-amber-700 bg-amber-100',
  violet: 'text-violet-700 bg-violet-100',
  emerald: 'text-emerald-700 bg-emerald-100',
  green: 'text-green-700 bg-green-100',
  rose: 'text-rose-700 bg-rose-100',
  pink: 'text-pink-700 bg-pink-100',
};

function Kpi({ href, icon: Icon, label, value, tone, loading, sub }: { href: string; icon: LucideIcon; label: string; value: number | undefined; tone: string; loading: boolean; sub?: string }) {
  return (
    <Link href={href} className="rounded-2xl bg-white border border-black/[0.06] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)] hover:border-black/[0.1] transition-all">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">{label}</span>
        <span className={cx('w-7 h-7 rounded-lg flex items-center justify-center', TONES[tone])}><Icon size={14} /></span>
      </div>
      <div className="text-[26px] font-bold text-zinc-900 tabular-nums leading-none">{value == null ? (loading ? '—' : 0) : value}</div>
      <div className="text-[12px] font-medium text-zinc-400 tabular-nums mt-1.5 h-[15px]">{sub ?? ''}</div>
    </Link>
  );
}

function Tile({ href, icon: Icon, title, desc }: { href: string; icon: LucideIcon; title: string; desc: string }) {
  return (
    <Link href={href} className="group rounded-2xl bg-white border border-black/[0.06] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)] hover:border-black/[0.1] transition-all flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center"><Icon size={18} className="text-indigo-600" /></div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-zinc-900">{title}</div>
        <div className="text-[11px] text-zinc-500 truncate">{desc}</div>
      </div>
      <ArrowRight size={15} className="text-zinc-300 group-hover:text-indigo-400 group-hover:translate-x-0.5 transition-all" />
    </Link>
  );
}
