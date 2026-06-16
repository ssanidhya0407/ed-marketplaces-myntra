'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Package, Sparkles, Bell, ShoppingBag, Check, X, Inbox, Undo2, Boxes, LayoutDashboard, Percent, BarChart3, LogOut, PanelLeft, PanelLeftClose } from 'lucide-react';
import { useNotifications } from './NotificationProvider';
import { cx } from '@/lib/utils';

const NAV = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/orders', label: 'All Orders', icon: Package },
  { href: '/orders/new', label: 'New Orders', icon: Sparkles },
  { href: '/inbox', label: 'Inbox', icon: Inbox },
  { href: '/returns', label: 'Returns', icon: Undo2 },
  { href: '/inventory', label: 'Inventory', icon: Boxes },
  { href: '/discounts', label: 'Discounts', icon: Percent },
  { href: '/reports', label: 'Reports', icon: BarChart3 },
];

function NotificationBell() {
  const { notifications, unread, markAllRead, clearNotifications, lastSync } = useNotifications();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => { setOpen((o) => !o); if (!open) markAllRead(); }}
        className="relative p-2 text-zinc-400 hover:text-zinc-700 hover:bg-white rounded-xl transition-all"
      >
        <Bell size={17} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-80 bg-white border border-black/[0.08] rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.12)] py-2 z-50 overflow-hidden">
          <div className="px-4 py-2 flex items-center justify-between">
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Notifications</p>
            {notifications.length > 0 && (
              <button onClick={clearNotifications} className="text-[11px] font-semibold text-indigo-500 hover:text-indigo-700">Clear</button>
            )}
          </div>
          {notifications.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-[13px] text-zinc-600">No new orders yet.</p>
              <p className="text-[11px] text-zinc-400 mt-0.5">Watching live every 30s.</p>
            </div>
          ) : (
            <div className="max-h-72 overflow-y-auto">
              {notifications.map((n, i) => (
                <div key={i} className="px-4 py-3 hover:bg-zinc-50 transition-colors border-t border-black/[0.04]">
                  <div className="flex items-start gap-2.5">
                    <div className="w-6 h-6 rounded-lg bg-rose-50 flex items-center justify-center shrink-0 mt-0.5">
                      <ShoppingBag size={11} className="text-rose-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] text-zinc-800 font-semibold">New order #{n.orderId}</p>
                      <p className="text-[11px] font-mono text-zinc-400 truncate">{n.sellerOrderId || ''}</p>
                      <p className="text-[10px] text-zinc-400 mt-0.5">{new Date(n.at).toLocaleTimeString()}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="px-4 pt-2 text-[10px] text-zinc-400 border-t border-black/[0.04]">
            {lastSync ? 'Last synced ' + lastSync.toLocaleTimeString() : 'Syncing…'}
          </p>
        </div>
      )}
    </div>
  );
}

function AccountMenu() {
  const [email, setEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/orders/api/auth/me')
      .then((r) => r.json())
      .then((d) => setEmail(d?.email ?? null))
      .catch(() => {});
  }, []);

  async function logout() {
    setBusy(true);
    try {
      await fetch('/orders/api/auth/logout', { method: 'POST' });
    } catch {
      /* ignore — redirect regardless */
    }
    window.location.href = '/login';
  }

  const initial = (email || 'E').trim().charAt(0).toUpperCase();
  return (
    <div className="flex items-center gap-2">
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-sm ring-2 ring-white ring-offset-1 ring-offset-[#FAF9F6]" title={email || undefined}>
        <span className="text-white text-[11px] font-bold">{initial}</span>
      </div>
      <button
        onClick={logout}
        disabled={busy}
        title={email ? `Sign out (${email})` : 'Sign out'}
        className="p-2 text-zinc-400 hover:text-rose-600 hover:bg-white rounded-xl transition-all disabled:opacity-60"
      >
        <LogOut size={16} />
      </button>
    </div>
  );
}

