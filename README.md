# NovaShop — Serverless Sales System (CRUDL)

Full-stack implementation of **CRUDL** (Create, Read, Update, Delete, List) backed by:

| Concern          | AWS Service                                          |
|------------------|------------------------------------------------------|
| Security / Auth  | **Amazon Cognito** (User Pool, USER_PASSWORD_AUTH, JWT authorizer) |
| API              | **Amazon API Gateway** (REST, Cognito authorizer, CORS) |
| Compute          | **AWS Lambda** (Node.js 20)                          |
| Data             | **Amazon DynamoDB** (Products + Orders tables, transactions) |
| Files            | **Amazon S3** (private bucket, pre-signed PUT/GET URLs) |

The frontend (`frontend/`) is vanilla JS — when `frontend/config.js` is empty it runs
as a local demo; once filled it talks to the real AWS stack.

---

## Architecture

```
                      ┌────────────────────┐
                      │  Browser (SPA)     │
                      │  frontend/         │
                      └─────┬────────┬─────┘
             login (JWT)    │        │  REST + Bearer ID token
                            ▼        ▼
                 ┌──────────────┐   ┌─────────────────────┐
                 │   Cognito    │   │    API Gateway      │
                 │  User Pool   │   │  /products /orders  │
                 └──────────────┘   │  /images/presign    │
                                    └───────┬─────────────┘
                                            │  (Cognito authorizer)
                          ┌─────────────────┼─────────────────┐
                          ▼                 ▼                 ▼
                  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
                  │ productsFn   │  │  ordersFn    │  │  presignFn   │
                  │ CRUDL Lambda │  │  Lambda      │  │  Lambda      │
                  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
                         │                 │                 │ pre-signed PUT
                         ▼                 ▼                 ▼
                  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
                  │ DynamoDB     │  │ DynamoDB     │  │ S3 bucket    │
                  │ Products     │  │ Orders (GSI) │  │ images/      │
                  └──────────────┘  └──────────────┘  └──────────────┘
```

## CRUDL surface

| Operation | Endpoint                  | Lambda            | Notes |
|-----------|---------------------------|-------------------|-------|
| **C**reate | `POST /products`         | `products.handler`| Validates & whitelists fields |
| **R**ead   | `GET /products/{id}`     | `products.handler`| Returns pre-signed image URL |
| **U**pdate | `PUT /products/{id}`     | `products.handler`| Partial-safe field update |
| **D**elete | `DELETE /products/{id}`  | `products.handler`| Also removes the S3 image object |
| **L**ist   | `GET /products`          | `products.handler`| Optional `?category=` filter |
| Create     | `POST /orders`           | `orders.handler`  | Server-side pricing + atomic stock decrement (TransactWriteItems) |
| List       | `GET /orders`            | `orders.handler`  | Per-user via GSI `user-createdAt-index` |
| Upload     | `POST /images/presign`   | `presign.handler` | Pre-signed S3 PUT (PNG/JPEG/WEBP/GIF) |

All endpoints require a valid Cognito ID token (`Authorization: Bearer <jwt>`).

## Deploy

```powershell
# 1. Build & deploy (guided first run)
cd infrastructure
sam build
sam deploy --guided

# 2. Create your Cognito user (admin-only sign-up, no self registration)
aws cognito-idp admin-create-user `
  --user-pool-id <UserPoolId-output> `
  --username you@example.com `
  --user-attributes Name=email,Value=you@example.com Name=email_verified,Value=true `
  --message-action SUPPRESS

aws cognito-idp admin-set-password `
  --user-pool-id <UserPoolId-output> `
  --username you@example.com `
  --password YourPassw0rd! `
  --permanent

# 3. Point the frontend at the stack (copy values from deploy outputs)
#    Edit frontend/config.js → apiBaseUrl, region, userPoolId, clientId

# 4. (Optional) Seed the product catalog
cd ../backend
npm install
PRODUCTS_TABLE=<stackname>-products node seed.mjs

# 5. Open the app (e.g. Live Server on port 5502)
```

## Local development

```powershell
cd infrastructure
sam local start-api            # needs Docker; authorizer is bypassed in local mode
```

## Notes / design decisions

- **Password auth flow**: the app client enables `USER_PASSWORD_AUTH`, so the SPA
  logs in directly against the Cognito IdP endpoint — no hosted UI required.
  ID tokens are stored in `localStorage` and refreshed silently with the refresh token.
- **Private images**: the S3 bucket blocks all public access; product images are
  uploaded via pre-signed PUT URLs and served via 1-hour pre-signed GET URLs.
- **Server-side pricing**: order totals are computed from DynamoDB prices, never
  from client payloads; stock is decremented atomically with a conditional
  transaction so an out-of-stock checkout rolls back completely (HTTP 409).
- **Validation**: Lambda input is whitelisted (`name, category, price, stock, emoji, imageKey`)
  and range-checked; unknown fields are ignored.
