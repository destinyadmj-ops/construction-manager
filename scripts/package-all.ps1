# Package All Apps (Web + Desktop + Mobile)
# Master Hub の全プラットフォームをビルド・パッケージング

param(
    [switch]$DesktopOnly,
    [switch]$MobileOnly,
    [switch]$WebOnly,
    [string]$DesktopUrl = "http://localhost:3000",
    [string]$DesktopReleaseUrl = ""
)

$ErrorActionPreference = "Continue"

Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "  Master Hub - Full Package Build   " -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan

$startTime = Get-Date

# Build Web (always needed unless skipped)
if (-not $MobileOnly -and -not $DesktopOnly) {
    Write-Host "`n[Web] Building production..." -ForegroundColor Yellow
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Web build failed!" -ForegroundColor Red
        exit 1
    }
    Write-Host "[Web] Build completed." -ForegroundColor Green
}

# Package Desktop
if (-not $MobileOnly -and -not $WebOnly) {
    Write-Host "`n[Desktop] Packaging Electron app..." -ForegroundColor Yellow
    & "$PSScriptRoot/package-desktop.ps1" -SkipBuild -MasterHubUrl $DesktopUrl -DesktopReleaseUrl $DesktopReleaseUrl
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[Desktop] Packaging failed!" -ForegroundColor Red
    } else {
        Write-Host "[Desktop] Packaging completed." -ForegroundColor Green
    }
}

# Package Mobile
if (-not $DesktopOnly -and -not $WebOnly) {
    Write-Host "`n[Mobile] Packaging Capacitor app..." -ForegroundColor Yellow
    & "$PSScriptRoot/package-mobile.ps1" -SkipBuild -Platform both
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[Mobile] Packaging failed!" -ForegroundColor Red
    } else {
        Write-Host "[Mobile] Packaging completed." -ForegroundColor Green
    }
}

$endTime = Get-Date
$duration = $endTime - $startTime

Write-Host "`n=====================================" -ForegroundColor Green
Write-Host "  All Packaging Complete!           " -ForegroundColor Green
Write-Host "=====================================" -ForegroundColor Green
Write-Host "Duration: $($duration.ToString('mm\:ss'))" -ForegroundColor Cyan

Write-Host "`nOutput locations:" -ForegroundColor Yellow
if (-not $MobileOnly -and -not $DesktopOnly) {
    Write-Host "  - Web: .next/ (for production server)" -ForegroundColor White
}
if (-not $MobileOnly -and -not $WebOnly) {
    Write-Host "  - Desktop: apps/desktop/dist/" -ForegroundColor White
}
if (-not $DesktopOnly -and -not $WebOnly) {
    Write-Host "  - Mobile: apps/mobile/ios/ and apps/mobile/android/" -ForegroundColor White
}

Write-Host "`nDistribution ready!" -ForegroundColor Green
