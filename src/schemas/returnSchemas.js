const { z } = require('zod');

const returnTypeEnum = z.enum(['COURIER_RETURN', 'CUSTOMER_RETURN']);

const createReturnSchema = z.object({
  params: z
    .object({
      id: z.string().min(1),
    })
    .passthrough(),
  body: z
    .object({
      id: z.string().min(1),
      type: returnTypeEnum,
      status: z.string().min(1),
      sellerOrderId: z.string().min(1),
      orderLineId: z.union([z.string().min(1), z.number()]),
      createdOn: z.string().min(1),
      reason: z.string().min(1),
      returnWarehouseCode: z.string().min(1),
    })
    .passthrough(),
  query: z.object({}).passthrough(),
  headers: z.object({}).passthrough(),
});

const updateReturnSchema = z.object({
  params: z
    .object({
      returnId: z.string().min(1),
    })
    .passthrough(),
  body: z
    .object({
      id: z.string().min(1),
      type: returnTypeEnum,
      status: z.enum(['DELIVERED', 'CANCELLED', 'READY_FOR_PICKUP', 'DECLINED', 'RECEIVED', 'CLOSED', 'REFUNDED']),
      sellerOrderId: z.string().min(1),
      orderLineId: z.union([z.string().min(1), z.number()]),
      createdOn: z.string().min(1),
      reason: z.string().min(1),
      returnWarehouseCode: z.string().min(1),
    })
    .passthrough(),
  query: z.object({}).passthrough(),
  headers: z.object({}).passthrough(),
});

module.exports = {
  createReturnSchema,
  updateReturnSchema,
};
