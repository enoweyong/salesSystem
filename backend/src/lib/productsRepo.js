'use strict';

/**
 * Products repository / service — all DynamoDB + S3 business logic for the
 * products CRUDL. Dependencies are injected, which makes it fully unit-testable:
 *
 *   const products = createProductsService({
 *       ddb, s3, table, bucket,
 *       signUrl,          // (s3Client, command, opts) => Promise<string>
 *       deleteObject,     // (s3Client, command) => Promise
 *   });
 */

const { randomUUID } = require('node:crypto');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { HttpError } = require('../common');
const { toProductPayload } = require('./validate');

function createProductsService({ ddb, s3, table, bucket, imageUrlTtl = 3600, signUrl, deleteObject }) {
    /** Pre-signed GET URL for a product image (or null). */
    async function imageUrlFor(item) {
        if (!item || !item.imageKey || !bucket) return null;
        return signUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: item.imageKey }), {
            expiresIn: imageUrlTtl,
        });
    }

    async function list(event) {
        const input = { TableName: table };
        const category = event?.queryStringParameters?.category;
        if (category && category !== 'all') {
            input.FilterExpression = '#c = :cat';
            input.ExpressionAttributeNames = { '#c': 'category' };
            input.ExpressionAttributeValues = { ':cat': String(category) };
        }
        const result = await ddb.send({ kind: 'Scan', input });
        const items = await Promise.all(
            (result.Items || []).map(async (item) => ({ ...item, imageUrl: await imageUrlFor(item) })),
        );
        items.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
        return items;
    }

    async function get(id) {
        if (!id) throw new HttpError(400, 'Missing product id');
        const result = await ddb.send({ kind: 'Get', input: { TableName: table, Key: { productId: id } } });
        if (!result.Item) throw new HttpError(404, 'Product not found');
        return { ...result.Item, imageUrl: await imageUrlFor(result.Item) };
    }

    async function create(body) {
        const now = new Date().toISOString();
        const item = { productId: randomUUID(), ...toProductPayload(body), createdAt: now, updatedAt: now };
        await ddb.send({ kind: 'Put', input: { TableName: table, Item: item } });
        return { ...item, imageUrl: await imageUrlFor(item) };
    }

    async function update(id, body) {
        if (!id) throw new HttpError(400, 'Missing product id');
        const payload = toProductPayload(body);

        const names = { '#updatedAt': 'updatedAt' };
        const values = { ':updatedAt': new Date().toISOString() };
        const sets = Object.keys(payload).map((key) => {
            names[`#${key}`] = key;
            values[`:${key}`] = payload[key];
            return `#${key} = :${key}`;
        });

        try {
            const result = await ddb.send({
                kind: 'Update',
                input: {
                    TableName: table,
                    Key: { productId: id },
                    UpdateExpression: `SET ${[...sets, '#updatedAt = :updatedAt'].join(', ')}`,
                    ExpressionAttributeNames: names,
                    ExpressionAttributeValues: values,
                    ConditionExpression: 'attribute_exists(productId)',
                    ReturnValues: 'ALL_NEW',
                },
            });
            return { ...result.Attributes, imageUrl: await imageUrlFor(result.Attributes) };
        } catch (err) {
            if (err.name === 'ConditionalCheckFailedException') throw new HttpError(404, 'Product not found');
            throw err;
        }
    }

    async function remove(id) {
        if (!id) throw new HttpError(400, 'Missing product id');
        try {
            const result = await ddb.send({
                kind: 'Delete',
                input: {
                    TableName: table,
                    Key: { productId: id },
                    ConditionExpression: 'attribute_exists(productId)',
                    ReturnValues: 'ALL_OLD',
                },
            });
            // Best-effort cleanup of the S3 image object.
            if (result.Attributes?.imageKey && bucket) {
                await deleteObject(s3, { Bucket: bucket, Key: result.Attributes.imageKey })
                    .catch((e) => console.warn('Failed to delete image object:', e.message));
            }
            return { deleted: id };
        } catch (err) {
            if (err.name === 'ConditionalCheckFailedException') throw new HttpError(404, 'Product not found');
            throw err;
        }
    }

    return { list, get, create, update, remove, imageUrlFor };
}

module.exports = { createProductsService };
