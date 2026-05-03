# Package Desktop App (Electron)
# Master Hub Desktop アプリをビルドしてインストーラを生成

param(
    [switch]$SkipBuild,
    [switch]$DirOnly,
    [string]$MasterHubUrl = "http://localhost:3000",
    [string]$DesktopReleaseUrl = "",
    [string]$DesktopVersion = "",
    [string]$WindowsCertFile = "",
    [string]$WindowsCertPassword = "",
    [string]$WindowsCertSha1 = ""
)

$ErrorActionPreference = "Stop"

Write-Host "=== Master Hub Desktop Packaging ===" -ForegroundColor Cyan

# Check if we're in the root directory
if (-not (Test-Path "apps/desktop")) {
    Write-Host "Error: apps/desktop not found. Run this from the project root." -ForegroundColor Red
    exit 1
}

# 1. Build Next.js production if not skipped
if (-not $SkipBuild) {
    Write-Host "`n[1/6] Building Next.js production..." -ForegroundColor Yellow
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Build failed!" -ForegroundColor Red
        exit 1
    }
    Write-Host "Build completed." -ForegroundColor Green
} else {
    Write-Host "`n[1/6] Skipping Next.js build." -ForegroundColor Yellow
}

# 2. Install desktop dependencies
Write-Host "`n[2/6] Installing desktop dependencies..." -ForegroundColor Yellow
Push-Location apps/desktop
if (-not (Test-Path "node_modules")) {
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Desktop npm install failed!" -ForegroundColor Red
        Pop-Location
        exit 1
    }
}
Write-Host "Dependencies ready." -ForegroundColor Green

$builderArgs = @()

if (-not [string]::IsNullOrWhiteSpace($DesktopVersion)) {
    if ($DesktopVersion -notmatch '^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)*$') {
        Write-Host "DesktopVersion must look like 0.1.1 or 0.1.1-beta.1" -ForegroundColor Red
        Pop-Location
        exit 1
    }
    Write-Host "Overriding desktop version: $DesktopVersion" -ForegroundColor Yellow
    $builderArgs += "--config.extraMetadata.version=$DesktopVersion"
}

$signingConfigured = $false

if (-not [string]::IsNullOrWhiteSpace($WindowsCertFile)) {
    if (-not (Test-Path $WindowsCertFile)) {
        Write-Host "Code signing certificate not found: $WindowsCertFile" -ForegroundColor Red
        Pop-Location
        exit 1
    }

    $resolvedCertFile = (Resolve-Path $WindowsCertFile).Path
    $env:CSC_LINK = $resolvedCertFile
    $signingConfigured = $true
    Write-Host "Using Windows signing certificate: $resolvedCertFile" -ForegroundColor Yellow
}

if (-not [string]::IsNullOrWhiteSpace($WindowsCertPassword)) {
    $env:CSC_KEY_PASSWORD = $WindowsCertPassword
    $signingConfigured = $true
    Write-Host "Using Windows signing certificate password from script parameter." -ForegroundColor Yellow
}

if (-not [string]::IsNullOrWhiteSpace($WindowsCertSha1)) {
    $builderArgs += "--config.win.certificateSha1=$WindowsCertSha1"
    $signingConfigured = $true
    Write-Host "Using Windows signing certificate thumbprint: $WindowsCertSha1" -ForegroundColor Yellow
}

if (-not $signingConfigured -and (
    -not [string]::IsNullOrWhiteSpace($env:CSC_LINK) -or
    -not [string]::IsNullOrWhiteSpace($env:WIN_CSC_LINK) -or
    -not [string]::IsNullOrWhiteSpace($env:CSC_NAME)
)) {
    $signingConfigured = $true
}

if ($signingConfigured) {
    Write-Host "Windows code signing is enabled for this build." -ForegroundColor Green
} else {
    Write-Host "Windows code signing is not configured; the installer will be unsigned." -ForegroundColor Yellow
}

# 3. Set environment variables for desktop runtime
Write-Host "`n[3/6] Setting MASTER_HUB_URL: $MasterHubUrl" -ForegroundColor Yellow
$env:MASTER_HUB_URL = $MasterHubUrl
if (-not [string]::IsNullOrWhiteSpace($DesktopReleaseUrl)) {
    Write-Host "Setting MASTER_HUB_UPDATE_URL: $DesktopReleaseUrl" -ForegroundColor Yellow
    $env:MASTER_HUB_UPDATE_URL = $DesktopReleaseUrl
}

# 4. Persist runtime config into the packaged app
Write-Host "`n[4/6] Writing runtime config..." -ForegroundColor Yellow
$runtimeConfig = [ordered]@{
    masterHubUrl = $MasterHubUrl
}
if (-not [string]::IsNullOrWhiteSpace($DesktopReleaseUrl)) {
    $runtimeConfig.desktopReleaseUrl = $DesktopReleaseUrl
}
$runtimeConfigPath = Join-Path (Get-Location) "build/runtime-config.json"
$runtimeConfig | ConvertTo-Json | Set-Content -Path $runtimeConfigPath -Encoding UTF8
Write-Host "Runtime config written: $runtimeConfigPath" -ForegroundColor Green

# 5. Generate icons and build
Write-Host "`n[5/6] Generating icons..." -ForegroundColor Yellow
node generate-icons.mjs
if ($LASTEXITCODE -ne 0) {
    Write-Host "Icon generation failed!" -ForegroundColor Red
    Pop-Location
    exit 1
}
Write-Host "Icons generated." -ForegroundColor Green

# 6. Package with electron-builder
Write-Host "`n[6/6] Packaging with electron-builder..." -ForegroundColor Yellow
if ($DirOnly) {
    Write-Host "Building unpacked directory only..." -ForegroundColor Cyan
    & npx electron-builder --dir @builderArgs
} else {
    Write-Host "Building installer..." -ForegroundColor Cyan
    & npx electron-builder @builderArgs
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "Packaging failed!" -ForegroundColor Red
    Pop-Location
    exit 1
}

Pop-Location

# Show results
Write-Host "`n=== Packaging Complete! ===" -ForegroundColor Green
Write-Host "`nOutput directory: apps/desktop/dist/" -ForegroundColor Cyan

if (Test-Path "apps/desktop/dist") {
    Write-Host "`nGenerated files:" -ForegroundColor Yellow
    Get-ChildItem -Path "apps/desktop/dist" -File | ForEach-Object {
        $size = [math]::Round($_.Length / 1MB, 2)
        Write-Host "  - $($_.Name) ($size MB)" -ForegroundColor White
    }
}

Write-Host "`nInstaller can be distributed to users." -ForegroundColor Green
Write-Host "Default URL: $MasterHubUrl" -ForegroundColor Cyan
if (-not [string]::IsNullOrWhiteSpace($DesktopReleaseUrl)) {
    Write-Host "Release info URL: $DesktopReleaseUrl" -ForegroundColor Cyan
} else {
    Write-Host "Release info URL: <app-origin>/api/desktop-release" -ForegroundColor Cyan
}
