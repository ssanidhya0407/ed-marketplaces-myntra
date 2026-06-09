'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

export interface NotifEntry { orderId: string | number; sellerOrderId: string | null; at: string }
export interface Toast { id: number; tone: 'ok' | 'err' | 'new'; title: string; message?: string }

interface Ctx {
  toasts: Toast[];
  pushToast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;
  notifications: NotifEntry[];
  unread: number;
  markAllRead: () => void;
  clearNotifications: () => void;
  lastSync: Date | null;
  pollNow: () => Promise<void>;
}

const NotificationContext = createContext<Ctx | null>(null);
export const useNotifications = () => {
  const c = useContext(NotificationContext);
  if (!c) throw new Error('useNotifications outside provider');
  return c;
};

const SEEN_KEY = 'oms.seenOrderIds';
const POLL_MS = 30000;

function loadSeen(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch { return new Set(); }
}
function saveSeen(set: Set<string>) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...set].slice(-2000))); } catch { /* quota */ }
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [notifications, setNotifications] = useState<NotifEntry[]>([]);
  const [unread, setUnread] = useState(0);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const seededRef = useRef(false);
  const idRef = useRef(1);

  const pushToast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = idRef.current++;
    setToasts((arr) => [...arr, { id, ...t }]);
    setTimeout(() => setToasts((arr) => arr.filter((x) => x.id !== id)), t.tone === 'new' ? 9000 : 5000);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((arr) => arr.filter((x) => x.id !== id)), []);
  const markAllRead = useCallback(() => setUnread(0), []);
  const clearNotifications = useCallback(() => { setNotifications([]); setUnread(0); }, []);

  useEffect(() => {
    seenRef.current = loadSeen();
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  const poll = useCallback(async () => {
    try {
      const res = await api.listOrders({ page: 0 });
      if (!res.ok) return;
      setLastSync(new Date());
      const orders = res.orders || [];
      const seen = seenRef.current;

      if (!seededRef.current) {
        orders.forEach((o) => seen.add(String(o.orderId)));
        saveSeen(seen);
        seededRef.current = true;
        return;
      }

      const fresh = orders.filter((o) => !seen.has(String(o.orderId)));
      if (fresh.length) {
        fresh.forEach((o) => seen.add(String(o.orderId)));
        saveSeen(seen);
        const entries: NotifEntry[] = fresh.map((o) => ({
          orderId: o.orderId,
          sellerOrderId: o.orderLines?.[0]?.sellerOrderId ?? null,
          at: new Date().toISOString(),
        }));
        setNotifications((n) => [...entries, ...n].slice(0, 50));
        setUnread((u) => u + fresh.length);
        pushToast({
          tone: 'new',
          title: fresh.length === 1 ? 'New order received' : `${fresh.length} new orders received`,
          message: fresh.map((o) => '#' + o.orderId).slice(0, 4).join(', '),
        });
        if ('Notification' in window && Notification.permission === 'granted') {
          try {
            new Notification('Myntra OMS — new order', {
              body: fresh.length === 1 ? `Order #${fresh[0].orderId}` : `${fresh.length} new orders`,
            });
          } catch { /* ignore */ }
        }
      }
    } catch { /* network blip */ }
  }, [pushToast]);

  useEffect(() => {
    poll();
    const t = setInterval(poll, POLL_MS);
    return () => clearInterval(t);
  }, [poll]);

  return (
    <NotificationContext.Provider
      value={{ toasts, pushToast, dismissToast, notifications, unread, markAllRead, clearNotifications, lastSync, pollNow: poll }}
    >
      {children}
    </NotificationContext.Provider>
  );
}
