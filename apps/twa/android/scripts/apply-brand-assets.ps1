<#
Place your brand PNGs under `apps/twa/android/brand-assets/` with these names (one-per-density optional):
  - ic_launcher.png (default adaptive launcher)
  - ic_maskable.png
  - ic_notification_icon.png
  - splash.png

This script copies available assets into the appropriate `res/` folders.
#>
param(
  [string]$ProjectRoot = "$(Split-Path -Parent $PSCommandPath)/.."
)

Write-Host "Applying brand assets from $ProjectRoot/brand-assets ..."

$assetsDir = Join-Path $ProjectRoot 'brand-assets'
if (-not (Test-Path $assetsDir)) {
  Write-Host "No brand-assets folder found at $assetsDir. Create it and add images then re-run." -ForegroundColor Yellow
  exit 1
}

function CopyIfExists($src, $dest) {
  if (Test-Path $src) {
    New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
    Copy-Item -Force $src $dest
    Write-Host "Copied $src -> $dest"
  }
}

$resRoot = Join-Path $ProjectRoot 'app\src\main\res'

# Launcher adaptive: copy foreground to mipmap-anydpi-v26/ic_maskable.xml -> use bitmap if provided
CopyIfExists (Join-Path $assetsDir 'ic_maskable.png') (Join-Path $resRoot 'mipmap\ic_maskable.png')
CopyIfExists (Join-Path $assetsDir 'ic_launcher.png') (Join-Path $resRoot 'mipmap-anydpi-v26\ic_launcher.png')

# Notification icon
CopyIfExists (Join-Path $assetsDir 'ic_notification_icon.png') (Join-Path $resRoot 'drawable\ic_notification_icon.png')

# Splash
CopyIfExists (Join-Path $assetsDir 'splash.png') (Join-Path $resRoot 'drawable\splash.png')

Write-Host "Assets applied. You can now rebuild:"
Write-Host "  cd apps/twa/android ; .\gradlew.bat assembleRelease"
