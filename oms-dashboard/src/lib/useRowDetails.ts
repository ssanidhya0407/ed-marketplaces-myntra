'use client';

import { useEffect, useRef, useState } from 'react';
import { api, type OrderSummary } from './api';

// The order LIST is sparse (id, sellerOrderId, status). To show SKU, amount and
// document buttons in the table we resolve each row's detail once and cache it.
export interface RowDetail {
  packetId: string | null;
  sku: string | null;
  amount: number | null;
  image: string | null;
  qty: number | null;
}

const EMPTY: RowDetail = { packetId: null, sku: null, amount: null, image: null, qty: null };

export function useRowDetails(orders: OrderSummary[]): Record<string, RowDetail | undefined> {
  const [map, setMap] = useState<Record<string, RowDetail>>({});
  const cache = useRef<Record<string, RowDetail>>({});

  useEffect(() => {
    let cancelled = false;
    const todo = orders
      .map((o) => o.orderLines?.[0]?.sellerOrderId)
      .filter((s): s is string => !!s && !(s in cache.current));

    if (!todo.length) { setMap({ ...cache.current }); return; }

    Promise.all(
      todo.map(async (sid) => {
        try {
          const d = await api.orderDetail(sid);
          if (d.ok) {
            const lines: any[] = d.detail?.orderLineEntries || [];
            const first = lines[0] || {};
            const withPacket = lines.find((l) => l.packetId);
            cache.current[sid] = {
              packetId: withPacket?.packetId ?? null,
              sku: first.sku ?? null,
              amount: first.lineFinalAmount ?? first.mrp ?? null,
              image: first.imageUrl ?? first.image ?? null,
              qty: lines.length || null,
            };
          } else {
            cache.current[sid] = EMPTY;
          }
        } catch {
          cache.current[sid] = EMPTY;
        }
      }),
    ).then(() => { if (!cancelled) setMap({ ...cache.current }); });

    return () => { cancelled = true; };
  }, [orders]);

  return map;
}
