'use client';

import { formatINR } from '@/lib/utils';

// Renders Myntra's getInvoiceDetails payload as a proper tax-invoice document.
// Falls back to a data-driven grid for any other payload shape (e.g. returns).

const ENVELOPE = new Set(['statuscode', 'statusmessage', 'statustype', 'status', 'message', 'orderlineentries']);
const AMOUNT_HINT = /(amount|amt|price|value|total|mrp|discount|payable|charge|taxable)/i;
const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// ---------- Tax-invoice document ----------

function InvoiceDoc({ lines, customer, address }: { lines: any[]; customer?: string; address?: string }) {
  const first = lines[0] || {};
  const invNo = first.invoiceNumber || '—';
  const invDate = first.invoiceDate || '';
  const warehouse = first.warehouse || '';

  const taxByType: Record<string, number> = {};
  let sumTaxable = 0;
  let sumTax = 0;
  const rows = lines.map((l) => {
    const taxes: any[] = Array.isArray(l.taxEntries) ? l.taxEntries : [];
    const taxable = num(taxes[0]?.unitTaxableAmount ?? l.unitSalePriceWithoutTax);
    const lineTax = taxes.reduce((s, t) => s + num(t.unitTaxAmount), 0);
    taxes.forEach((t) => { const k = String(t.taxType || 'TAX').toUpperCase(); taxByType[k] = (taxByType[k] || 0) + num(t.unitTaxAmount); });
    sumTaxable += taxable; sumTax += lineTax;
    return { sku: l.sku, mrp: l.mrp, finalAmount: l.finalAmount, taxable, taxes, amount: taxable + lineTax };
  });
  const grand = sumTaxable + sumTax;

  return (
    <div className="rounded-xl border border-black/[0.1] bg-white overflow-hidden">
      {/* Invoice header */}
      <div className="px-4 py-3.5 bg-gradient-to-r from-zinc-50 to-white border-b border-black/[0.08] flex items-start justify-between gap-4">
        <div>
          <div className="text-[14px] font-bold tracking-wide text-zinc-900">TAX INVOICE</div>
          <div className="text-[11px] text-zinc-500 mt-0.5">EXPERIENCES.DIGITAL PRIVATE LIMITED</div>
        </div>
        <div className="text-right">
          <div className="text-[9px] uppercase tracking-wider text-zinc-400 font-semibold">Invoice no</div>
          <div className="text-[12px] font-mono font-semibold text-zinc-800">{invNo}</div>
          {invDate && <div className="text-[11px] text-zinc-500 mt-0.5">{invDate}</div>}
        </div>
      </div>

      {/* Parties */}
      <div className="grid grid-cols-2 gap-4 px-4 py-3 text-[11px] border-b border-black/[0.06]">
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-wider text-zinc-400 font-semibold mb-1">Sold by</div>
          <div className="text-zinc-800 font-medium">EXPERIENCES.DIGITAL PRIVATE LIMITED</div>
          {warehouse && <div className="text-zinc-500">Warehouse {warehouse}</div>}
        </div>
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-wider text-zinc-400 font-semibold mb-1">Bill to</div>
          <div className="text-zinc-800 font-medium">{customer || '—'}</div>
          {address && <div className="text-zinc-500 leading-snug">{address}</div>}
        </div>
      </div>

      {/* Line items */}
      <table className="w-full text-[11px]">
        <thead className="bg-zinc-50 text-[9px] uppercase text-zinc-500">
          <tr>
            <th className="px-3 py-2 text-left">Item</th>
            <th className="px-3 py-2 text-right whitespace-nowrap">Taxable value</th>
            <th className="px-3 py-2 text-left">Tax</th>
            <th className="px-3 py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.map((r, i) => (
            <tr key={i} className="align-top">
              <td className="px-3 py-2.5">
                <div className="font-semibold text-zinc-800">{r.sku || '—'}</div>
                {r.mrp != null && <div className="text-[10px] text-zinc-400">MRP {formatINR(r.mrp)}{r.finalAmount != null ? ` · customer paid ${formatINR(r.finalAmount)}` : ''}</div>}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-zinc-700">{formatINR(r.taxable)}</td>
              <td className="px-3 py-2.5 text-zinc-600">
                {r.taxes.length
                  ? r.taxes.map((t: any, j: number) => <div key={j} className="whitespace-nowrap">{t.taxType} {t.taxRate}% · {formatINR(num(t.unitTaxAmount))}</div>)
                  : '—'}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-zinc-900">{formatINR(r.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <div className="border-t border-black/[0.08] px-4 py-3 flex justify-end">
        <div className="w-full sm:w-64 text-[11px] space-y-1.5">
          <div className="flex justify-between"><span className="text-zinc-500">Taxable value</span><span className="tabular-nums text-zinc-700">{formatINR(sumTaxable)}</span></div>
          {Object.entries(taxByType).map(([k, v]) => (
            <div key={k} className="flex justify-between"><span className="text-zinc-500">{k}</span><span className="tabular-nums text-zinc-700">{formatINR(v)}</span></div>
          ))}
          <div className="flex justify-between border-t border-black/[0.12] pt-2 mt-1 text-[14px] font-bold text-zinc-900"><span>Invoice total</span><span className="tabular-nums">{formatINR(grand)}</span></div>
        </div>
      </div>
    </div>
  );
}

// ---------- Generic fallback (non-invoice payloads) ----------

function humanize(k: string): string {
  return k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase());
}
const isNumeric = (v: any) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)));
function fmtValue(key: string, v: any): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (AMOUNT_HINT.test(key) && !/taxtype|taxrate/i.test(key) && isNumeric(v)) return formatINR(Number(v));
  return String(v);
}
const visibleEntries = (obj: any): [string, any][] => Object.entries(obj || {}).filter(([k]) => !ENVELOPE.has(k.toLowerCase()));
const flattenObject = (obj: any): string => visibleEntries(obj).map(([k, v]) => `${humanize(k)} ${fmtValue(k, v)}`).join(' · ');

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

function GenericObject({ data }: { data: any }) {
  const scalars: Record<string, any> = {};
  const nested: [string, any][] = [];
  for (const [k, v] of visibleEntries(data)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) nested.push([k, v]);
    else if (Array.isArray(v)) scalars[k] = v.length && typeof v[0] === 'object' ? v.map(flattenObject).join(' | ') : v.join(', ');
    else scalars[k] = v;
  }
  return (
    <div className="space-y-3">
      <ScalarGrid obj={scalars} />
      {nested.map(([k, v]) => (
        <div key={k}><div className="text-[10px] font-semibold text-zinc-500 mb-1">{humanize(k)}</div><ScalarGrid obj={v} /></div>
      ))}
    </div>
  );
}

export default function InvoiceDetails({ data, customer, address }: { data: any; customer?: string; address?: string }) {
  if (!data || typeof data !== 'object') return null;
  const lines: any[] = Array.isArray(data.orderLineEntries) ? data.orderLineEntries : [];
  if (lines.length) return <InvoiceDoc lines={lines} customer={customer} address={address} />;
  return <GenericObject data={data} />;
}
