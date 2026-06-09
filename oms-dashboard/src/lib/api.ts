// Client for the Express OMS backend (proxied via next.config rewrites).
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
  orderDetail(sellerOrderId: string): Promise<{ ok: boolean; detail: any; error?: string }> {
    return getJson(`/orders/api/detail/${encodeURIComponent(sellerOrderId)}`);
  },
  labelUrl: (packetId: string) => withKey(`/orders/api/label/${encodeURIComponent(packetId)}`),
  invoiceUrl: (packetId: string) => withKey(`/orders/api/invoice/${encodeURIComponent(packetId)}`),
  async action(sellerOrderId: string, body: Record<string, unknown>): Promise<any> {
    const res = await fetch(withKey(`/orders/api/action/${encodeURIComponent(sellerOrderId)}`), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { httpStatus: res.status, ...data };
  },
};
