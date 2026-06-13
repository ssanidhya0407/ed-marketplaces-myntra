// Client for the Express OMS backend (proxied via next.config rewrites) — live Myntra only.
export interface OrderLineSummary { orderLineId: number | string; sellerOrderId: string; status?: string | null }
export interface OrderSummary { orderId: number | string; orderLines: OrderLineSummary[] }
export interface ListResponse {
  ok: boolean; page: number; totalCount: number | null; pages: number | null;
  statusMessage?: string | null; error?: string; orders: OrderSummary[];
}

const KEY = typeof window !== 'undefined' ? new URLSearchParams(location.search).get('key') : null;
const withKey = (url: string) => (KEY ? url + (url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(KEY) : url);

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(withKey(url));
  const data = await res.json().catch(() => ({}));
  return { httpStatus: res.status, ...data } as T;
}

export const api = {
  listOrders(params: { page?: number; statusCode?: string; startDate?: string; endDate?: string } = {}): Promise<ListResponse> {
    const { page = 0, statusCode, startDate, endDate } = params;
    let url = `/orders/api/list?page=${page}`;
    if (statusCode) url += `&statusCode=${encodeURIComponent(statusCode)}`;
    if (startDate && endDate) url += `&startDate=${startDate}&endDate=${endDate}`;
    return getJson<ListResponse>(url);
  },
  orderDetail(sellerOrderId: string, source: 'live' | 'inbox' = 'live'): Promise<{ ok: boolean; detail: any; error?: string }> {
    const base = source === 'inbox' ? '/orders/api/inbox/detail' : '/orders/api/detail';
    return getJson(`${base}/${encodeURIComponent(sellerOrderId)}`);
  },
  // Inbox = orders/returns Myntra pushed to our webhook (local store), shown in real time.
  inboxList(params: { statusCode?: string } = {}): Promise<ListResponse> {
    let url = '/orders/api/inbox/list';
    if (params.statusCode) url += `?statusCode=${encodeURIComponent(params.statusCode)}`;
    return getJson<ListResponse>(url);
  },
  inboxReturns(): Promise<{ ok: boolean; totalCount: number; returns: any[] }> {
    return getJson('/orders/api/inbox/returns');
  },
  inboxReturnDetail(id: string): Promise<{ ok: boolean; return: any; error?: string }> {
    return getJson(`/orders/api/inbox/return/${encodeURIComponent(id)}`);
  },
  // Live return detail from Myntra (Returns Recon by id).
  returnDetails(id: string): Promise<{ ok: boolean; httpStatus: number; statusCode: number | null; message: string | null; detail: any; error?: string }> {
    return getJson(`/orders/api/return-details/${encodeURIComponent(id)}`);
  },
  statusLabels() { return getJson('/orders/api/status-labels'); },
  labelUrl(packetId: string, source: 'live' | 'inbox' = 'live') {
    const base = source === 'inbox' ? '/orders/api/inbox/label' : '/orders/api/label';
    return withKey(`${base}/${encodeURIComponent(packetId)}`);
  },
  invoiceUrl(packetId: string, source: 'live' | 'inbox' = 'live') {
    const base = source === 'inbox' ? '/orders/api/inbox/invoice' : '/orders/api/invoice';
    return withKey(`${base}/${encodeURIComponent(packetId)}`);
  },
  // Invoice details as JSON (live Myntra only). 2050 until the packet is RTD'd.
  invoiceDetails(packetId: string): Promise<{ ok: boolean; httpStatus: number; statusCode: number | null; message: string | null; details: any; error?: string }> {
    return getJson(`/orders/api/invoice-details/${encodeURIComponent(packetId)}`);
  },
  async action(sellerOrderId: string, body: Record<string, unknown>): Promise<any> {
    const res = await fetch(withKey(`/orders/api/action/${encodeURIComponent(sellerOrderId)}`), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { httpStatus: res.status, ...data };
  },
  async updateInventory(items: Array<{ sku: string; quantity: number | string; processingSla?: number | string; store_code: string }>): Promise<{ ok: boolean; submitted?: number; succeeded?: number; failed?: any[]; chunkErrors?: any[]; error?: string; httpStatus: number }> {
    const res = await fetch(withKey('/orders/api/inventory/update'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }),
    });
    const data = await res.json().catch(() => ({}));
    return { httpStatus: res.status, ...data };
  },
};
