'use client';

import { formatINR } from '@/lib/utils';

// Renders Myntra's getInvoiceDetails payload as readable UI. The exact schema
// isn't fixed, so this is data-driven: scalars become a labelled grid, arrays of
// objects become compact tables, nested objects become sub-grids. No raw JSON.

const ENVELOPE = new Set(['statuscode', 'statusmessage', 'statustype', 'status', 'message']);
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

function fmtValue(key: string, v: any): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (AMOUNT_HINT.test(key) && !/taxtype/i.test(key) && isNumeric(v)) return formatINR(Number(v));
  return String(v);
}

const visibleEntries = (obj: any): [string, any][] =>
  Object.entries(obj || {}).filter(([k]) => !ENVELOPE.has(k.toLowerCase()));

function ScalarGrid({ obj }: { obj: Record<string, any> }) {
  const rows = visibleEntries(obj).filter(
    ([, v]) => v === null || ['string', 'number', 'boolean'].includes(typeof v),
  );
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
  const cols = Array.from(
    rows.reduce((s: Set<string>, r) => {
      Object.keys(r || {}).forEach((k) => s.add(k));
      return s;
    }, new Set<string>()),
  );
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
              <tr key={i}>{cols.map((c) => <td key={c} className="px-2 py-1.5 whitespace-nowrap">{fmtValue(c, r?.[c])}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function InvoiceDetails({ data }: { data: any }) {
  if (!data || typeof data !== 'object') return null;

  const scalars: Record<string, any> = {};
  const arrays: [string, any[]][] = [];
  const nested: [string, any][] = [];

  for (const [k, v] of visibleEntries(data)) {
    if (Array.isArray(v)) {
      if (v.length && typeof v[0] === 'object') arrays.push([k, v]);
      else if (v.length) scalars[k] = v.join(', ');
    } else if (v && typeof v === 'object') {
      nested.push([k, v]);
    } else {
      scalars[k] = v;
    }
  }

  return (
    <div className="space-y-3">
      <ScalarGrid obj={scalars} />
      {nested.map(([k, v]) => (
        <div key={k}>
          <div className="text-[10px] font-semibold text-zinc-500 mb-1">{humanize(k)}</div>
          <ScalarGrid obj={v} />
        </div>
      ))}
      {arrays.map(([k, v]) => <ObjTable key={k} rows={v} title={humanize(k)} />)}
    </div>
  );
}
