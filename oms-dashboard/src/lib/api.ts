// Client for the Express OMS backend (proxied via next.config rewrites) — live Myntra only.
export interface OrderLineSummary { orderLineId: number | string; sellerOrderId: string; status?: string | null }
export interface OrderSummary { orderId: number | string; orderLines: OrderLineSummary[] }
export interface ListResponse {
  ok: boolean; page: number; totalCount: number | null; pages: number | null;
  statusMessage?: string | null; error?: string; orders: OrderSummary[];
}

// ── 360° Sales Report ──
export interface SkuRow {
  sku: string; category: string; rank: number; units: number; orders: number;
  revenue: number; tax: number; settlement: number; avgPrice: number; contributionPct: number;
  cancelledUnits: number; returnedUnits: number; returnRate: number;
  currentStock: number | null; velocity: number; daysOfInventory: number | null; sellThrough: number | null;
  movement: 'fast' | 'slow' | 'medium';
}
export interface CategoryRow {
  category: string; skus: number; units: number; revenue: number;
  contributionPct: number; returnedUnits: number; returnRate: number; currentStock: number;
}
export interface RegionRow { region: string; orders: number; units: number; revenue: number }
export interface PaymentRow { method: string; orders: number; revenue: number }
export interface StatusRow { status: string; orders: number; units: number; revenue: number }
export interface SeriesPoint { key: string; revenue: number; orders: number; units: number; growthPct?: number | null }
export interface ReturnRow {
  id: string; sellerOrderId: string | null; sku: string | null; category: string | null;
  value: number; type: string | null; reason: string | null; status: string | null; createdOn: string | null;
}
export interface OrderRow {
  sellerOrderId: string; date: string | null; status: string; region: string;
  city: string | null; payment: string; units: number; gross: number; net: number; skus: string;
}
export interface ReportSummary {
  grossSales: number; netSales: number; cancelledValue: number; returnValue: number; taxCollected: number; sellerSettlement: number;
  ordersCount: number; unitsSold: number; aov: number; itemsPerOrder: number;
  cancelledOrders: number; cancelRate: number; returnCount: number; returnedUnits: number; returnRate: number;
  postDeliveryReturns: number; postDeliveryReturnValue: number; postDeliveryReturnRate: number;
  totalCurrentStock: number | null; outOfStockCount: number | null; sellThroughRate: number | null;
  inventoryTurnover: number | null; revenueGrowthPct: number | null; skuCount: number;
}
export interface SalesReport {
  ok: boolean; cached?: boolean; error?: string;
  generatedAt: string;
  window: { from: string | null; to: string | null; days: number; hasDates: boolean };
  summary: ReportSummary;
  byStatus: StatusRow[]; bySku: SkuRow[]; byCategory: CategoryRow[]; byRegion: RegionRow[]; byPayment: PaymentRow[];
  revenueByDay: SeriesPoint[]; revenueByWeek: SeriesPoint[]; revenueByMonth: SeriesPoint[];
  topSkus: SkuRow[]; bottomSkus: SkuRow[]; fastMoving: SkuRow[]; slowMoving: SkuRow[]; outOfStock: SkuRow[];
  returns: ReturnRow[]; orders: OrderRow[]; notes: string[];
}

// ── Catalog Stock: Amazon∪Flipkart SKUs probed against Myntra inventory ──
export interface CatalogStockItem {
  sku: string; sources: string[]; onMyntra: boolean;
  total: number | null; active: number | null; other: number | null;
  blocked: boolean; error: boolean;
}
export interface CatalogStockSummary {
  totalSkus: number; amazon: number; flipkart: number; both: number;
  onMyntra: number; inStock: number; outOfStock: number; notOnMyntra: number;
  blocked: number; totalUnits: number;
}
export interface CatalogStockResponse {
  status: 'running' | 'done' | 'error';
  done?: number; total?: number; error?: string;
  generatedAt?: string; summary?: CatalogStockSummary; items?: CatalogStockItem[];
}

