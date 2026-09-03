'use strict';

/**
 * NovaShop — Products Lambda handler (thin routing layer).
 * All business logic lives in src/lib/productsRepo.js.
 *
 * Routes (API Gateway + Cognito authorizer, all authorized):
 *   GET    /products          → list (optional ?category=<name>)
 *   POST   /products          → create
 *   GET    /products/{id}     → read one
 *   PUT    /products/{id}     → update (PATCH also accepted)
 *   DELETE /products/{id}     → delete (also removes the S3 image, if any)
 */

const { HttpError, res, error, getClaims, parseBody } = require('../common');
const { buildServices } = require('../lib/awsClients');

const services = buildServices();

exports.handler = async (event) => {
    try {
        if (!getClaims(event)) return error(401, 'Unauthorized');
        const method = event.httpMethod;
        const id = event.pathParameters?.id;

        switch (method) {
            case 'GET':
                return res(200, id ? await services.products.get(id) : await services.products.list(event));
            case 'POST':
                return res(201, await services.products.create(parseBody(event)));
            case 'PUT':
            case 'PATCH':
                return res(200, await services.products.update(id, parseBody(event)));
            case 'DELETE':
                return res(200, await services.products.remove(id));
            default:
                return error(405, 'Method not allowed');
        }
    } catch (err) {
        if (err instanceof HttpError) return error(err.status, err.message);
        console.error('products.handler failed:', err);
        return error(500, 'Internal server error');
    }
};
