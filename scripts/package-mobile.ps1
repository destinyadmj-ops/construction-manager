# Package Mobile App (Capacitor)
# Master Hub Mobile アプリをビルドしてネイティブプロジェクトを生成

param(
    [switch]$SkipBuild,
    [ValidateSet("ios", "android", "both")]
    [string]$Platform = "both",
    [switch]$Open
)

$ErrorActionPreference = "Stop"

Write-Host "=== Master Hub Mobile Packaging ===" -ForegroundColor Cyan

# Check if we're in the root directory
if (-not (Test-Path "apps/mobile")) {
    Write-Host "Error: apps/mobile not found. Run this from the project root." -ForegroundColor Red
    exit 1
}

# 1. Build Next.js production if not skipped
if (-not $SkipBuild) {
    Write-Host "`n[1/4] Building Next.js production..." -ForegroundColor Yellow
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Build failed!" -ForegroundColor Red
        exit 1
    }
    Write-Host "Build completed." -ForegroundColor Green
} else {
    Write-Host "`n[1/4] Skipping Next.js build." -ForegroundColor Yellow
}

# 2. Install mobile dependencies
Write-Host "`n[2/4] Installing mobile dependencies..." -ForegroundColor Yellow
Push-Location apps/mobile
if (-not (Test-Path "node_modules")) {
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Mobile npm install failed!" -ForegroundColor Red
        Pop-Location
        exit 1
    }
}
Write-Host "Dependencies ready." -ForegroundColor Green

# 3. Copy Next.js build to mobile
Write-Host "`n[3/4] Copying Next.js build to mobile..." -ForegroundColor Yellow
if (Test-Path "../../.next") {
    if (-not (Test-Path "www")) {
        New-Item -ItemType Directory -Path "www" | Out-Null
    }
    
    # Copy standalone build or static export
    if (Test-Path "../../out") {
        Write-Host "Copying static export from /out..." -ForegroundColor Cyan
        Copy-Item -Path "../../out/*" -Destination "www/" -Recurse -Force
    } else {
        Write-Host "Note: For mobile, consider adding 'output: export' to next.config.ts" -ForegroundColor Yellow
        Write-Host "Using .next/static as fallback..." -ForegroundColor Cyan
        Copy-Item -Path "../../.next/static" -Destination "www/static" -Recurse -Force
        Copy-Item -Path "../../public/*" -Destination "www/" -Recurse -Force
    }
    
    Write-Host "Build copied." -ForegroundColor Green
} else {
    Write-Host "Warning: .next build not found. Run npm run build first." -ForegroundColor Yellow
}

# 4. Sync with Capacitor
Write-Host "`n[4/4] Syncing with Capacitor..." -ForegroundColor Yellow

if ($Platform -eq "ios" -or $Platform -eq "both") {
    Write-Host "Syncing iOS..." -ForegroundColor Cyan
    npx cap sync ios
    if ($LASTEXITCODE -ne 0) {
        Write-Host "iOS sync failed!" -ForegroundColor Red
        Pop-Location
        exit 1
    }
}

if ($Platform -eq "android" -or $Platform -eq "both") {
    Write-Host "Syncing Android..." -ForegroundColor Cyan
    npx cap sync android
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Android sync failed!" -ForegroundColor Red
        Pop-Location
        exit 1
    }
}

Write-Host "Capacitor sync completed." -ForegroundColor Green

# 5. Open native IDE if requested
if ($Open) {
    Write-Host "`nOpening native IDE..." -ForegroundColor Yellow
    
    if ($Platform -eq "ios" -or $Platform -eq "both") {
        Write-Host "Opening Xcode..." -ForegroundColor Cyan
        npx cap open ios
    }
    
    if ($Platform -eq "android" -or $Platform -eq "both") {
        Write-Host "Opening Android Studio..." -ForegroundColor Cyan
        npx cap open android
    }
}

Pop-Location

# Show results
Write-Host "`n=== Mobile Packaging Complete! ===" -ForegroundColor Green

if ($Platform -eq "ios" -or $Platform -eq "both") {
    Write-Host "`niOS project: apps/mobile/ios/" -ForegroundColor Cyan
    Write-Host "  - Open in Xcode and build for device/simulator" -ForegroundColor White
}

if ($Platform -eq "android" -or $Platform -eq "both") {
    Write-Host "`nAndroid project: apps/mobile/android/" -ForegroundColor Cyan
    Write-Host "  - Open in Android Studio and build APK/AAB" -ForegroundColor White
}

Write-Host "`nNext steps:" -ForegroundColor Yellow
Write-Host "  1. Open native IDE (Xcode/Android Studio)" -ForegroundColor White
Write-Host "  2. Configure signing (iOS: Team, Android: Keystore)" -ForegroundColor White
Write-Host "  3. Build for production/release" -ForegroundColor White
