'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createImagesService } = require('../src/lib/images');
const { HttpError } = require('../src/common');

function makeService() {
    const signed = [];
    const service = createImagesService({
        s3: {},
        bucket: 'test-bucket',
        signUrl: async (_s3, cmd, opts) => {
            signed.push({ cmd: cmd.input, opts });
            return `https://signed/${cmd.input.Key}`;
        },
    });
    return { service, signed };
}

test('createUploadUrl returns a pre-signed PUT for an allowed type', async () => {
    const { service, signed } = makeService();
    const result = await service.createUploadUrl({ fileName: 'My Photo.JPG', contentType: 'image/jpeg' });
    assert.equal(result.uploadUrl, `https://signed/${result.key}`);
    assert.equal(result.expiresIn, 300);
    assert.ok(result.key.startsWith('products/'), 'key lives under products/ prefix');
    assert.ok(result.key.endsWith('.jpg'), 'extension preserved');
    assert.ok(!result.key.includes(' '), 'spaces sanitized');
    assert.equal(signed[0].cmd.Bucket, 'test-bucket');
    assert.equal(signed[0].cmd.ContentType, 'image/jpeg');
});

test('createUploadUrl sanitizes hostile file names', async () => {
    const { service } = makeService();
    const r = await service.createUploadUrl({ fileName: '../../evil <>name?.png', contentType: 'image/png' });
    // path traversal resolved, no spaces/special chars, single products/ prefix
    assert.doesNotMatch(r.key, /(\.\.\/)|(^products\/.+products\/)|(\s)/);
    assert.match(r.key, /^products\/[0-9a-f-]{36}-[a-z0-9.-]+\.png$/);
});

test('createUploadUrl rejects unsupported content types with 415', async () => {
    const { service } = makeService();
    await assert.rejects(
        () => service.createUploadUrl({ fileName: 'a.exe', contentType: 'application/x-msdownload' }),
        (e) => e instanceof HttpError && e.status === 415,
    );
    await assert.rejects(
        () => service.createUploadUrl({ fileName: 'a.png', contentType: '' }),
        (e) => e.status === 415,
    );
});

test('createUploadUrl falls back to a default name when fileName is empty', async () => {
    const { service } = makeService();
    const r = await service.createUploadUrl({ contentType: 'image/webp' });
    assert.ok(r.key.endsWith('.webp'));
});
