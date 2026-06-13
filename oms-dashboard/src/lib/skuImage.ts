// Product images by seller SKU, sourced from the catalog DB (Amazon CDN URLs).
// Lets the OMS show a thumbnail per SKU even though Myntra's order payloads don't
// carry images. Lookup is exact-first, then case/punctuation-insensitive.
import imagesRaw from '@/data/skuImages.json';

const images = imagesRaw as Record<string, string>;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const normIndex: Record<string, string> = {};
for (const [sku, url] of Object.entries(images)) {
  const k = norm(sku);
  if (!(k in normIndex)) normIndex[k] = url;
}

export function skuImage(sku?: string | null): string | null {
  if (!sku) return null;
  const s = String(sku).trim();
  return images[s] || normIndex[norm(s)] || null;
}
