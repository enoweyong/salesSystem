'use strict';

/**
 * Shared helpers for NovaShop Lambda handlers.
 */

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers':
        'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'DELETE,GET,OPTIONS,PATCH,POST,PUT',
};

/** HTTP-style error you can throw from anywhere in a handler. */
class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

/** JSON response with CORS headers. */
function res(statusCode, body) {
    return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

/** Error response shorthand. */
function error(statusCode, message) {
    return res(statusCode, { message });
}

/**
 * Extract verified Cognito claims from the API Gateway authorizer context.
 * Returns null when the request was not authenticated.
 */
function getClaims(event) {
    const claims = event?.requestContext?.authorizer?.claims;
    if (claims && (claims.sub || claims.username)) return claims;
    return null;
}

/** Safely parse a JSON request body. */
function parseBody(event) {
    try {
        return JSON.parse(event.body || '{}');
    } catch {
        return {};
    }
}

module.exports = { CORS_HEADERS, HttpError, res, error, getClaims, parseBody };