// ── Payments: payouts + settlement reports ──
export interface PaymentRecord {
  paymentMethod: string; utrNumber: string; paymentDate: string;
  yearMonth: number; amount: number; utrDetailsLink?: string; adviceId?: string;
}
export interface PaymentHistoryResponse {
  ok: boolean; error?: string;
  payments?: PaymentRecord[];
  summary?: { totalAmount: number; prepaidAmount: number; postpaidAmount: number; count: number };
}
export interface PaymentReportResponse {
  ok: boolean; httpStatus: number; error?: string;
  found?: boolean; message?: string;
  reportName?: string; reportPath?: string;
  columns?: string[]; rows?: string[][]; rowCount?: number; truncated?: boolean;
}
export interface ReconOrder {
  orderId: string; storeOrderId: string; type: string; paymentType: string; date: string; utr: string;
  customerPaid: number; settled: number; deductions: number; takeRate: number; gst: number;
  commission: number; logistics: number; fees: number; tds: number; marketing: number; other: number;
}
export interface ReconSummary {
  ordersSettled: number; grossCustomerPaid: number; netSettled: number; totalDeductions: number;
  gst: number; effectiveTakeRate: number;
  breakdown: { commission: number; logistics: number; fees: number; tds: number; marketing: number; other: number };
}
export interface ReconResponse {
  ok: boolean; error?: string;
  summary?: ReconSummary; settled?: ReconOrder[];
  pending?: { orderCode: string; amount: number; month: string }[]; pendingAmount?: number;
  notes?: { detailErrors: number; salesReportMonths: number };
}

