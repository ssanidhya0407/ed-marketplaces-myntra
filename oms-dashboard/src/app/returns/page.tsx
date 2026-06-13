'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RotateCw, Undo2, Search } from 'lucide-react';
import { api } from '@/lib/api';
import ReturnDetailModal from '@/components/ReturnDetailModal';
import OrderDetailModal from '@/components/OrderDetailModal';
import { formatDate } from '@/lib/utils';

interface ReturnRow {
  id: string; type: string | null; status: string | null; sellerOrderId: string | null;
  orderLineId: string | number | null; trackingNumber: string | number | null;
  reason: string | null; returnWarehouseCode: string | null; createdOn: string | null;
}

const isRTO = (t: string | null) => String(t || '').toUpperCase() === 'COURIER_RETURN';

const TYPE_TABS = [
  { k: 'all', label: 'All' },
  { k: 'CUSTOMER_RETURN', label: 'Customer' },
  { k: 'COURIER_RETURN', label: 'RTO' },
];
const STATUS_OPTIONS = ['all', 'CONFIRMED', 'READY_FOR_PICKUP', 'DELIVERED', 'CANCELLED', 'DECLINED'];

function statusTone(s: string | null): string {
  switch (String(s || '').toUpperCase()) {
    case 'DELIVERED': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'READY_FOR_PICKUP': return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'CANCELLED':
    case 'DECLINED': return 'bg-rose-50 text-rose-700 border-rose-200';
    default: return 'bg-zinc-100 text-zinc-600 border-zinc-200';
  }
}

export default function ReturnsPage() {
  const [returns, setReturns] = useState<ReturnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [typeF, setTypeF] = useState('all');
  const [statusF, setStatusF] = useState('all');
  const [q, setQ] = useState('');
  const [selectedReturn, setSelectedReturn] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await api.inboxReturns();
      if (r.ok) setReturns(r.returns || []); else setError('Failed to load returns');
      setLastSync(new Date());
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [load]);

  const counts = useMemo(() => ({
    all: returns.length,
    CUSTOMER_RETURN: returns.filter((r) => !isRTO(r.type)).length,
    COURIER_RETURN: returns.filter((r) => isRTO(r.type)).length,
  } as Record<string, number>), [returns]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return returns.filter((r) => {
      if (typeF !== 'all' && String(r.type || '') !== typeF) return false;
      if (statusF !== 'all' && String(r.status || '').toUpperCase() !== statusF) return false;
      if (term) {
        const hay = [r.id, r.sellerOrderId, r.trackingNumber, r.reason].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [returns, typeF, statusF, q]);

  return (
    <>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 flex items-center gap-2">
            <Undo2 size={17} className="text-rose-500" /> Returns
            <span className="text-[12px] font-bold bg-rose-500 text-white rounded-full px-2 py-0.5">{returns.length}</span>
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            RTO &amp; customer returns Myntra pushed to your webhook · {lastSync ? 'synced ' + lastSync.toLocaleTimeString() : 'syncing…'}
          </p>
        </div>
        <button onClick={load}
          className="flex items-center gap-1.5 px-3.5 py-2 text-[12px] font-semibold bg-gradient-to-r from-rose-500 to-pink-600 text-white rounded-xl hover:opacity-90 transition-opacity shadow-sm">
          <RotateCw size={13} /> Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-1.5 bg-white border border-black/[0.06] rounded-xl p-1 shadow-sm">
          {TYPE_TABS.map((t) => (
            <button key={t.k} onClick={() => setTypeF(t.k)}
              className={'px-3 py-1.5 text-[12px] font-semibold rounded-lg transition-colors ' +
                (typeF === t.k ? 'bg-rose-500 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-800')}>
              {t.label} <span className={typeF === t.k ? 'text-white/80' : 'text-zinc-400'}>{counts[t.k] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <select value={statusF} onChange={(e) => setStatusF(e.target.value)}
            className="px-3 py-2 text-[12px] font-medium bg-white border border-black/[0.08] rounded-xl outline-none focus:border-rose-400">
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>)}
          </select>
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search id / order / tracking"
              className="pl-8 pr-3 py-2 text-[12px] bg-white border border-black/[0.08] rounded-xl outline-none focus:border-rose-400 w-[230px]" />
          </div>
        </div>
      </div>

      <div className="rounded-2xl bg-white border border-black/[0.06] overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.04)]">
        {loading && <div className="px-4 py-14 text-center text-sm text-zinc-400">Loading returns…</div>}
        {!loading && error && <div className="px-4 py-12 text-center text-sm text-rose-600">{error}</div>}
        {!loading && !error && (
          <table className="w-full text-sm">
            <thead className="bg-zinc-50/80 text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Return ID</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Seller Order</th>
                <th className="px-4 py-3 text-left">Tracking</th>
                <th className="px-4 py-3 text-left">Created</th>
                <th className="px-4 py-3 text-left">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-16 text-center text-sm text-zinc-400">
                  {returns.length === 0 ? 'No returns pushed yet. They appear here when Myntra calls your return webhook.' : 'No returns match these filters.'}
                </td></tr>
              )}
              {filtered.map((r) => (
                <tr key={r.id} onClick={() => setSelectedReturn(r.id)} className="hover:bg-rose-50/40 cursor-pointer transition-colors">
                  <td className="px-4 py-3 font-mono text-[11px] text-zinc-700">{r.id}</td>
                  <td className="px-4 py-3">
                    <span className={'text-[10px] font-semibold px-2 py-0.5 rounded-md border ' + (isRTO(r.type) ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-blue-50 text-blue-700 border-blue-200')}>
                      {isRTO(r.type) ? 'RTO' : 'Customer'}
                    </span>
                  </td>
                  <td className="px-4 py-3"><span className={'text-[10px] font-semibold px-2 py-0.5 rounded-md border ' + statusTone(r.status)}>{r.status || '—'}</span></td>
                  <td className="px-4 py-3 font-mono text-[11px] text-zinc-500">{r.sellerOrderId || '—'}</td>
                  <td className="px-4 py-3 font-mono text-[11px] text-zinc-500">{r.trackingNumber || '—'}</td>
                  <td className="px-4 py-3 text-[11px] text-zinc-500">{r.createdOn ? formatDate(r.createdOn) : '—'}</td>
                  <td className="px-4 py-3 text-[12px] text-zinc-600 max-w-[240px] truncate" title={r.reason || ''}>{r.reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selectedReturn && (
        <ReturnDetailModal
          id={selectedReturn}
          onClose={() => setSelectedReturn(null)}
          onViewOrder={(sid) => { setSelectedReturn(null); setSelectedOrder(sid); }}
        />
      )}
      {selectedOrder && (
        <OrderDetailModal sellerOrderId={selectedOrder} source="live" onClose={() => setSelectedOrder(null)} />
      )}
    </>
  );
}
