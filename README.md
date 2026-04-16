# Myntra Seller API V4 Outbound Backend (Node.js/Express)

Production-style webhook backend for Myntra OMS outbound APIs with:
- strict Zod validation
- auth middleware (`access_token`)
- centralized Myntra error mapping
- idempotency + retry-safe replay
- request/response logging
- rate limiting
- persistent local datastore (`data/persistent-store.json`)

## Folder Structure

```text
ed_marketplaces/
  src/
    app.js
    server.js
    config/
      env.js
    constants/
      myntraCodes.js
    controllers/
      orderController.js
      inventoryController.js
      returnController.js
    db/
      mockDb.js
    errors/
      AppError.js
    middleware/
      auth.js
      errorHandler.js
      forceError.js
      idempotency.js
      logging.js
      notFound.js
      validate.js
    routes/
      healthRoutes.js
      index.js
      inventoryRoutes.js
      orderRoutes.js
      returnRoutes.js
    schemas/
      inventorySchemas.js
      orderSchemas.js
      packetSchemas.js
      returnSchemas.js
    services/
      inventoryService.js
      orderService.js
      responseService.js
      returnService.js
    utils/
      hash.js
  postman/
    myntra-outbound.postman_collection.json
  index.js
  package.json
```

## Run Locally

```bash
npm install
MYNTRA_WEBHOOK_TOKEN=change-me-in-prod npm start
```

Server: `http://localhost:3000`

Health check (no auth):
- `GET /health`

## Auth

For all non-health routes send:
- `access_token: <token>`
- `x-partner-store: <store_name>`

Token verification modes:
- Opaque token allowlist via `MYNTRA_WEBHOOK_TOKEN` and optional `MYNTRA_WEBHOOK_TOKEN_EXPIRY`
- Multi-token allowlist via `MYNTRA_ACCESS_TOKENS_JSON`
- Signed token mode (`payload.signature`) with HMAC secret `MYNTRA_TOKEN_SIGNING_SECRET`

## Idempotency (Retry-safe)

For mutation requests (`POST/PUT`), send:
- `x-idempotency-key: <unique-key>`

If repeated, same response is replayed with header:
- `x-idempotency-replay: true`

Idempotency store persists across restarts in `data/persistent-store.json`.

## Outbound Endpoints (Myntra -> Your OMS)

1. `POST /storefront/v4/order/:sellerOrderId`
2. `PUT /storefront/v4/order/:sellerOrderId/:eventType`
3. `GET /storefront/v4/packet/downloadinvoice/:packetId`
4. `POST /failureinventory/update`
5. `POST /storefront/v4/return/:id` (`id` can be `cou_*` or `cus_*`)
6. `PUT /storefront/v4/return/:returnId/update`

## Supported eventType values

`accept`, `reject`, `pack`, `readyToDispatch`, `shipped`, `delivered`, `lost`, `onhold`, `unhold`, `itemCancellation`, `cancelItems`

## Success Codes Used

- `1000` Order updated successfully
- `1001` Inventory processed successfully
- `1002` Inventory retrieved successfully
- `1004` Items cancelled successfully
- `1005` Order retrieved successfully
- `1006` Discounts processed successfully
- `1009` Shipments verified successfully

## Error Code Mapping

Implemented in `src/constants/myntraCodes.js` with HTTP alignment for codes like:
`401`, `403`, `2000`, `2005`, `2006`, `2007`, `2008`, `2020`, `2031`, `2033`, `2061`, `3001`, `3002`, `8247`, etc.

## Force Error for Testing

Add query param:
- `?errorCode=2006`

Example:
```bash
curl -X POST 'http://localhost:3000/storefront/v4/order/ORD1?errorCode=2033' \
  -H 'Authorization: Bearer change-me-in-prod' \
  -H 'Content-Type: application/json' \
  -d '{"receiverName":"A","mobile":"9999999999","address":"Addr 1","city":"BLR","state":"KA","zipcode":"560001","warehouse":"WH1","paymentMethod":"on","orderLineEntries":[{"orderLineId":"OL1","sku":"SKU1","quantity":1}]}'
```

## Sample Requests/Responses

### 1) Create Order
**Request**
```http
POST /storefront/v4/order/ORD123
Authorization: Bearer change-me-in-prod
Content-Type: application/json
x-partner-store: Myntra
x-idempotency-key: create-ord-123
```
```json
{
  "receiverName": "Rahul Sharma",
  "mobile": "9876543210",
  "address": "HSR Layout",
  "city": "Bengaluru",
  "state": "KA",
  "zipcode": "560102",
  "warehouse": "WH1",
  "paymentMethod": "on",
  "orderLineEntries": [
    { "orderLineId": "OL1", "sku": "SKU1", "quantity": 1 }
  ]
}
```
**Success (200)**
```json
{ "statusCode": 1000, "statusMessage": "Order updated successfully", "statusType": "SUCCESS" }
```
**Failure duplicate (400)**
```json
{ "statusCode": 2005, "statusMessage": "Duplicate Request / Inventory is unavailable", "statusType": "ERROR" }
```

