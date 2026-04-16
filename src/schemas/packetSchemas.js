const { z } = require('zod');

const downloadInvoiceSchema = z.object({
  params: z
    .object({
      packetId: z.string().min(1),
    })
    .strict(),
  body: z.object({}).passthrough(),
  query: z.object({}).passthrough(),
  headers: z.object({}).passthrough(),
});

const getPacketSchema = z.object({
  params: z
    .object({
      packetId: z.string().min(1),
    })
    .strict(),
  body: z.object({}).passthrough(),
  query: z.object({}).passthrough(),
  headers: z.object({}).passthrough(),
});

module.exports = {
  downloadInvoiceSchema,
  getPacketSchema,
};
