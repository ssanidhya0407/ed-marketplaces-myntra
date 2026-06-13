'use client';

import { Receipt, Warehouse, Clock, Star } from 'lucide-react';
import { formatINR } from '@/lib/utils';

// Renders Myntra's getInvoiceDetails / getReturnDetails payloads.
// - Invoice data (has orderLineEntries) -> a purpose-built invoice card per line.
// - Anything else (e.g. return detail) -> a clean, data-driven field grid.

const ENVELOPE = new Set(['statuscode', 'statusmessage', 'statustype', 'status', 'message', 'orderlineentries']);
const AMOUNT_HINT = /(amount|amt|price|value|total|mrp|discount|payable|charge|taxable)/i;

function humanize(k: string): string {
  return k
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const isNumeric = (v: any) =>
  typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)));

const inr = (v: any) => (v === null || v === undefined || v === '' || !isNumeric(v) ? '—' : formatINR(Number(v)));

function fmtValue(key: string, v: any): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (AMOUNT_HINT.test(key) && !/taxtype|taxrate/i.test(key) && isNumeric(v)) return formatINR(Number(v));
  return String(v);
}

// ---------- Purpose-built invoice layout ----------

function Amount({ label, value, accent }: { label: string; value: any; accent?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">{label}</div>
      <div className={`text-[13px] font-semibold tabular-nums ${accent ? 'text-emerald-600' : 'text-zinc-800'}`}>{inr(value)}</div>
    </div>
  );
}

function InvoiceLine({ line }: { line: any }) {
  const taxes: any[] = Array.isArray(line.taxEntries) ? line.taxEntries : [];
  const totalTax = taxes.reduce((s, t) => s + (Number(t.unitTaxAmount) || 0), 0);

  return (
    <div className="rounded-xl border border-black/[0.07] bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-3.5 py-2.5 bg-zinc-50/70 border-b border-black/[0.05]">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-bold text-zinc-900">{line.sku || '—'}</span>
            {line.priority && (
              <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                <Star size={9} /> Priority
              </span>
            )}
          </div>
          <div className="text-[10px] text-zinc-400 font-mono mt-0.5">Line {line.orderLineId || '—'}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="flex items-center gap-1 justify-end text-[11px] font-semibold text-indigo-600">
            <Receipt size={11} /> {line.invoiceNumber || '—'}
          </div>
          <div className="text-[10px] text-zinc-400 mt-0.5">{line.invoiceDate || '—'}</div>
        </div>
      </div>

      {/* Amounts */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 px-3.5 py-3">
        <Amount label="MRP" value={line.mrp} />
        <Amount label="Sale price (excl. tax)" value={line.unitSalePriceWithoutTax} />
        <Amount label="Other charges (excl. tax)" value={line.unitOtherChargesWithoutTax} />
        <Amount label="Final amount" value={line.finalAmount} />
        <Amount label="Seller final amount" value={line.sellerFinalAmount} accent />
        <Amount label="Total tax" value={totalTax} />
      </div>

      {/* Tax breakdown */}
      {taxes.length > 0 && (
        <div className="px-3.5 pb-3">
          <div className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider mb-1">Tax breakdown</div>
          <div className="rounded-lg border border-black/[0.06] overflow-hidden">
            <table className="w-full text-[11px]">
              <thead className="bg-zinc-50 text-[9px] uppercase text-zinc-500">
                <tr>
                  <th className="px-2.5 py-1.5 text-left">Type</th>
                  <th className="px-2.5 py-1.5 text-right">Rate</th>
                  <th className="px-2.5 py-1.5 text-right">Taxable</th>
                  <th className="px-2.5 py-1.5 text-right">Tax</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {taxes.map((t, i) => (
                  <tr key={i}>
                    <td className="px-2.5 py-1.5 font-semibold text-zinc-700">{t.taxType || '—'}</td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums">{t.taxRate != null ? `${t.taxRate}%` : '—'}</td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums text-zinc-600">{inr(t.unitTaxableAmount)}</td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums font-medium">{inr(t.unitTaxAmount)}</td>
                  </tr>
                ))}
                <tr className="bg-zinc-50/60">
                  <td className="px-2.5 py-1.5 font-semibold text-zinc-500" colSpan={3}>Total tax</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums font-bold text-zinc-800">{inr(totalTax)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Meta footer */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3.5 py-2 border-t border-black/[0.05] text-[10px] text-zinc-500">
        {line.warehouse && <span className="flex items-center gap-1"><Warehouse size={10} /> WH {line.warehouse}</span>}
        {line.processingStartTime && <span className="flex items-center gap-1"><Clock size={10} /> Processing {line.processingStartTime}</span>}
        {line.packetId && <span className="font-mono">Packet {line.packetId}</span>}
      </div>
    </div>
  );
}

// ---------- Generic data-driven fallback (returns, unknown shapes) ----------

const visibleEntries = (obj: any): [string, any][] =>
  Object.entries(obj || {}).filter(([k]) => !ENVELOPE.has(k.toLowerCase()));

const flattenObject = (obj: any): string =>
  visibleEntries(obj).map(([k, v]) => `${humanize(k)} ${fmtValue(k, v)}`).join(' · ');

function renderCell(key: string, v: any) {
  if (Array.isArray(v)) {
    if (v.length && typeof v[0] === 'object') {
      return <div className="space-y-0.5">{v.map((o, i) => <div key={i} className="text-zinc-700">{flattenObject(o)}</div>)}</div>;
    }
    return v.length ? v.map((x) => fmtValue(key, x)).join(', ') : '—';
  }
  if (v && typeof v === 'object') return flattenObject(v) || '—';
  return fmtValue(key, v);
}

function ScalarGrid({ obj }: { obj: Record<string, any> }) {
  const rows = visibleEntries(obj).filter(([, v]) => v === null || ['string', 'number', 'boolean'].includes(typeof v));
  if (!rows.length) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2.5">
      {rows.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <div className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">{humanize(k)}</div>
          <div className="text-[12px] text-zinc-800 font-medium break-words">{fmtValue(k, v)}</div>
        </div>
      ))}
    </div>
  );
}

