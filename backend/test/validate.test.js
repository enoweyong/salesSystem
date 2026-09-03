'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toProductPayload, toOrderLines, round2 } = require('../src/lib/validate');
const { HttpError } = require('../src/common');

test('toProductPayload accepts and normalizes a valid product', () => {
    const p = toProductPayload({ name: '  Widget ', category: 'Home', price: '9.999', stock: '3', emoji: '📦📦📦📦📦' });
    assert.equal(p.name, 'Widget');
    assert.equal(p.category, 'Home');
    assert.equal(p.price, 10); // rounded half-up-ish: 9.999 -> 10
    assert.equal(p.stock, 3);
    assert.ok(p.emoji.length <= 8);
});

test('toProductPayload drops unknown fields (whitelist)', () => {
    const p = toProductPayload({ name: 'X', price: 1, stock: 1, isAdmin: true, hacker: 'DROP TABLE' });
    assert.equal(p.isAdmin, undefined);
    assert.equal(p.hacker, undefined);
});

test('toProductPayload rejects missing/blank name', () => {
    assert.throws(() => toProductPayload({ name: '   ', price: 1, stock: 1 }), (e) => e instanceof HttpError && e.status === 400);
});

test('toProductPayload rejects negative price and bad stock', () => {
    assert.throws(() => toProductPayload({ name: 'X', price: -5, stock: 1 }), (e) => e.status === 400);
    assert.throws(() => toProductPayload({ name: 'X', price: 1, stock: 'lots' }), (e) => e.status === 400);
    assert.throws(() => toProductPayload({ name: 'X', price: 1, stock: -1 }), (e) => e.status === 400);
});

test('toOrderLines keeps only valid lines and caps quantity parsing', () => {
    const lines = toOrderLines([
        { productId: 'a', quantity: 2 },
        { productId: '', quantity: 5 },     // dropped: no id
        { productId: 'b', quantity: 0 },    // dropped: qty < 1
        { productId: 'c', quantity: 'x' },  // dropped: NaN
        'garbage',                          // dropped: not an object
    ]);
    assert.deepEqual(lines, [{ productId: 'a', quantity: 2 }]);
});

test('toOrderLines caps at max items', () => {
    const lines = toOrderLines(Array.from({ length: 60 }, (_, i) => ({ productId: `p${i}`, quantity: 1 })), 50);
    assert.equal(lines.length, 50);
});

test('round2 rounds money correctly', () => {
    assert.equal(round2(10.005), 10.01);
    assert.equal(round2(1 / 3), 0.33);
    assert.equal(round2(0.1 + 0.2), 0.3);
});
