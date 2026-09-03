'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { FakeDDB } = require('./helpers/fakeDdb');
const { createProductsService } = require('../src/lib/productsRepo');
const { HttpError } = require('../src/common');

const TABLE = 'test-products';
const BUCKET = 'test-bucket';

function makeService({ signedUrls = [] } = {}) {
    const ddb = new FakeDDB();
    const signed = [];
    const service = createProductsService({
        ddb,
        s3: {},
        table: TABLE,
        bucket: BUCKET,
        signUrl: async (_s3, cmd, opts) => {
            signed.push({ key: cmd.input.Key, expiresIn: opts.expiresIn });
            return `https://signed/${cmd.input.Key}`;
        },
        deleteObject: async (_s3, input) => {
            ddb.deletedImages.push(input);
            return {};
        },
    });
    return { ddb, service, signed };
}

test('create persists a generated product with timestamps and no image url', async () => {
    const { service } = makeService();
    const item = await service.create({ name: 'Mug', category: 'Home', price: 12.99, stock: 5, emoji: '☕' });
    assert.ok(item.productId);
    assert.ok(item.createdAt && item.updatedAt);
    assert.equal(item.imageUrl, null);
    const stored = await service.get(item.productId);
    assert.equal(stored.name, 'Mug');
});

test('create returns a pre-signed image url when imageKey is set', async () => {
    const { service, signed } = makeService();
    const item = await service.create({ name: 'Mug', price: 1, stock: 1, imageKey: 'products/abc.png' });
    assert.equal(item.imageUrl, `https://signed/products/abc.png`);
    assert.equal(signed[0].expiresIn, 3600);
});

test('get throws 404 for unknown id', async () => {
    const { service } = makeService();
    await assert.rejects(() => service.get('nope'), (e) => e instanceof HttpError && e.status === 404);
    await assert.rejects(() => service.get(undefined), (e) => e.status === 400);
});

test('list returns items sorted by createdAt with image urls', async () => {
    const { ddb, service } = makeService();
    ddb.putItem(TABLE, { productId: 'a', name: 'A', createdAt: '2026-01-02T00:00:00Z' });
    ddb.putItem(TABLE, { productId: 'b', name: 'B', createdAt: '2026-01-01T00:00:00Z', imageKey: 'products/b.jpg' });
    const items = await service.list({});
    assert.deepEqual(items.map((i) => i.productId), ['b', 'a']); // oldest first
    assert.equal(items[0].imageUrl, 'https://signed/products/b.jpg');
    assert.equal(items[1].imageUrl, null);
});

test('list filters by category when ?category is provided', async () => {
    const { ddb, service } = makeService();
    ddb.putItem(TABLE, { productId: 'a', name: 'A', category: 'Home' });
    ddb.putItem(TABLE, { productId: 'b', name: 'B', category: 'Toys' });
    const all = await service.list({ queryStringParameters: { category: 'all' } });
    const homes = await service.list({ queryStringParameters: { category: 'Home' } });
    assert.equal(all.length, 2);
    assert.deepEqual(homes.map((i) => i.productId), ['a']);
});

test('update modifies only whitelisted fields and 404s on missing item', async () => {
    const { ddb, service } = makeService();
    ddb.putItem(TABLE, { productId: 'a', name: 'Old', category: 'Misc', price: 1, stock: 1, emoji: '📦', createdAt: 't' });
    const updated = await service.update('a', { name: 'New', price: 9.5, stock: 7 });
    assert.equal(updated.name, 'New');
    assert.equal(updated.price, 9.5);
    assert.equal(updated.stock, 7);
    assert.equal(updated.category, 'Misc'); // untouched
    await assert.rejects(() => service.update('ghost', { name: 'X', price: 1, stock: 1 }), (e) => e.status === 404);
});

test('remove deletes the item and its S3 image object', async () => {
    const { ddb, service } = makeService();
    ddb.putItem(TABLE, { productId: 'a', name: 'A', imageKey: 'products/a.png' });
    const result = await service.remove('a');
    assert.equal(result.deleted, 'a');
    assert.deepEqual(ddb.deletedImages, [{ Bucket: BUCKET, Key: 'products/a.png' }]);
    await assert.rejects(() => service.remove('a'), (e) => e.status === 404); // already gone
});
