# Package Desktop App (Electron)
# Master Hub Desktop アプリをビルドしてインストーラを生成

param(
    [switch]$SkipBuild,
    [switch]$DirOnly,
    [string]$MasterHubUrl = "http://localhost:3001",
    [string]$DesktopReleaseUrl = ""
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
    npx electron-builder --dir
} else {
    Write-Host "Building installer..." -ForegroundColor Cyan
    npx electron-builder
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
