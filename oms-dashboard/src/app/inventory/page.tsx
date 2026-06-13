'use client';

import { useState } from 'react';
import { Boxes, Plus, Trash2, Upload, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { useNotifications } from '@/components/NotificationProvider';

interface Row { sku: string; quantity: string; processingSla: string; store_code: string }

const DEFAULT_STORE = '84502';
const DEFAULT_SLA = '5';
const blankRow = (): Row => ({ sku: '', quantity: '', processingSla: DEFAULT_SLA, store_code: DEFAULT_STORE });

interface Result { ok: boolean; submitted?: number; succeeded?: number; failed?: any[]; chunkErrors?: any[]; error?: string }

export default function InventoryPage() {
  const [rows, setRows] = useState<Row[]>([blankRow()]);
  const [bulk, setBulk] = useState('');
  const [showBulk, setShowBulk] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const { pushToast } = useNotifications();

  const update = (i: number, key: keyof Row, val: string) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [key]: val } : row)));
  const addRow = () => setRows((r) => [...r, blankRow()]);
  const removeRow = (i: number) => setRows((r) => (r.length === 1 ? [blankRow()] : r.filter((_, idx) => idx !== i)));

  // Parse "sku,qty[,sla[,store]]" lines into rows.
  function applyBulk() {
    const parsed: Row[] = bulk.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
      const [sku, quantity, sla, store] = line.split(/[,\t]/).map((s) => s.trim());
      return { sku: sku || '', quantity: quantity || '', processingSla: sla || DEFAULT_SLA, store_code: store || DEFAULT_STORE };
    }).filter((r) => r.sku);
    if (!parsed.length) { pushToast({ tone: 'err', title: 'Nothing to parse', message: 'Use one "sku,quantity" per line.' }); return; }
    setRows(parsed);
    setShowBulk(false);
    setBulk('');
  }

  async function submit() {
    const items = rows.filter((r) => r.sku.trim()).map((r) => ({ sku: r.sku.trim(), quantity: r.quantity, processingSla: r.processingSla, store_code: r.store_code.trim() }));
    if (!items.length) { pushToast({ tone: 'err', title: 'No SKUs', message: 'Add at least one SKU row.' }); return; }
    setSubmitting(true); setResult(null);
    try {
      const res = await api.updateInventory(items);
      if (!res.ok) { pushToast({ tone: 'err', title: 'Update failed', message: res.error || `HTTP ${res.httpStatus}` }); setResult(res); return; }
      setResult(res);
      const failedN = (res.failed?.length || 0) + (res.chunkErrors?.flatMap((e: any) => e.skus)?.length || 0);
      pushToast({
        tone: failedN ? 'err' : 'ok',
        title: failedN ? `${res.succeeded}/${res.submitted} updated` : 'Inventory updated',
        message: failedN ? `${failedN} SKU(s) rejected — see below.` : `${res.succeeded} SKU(s) updated on Myntra.`,
      });
    } catch (e: any) {
      pushToast({ tone: 'err', title: 'Network error', message: e.message });
    } finally {
      setSubmitting(false);
    }
  }

  const failedRows = [
    ...(result?.failed || []).map((f: any) => ({ sku: f.sku, remarks: f.remarks || 'Rejected', store: f.store_code })),
    ...(result?.chunkErrors || []).flatMap((e: any) => (e.skus || []).map((s: string) => ({ sku: s, remarks: e.message || 'Batch failed', store: '' }))),
  ];

  return (
    <>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <h2 className="text-base font-semibold text-zinc-900 flex items-center gap-2">
          <Boxes size={17} className="text-indigo-500" /> Update inventory
        </h2>
        <button onClick={() => setShowBulk((s) => !s)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors">
          <Upload size={13} /> Bulk paste
        </button>
      </div>
      <p className="text-xs text-zinc-500 mb-4">Push the latest stock snapshot to Myntra (Seller API). Up to 10 SKUs per batch — larger lists are sent automatically in batches.</p>

      {showBulk && (
        <div className="rounded-2xl bg-white border border-black/[0.06] p-4 mb-4 shadow-sm">
          <div className="text-[11px] font-semibold text-zinc-500 mb-1.5">Paste rows — one per line: <code className="font-mono text-zinc-600">sku,quantity,sla,storecode</code> (sla &amp; storecode optional)</div>
          <textarea value={bulk} onChange={(e) => setBulk(e.target.value)} rows={5} placeholder={`Earrings632,25\nBracelet088,10,5,84502`}
            className="w-full px-3 py-2 text-[12px] font-mono bg-zinc-50 border border-black/[0.08] rounded-lg outline-none focus:border-indigo-400" />
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={() => { setShowBulk(false); setBulk(''); }} className="px-3 py-1.5 text-[11px] font-medium text-zinc-600 hover:text-zinc-900">Cancel</button>
            <button onClick={applyBulk} className="px-3.5 py-1.5 text-[11px] font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">Load rows</button>
          </div>
        </div>
      )}

      <div className="rounded-2xl bg-white border border-black/[0.06] overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.04)]">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50/80 text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">
            <tr>
              <th className="px-4 py-3 text-left">Seller SKU</th>
              <th className="px-4 py-3 text-left w-32">Quantity</th>
              <th className="px-4 py-3 text-left w-36">Processing SLA (days)</th>
              <th className="px-4 py-3 text-left w-36">Store code</th>
              <th className="px-4 py-3 w-12" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.map((row, i) => (
              <tr key={i}>
                <td className="px-4 py-2">
                  <input value={row.sku} onChange={(e) => update(i, 'sku', e.target.value)} placeholder="e.g. Earrings632"
                    className="w-full px-2.5 py-1.5 text-[12px] font-mono bg-white border border-black/[0.08] rounded-lg outline-none focus:border-indigo-400" />
                </td>
                <td className="px-4 py-2">
                  <input value={row.quantity} onChange={(e) => update(i, 'quantity', e.target.value)} type="number" min={0} placeholder="0"
                    className="w-full px-2.5 py-1.5 text-[12px] bg-white border border-black/[0.08] rounded-lg outline-none focus:border-indigo-400" />
                </td>
                <td className="px-4 py-2">
                  <input value={row.processingSla} onChange={(e) => update(i, 'processingSla', e.target.value)} type="number" min={0}
                    className="w-full px-2.5 py-1.5 text-[12px] bg-white border border-black/[0.08] rounded-lg outline-none focus:border-indigo-400" />
                </td>
                <td className="px-4 py-2">
                  <input value={row.store_code} onChange={(e) => update(i, 'store_code', e.target.value)} placeholder="84502"
                    className="w-full px-2.5 py-1.5 text-[12px] font-mono bg-white border border-black/[0.08] rounded-lg outline-none focus:border-indigo-400" />
                </td>
                <td className="px-4 py-2 text-center">
                  <button onClick={() => removeRow(i)} className="text-zinc-300 hover:text-rose-500 transition-colors"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center justify-between px-4 py-3 border-t border-black/[0.05]">
          <button onClick={addRow} className="flex items-center gap-1.5 text-[12px] font-semibold text-indigo-600 hover:text-indigo-800">
            <Plus size={14} /> Add SKU
          </button>
          <button onClick={submit} disabled={submitting}
            className="flex items-center gap-1.5 px-5 py-2 text-[12px] font-semibold bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl hover:opacity-90 transition-opacity shadow-sm disabled:opacity-50">
            {submitting ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Update on Myntra
          </button>
        </div>
      </div>

      {result?.ok && (
        <div className="mt-4 rounded-2xl bg-white border border-black/[0.06] p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            {failedRows.length === 0
              ? <CheckCircle2 size={16} className="text-emerald-500" />
              : <AlertTriangle size={16} className="text-amber-500" />}
            <span className="text-[13px] font-semibold text-zinc-800">
              {result.succeeded}/{result.submitted} SKU(s) updated on Myntra
            </span>
          </div>
          {failedRows.length > 0 && (
            <div className="rounded-lg border border-rose-200/70 overflow-hidden">
              <table className="w-full text-[11px]">
                <thead className="bg-rose-50 text-[9px] uppercase text-rose-600">
                  <tr><th className="px-3 py-1.5 text-left">SKU</th><th className="px-3 py-1.5 text-left">Store</th><th className="px-3 py-1.5 text-left">Reason</th></tr>
                </thead>
                <tbody className="divide-y divide-rose-100">
                  {failedRows.map((f, i) => (
                    <tr key={i}>
                      <td className="px-3 py-1.5 font-mono text-zinc-700">{f.sku}</td>
                      <td className="px-3 py-1.5 font-mono text-zinc-500">{f.store || '—'}</td>
                      <td className="px-3 py-1.5 text-rose-600">{f.remarks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
