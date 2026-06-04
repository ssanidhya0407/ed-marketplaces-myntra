# Myntra Seller API V4 Integration Guide

## Overview

This document explains the core Myntra Seller APIs required for OMS integration.

Implementation Order:

1. Authentication
2. Order Search
3. Order Details
4. Shipping Label Download
5. Inventory Update
6. Inventory Search
7. Order Status Updates (RTS / RTD)

---

# 1. Authentication

All Myntra APIs require an `access_token`.

## Generate Access Token

### Endpoint

```http
POST https://api-integration.myntra.com/authorization/generate_token
```

### Headers

```http
secret_key: <SECRET_KEY>
```

### Body

```json
{
  "merchant_id": "YOUR_MERCHANT_ID"
}
```

### Response

```json
{
  "access_token": "...",
  "refresh_token": "..."
}
```

Store:

* access_token
* refresh_token
* expiry timestamp

---

## Refresh Token

### Endpoint

```http
POST https://api-integration.myntra.com/authorization/refresh_token
```

### Headers

```http
refresh_token: <REFRESH_TOKEN>
x-partner-store: MYNTRA
```

### Body

```json
{
  "merchant_id": "YOUR_MERCHANT_ID"
}
```

---

# Common Headers

Most APIs require:

```http
Authorization: access_token
Content-Type: application/json
x-partner-store: MYNTRA
```

Example:

```http
access_token: eyJ...
Content-Type: application/json
x-partner-store: MYNTRA
```

---

# 2. Orders

Orders are fetched using the Order Search API and then enriched using Get Order APIs.

---

## Order Search

Fetch orders within a date range.

### Endpoint

```http
GET /partner/v4/order/getOrderList
```

### Query Parameters

| Parameter  | Description  |
| ---------- | ------------ |
| page       | Pagination   |
| statusCode | Order status |
| startDate  | Start date   |
| endDate    | End date     |

### Example

```http
GET /partner/v4/order/getOrderList?page=0&statusCode=RFR&startDate=2025-05-01&endDate=2025-05-31
```

### Common Status Values

```text
RFR
WP
IC
PK
SH
DL
```

### OMS Flow

Run every 5–15 minutes:

```text
1. Fetch orders
2. Save sellerOrderId
3. Save packetId
4. Create local order
5. Sync order lines
```

---

## Get Order By Seller Order Id

### Endpoint

```http
GET /partner/v4/order/{sellerOrderId}
```

### Example

```http
GET /partner/v4/order/MYN123456
```

### Use Case

Fetch complete details for a specific order.

Useful for:

* Order Details Page
* Order Refresh
* Retry Failed Sync

---

## Get Order By Packet Id

### Endpoint

```http
GET /partner/v4/packet/{packetId}
```

### Example

```http
GET /partner/v4/packet/4000000011889
```

### Use Case

Used after packing and shipping stages.

---

# 3. Shipping Label

After order confirmation, download shipping labels.

## Download Shipping Label

### Endpoint

```http
GET /partner/v4/packet/{packetId}/shippingLabel
```

### Response

```http
application/pdf
```

### OMS Usage

```text
Order Details
      ↓
Download Label
      ↓
Store PDF in S3
      ↓
Print Label
```

Suggested DB Fields:

```sql
shipping_label_url
shipping_label_downloaded
```

---

# 4. Inventory

Inventory sync is one of the most critical integrations.

---

## Update Inventory

### Endpoint

```http
PUT /partner/v4/inventory/update
```

### Request

```json
{
  "inventoryCount": 25,
  "sku": "SKU123",
  "processingSla": 2,
  "storeCode": "MF"
}
```

### Fields

| Field          | Description       |
| -------------- | ----------------- |
| inventoryCount | Available stock   |
| sku            | Seller SKU        |
| processingSla  | Dispatch SLA days |
| storeCode      | Warehouse code    |

### OMS Trigger

Whenever:

```text
Order placed
Order cancelled
Inventory adjusted
Stock imported
```

---

## Async Inventory Update

For bulk inventory updates.

### Endpoint

```http
PUT /partner/v4/inventory/async/update
```

Use for:

```text
Catalog Sync
Bulk Upload
Nightly Inventory Sync
```

---

## Search Inventory

Retrieve inventory from Myntra.

### Endpoint

```http
POST /partner/v4/inventory/search
```

### Request

```json
{
  "list": [
    "SKU123",
    "SKU456"
  ]
}
```

### Use Case

Inventory reconciliation.

OMS Process:

```text
Local Stock
     ↓
Fetch Myntra Stock
     ↓
Compare
     ↓
Update Differences
```

---

# 5. Order Fulfillment APIs

---

## Accept / Reject Order

### Endpoint

```http
PUT /partner/v4/order/{sellerOrderId}/{eventType}
```

### Event Types

```text
accept
reject
```

### Example

```http
PUT /partner/v4/order/ORD123/accept
```

---

## Ready To Ship (RTS)

Marks shipment ready for pickup.

### Endpoint

```http
PUT /partner/v4/trackingNumber/{trackingNo}/readyToShip
```

### Workflow

```text
Order Accepted
      ↓
Packed
      ↓
RTS
```

---

## Ready To Dispatch (RTD)

### Endpoint

```http
PUT /partner/v4/order/readyToDispatch
```

### Required Data

```json
{
  "warehouse": "WH01",
  "orderLineEntries": [
    {
      "sellerOrderId": "ORD123",
      "orderLineId": "LINE001",
      "invoiceNumber": "INV001",
      "invoiceDate": "2025-05-01"
    }
  ]
}
```

### Workflow

```text
Order Received
      ↓
Accept
      ↓
Pack
      ↓
Generate Invoice
      ↓
RTD
      ↓
Courier Pickup
```

---

# Recommended OMS Sync Schedule

## Every 5 Minutes

```text
Order Search
Get Order By Id
```

## Real-Time

```text
Inventory Update
```

## On Demand

```text
Download Label
Download Invoice
```

## Fulfillment Events

```text
Accept Order
Reject Order
RTS
RTD
```

---

# Minimum APIs Required For Production OMS

Priority 1:

```text
Generate Token
Refresh Token
Order Search
Get Order By Seller Order Id
Download Shipping Label
Update Inventory
Search Inventory
```

Priority 2:

```text
Accept Order
Reject Order
Ready To Ship
Ready To Dispatch
Download Invoice
```

Priority 3:

```text
Returns
Payments
Credit Notes
Store Status
OTP
Discount APIs
```
