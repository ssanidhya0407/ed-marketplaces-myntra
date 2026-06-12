const { z } = require('zod');

// Myntra's OUTBOUND return webhooks (Create Return RTO / Customer Return / Update Return)
// are trusted, authenticated pushes whose payloads carry many null fields and values
// outside fixed enums. We accept them permissively — only the path id is required.
const nstr = z.string().nullish();
const nnum = z.union([z.string(), z.number()]).nullish();

const createReturnSchema = z.object({
  params: z.object({ id: z.string().min(1) }).passthrough(),
  body: z
    .object({
      id: nstr,
      type: nstr,
      status: nstr,
      sellerOrderId: nstr,
      orderId: nstr,
      orderLineId: nnum,
      createdOn: nstr,
      reason: nstr,
      returnWarehouseCode: nstr,
      returnReferenceId: nstr,
      trackingNumber: nnum,
    })
    .passthrough(),
  query: z.object({}).passthrough(),
  headers: z.object({}).passthrough(),
});

const updateReturnSchema = z.object({
  params: z.object({ returnId: z.string().min(1) }).passthrough(),
  body: z
    .object({
      id: nstr,
      type: nstr,
      status: nstr,
      sellerOrderId: nstr,
      orderLineId: nnum,
      reason: nstr,
      returnWarehouseCode: nstr,
    })
    .passthrough(),
  query: z.object({}).passthrough(),
  headers: z.object({}).passthrough(),
});

module.exports = {
  createReturnSchema,
  updateReturnSchema,
};
