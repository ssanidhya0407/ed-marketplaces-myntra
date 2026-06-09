'use client';

import { useCallback, useEffect, useState } from 'react';
import { RotateCw } from 'lucide-react';
import { api, type OrderSummary } from '@/lib/api';
import { useRowDetails } from '@/lib/useRowDetails';
import OrdersTable from '@/components/OrdersTable';
import OrderDetailModal from '@/components/OrderDetailModal';
import { useNotifications } from '@/components/NotificationProvider';

// "New" = Myntra status RFR (Ready For RTD). We query that filter directly
// (myntradeveloper.md §Order Search) instead of guessing from blank summary statuses.
export default function NewOrdersPage() {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const { notifications, lastSync, pollNow } = useNotifications();
  const sessionNewIds = new Set(notifications.map((n) => String(n.orderId)));
  const details = useRowDetails(orders);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      // Orders needing attention: WP (ready to dispatch) + RFR (received, awaiting release).
      const fetchAll = async (statusCode: string) => {
        const first = await api.listOrders({ page: 0, statusCode });
        if (!first.ok) return [] as OrderSummary[];
        let all = first.orders || [];
        for (let p = 1; p < (first.pages || 1); p++) {
          const r = await api.listOrders({ page: p, statusCode });
          if (r.ok) all = all.concat(r.orders || []);
        }
        return all;
      };
      const [wp, rfr] = await Promise.all([fetchAll('WP'), fetchAll('RFR')]);
      setOrders([...wp, ...rfr]); // WP (actionable) first, then RFR (pending)
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-900 flex items-center gap-2">
            New Orders
            <span className="text-[12px] font-bold bg-rose-500 text-white rounded-full px-2 py-0.5">{orders.length}</span>
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">Awaiting action · {lastSync ? 'last synced ' + lastSync.toLocaleTimeString() : 'syncing…'}</p>
        </div>
        <button onClick={() => { pollNow(); load(); }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
          <RotateCw size={13} /> Check now
        </button>
      </div>

      <div className="rounded-2xl bg-white border border-black/[0.06] overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.04)]">
        {loading && <div className="px-4 py-12 text-center text-sm text-zinc-400">Scanning all orders…</div>}
        {!loading && error && <div className="px-4 py-10 text-center text-sm text-rose-600">{error}</div>}
        {!loading && !error && orders.length === 0 && (
          <div className="px-4 py-16 text-center text-sm text-zinc-500">🎉 You’re all caught up — no new orders awaiting action.</div>
        )}
        {!loading && !error && orders.length > 0 && (
          <OrdersTable orders={orders} onSelect={setSelected} highlightIds={sessionNewIds} details={details} />
        )}
      </div>

      {selected && <OrderDetailModal sellerOrderId={selected} onClose={() => setSelected(null)} onMutated={load} />}
    </>
  );
}