function ObjTable({ rows, title }: { rows: any[]; title: string }) {
  const cols = Array.from(rows.reduce((s: Set<string>, r) => { Object.keys(r || {}).forEach((k) => s.add(k)); return s; }, new Set<string>()));
  if (!cols.length) return null;
  return (
    <div>
      <div className="text-[10px] font-semibold text-zinc-500 mb-1">{title}</div>
      <div className="rounded-lg border border-black/[0.06] overflow-x-auto bg-white">
        <table className="w-full text-[11px]">
          <thead className="bg-zinc-50 text-[9px] uppercase text-zinc-500">
            <tr>{cols.map((c) => <th key={c} className="px-2 py-1.5 text-left whitespace-nowrap">{humanize(c)}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.map((r, i) => (
              <tr key={i}>{cols.map((c) => <td key={c} className="px-2 py-1.5 align-top whitespace-nowrap">{renderCell(c, r?.[c])}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GenericObject({ data }: { data: any }) {
  const scalars: Record<string, any> = {};
  const arrays: [string, any[]][] = [];
  const nested: [string, any][] = [];
  for (const [k, v] of visibleEntries(data)) {
    if (Array.isArray(v)) { if (v.length && typeof v[0] === 'object') arrays.push([k, v]); else if (v.length) scalars[k] = v.join(', '); }
    else if (v && typeof v === 'object') nested.push([k, v]);
    else scalars[k] = v;
  }
  return (
    <div className="space-y-3">
      <ScalarGrid obj={scalars} />
      {nested.map(([k, v]) => (
        <div key={k}><div className="text-[10px] font-semibold text-zinc-500 mb-1">{humanize(k)}</div><ScalarGrid obj={v} /></div>
      ))}
      {arrays.map(([k, v]) => <ObjTable key={k} rows={v} title={humanize(k)} />)}
    </div>
  );
}

export default function InvoiceDetails({ data }: { data: any }) {
  if (!data || typeof data !== 'object') return null;
  const lines: any[] = Array.isArray(data.orderLineEntries) ? data.orderLineEntries : [];
  if (lines.length) {
    return <div className="space-y-3">{lines.map((l, i) => <InvoiceLine key={l.orderLineId || i} line={l} />)}</div>;
  }
  return <GenericObject data={data} />;
}