// ── Financials: full monthly settlement statement ──
export interface FinOrder {
  orderId: string; sellerOrderId: string; sku: string; sellerSku: string; article: string; brand: string; category: string;
  customerPaid: number; sellerAmount: number; commission: number; commissionBase: number; logistics: number;
  shippingFee: number; fixedFee: number; pickPackFee: number; pgFee: number; platformFees: number; marketing: number;
  tcs: number; tds: number; igst: number; cgst: number; sgst: number; gst: number; taxable: number;
  netSettled: number; pending: number; deliveredDate: string;
  packetId: string; invoiceNumber: string; settlementUtr: string; settlementDate: string;
  cogs: number; profit: number; margin: number;
}
export interface FinReturn { orderId: string; sellerOrderId: string; sku: string; sellerSku: string; article: string; returnType: string; returnDate: string; reverseAmount: number; commission: number; logistics: number }
export interface FinNonOrder { type: string; amount: number; description: string; utr: string; date: string }
export interface FinArticle { article: string; units: number; sales: number; netSettled: number; deductions: number; takeRate: number }
export interface FinSku { sku: string; vendorSku: string; article: string; units: number; sales: number; netSettled: number; deductions: number; cogs: number; profit: number; returns: number; returnUnits: number; takeRate: number; margin: number; returnRate: number }
export interface FinFee { key: string; label: string; amount: number; sub?: boolean }
export interface FinDaily { date: string; sales: number; deductions: number; net: number; returns: number }
export interface FinSettlement { utr: string; date: string; orders: number; netSettled: number }
export interface FinInsight { tone: 'info' | 'warning' | 'critical'; title: string; detail: string }
export interface FinancialsResponse {
  ok: boolean; error?: string; year?: string; month?: string;
  found?: { forward: boolean; reverse: boolean; nonOrder: boolean };
  summary?: {
    grossCustomerPaid: number; sellerValue: number; netForward: number; pending: number;
    returns: number; nonOrder: number; netReceivable: number; totalDeductions: number;
    takeRate: number; orderCount: number; returnCount: number; gst: number; taxable: number;
    cogs: number; cogsKnown: boolean; grossProfit: number; marginPct: number;
  };
  deductions?: { commission: number; logistics: number; platformFees: number; marketing: number; tcs: number; tds: number };
  gstBreakdown?: { igst: number; cgst: number; sgst: number; tcs: number };
  feeBreakdown?: FinFee[];
  lifecycle?: { settledCount: number; pendingCount: number; settledAmount: number; pendingAmount: number; settledRate: number };
  daily?: FinDaily[]; settlements?: FinSettlement[]; insights?: FinInsight[];
  byArticle?: FinArticle[]; bySku?: FinSku[]; orders?: FinOrder[]; returns?: FinReturn[]; nonOrder?: FinNonOrder[];
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
  stats(): Promise<{ ok: boolean; total: number; byStatus: Record<string, number>; completed: number; inboxOrders: number; returns: number; error?: string }> {
    return getJson('/orders/api/stats');
  },
  report(refresh = false): Promise<SalesReport> {
    return getJson('/orders/api/report' + (refresh ? '?refresh=1' : ''));
  },
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
  async searchInventory(skus: string[]): Promise<{ ok: boolean; inventory?: Record<string, Array<{ store_code: string; count: number }>>; failed?: string[]; blocked?: string[]; error?: string; httpStatus: number }> {
    const res = await fetch(withKey('/orders/api/inventory/search'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skus }),
    });
    const data = await res.json().catch(() => ({}));
    return { httpStatus: res.status, ...data };
  },
  listSkus(): Promise<{ ok: boolean; skus?: string[]; error?: string }> {
    return getJson('/orders/api/skus');
  },
  catalogStock(refresh = false): Promise<CatalogStockResponse> {
    return getJson('/orders/api/catalog-stock' + (refresh ? '?refresh=1' : ''));
  },
  paymentHistory(params: { fromDate: string; toDate: string; method?: 'ALL' | 'POSTPAID' | 'PREPAID' }): Promise<PaymentHistoryResponse> {
    const { fromDate, toDate, method = 'ALL' } = params;
    return getJson(`/orders/api/payments/history?fromDate=${fromDate}&toDate=${toDate}&method=${method}`);
  },
  async paymentReport(body: { reportType: string; year: string; month?: string; reportName: string }): Promise<PaymentReportResponse> {
    const res = await fetch(withKey('/orders/api/payments/report'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { httpStatus: res.status, ...data } as PaymentReportResponse;
  },
  reconciliation(fromDate: string, toDate: string): Promise<ReconResponse> {
    return getJson(`/orders/api/payments/reconciliation?fromDate=${fromDate}&toDate=${toDate}`);
  },
  financials(year: string, month: string): Promise<FinancialsResponse> {
    return getJson(`/orders/api/financials?year=${year}&month=${month}`);
  },
  getCogs(): Promise<{ ok: boolean; cogs?: Record<string, number> }> {
    return getJson('/orders/api/financials/cogs');
  },
  financialsMonths(): Promise<{ ok: boolean; months?: string[] }> {
    return getJson('/orders/api/financials/months');
  },
  awaitingSettlement(): Promise<{ ok: boolean; error?: string; count?: number; shown?: number; totalValue?: number; settledOrders?: number; completed?: number; firstUnsettled?: string | null; finalizedThrough?: string | null; byMonth?: Record<string, { total: number; settled: number; awaiting: number; awaitingValue: number }>; awaiting?: { sellerOrderId: string; orderId: string; sku: string; value: number; status: string; invoiceDate: string | null }[] }> {
    return getJson('/orders/api/financials/awaiting');
  },
  async syncAlyaCogs(): Promise<{ ok: boolean; synced?: number; count?: number; error?: string }> {
    const res = await fetch(withKey('/orders/api/financials/cogs/sync-alya'), { method: 'POST' });
    return (await res.json().catch(() => ({}))) as any;
  },
  async saveCogs(items: { sku: string; cost: number }[]): Promise<{ ok: boolean; updated?: number; count?: number; error?: string }> {
    const res = await fetch(withKey('/orders/api/financials/cogs'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }),
    });
    return (await res.json().catch(() => ({}))) as any;
  },
  async overrideDiscount(payload: { startDate: string; endDate: string; discountType: string; items: Array<{ sku: string; discount: number | string }> }): Promise<{ ok: boolean; submitted?: number; succeeded?: number; results?: any[]; chunkErrors?: any[]; error?: string; httpStatus: number }> {
    const res = await fetch(withKey('/orders/api/discount/override'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    return { httpStatus: res.status, ...data };
  },
};
