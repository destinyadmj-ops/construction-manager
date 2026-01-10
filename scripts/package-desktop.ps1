# Package Desktop App (Electron)
# Master Hub Desktop アプリをビルドしてインストーラを生成

param(
    [switch]$SkipBuild,
    [switch]$DirOnly,
    [string]$MasterHubUrl = "http://localhost:3001"
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
    Write-Host "`n[1/5] Building Next.js production..." -ForegroundColor Yellow
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Build failed!" -ForegroundColor Red
        exit 1
    }
    Write-Host "Build completed." -ForegroundColor Green
} else {
    Write-Host "`n[1/5] Skipping Next.js build." -ForegroundColor Yellow
}

# 2. Install desktop dependencies
Write-Host "`n[2/5] Installing desktop dependencies..." -ForegroundColor Yellow
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

# 3. Set environment variable for MASTER_HUB_URL
Write-Host "`n[3/5] Setting MASTER_HUB_URL: $MasterHubUrl" -ForegroundColor Yellow
$env:MASTER_HUB_URL = $MasterHubUrl

# 4. Generate icons and build
Write-Host "`n[4/5] Generating icons..." -ForegroundColor Yellow
node generate-icons.mjs
if ($LASTEXITCODE -ne 0) {
    Write-Host "Icon generation failed!" -ForegroundColor Red
    Pop-Location
    exit 1
}
Write-Host "Icons generated." -ForegroundColor Green

# 5. Package with electron-builder
Write-Host "`n[5/5] Packaging with electron-builder..." -ForegroundColor Yellow
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
