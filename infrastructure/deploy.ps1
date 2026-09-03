# NovaShop — one-shot AWS deployment (no SAM CLI required; uses AWS CLI v2)
# Usage:
#   .\deploy.ps1 -UserEmail you@example.com -UserPassword 'YourPassw0rd!' [-StackName novashop] [-Region us-east-1] [-Seed]

param(
    [string]$UserEmail = "",
    [string]$UserPassword = "",
    [string]$StackName = "novashop",
    [string]$Region = "",
    [switch]$Seed
)

$ErrorActionPreference = "Stop"

# ---------- 0. Preflight ----------
Write-Host "== NovaShop deploy ==" -ForegroundColor Cyan
if (-not $Region) { $Region = (aws configure get region) ?? "us-east-1" }
$Account = (aws sts get-caller-identity --query Account --output text)
Write-Host "Account: $Account   Region: $Region   Stack: $StackName"

$Root = Split-Path $PSScriptRoot -Parent
$Template = Join-Path $PSScriptRoot "template.yaml"
$Packaged = Join-Path $PSScriptRoot "packaged.yaml"
# template.yaml uses relative CodeUri 'backend/' — run package from the repo root
Push-Location $Root

# ---------- 1. Bootstrap deployment bucket ----------
$Bucket = "$StackName-deploy-$Account-$Region"
aws s3api head-bucket --bucket $Bucket 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Creating deployment bucket: $Bucket"
    aws s3api create-bucket --bucket $Bucket --region $Region `
        $(if ($Region -ne "us-east-1") { "--create-bucket-configuration LocationConstraint=$Region" }) | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to create deployment bucket" }
}

# ---------- 2. Install backend deps ----------
Write-Host "Installing backend dependencies..."
Push-Location "$Root/backend"; npm install --no-audit --no-fund --silent; Pop-Location

# ---------- 3. Run tests (fail fast) ----------
Write-Host "Running backend test suite..."
Push-Location "$Root/backend"; npm test; if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Tests failed — aborting deploy." }; Pop-Location

# ---------- 4. Package + deploy ----------
Write-Host "Packaging Lambda code to s3://$Bucket ..."
aws cloudformation package `
    --template-file $Template `
    --s3-bucket $Bucket --s3-prefix lambda `
    --output-template-file $Packaged | Out-Null

Write-Host "Deploying CloudFormation stack (this takes a few minutes)..."
aws cloudformation deploy `
    --template-file $Packaged `
    --stack-name $StackName `
    --capabilities CAPABILITY_IAM `
    --region $Region `
    --parameter-overrides StageName=prod | Out-Null
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "CloudFormation deploy failed" }

# ---------- 5. Collect outputs ----------
$o = aws cloudformation describe-stacks --stack-name $StackName --region $Region `
    --query "Stacks[0].Outputs" | ConvertFrom-Json
$ApiBaseUrl    = ($o | Where-Object OutputKey -eq "ApiBaseUrl").OutputValue
$UserPoolId    = ($o | Where-Object OutputKey -eq "UserPoolId").OutputValue
$ClientId      = ($o | Where-Object OutputKey -eq "UserPoolClientId").OutputValue
$ImagesBucket  = ($o | Where-Object OutputKey -eq "ImagesBucketName").OutputValue
Pop-Location

Write-Host "`n== Stack outputs ==" -ForegroundColor Green
Write-Host "ApiBaseUrl:       $ApiBaseUrl"
Write-Host "UserPoolId:       $UserPoolId"
Write-Host "UserPoolClientId: $ClientId"
Write-Host "ImagesBucket:     $ImagesBucket"

# ---------- 6. Write frontend/config.js ----------
@"
window.NOVA_CONFIG = {
    apiBaseUrl: '$ApiBaseUrl',
    region: '$Region',
    userPoolId: '$UserPoolId',
    clientId: '$ClientId',
};
"@ | Set-Content -Encoding UTF8 (Join-Path $Root "frontend/config.js")
Write-Host "frontend/config.js updated."

# ---------- 7. Create the Cognito user ----------
if ($UserEmail -and $UserPassword) {
    Write-Host "Creating Cognito user $UserEmail ..."
    aws cognito-idp admin-create-user --user-pool-id $UserPoolId --username $UserEmail `
        --user-attributes Name=email,Value=$UserEmail Name=email_verified,Value=true `
        --message-action SUPPRESS --region $Region | Out-Null
    aws cognito-idp admin-set-password --user-pool-id $UserPoolId --username $UserEmail `
        --password $UserPassword --permanent --region $Region | Out-Null
    Write-Host "User ready — sign in with $UserEmail / your password."
} else {
    Write-Host "Skipping user creation (pass -UserEmail/-UserPassword to create one)."
}

# ---------- 8. Seed the product catalog ----------
if ($Seed) {
    Write-Host "Seeding products into $StackName-products ..."
    $env:PRODUCTS_TABLE = "$StackName-products"
    $env:AWS_REGION = $Region
    Push-Location "$Root/backend"; node seed.mjs; Pop-Location
}

Write-Host "`n✅ Deploy complete. Open frontend/index.html (Live Server) and sign in." -ForegroundColor Green
