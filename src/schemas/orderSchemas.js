const { z } = require('zod');

// Myntra's OUTBOUND "Create Order" push is a trusted, authenticated webhook. Its real
// payload sends many fields as null (warehouse, quantity, acceptByTime, customerPromiseTime,
// etc.) — see Myntra's own example. We must ACCEPT it, so every non-essential field is
// nullish (accepts null OR missing). Only orderLineId is structurally required.
const nstr = z.string().nullish();
const orderLineEntrySchema = z
  .object({
    orderLineId: z.union([z.string().min(1), z.number()]),
    sku: nstr,
    quantity: z.number().int().nullish(),
    price: z.number().nullish(),
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
      sellerOrderId: nstr,
      receiverName: nstr,
      mobile: nstr,
      address: nstr,
      city: nstr,
      state: nstr,
      zipcode: nstr,
      warehouse: nstr,
      paymentMethod: nstr,
      orderLineEntries: z.array(orderLineEntrySchema).min(1),
      priority: z.boolean().nullish(),
      acceptByTime: nstr,
      shipByTime: nstr,
      customerPromiseTime: nstr,
      status: nstr,
      eventName: nstr,
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
