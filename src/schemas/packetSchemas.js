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

// Packet-level events Myntra pushes after RTD: shipped / delivered / lost.
const updatePacketSchema = z.object({
  params: z
    .object({
      packetId: z.string().min(1),
      eventType: z.string().min(1),
    })
    .passthrough(),
  body: z.object({}).passthrough(),
  query: z.object({}).passthrough(),
  headers: z.object({}).passthrough(),
});

module.exports = {
  downloadInvoiceSchema,
  getPacketSchema,
  updatePacketSchema,
};
