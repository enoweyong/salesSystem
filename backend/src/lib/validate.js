'use strict';

/**
 * Input validation & whitelisting — pure functions, no AWS dependencies.
 * Everything that guards Lambda input lives here so it can be unit-tested
 * in isolation.
 */

const { HttpError } = require('../common');

/**
 * Validate + whitelist incoming product fields.
 * Throws HttpError(400) on invalid input; unknown fields are dropped.
 */
function toProductPayload(body) {
    const name = String(body?.name ?? '').trim();
    const category = String(body?.category ?? 'Misc').trim();
    const price = Number(body?.price);
    const stock = Number.parseInt(body?.stock, 10);

    if (!name) throw new HttpError(400, '"name" is required');
    if (name.length > 200) throw new HttpError(400, '"name" is too long (max 200)');
    if (!Number.isFinite(price) || price < 0) throw new HttpError(400, '"price" must be a number ≥ 0');
    if (!Number.isInteger(stock) || stock < 0) throw new HttpError(400, '"stock" must be an integer ≥ 0');

    const payload = {
        name,
        category: category.slice(0, 60),
        price: Math.round(price * 100) / 100,
        stock,
        emoji: String(body?.emoji ?? '📦').trim().slice(0, 8) || '📦',
    };
    if (body?.imageKey) payload.imageKey = String(body.imageKey);
    return payload;
}

/**
 * Normalize order lines from a client payload.
 * Returns [] when nothing valid remains.
 */
function toOrderLines(items, max = 50) {
    const requested = Array.isArray(items) ? items : [];
    const lines = requested
        .map((i) => ({
            productId: String(i?.productId ?? ''),
            quantity: Number.parseInt(i?.quantity, 10),
        }))
        .filter((i) => i.productId && Number.isInteger(i.quantity) && i.quantity > 0);
    return lines.slice(0, max);
}

/** Round to 2 decimal places (money). */
const round2 = (n) => Math.round(n * 100) / 100;

module.exports = { toProductPayload, toOrderLines, round2 };
