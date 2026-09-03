#!/usr/bin/env node
'use strict';

const cdk = require('aws-cdk-lib');
const { NovaShopStack } = require('../lib/novashop-stack');

const app = new cdk.App();
new NovaShopStack(app, 'NovaShopStack', {
    // API Gateway stage name (dev | staging | prod)
    stageName: app.node.tryGetContext('stage') || 'prod',
    // Cognito hosted-UI domain prefix — globally unique, override via -c domain=xxx
    userPoolDomainPrefix: app.node.tryGetContext('domain') || 'novashop-sales-demo',
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION,
    },
});
