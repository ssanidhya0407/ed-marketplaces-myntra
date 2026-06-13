'use client';

import { useCallback, useEffect, useState } from 'react';
import { RotateCw, Inbox as InboxIcon } from 'lucide-react';
import { api, type OrderSummary } from '@/lib/api';
import OrdersTable from '@/components/OrdersTable';
import OrderDetailModal from '@/components/OrderDetailModal';
import { useRowDetails } from '@/lib/useRowDetails';

export default function InboxPage() {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const details = useRowDetails(orders, 'inbox'); // enrich rows from the inbox (local store)

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const list = await api.inboxList();
      if (!list.ok) { setError(list.error || 'Failed to load inbox'); setLoading(false); return; }
      setOrders(list.orders || []);
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
            Orders pushed by Myntra to your webhook · {lastSync ? 'synced ' + lastSync.toLocaleTimeString() : 'syncing…'}
          </p>
        </div>
        <button onClick={load}
          className="flex items-center gap-1.5 px-3.5 py-2 text-[12px] font-semibold bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl hover:opacity-90 transition-opacity shadow-sm">
          <RotateCw size={13} /> Refresh
        </button>
      </div>

      <div className="rounded-2xl bg-white border border-black/[0.06] overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.04)]">
        {loading && <div className="px-4 py-14 text-center text-sm text-zinc-400">Loading pushed orders…</div>}
        {!loading && error && <div className="px-4 py-12 text-center text-sm text-rose-600">{error}</div>}
        {!loading && !error && (
          orders.length === 0
            ? <div className="px-4 py-16 text-center text-sm text-zinc-500">No orders pushed yet. They appear here the moment Myntra calls your <code className="font-mono text-zinc-600">/storefront/v4/order</code> webhook.</div>
            : <OrdersTable orders={orders} onSelect={setSelected} details={details} source="inbox" />
        )}
      </div>

      {selected && <OrderDetailModal sellerOrderId={selected} source="inbox" onClose={() => setSelected(null)} onMutated={load} />}
    </>
  );
}
