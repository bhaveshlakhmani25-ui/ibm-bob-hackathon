# ShopFlow — Synthetic Fixture Application

ShopFlow is the primary synthetic test fixture for Change Rehearsal.

## Architecture

```
Frontend → Auth → Product → Inventory → Pricing → Order → DB
```

## Demo Scenario

**Requirement:** Add caching to Product API.

**Hidden regression:** the candidate version caches product data but does not invalidate on inventory update. A journey that updates inventory and then reads the product sees a stale cached stock value.

## Versions

| Directory | Git ref | Description |
|---|---|---|
| `baseline/` | `baseline` | Pre-caching version. Inventory updates are immediately visible. |
| `candidate/` | `candidate` | Post-caching version (with regression). Cache is not invalidated on inventory update. |

## Service Map

`change-rehearsal.yaml` in each version declares:

```yaml
services:
  product:
    port: 3001
    startCommand: "npm start"
    healthCheck: "/health"
    dependsOn:
      - inventory
  inventory:
    port: 3002
    startCommand: "npm start"
    healthCheck: "/health"
```

## Seed Data Contract

Services expose `POST /test/seed` which accepts a JSON body and resets in-memory state.

Example seed for the inventory-freshness scenario:

```json
{
  "products": [
    { "id": 1, "name": "Widget", "price": 9.99 }
  ],
  "inventory": [
    { "productId": 1, "stock": 5 }
  ]
}
```

After seeding, the scenario updates inventory to `stock: 3` and asserts the product read reflects `stock: 3`.

## Fixtures

```
fixtures/shopflow/
  inventory-3-units/
    seed.json          # initial state: stock=5
    journeys.json      # pre-defined Journey[] for deterministicMode
```

## Expected Verdict

| Journey | Baseline | Candidate | Verdict |
|---|---|---|---|
| inventory-visibility-after-update | stock=3 (fresh) | stock=5 (stale) | REGRESSION |
