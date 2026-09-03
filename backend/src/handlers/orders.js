'use strict';

/**
 * NovaShop — Orders Lambda handler (thin routing layer).
 * Business logic lives in src/lib/ordersRepo.js.
 *
 * Routes (API Gateway + Cognito authorizer, all authorized):
 *   POST /orders → place an order (server-side pricing + atomic stock update)
 *   GET  /orders → list the authenticated user's orders (newest first)
 */

const { HttpError, res, error, getClaims, parseBody } = require('../common');
const { buildServices } = require('../lib/awsClients');

const services = buildServices();

exports.handler = async (event) => {
    try {
        const claims = getClaims(event);
        if (!claims) return error(401, 'Unauthorized');
        const userId = claims.sub || claims.username;

        switch (event.httpMethod) {
            case 'POST':
                return res(201, await services.orders.createOrder(userId, parseBody(event)));
            case 'GET':
                return res(200, await services.orders.listOrders(userId));
            default:
                return error(405, 'Method not allowed');
        }
    } catch (err) {
        if (err instanceof HttpError) return error(err.status, err.message);
        console.error('orders.handler failed:', err);
        return error(500, 'Internal server error');
    }
};
