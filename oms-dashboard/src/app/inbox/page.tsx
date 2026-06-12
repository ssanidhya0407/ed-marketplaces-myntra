'use client';

import { useCallback, useEffect, useState } from 'react';
import { RotateCw, Inbox as InboxIcon, Undo2 } from 'lucide-react';
import { api, type OrderSummary } from '@/lib/api';
import OrdersTable from '@/components/OrdersTable';
import OrderDetailModal from '@/components/OrderDetailModal';
import ReturnDetailModal from '@/components/ReturnDetailModal';
import { useRowDetails } from '@/lib/useRowDetails';
import { formatDate } from '@/lib/utils';

interface ReturnRow {
  id: string; type: string | null; status: string | null; sellerOrderId: string | null;
  trackingNumber: string | number | null; reason: string | null; returnWarehouseCode: string | null; createdOn: string | null;
}

export default function InboxPage() {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [returns, setReturns] = useState<ReturnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedReturn, setSelectedReturn] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const details = useRowDetails(orders, 'inbox'); // enrich rows from the inbox (local store)

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [list, ret] = await Promise.all([api.inboxList(), api.inboxReturns()]);
      if (!list.ok) { setError(list.error || 'Failed to load inbox'); setLoading(false); return; }
      setOrders(list.orders || []);
      setReturns(ret.ok ? ret.returns || [] : []);
      setLastSync(new Date());
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [load]);

  return (
    <>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 flex items-center gap-2">
            <InboxIcon size={17} className="text-indigo-500" /> Inbox
            <span className="text-[12px] font-bold bg-indigo-600 text-white rounded-full px-2 py-0.5">{orders.length}</span>
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Orders &amp; returns pushed by Myntra to your webhook · {lastSync ? 'synced ' + lastSync.toLocaleTimeString() : 'syncing…'}
          </p>
        </div>
        <button onClick={load}
          className="flex items-center gap-1.5 px-3.5 py-2 text-[12px] font-semibold bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl hover:opacity-90 transition-opacity shadow-sm">
          <RotateCw size={13} /> Refresh
        </button>
      </div>

      <div className="rounded-2xl bg-white border border-black/[0.06] overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.04)] mb-6">
        {loading && <div className="px-4 py-14 text-center text-sm text-zinc-400">Loading pushed orders…</div>}
        {!loading && error && <div className="px-4 py-12 text-center text-sm text-rose-600">{error}</div>}
        {!loading && !error && (
          orders.length === 0
            ? <div className="px-4 py-16 text-center text-sm text-zinc-500">No orders pushed yet. They appear here the moment Myntra calls your <code className="font-mono text-zinc-600">/storefront/v4/order</code> webhook.</div>
            : <OrdersTable orders={orders} onSelect={setSelected} details={details} source="inbox" />
        )}
      </div>

      {/* Returns */}
      <div className="flex items-center gap-2 mb-3">
        <Undo2 size={15} className="text-rose-500" />
        <h3 className="text-[13px] font-semibold text-zinc-800">Returns <span className="text-zinc-400 font-normal">({returns.length})</span></h3>
      </div>
      <div className="rounded-2xl bg-white border border-black/[0.06] overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        {returns.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-zinc-400">No returns pushed yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-zinc-50/80 text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Return ID</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Seller Order</th>
                <th className="px-4 py-3 text-left">Tracking</th>
                <th className="px-4 py-3 text-left">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {returns.map((r) => (
                <tr key={r.id} onClick={() => setSelectedReturn(r.id)} className="hover:bg-rose-50/40 cursor-pointer transition-colors">
                  <td className="px-4 py-3 font-mono text-[11px] text-zinc-700">{r.id}</td>
                  <td className="px-4 py-3">
                    <span className={'text-[10px] font-semibold px-2 py-0.5 rounded-md border ' + (r.type === 'COURIER_RETURN' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-blue-50 text-blue-700 border-blue-200')}>
                      {r.type === 'COURIER_RETURN' ? 'RTO' : 'Customer'}
                    </span>
                  </td>
                  <td className="px-4 py-3"><span className="text-[10px] font-semibold px-2 py-0.5 rounded-md border bg-zinc-100 text-zinc-600 border-zinc-200">{r.status || '—'}</span></td>
                  <td className="px-4 py-3 font-mono text-[11px] text-zinc-500">{r.sellerOrderId || '—'}</td>
                  <td className="px-4 py-3 font-mono text-[11px] text-zinc-500">{r.trackingNumber || '—'}</td>
                  <td className="px-4 py-3 text-[12px] text-zinc-600 max-w-[240px] truncate" title={r.reason || ''}>{r.reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selected && <OrderDetailModal sellerOrderId={selected} source="inbox" onClose={() => setSelected(null)} onMutated={load} />}
      {selectedReturn && <ReturnDetailModal id={selectedReturn} onClose={() => setSelectedReturn(null)} />}
    </>
  );
}
