'use strict';

/**
 * Handler-level tests — the thin routing layer (auth gate, method routing,
 * error mapping) tested against the service modules via common.js shapes.
 * Services are real lib modules; only auth/claims are simulated.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { getClaims, parseBody, res, error } = require('../src/common');
const { adaptDocumentClient } = require('../src/lib/awsClients');
const { FakeDDB } = require('./helpers/fakeDdb');

test('common: getClaims accepts valid claims and rejects anonymous events', () => {
    const claims = { sub: 'u1', username: 'u1' };
    assert.ok(getClaims({ requestContext: { authorizer: { claims } } }));
    assert.equal(getClaims({ requestContext: { authorizer: {} } }), null);
    assert.equal(getClaims({}), null);
    assert.equal(getClaims({ requestContext: { authorizer: { claims: {} } } }), null);
});

test('common: parseBody tolerates empty and malformed bodies', () => {
    assert.deepEqual(parseBody({ body: null }), {});
    assert.deepEqual(parseBody({ body: '{"a":1}' }), { a: 1 });
    assert.deepEqual(parseBody({ body: 'not-json' }), {});
    assert.deepEqual(parseBody({}), {});
});

test('common: res/error shapes include CORS headers and JSON bodies', () => {
    const ok = res(201, { id: 1 });
    assert.equal(ok.statusCode, 201);
    assert.equal(ok.headers['Access-Control-Allow-Origin'], '*');
    assert.deepEqual(JSON.parse(ok.body), { id: 1 });
    const err = error(404, 'Not found');
    assert.equal(err.statusCode, 404);
    assert.deepEqual(JSON.parse(err.body), { message: 'Not found' });
});

test('awsClients: adaptDocumentClient maps kinds to SDK command classes', async () => {
    const seen = [];
    const fake = { send: async (cmd) => { seen.push(cmd.constructor.name); return {}; } };
    const wrapped = adaptDocumentClient(fake);
    await wrapped.send({ kind: 'Get', input: {} });
    await wrapped.send({ kind: 'Scan', input: {} });
    await wrapped.send({ kind: 'Transact', input: {} });
    assert.deepEqual(seen, ['GetCommand', 'ScanCommand', 'TransactWriteCommand']);
    await assert.rejects(() => wrapped.send({ kind: 'Nope', input: {} }), /Unknown command kind/);
});

test('FakeDDB is consistent across put/get/update/delete cycles', async () => {
    const ddb = new FakeDDB();
    ddb.putItem('t', { productId: 'x', name: 'X', stock: 2 });
    await ddb.send({ kind: 'Update', input: {
        TableName: 't', Key: { productId: 'x' },
        UpdateExpression: 'SET stock = stock - :q',
        ConditionExpression: 'attribute_exists(productId) AND stock >= :q',
        ExpressionAttributeValues: { ':q': 2 },
    } });
    const after = await ddb.send({ kind: 'Get', input: { TableName: 't', Key: { productId: 'x' } } });
    assert.equal(after.Item.stock, 0);
});
