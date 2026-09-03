'use strict';

/**
 * NovaShop — S3 presign Lambda handler (thin routing layer).
 * Logic lives in src/lib/images.js.
 *
 * Route (API Gateway + Cognito authorizer, authorized):
 *   POST /images/presign
 *     Body: { fileName: "photo.jpg", contentType: "image/jpeg" }
 *     Returns: { uploadUrl, key, expiresIn }
 */

const { HttpError, res, error, getClaims, parseBody } = require('../common');
const { buildServices } = require('../lib/awsClients');

const services = buildServices();

exports.handler = async (event) => {
    try {
        if (!getClaims(event)) return error(401, 'Unauthorized');
        if (event.httpMethod !== 'POST') return error(405, 'Method not allowed');
        return res(200, await services.images.createUploadUrl(parseBody(event)));
    } catch (err) {
        if (err instanceof HttpError) return error(err.status, err.message);
        console.error('presign.handler failed:', err);
        return error(500, 'Internal server error');
    }
};