### 2) Update Order
**Request**
```http
PUT /storefront/v4/order/ORD123/shipped
```
```json
{ "warehouse": "WH1" }
```
**Success (200)**
```json
{ "statusCode": 1009, "statusMessage": "Shipments verified successfully", "statusType": "SUCCESS" }
```
**Failure invalid state (400)**
```json
{ "statusCode": 8247, "statusMessage": "This order is not yet eligible for processing by seller", "statusType": "ERROR" }
```

### 3) Failure Inventory Update
**Request**
```http
POST /failureinventory/update
```
```json
{
  "failures": [
    { "sku": "SKU1", "storeCode": "WH1", "reason": "Sync timeout" }
  ]
}
```
**Success (200)**
```json
{ "statusCode": 1001, "statusMessage": "Inventory processed successfully", "statusType": "SUCCESS" }
```

### 4) Download Invoice
**Request**
```http
GET /storefront/v4/packet/downloadinvoice/PKT-ORD123
```
**Success (200)**
```json
{ "statusCode": 1005, "statusMessage": "Order retrieved successfully", "statusType": "SUCCESS" }
```

### 5) Create Return (RTO or Customer)
**Request**
```http
POST /storefront/v4/return/cou_111
```
```json
{
  "id": "cou_111",
  "type": "COURIER_RETURN",
  "status": "CONFIRMED",
  "sellerOrderId": "ORD123",
  "orderLineId": "OL1",
  "createdOn": "2026-04-16 10:00:00",
  "reason": "Delayed delivery",
  "returnWarehouseCode": "Warehouse"
}
```
**Success (200)**
```json
{ "statusCode": 1000, "statusMessage": "Order updated successfully", "statusType": "SUCCESS" }
```

### 6) Update Return
**Request**
```http
PUT /storefront/v4/return/cou_111/update
```
```json
{
  "id": "cou_111",
  "type": "COURIER_RETURN",
  "status": "DELIVERED",
  "sellerOrderId": "ORD123",
  "orderLineId": "OL1",
  "createdOn": "2026-04-16 10:00:00",
  "reason": "Completed",
  "returnWarehouseCode": "Warehouse"
}
```
**Success (200)**
```json
{ "statusCode": 1000, "statusMessage": "Order updated successfully", "statusType": "SUCCESS" }
```

## Docker

Build and run:
```bash
docker build -t myntra-oms-backend:latest .
docker run --rm -p 3000:3000 \
  -v "$(pwd)/data:/app/data" \
  -e MYNTRA_WEBHOOK_TOKEN=change-me-in-prod \
  -e MYNTRA_TOKEN_SIGNING_SECRET=change-me-in-prod-signing-secret \
  -e IDEMPOTENCY_TTL_MS=86400000 \
  myntra-oms-backend:latest
```

Or use Compose:
```bash
docker compose up --build -d
```

## AWS ECS (Fargate) Deployment

Files:
- `deploy/ecs/task-definition.json`
- `deploy/ecs/service-definition.json`
- `deploy/ecs/deploy.sh`

Minimal flow:
```bash
export AWS_REGION=ap-south-1
export AWS_ACCOUNT_ID=123456789012
export ECR_REPO=myntra-oms-backend
export ECS_CLUSTER=myntra-oms-cluster
export ECS_SERVICE=myntra-oms-backend-svc

./deploy/ecs/deploy.sh
```

Notes:
- Create ECR repo first.
- Update placeholders in `task-definition.json` and `service-definition.json`.
- Store token envs in AWS Secrets Manager and reference them in task definition.
- Configure EFS and set `fileSystemId` placeholder in task definition for persistent `/app/data`.

## AWS EC2 Deployment

Files:
- `deploy/ec2/bootstrap.sh`
- `deploy/ec2/run-container.sh`
- `deploy/ec2/myntra-oms-backend.service`

Steps on EC2 host:
```bash
cd /opt
git clone <your-repo-url> myntra-oms
cd myntra-oms
./deploy/ec2/bootstrap.sh
```

Create env file:
```bash
echo 'MYNTRA_WEBHOOK_TOKEN=change-me-in-prod' | sudo tee /etc/myntra-oms-backend.env
```

Build and start:
```bash
docker build -t myntra-oms-backend:latest .
sudo systemctl enable myntra-oms-backend
sudo systemctl start myntra-oms-backend
sudo systemctl status myntra-oms-backend
```
