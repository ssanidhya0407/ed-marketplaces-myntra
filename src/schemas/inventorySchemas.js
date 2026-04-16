const { z } = require('zod');

const failureInventorySchema = z.object({
  params: z.object({}).passthrough(),
  body: z
    .union([
      z
        .object({
          url: z.string().url().optional(),
          headers: z.record(z.string(), z.string()).optional(),
          method: z.string().min(3).max(10).optional(),
          failures: z
            .array(
              z
                .object({
                  sku: z.string().min(1),
                  storeCode: z.string().min(1),
                  reason: z.string().min(1),
                })
                .passthrough(),
            )
            .min(1),
        })
        .passthrough(),
      z
        .object({
          failures: z
            .array(
              z
                .object({
                  sku: z.string().min(1),
                  storeCode: z.string().min(1),
                  reason: z.string().min(1),
                })
                .passthrough(),
            )
            .min(1),
        })
        .passthrough(),
    ])
    .refine((val) => Array.isArray(val.failures) && val.failures.length > 0, {
      message: 'failures must contain at least one item',
    }),
  query: z.object({}).passthrough(),
  headers: z.object({}).passthrough(),
});

module.exports = {
  failureInventorySchema,
};
