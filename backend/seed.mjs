/**
 * NovaShop — DynamoDB product seeder.
 *
 * Usage (after `sam deploy`):
 *   cd backend
 *   npm install
 *   PRODUCTS_TABLE=<table-name> node seed.mjs
 *
 * Get the table name from the `aws cloudformation describe-stacks` outputs
 * or `sam deploy` output (e.g. "novashop-dev-products").
 */

import crypto from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const TABLE = process.env.PRODUCTS_TABLE;
if (!TABLE) {
    console.error('Set PRODUCTS_TABLE env var, e.g. PRODUCTS_TABLE=novashop-dev-products node seed.mjs');
    process.exit(1);
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const products = [
    { name: 'Wireless Headphones', category: 'Electronics', price: 79.99, stock: 12, emoji: '🎧' },
    { name: 'Smart Watch', category: 'Electronics', price: 149.99, stock: 8, emoji: '⌚' },
    { name: 'Bluetooth Speaker', category: 'Electronics', price: 59.99, stock: 9, emoji: '🔊' },
    { name: 'Running Shoes', category: 'Clothing', price: 89.99, stock: 15, emoji: '👟' },
    { name: 'Hoodie', category: 'Clothing', price: 49.99, stock: 20, emoji: '🧥' },
    { name: 'Backpack', category: 'Clothing', price: 39.99, stock: 11, emoji: '🎒' },
    { name: 'Coffee Mug', category: 'Home', price: 12.99, stock: 30, emoji: '☕' },
    { name: 'Desk Lamp', category: 'Home', price: 34.99, stock: 10, emoji: '💡' },
    { name: 'Fiction Novel', category: 'Books', price: 19.99, stock: 25, emoji: '📚' },
    { name: 'Cookbook', category: 'Books', price: 24.99, stock: 18, emoji: '🍳' },
    { name: 'Action Figure', category: 'Toys', price: 29.99, stock: 7, emoji: '🤖' },
    { name: 'Puzzle Set', category: 'Toys', price: 15.99, stock: 14, emoji: '🧩' },
];

const now = new Date().toISOString();
for (const p of products) {
    const item = { productId: crypto.randomUUID(), ...p, createdAt: now, updatedAt: now };
    await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
    console.log(`✓ Seeded: ${p.name}`);
}
console.log(`\nDone — ${products.length} products written to "${TABLE}".`);