function Toasts() {
  const { toasts, dismissToast } = useNotifications();
  return (
    <div className="fixed right-5 bottom-5 z-[60] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => dismissToast(t.id)}
          className={cx(
            'animate-toast cursor-pointer bg-white border rounded-xl shadow-[0_8px_26px_rgba(0,0,0,0.14)] px-4 py-3 min-w-[250px] max-w-[380px] flex items-start gap-2.5',
            t.tone === 'ok' && 'border-l-4 border-l-emerald-500 border-zinc-200',
            t.tone === 'err' && 'border-l-4 border-l-rose-500 border-zinc-200',
            t.tone === 'new' && 'border-l-4 border-l-indigo-500 border-zinc-200',
          )}
        >
          <div className="mt-0.5">
            {t.tone === 'ok' && <Check size={15} className="text-emerald-500" />}
            {t.tone === 'err' && <X size={15} className="text-rose-500" />}
            {t.tone === 'new' && <ShoppingBag size={15} className="text-indigo-500" />}
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-zinc-800">{t.title}</p>
            {t.message && <p className="text-[12px] text-zinc-500 mt-0.5">{t.message}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => { setCollapsed(localStorage.getItem('oms.sidebar.collapsed') === '1'); }, []);
  const toggleSidebar = () => setCollapsed((c) => {
    const next = !c;
    try { localStorage.setItem('oms.sidebar.collapsed', next ? '1' : '0'); } catch { /* ignore */ }
    return next;
  });

  // A nav item is active on an exact match, or on a deeper sub-route — but NOT
  // when a more specific nav entry also matches (so /orders doesn't light up on
  // /orders/new, which is its own entry).
  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    if (pathname === href) return true;
    if (!pathname.startsWith(href + '/')) return false;
    return !NAV.some((n) => n.href !== href && n.href.startsWith(href + '/')
      && (pathname === n.href || pathname.startsWith(n.href + '/')));
  };

  // The login screen renders full-bleed, without the dashboard chrome.
  if (pathname === '/login') return <>{children}</>;
  return (
    <div className="min-h-screen bg-[#FAF9F6]">
      {/* Sidebar */}
      <aside className={cx(
        'fixed top-0 left-0 h-screen bg-white border-r border-black/[0.06] flex flex-col py-5 z-40 transition-[width] duration-200',
        collapsed ? 'w-[68px] px-2' : 'w-[230px] px-3',
      )}>
        <div className={cx('mb-6 flex items-center', collapsed ? 'justify-center' : 'px-2 gap-2.5')}>
          <div className="w-9 h-9 rounded-xl bg-white border border-black/[0.06] flex items-center justify-center shadow-sm shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/myntra-logo.svg" alt="Myntra" className="w-6 h-6 object-contain" />
          </div>
          {!collapsed && (
            <div>
              <div className="text-[16px] font-extrabold tracking-tight text-zinc-900 leading-none">
                Myntra <span className="bg-gradient-to-r from-rose-500 to-pink-600 bg-clip-text text-transparent">OMS</span>
              </div>
              <div className="text-[10px] text-zinc-400 mt-1">EXPERIENCES.DIGITAL</div>
            </div>
          )}
        </div>
        {!collapsed && <div className="px-3 mb-1.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Menu</div>}
        <nav className="flex flex-col gap-0.5">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                title={collapsed ? label : undefined}
                className={cx(
                  'relative flex items-center rounded-xl text-[13.5px] font-semibold transition-all',
                  collapsed ? 'justify-center py-2.5' : 'gap-2.5 px-3 py-2.5',
                  active
                    ? 'bg-gradient-to-r from-rose-500 to-pink-600 text-white shadow-sm'
                    : 'text-zinc-600 hover:bg-zinc-100/70',
                )}
              >
                <Icon size={16} className={active ? 'text-white' : 'text-zinc-400'} />
                {!collapsed && label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto">
          {collapsed ? (
            <div className="flex justify-center py-2" title="Live · Myntra · K8MMD2GK">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </span>
            </div>
          ) : (
            <div className="rounded-xl border border-black/[0.06] bg-zinc-50/70 p-3">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                <span className="text-[11px] font-semibold text-zinc-700">Live · Myntra</span>
              </div>
              <div className="text-[10px] text-zinc-400 mt-1 truncate">EXPERIENCES.DIGITAL · K8MMD2GK</div>
            </div>
          )}
        </div>
      </aside>

      {/* Main */}
      <div className={cx('transition-[margin] duration-200', collapsed ? 'ml-[68px]' : 'ml-[230px]')}>
        <header className="sticky top-0 z-30 h-[56px] bg-[#FAF9F6]/95 backdrop-blur-xl border-b border-black/[0.06] flex items-center justify-between px-6 gap-1.5">
          <button
            onClick={toggleSidebar}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="p-2 -ml-2 text-zinc-400 hover:text-zinc-700 hover:bg-white rounded-xl transition-all"
          >
            {collapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
          </button>
          <div className="flex items-center gap-1.5">
            <NotificationBell />
            <AccountMenu />
          </div>
        </header>
        <main className="px-5 sm:px-8 py-7">
          <div className="mx-auto w-full max-w-[1480px]">{children}</div>
        </main>
      </div>

      <Toasts />
    </div>
  );
}
