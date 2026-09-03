'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { FakeDDB } = require('./helpers/fakeDdb');
const { createOrdersService } = require('../src/lib/ordersRepo');
const { HttpError } = require('../src/common');

const PRODUCTS = 'test-products';
const ORDERS = 'test-orders';

function makeService() {
    const ddb = new FakeDDB();
    const service = createOrdersService({
        ddb,
        productsTable: PRODUCTS,
        ordersTable: ORDERS,
        taxRate: 0.1,
    });
    return { ddb, service };
}

function seedProduct(ddb, overrides = {}) {
    ddb.putItem(PRODUCTS, {
        productId: 'p1',
        name: 'Widget',
        emoji: '📦',
        price: 10,
        stock: 5,
        ...overrides,
    });
}

test('createOrder prices server-side, computes tax, and decrements stock atomically', async () => {
    const { ddb, service } = makeService();
    seedProduct(ddb);
    seedProduct(ddb, { productId: 'p2', name: 'Gadget', price: 2.5, stock: 10 });

    const order = await service.createOrder('user1', {
        items: [
            { productId: 'p1', quantity: 2 },
            { productId: 'p2', quantity: 4 },
        ],
    });

    // Client sent no prices — totals must come from the catalog.
    // subtotal = 2*10 + 4*2.5 = 30 ; tax = 3 ; total = 33
    assert.equal(order.subtotal, 30);
    assert.equal(order.tax, 3);
    assert.equal(order.total, 33);
    assert.equal(order.userId, 'user1');
    assert.equal(order.status, 'completed');
    assert.ok(order.orderId);

    const p1 = await ddb.send({ kind: 'Get', input: { TableName: PRODUCTS, Key: { productId: 'p1' } } });
    const p2 = await ddb.send({ kind: 'Get', input: { TableName: PRODUCTS, Key: { productId: 'p2' } } });
    assert.equal(p1.Item.stock, 3); // 5 - 2
    assert.equal(p2.Item.stock, 6); // 10 - 4

    const stored = await ddb.send({ kind: 'Get', input: { TableName: ORDERS, Key: { orderId: order.orderId } } });
    assert.equal(stored.Item.total, 33);
});

test('createOrder rolls back completely when stock is insufficient', async () => {
    const { ddb, service } = makeService();
    seedProduct(ddb, { stock: 1 });

    await assert.rejects(
        () => service.createOrder('user1', { items: [{ productId: 'p1', quantity: 2 }] }),
        (e) => e instanceof HttpError && e.status === 409,
    );

    // Stock must be untouched (transaction rolled back)
    const p1 = await ddb.send({ kind: 'Get', input: { TableName: PRODUCTS, Key: { productId: 'p1' } } });
    assert.equal(p1.Item.stock, 1);
    assert.equal(ddb.table(ORDERS).size, 0); // no order persisted
});

test('createOrder rejects unknown products and empty/invalid item lists', async () => {
    const { ddb, service } = makeService();
    seedProduct(ddb);

    await assert.rejects(
        () => service.createOrder('u', { items: [{ productId: 'ghost', quantity: 1 }] }),
        (e) => e.status === 404,
    );
    await assert.rejects(() => service.createOrder('u', { items: [] }), (e) => e.status === 400);
    await assert.rejects(() => service.createOrder('u', {}), (e) => e.status === 400);
    assert.equal(ddb.table(ORDERS).size, 0);
});

test('listOrders returns only the caller\u2019s orders, newest first', async () => {
    const { ddb, service } = makeService();
    ddb.putItem(ORDERS, { orderId: 'o1', userId: 'user1', createdAt: '2026-01-01T00:00:00Z', total: 1 });
    ddb.putItem(ORDERS, { orderId: 'o2', userId: 'user1', createdAt: '2026-01-03T00:00:00Z', total: 3 });
    ddb.putItem(ORDERS, { orderId: 'o3', userId: 'user2', createdAt: '2026-01-02T00:00:00Z', total: 2 });

    const orders = await service.listOrders('user1');
    assert.deepEqual(orders.map((o) => o.orderId), ['o2', 'o1']); // newest first, only user1
});
