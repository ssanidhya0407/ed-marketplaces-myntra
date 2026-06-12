'use client';

import { useEffect, useState } from 'react';
import { X, Undo2, Loader2, RotateCcw, Truck, Package, Calendar, MapPin, Hash } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import InvoiceDetails from './InvoiceDetails';

const isRTO = (t: string | null | undefined) => String(t || '').toUpperCase() === 'COURIER_RETURN';

function Section({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div className="px-6 py-4 border-b border-black/[0.05]">
      <div className="flex items-center gap-1.5 mb-3 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
        <Icon size={13} className="text-zinc-400" /> {title}
      </div>
      {children}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: any; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">{label}</div>
      <div className={`text-[12px] text-zinc-800 font-medium break-words ${mono ? 'font-mono' : ''}`}>
        {value === null || value === undefined || value === '' ? '—' : String(value)}
      </div>
    </div>
  );
}

export default function ReturnDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [ret, setRet] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [live, setLive] = useState<{ loading: boolean; ok: boolean; message: string; detail: any } | null>(null);

  async function loadLive(entityId: string) {
    setLive({ loading: true, ok: false, message: '', detail: null });
    try {
      const res = await api.returnDetails(entityId);
      setLive({
        loading: false,
        ok: res.ok && !!res.detail,
        message: res.message || res.error || (res.ok ? 'No matching return on Myntra.' : `HTTP ${res.httpStatus}${res.statusCode ? ', code ' + res.statusCode : ''}`),
        detail: res.detail,
      });
    } catch (e: any) {
      setLive({ loading: false, ok: false, message: e.message, detail: null });
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError('');
      const res = await api.inboxReturnDetail(id);
      if (cancelled) return;
      if (res.ok) {
        setRet(res.return);
        loadLive(res.return?.trackingNumber || id); // Myntra keys Returns Recon on the entity id
      } else {
        setError(res.error || 'Failed to load return');
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', h); document.body.style.overflow = ''; };
  }, [onClose]);

  const history: string[] = Array.isArray(ret?.statusHistory) ? ret.statusHistory : (ret?.status ? [ret.status] : []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-modal-overlay"
      style={{ backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div className="relative bg-white rounded-2xl w-full max-w-[760px] max-h-[90vh] overflow-y-auto shadow-2xl animate-modal-content"
        onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-black/[0.06] px-6 py-4 rounded-t-2xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-rose-50 flex items-center justify-center">
              <Undo2 size={18} className="text-rose-500" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-[15px] font-bold text-zinc-900">Return Details</h2>
                {ret?.type && (
                  <span className={'text-[10px] font-semibold px-2 py-0.5 rounded-md border ' + (isRTO(ret.type) ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-blue-50 text-blue-700 border-blue-200')}>
                    {isRTO(ret.type) ? 'RTO' : 'Customer'}
                  </span>
                )}
                {ret?.status && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md border bg-zinc-100 text-zinc-600 border-zinc-200">{ret.status}</span>}
              </div>
              <span className="text-[11px] font-mono text-zinc-400">{id}</span>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl bg-zinc-50 hover:bg-zinc-100 flex items-center justify-center text-zinc-400 hover:text-zinc-700 transition-colors">
            <X size={16} />
          </button>
        </div>

        {loading && (
          <div className="px-6 py-16 text-center text-zinc-400"><Loader2 size={20} className="animate-spin inline mr-2" /> Loading return…</div>
        )}
        {!loading && error && <div className="px-6 py-10 text-center text-rose-600 text-sm">{error}</div>}

        {!loading && ret && (
          <>
            {history.length > 0 && (
              <Section title="Status timeline" icon={RotateCcw}>
                <div className="flex flex-wrap items-center gap-1.5">
                  {history.map((s, i) => (
                    <span key={i} className="flex items-center gap-1.5">
                      <span className={'text-[11px] font-semibold px-2.5 py-1 rounded-lg border ' + (i === history.length - 1 ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-zinc-50 text-zinc-500 border-zinc-200')}>{s}</span>
                      {i < history.length - 1 && <span className="text-zinc-300">→</span>}
                    </span>
                  ))}
                </div>
              </Section>
            )}

            <Section title="Return summary" icon={Package}>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
                <Field label="Return ID" value={ret.id} mono />
                <Field label="Type" value={isRTO(ret.type) ? 'RTO (Courier)' : 'Customer return'} />
                <Field label="Created on" value={ret.createdOn ? formatDate(ret.createdOn) : null} />
                <Field label="Seller order" value={ret.sellerOrderId} mono />
                <Field label="Order line" value={ret.orderLineId} mono />
                <Field label="Myntra order" value={ret.orderId} mono />
                <Field label="Tracking" value={ret.trackingNumber} mono />
                <Field label="Return warehouse" value={ret.returnWarehouseCode} />
                <Field label="Reason ID" value={ret.reasonId} />
              </div>
              {ret.reason && (
                <div className="mt-3 rounded-lg bg-zinc-50 border border-black/[0.05] px-3 py-2">
                  <div className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider mb-0.5">Reason</div>
                  <div className="text-[12px] text-zinc-700">{ret.reason}</div>
                </div>
              )}
            </Section>

            <Section title="Live details from Myntra" icon={Truck}>
              {!live || live.loading ? (
                <div className="flex items-center gap-2 text-[12px] text-zinc-500"><Loader2 size={13} className="animate-spin" /> Fetching from Myntra…</div>
              ) : live.ok ? (
                <InvoiceDetails data={live.detail} />
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[12px] text-amber-700">{live.message}</p>
                  <button onClick={() => loadLive(ret.trackingNumber || id)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600 hover:text-rose-800 shrink-0">
                    <RotateCcw size={11} /> Retry
                  </button>
                </div>
              )}
            </Section>
          </>
        )}
      </div>
    </div>
  );
}
