/**
 * NovaShop — end-to-end test against the LIVE AWS deployment.
 * Run: node test/e2e.js
 * (Credentials come from frontend/config.js + E2E_EMAIL / E2E_PASSWORD env vars.)
 */

const fs = require('node:fs');
const path = require('node:path');

const cfgSrc = fs.readFileSync(path.join(__dirname, '../../frontend/config.js'), 'utf8');
const CFG = {
    apiBaseUrl: cfgSrc.match(/apiBaseUrl:\s*'([^']+)'/)[1],
    region: cfgSrc.match(/region:\s*'([^']+)'/)[1],
    userPoolId: cfgSrc.match(/userPoolId:\s*'([^']+)'/)[1],
    clientId: cfgSrc.match(/clientId:\s*'([^']+)'/)[1],
};
const EMAIL = process.env.E2E_EMAIL || 'eyong@novashop.dev';
const PASSWORD = process.env.E2E_PASSWORD || 'NovaShop2026!';

const results = [];
async function step(name, fn) {
    try {
        const value = await fn();
        results.push(`✅ ${name}`);
        return value;
    } catch (e) {
        results.push(`❌ ${name}: ${e.message}`);
        throw e;
    }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); return true; };

const cognito = (op, payload) =>
    fetch(`https://cognito-idp.${CFG.region}.amazonaws.com/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': `AWSCognitoIdentityProviderService.${op}` },
        body: JSON.stringify(payload),
    }).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(JSON.stringify(d));
        return d;
    });

let token, api = async (ep, opts = {}) => {
    const r = await fetch(`${CFG.apiBaseUrl}${ep}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
    });
    const body = await r.json().catch(() => null);
    return { status: r.status, body };
};

(async () => {
    // 1. Authenticate against Cognito
    const auth = await step('Cognito login (USER_PASSWORD_AUTH)', () =>
        cognito('InitiateAuth', {
            AuthFlow: 'USER_PASSWORD_AUTH', ClientId: CFG.clientId,
            AuthParameters: { USERNAME: EMAIL, PASSWORD: PASSWORD },
        }));
    token = auth.AuthenticationResult.IdToken;

    // 2. Unauthenticated request must be rejected
    await step('API rejects anonymous request (401)', async () => {
        const r = await fetch(`${CFG.apiBaseUrl}/products`);
        assert(r.status === 401, `expected 401, got ${r.status}`);
    });

    // 3. LIST (seeded)
    const list0 = await step('LIST /products returns seeded catalog', async () => {
        const { status, body } = await api('/products');
        assert(status === 200, `status ${status}`);
        assert(Array.isArray(body) && body.length >= 12, `expected ≥12 products, got ${body.length}`);
        return body;
    });

    // 4. CREATE
    const created = await step('CREATE /products', async () => {
        const { status, body } = await api('/products', {
            method: 'POST',
            body: JSON.stringify({ name: 'E2E Test Product', category: 'Misc', price: 5.55, stock: 9, emoji: '🧪', hacker: 'x' }),
        });
        assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
        assert(body.productId && body.name === 'E2E Test Product', 'bad create body');
        assert(body.hacker === undefined, 'whitelist failed');
        return body;
    });

    // 5. READ one
    await step('READ /products/{id}', async () => {
        const { status, body } = await api(`/products/${created.productId}`);
        assert(status === 200 && body.productId === created.productId, `status ${status}`);
    });

    // 6. UPDATE
    await step('UPDATE /products/{id}', async () => {
        const { status, body } = await api(`/products/${created.productId}`, {
            method: 'PUT',
            body: JSON.stringify({ name: 'E2E Test Product v2', category: 'Misc', price: 7.77, stock: 4 }),
        });
        assert(status === 200 && body.price === 7.77 && body.stock === 4, `status ${status}`);
    });

    // 7. ORDER — checkout flow with atomic stock decrement
    await step('CREATE /orders (server-side pricing + stock decrement)', async () => {
        const { status, body } = await api('/orders', {
            method: 'POST',
            body: JSON.stringify({ items: [{ productId: created.productId, quantity: 2 }] }),
        });
        assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
        // price 7.77 x2 = 15.54 subtotal, tax 1.55 (rounded), total 17.09
        assert(body.subtotal === 15.54, `subtotal ${body.subtotal}`);
        assert(body.total === 17.09, `total ${body.total}`);
    });
    await step('Stock decremented after order', async () => {
        const { body } = await api(`/products/${created.productId}`);
        assert(body.stock === 2, `expected stock 2, got ${body.stock}`);
    });
    await step('Insufficient-stock order rejected (409)', async () => {
        const { status } = await api('/orders', {
            method: 'POST',
            body: JSON.stringify({ items: [{ productId: created.productId, quantity: 99 }] }),
        });
        assert(status === 409, `expected 409, got ${status}`);
    });
    await step('LIST /orders returns the order', async () => {
        const { status, body } = await api('/orders');
        assert(status === 200 && body.length >= 1, `status ${status}`);
    });

    // 8. LIST with category filter
    await step('LIST /products?category= filters', async () => {
        const { body } = await api('/products?category=Misc');
        assert(body.every((p) => p.category === 'Misc'), 'filter leaked other categories');
    });

    // 9. DELETE (cleanup)
    await step('DELETE /products/{id}', async () => {
        const { status } = await api(`/products/${created.productId}`, { method: 'DELETE' });
        assert(status === 200, `status ${status}`);
        const { status: s2 } = await api(`/products/${created.productId}`);
        assert(s2 === 404, 'product still readable after delete');
    });

    console.log('\n===== E2E RESULTS =====');
    results.forEach((r) => console.log(r));
    console.log('=======================\n🎉 ALL E2E TESTS PASSED');
})().catch(() => {
    console.log('\n===== E2E RESULTS =====');
    results.forEach((r) => console.log(r));
    console.log('=======================');
    process.exit(1);
});
