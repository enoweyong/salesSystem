'use strict';

/**
 * In-memory fake DynamoDB Document Client for unit tests.
 * Accepts the { kind, input } records the repositories send and emulates the
 * subset of DynamoDB semantics used by the app (get/put/update/delete/scan/
 * query/transact, conditional expressions, ReturnValues).
 */

class FakeDDB {
    constructor() {
        /** table name -> Map(JSON(key) -> item) */
        this.tables = new Map();
        this.deletedImages = []; // aux tracking for S3 cleanup assertions
    }

    table(name) {
        if (!this.tables.has(name)) this.tables.set(name, new Map());
        return this.tables.get(name);
    }

    putItem(name, item) {
        this.table(name).set(JSON.stringify(this.keyOf(item)), { ...item });
    }

    async send({ kind, input }) {
        switch (kind) {
            case 'Get': {
                const item = this.table(input.TableName).get(JSON.stringify(input.Key));
                return { Item: item ? { ...item } : undefined };
            }
            case 'Put': {
                const key = JSON.stringify(this.keyOf(input.Item));
                this.table(input.TableName).set(key, { ...input.Item });
                return {};
            }
            case 'Update': {
                return this.update(input);
            }
            case 'Delete': {
                const store = this.table(input.TableName);
                const key = JSON.stringify(input.Key);
                if (input.ConditionExpression === 'attribute_exists(productId)' && !store.has(key)) {
                    this.throwConditional();
                }
                const old = store.get(key);
                store.delete(key);
                return old ? { Attributes: { ...old } } : {};
            }
            case 'Scan': {
                let items = [...this.table(input.TableName).values()];
                if (input.FilterExpression === '#c = :cat') {
                    const cat = input.ExpressionAttributeValues[':cat'];
                    items = items.filter((i) => i.category === cat);
                }
                return { Items: items.map((i) => ({ ...i })) };
            }
            case 'Query': {
                // Only used for orders GSI: userId = :u, sorted by createdAt desc
                const userId = input.ExpressionAttributeValues[':u'];
                const items = [...this.table(input.TableName).values()]
                    .filter((i) => i.userId === userId)
                    .sort((a, b) =>
                        input.ScanIndexForward === false
                            ? String(b.createdAt).localeCompare(String(a.createdAt))
                            : String(a.createdAt).localeCompare(String(b.createdAt)),
                    );
                return { Items: items.map((i) => ({ ...i })) };
            }
            case 'Transact': {
                return this.transact(input);
            }
            default:
                throw new Error(`FakeDDB: unsupported kind ${kind}`);
        }
    }

    keyOf(item) {
        // Orders are keyed by orderId, products by productId.
        return item.orderId !== undefined ? { orderId: item.orderId } : { productId: item.productId };
    }

    throwConditional() {
        const err = new Error('The conditional request failed');
        err.name = 'ConditionalCheckFailedException';
        throw err;
    }

    update(input) {
        const store = this.table(input.TableName);
        const key = JSON.stringify(input.Key);
        const exists = store.has(key);
        if (input.ConditionExpression?.includes('attribute_exists') && !exists) this.throwConditional();

        // Stock-decrement pattern used by the orders transaction.
        if (input.UpdateExpression === 'SET stock = stock - :q') {
            const item = store.get(key);
            const qty = input.ExpressionAttributeValues[':q'];
            if (input.ConditionExpression?.includes('stock >= :q') && (!item || item.stock < qty)) {
                const err = new Error('Transaction cancelled');
                err.name = 'TransactionCanceledException';
                throw err;
            }
            item.stock -= qty;
            return {};
        }

        // Generic SET pattern used by productsRepo.update: SET #a = :a, ...
        const item = store.get(key) || {};
        const names = input.ExpressionAttributeNames || {};
        for (const part of input.UpdateExpression.replace(/^SET\s+/, '').split(', ')) {
            const [nRef, vRef] = part.split(' = ');
            const field = names[nRef] || nRef.replace(/^#/, '');
            item[field] = input.ExpressionAttributeValues[vRef];
        }
        store.set(key, item);
        return { Attributes: { ...item } };
    }

    transact(input) {
        // Validate all conditions first (mimics atomic rollback).
        for (const entry of input.TransactItems) {
            if (entry.Update) {
                const u = entry.Update;
                const store = this.table(u.TableName);
                const item = store.get(JSON.stringify(u.Key));
                if (u.ConditionExpression?.includes('attribute_exists') && !item) {
                    const err = new Error('Transaction cancelled');
                    err.name = 'TransactionCanceledException';
                    throw err;
                }
                if (u.ConditionExpression?.includes('stock >= :q') && item.stock < u.ExpressionAttributeValues[':q']) {
                    const err = new Error('Transaction cancelled');
                    err.name = 'TransactionCanceledException';
                    throw err;
                }
            }
        }
        // Then apply.
        for (const entry of input.TransactItems) {
            if (entry.Update) this.update(entry.Update);
            if (entry.Put) {
                const p = entry.Put;
                this.table(p.TableName).set(JSON.stringify(this.keyOf(p.Item)), { ...p.Item });
            }
        }
        return {};
    }
}

module.exports = { FakeDDB };
