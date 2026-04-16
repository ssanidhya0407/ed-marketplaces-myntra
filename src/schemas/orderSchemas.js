const { z } = require('zod');

const orderLineEntrySchema = z
  .object({
    orderLineId: z.union([z.string().min(1), z.number()]),
    sku: z.string().min(1),
    quantity: z.number().int().positive(),
    price: z.number().nonnegative().optional(),
  })
  .passthrough();

const createOrderSchema = z.object({
  params: z
    .object({
      sellerOrderId: z.string().min(1),
    })
    .passthrough(),
  body: z
    .object({
      sellerOrderId: z.string().min(1).optional(),
      receiverName: z.string().min(1),
      mobile: z.string().min(8),
      address: z.string().min(5),
      city: z.string().min(1),
      state: z.string().min(1),
      zipcode: z.string().min(3),
      warehouse: z.string().min(1),
      paymentMethod: z.enum(['on', 'cod']),
      orderLineEntries: z.array(orderLineEntrySchema).min(1),
      priority: z.boolean().optional(),
      acceptByTime: z.string().optional(),
      shipByTime: z.string().optional(),
      customerPromiseTime: z.string().optional(),
    })
    .passthrough(),
  query: z.object({}).passthrough(),
  headers: z.object({}).passthrough(),
});

const getOrderSchema = z.object({
  params: z
    .object({
      sellerOrderId: z.string().min(1),
    })
    .strict(),
  body: z.object({}).passthrough(),
  query: z.object({}).passthrough(),
  headers: z.object({}).passthrough(),
});

const allowedEventTypes = [
  'accept',
  'reject',
  'pack',
  'readyToDispatch',
  'shipped',
  'delivered',
  'lost',
  'onhold',
  'unhold',
  'itemCancellation',
  'cancelItems',
];

const updateOrderSchema = z.object({
  params: z
    .object({
      sellerOrderId: z.string().min(1),
      eventType: z.enum(allowedEventTypes),
    })
    .strict(),
  body: z
    .object({
      warehouse: z.string().min(1).optional(),
      trackingNumber: z.union([z.string().min(1), z.number()]).optional(),
      courier: z.string().min(1).optional(),
      eventTime: z.string().optional(),
      orderLineEntries: z
        .array(
          z
            .object({
              orderLineId: z.union([z.string().min(1), z.number()]),
              rejectionReasonId: z.number().int().positive().optional(),
              comment: z.string().max(500).optional(),
            })
            .passthrough(),
        )
        .optional(),
    })
    .passthrough(),
  query: z.object({}).passthrough(),
  headers: z.object({}).passthrough(),
});

module.exports = {
  createOrderSchema,
  getOrderSchema,
  updateOrderSchema,
  allowedEventTypes,
};
