'use strict';

/**
 * Orders repository / service — server-side pricing, atomic stock decrement
 * and per-user listing. Dependencies injected for unit testing:
 *
 *   const orders = createOrdersService({ ddb, productsTable, ordersTable, taxRate });
 */

const { randomUUID } = require('node:crypto');
const { HttpError } = require('../common');
const { toOrderLines, round2 } = require('./validate');

function createOrdersService({ ddb, productsTable, ordersTable, taxRate = 0.1, maxItems = 50 }) {
    async function createOrder(userId, body) {
        const lines = toOrderLines(body?.items, maxItems);
        if (!lines.length) throw new HttpError(400, 'items[] with productId and quantity are required');

        // Price on the server — never trust prices coming from the client.
        const priced = [];
        for (const line of lines) {
            const product = await ddb.send({
                kind: 'Get',
                input: { TableName: productsTable, Key: { productId: line.productId } },
            });
            if (!product.Item) throw new HttpError(404, `Product not found: ${line.productId}`);
            priced.push({
                productId: line.productId,
                name: product.Item.name,
                emoji: product.Item.emoji || '📦',
                price: product.Item.price,
                quantity: line.quantity,
            });
        }

        const subtotal = round2(priced.reduce((sum, i) => sum + i.price * i.quantity, 0));
        const tax = round2(subtotal * taxRate);
        const total = round2(subtotal + tax);
        const now = new Date().toISOString();

        const order = {
            orderId: randomUUID(),
            userId,
            items: priced,
            subtotal,
            tax,
            total,
            status: 'completed',
            createdAt: now,
            date: now, // kept in sync with the frontend renderer
        };

        try {
            await ddb.send({
                kind: 'Transact',
                input: {
                    TransactItems: [
                        // Decrement stock only if enough remains — otherwise the whole
                        // transaction (including the order) is rolled back.
                        ...priced.map((i) => ({
                            Update: {
                                TableName: productsTable,
                                Key: { productId: i.productId },
                                UpdateExpression: 'SET stock = stock - :q',
                                ConditionExpression: 'attribute_exists(productId) AND stock >= :q',
                                ExpressionAttributeValues: { ':q': i.quantity },
                            },
                        })),
                        { Put: { TableName: ordersTable, Item: order } },
                    ],
                },
            });
        } catch (err) {
            if (err.name === 'TransactionCanceledException') {
                throw new HttpError(409, 'Order failed: insufficient stock for one or more items');
            }
            throw err;
        }

        return order;
    }

    async function listOrders(userId) {
        const result = await ddb.send({
            kind: 'Query',
            input: {
                TableName: ordersTable,
                IndexName: 'user-createdAt-index',
                KeyConditionExpression: 'userId = :u',
                ExpressionAttributeValues: { ':u': userId },
                ScanIndexForward: false, // newest first
            },
        });
        return result.Items || [];
    }

    return { createOrder, listOrders };
}

module.exports = { createOrdersService };
