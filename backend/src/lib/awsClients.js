'use strict';

/**
 * AWS wiring / adapter layer — connects the testable lib modules to the real
 * AWS SDK clients and translates the { kind, input } command style used by
 * the repositories into SDK command instances.
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
    DynamoDBDocumentClient,
    ScanCommand,
    GetCommand,
    PutCommand,
    UpdateCommand,
    DeleteCommand,
    QueryCommand,
    TransactWriteCommand,
} = require('@aws-sdk/lib-dynamodb');
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const KINDS = {
    Scan: ScanCommand,
    Get: GetCommand,
    Put: PutCommand,
    Update: UpdateCommand,
    Delete: DeleteCommand,
    Query: QueryCommand,
    Transact: TransactWriteCommand,
};

/** Wrap a document client so repos can send { kind, input } records. */
function adaptDocumentClient(ddb) {
    return {
        send: async ({ kind, input }) => {
            const Ctor = KINDS[kind];
            if (!Ctor) throw new Error(`Unknown command kind: ${kind}`);
            return ddb.send(new Ctor(input));
        },
    };
}

/** (s3Client, command, opts) => signed URL — signature expected by the repos. */
function signUrl(s3, command, opts) {
    return getSignedUrl(s3, command, opts);
}

/** (s3Client, {Bucket, Key}) => Promise — used for image cleanup on delete. */
function deleteObject(s3, input) {
    return s3.send(new DeleteObjectCommand(input));
}

/** Build every service with real AWS clients from environment variables. */
function buildServices(env = process.env) {
    const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
    const s3 = new S3Client({});
    const { createProductsService } = require('./productsRepo');
    const { createOrdersService } = require('./ordersRepo');
    const { createImagesService } = require('./images');

    return {
        products: createProductsService({
            ddb: adaptDocumentClient(ddbDoc),
            s3,
            table: env.PRODUCTS_TABLE,
            bucket: env.IMAGES_BUCKET,
            signUrl,
            deleteObject,
        }),
        orders: createOrdersService({
            ddb: adaptDocumentClient(ddbDoc),
            productsTable: env.PRODUCTS_TABLE,
            ordersTable: env.ORDERS_TABLE,
        }),
        images: createImagesService({ s3, bucket: env.IMAGES_BUCKET, signUrl }),
    };
}

module.exports = { adaptDocumentClient, signUrl, deleteObject, buildServices, KINDS };
