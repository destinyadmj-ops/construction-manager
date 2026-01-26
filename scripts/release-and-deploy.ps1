<#
Release and Deploy helper

Edit the variables in the "Config" section below, then run this script from repository root in PowerShell:

  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release-and-deploy.ps1

Requirements:
- gh CLI (https://cli.github.com/) and authenticated
- npm/node
- git
#>

### Config - edit these
# Auto-detected from repository: https://github.com/destinyadmj-ops/construction-manager.git
$Owner = 'destinyadmj-ops'    # user or org
$Repo  = 'construction-manager'            # repository name
$Tag   = 'v0.1.0'               # release tag to create (uses package.json version by default)

# Test mode: when $DryRun is $true the script will skip uploading to GitHub Releases
# and publishing gh-pages. Set to $false to perform real uploads.
$DryRun = $false

### End config

Set-StrictMode -Version Latest

function Check-Command($name) {
    $p = Get-Command $name -ErrorAction SilentlyContinue
    if (-not $p) { Write-Error "Required command not found: $name"; exit 1 }
}

Check-Command gh
Check-Command npm
Check-Command git

Write-Host "Owner: $Owner  Repo: $Repo  Tag: $Tag" -ForegroundColor Cyan

function Run($cmd) {
    Write-Host "==> $cmd" -ForegroundColor Yellow
    iex $cmd
    if ($LASTEXITCODE -ne 0) { throw "Command failed: $cmd" }
}

try {
    # Build web
    Write-Host "Building web..." -ForegroundColor Green
    Run 'npm run build'

    # Package desktop
    Write-Host "Packaging desktop..." -ForegroundColor Green
    Run 'npm run package:desktop'

    # Locate desktop asset
    $desktopDir = Join-Path $PSScriptRoot '..\apps\desktop\dist' | Resolve-Path
    $exe = Get-ChildItem -Path $desktopDir -Filter '*.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $exe) { Write-Warning "Desktop installer not found in $desktopDir" }

    # Locate Android APK/AAB
    $apk = Get-ChildItem -Path (Join-Path $PSScriptRoot '..\apps\mobile') -Include '*.apk','*.aab' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $apk) { Write-Warning "Android APK/AAB not found under apps/mobile" }

    # Create or ensure release exists (skip in DryRun)
    if (-not $DryRun) {
        $releaseCheck = gh release view $Tag --repo "$Owner/$Repo" 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Creating release $Tag" -ForegroundColor Green
            gh release create $Tag -t "$Tag" -n "Release $Tag" --repo "$Owner/$Repo"
        } else {
            Write-Host "Release $Tag already exists (will upload assets)." -ForegroundColor Green
        }

        $assets = @()
        if ($exe) { $assets += $exe.FullName }
        if ($apk) { $assets += $apk.FullName }

        if ($assets.Count -gt 0) {
            Write-Host "Uploading assets to release $Tag" -ForegroundColor Green
            gh release upload $Tag $assets --clobber --repo "$Owner/$Repo"

            # Generate and upload checksums
            foreach ($a in $assets) {
                $hash = Get-FileHash -Path $a -Algorithm SHA256
                $sumFile = "$a.sha256"
                "$($hash.Hash)  $([IO.Path]::GetFileName($a))" | Out-File -FilePath $sumFile -Encoding utf8
                gh release upload $Tag $sumFile --repo "$Owner/$Repo" --clobber
            }
        } else {
            Write-Host "No assets found to upload." -ForegroundColor Yellow
        }
    } else {
        Write-Host "DryRun: skipping GitHub Releases create/upload." -ForegroundColor Yellow
        $assets = @()
        if ($exe) { $assets += $exe.FullName }
        if ($apk) { $assets += $apk.FullName }
        if ($assets.Count -gt 0) {
            Write-Host "DryRun: assets that would be uploaded:" -ForegroundColor Yellow
            $assets | ForEach-Object { Write-Host " - $_" }
        } else {
            Write-Host "DryRun: no assets found to upload." -ForegroundColor Yellow
        }
    }

    # Export static PWA (Next export) - skip in DryRun if export script is absent
    if (-not $DryRun) {
        Write-Host "Exporting static site (PWA)..." -ForegroundColor Green
        Run 'npm run export'
        $outDir = Join-Path $PSScriptRoot '..\out'
        if (-not (Test-Path $outDir)) {
            Write-Error "Export output not found at $outDir"; exit 1
        }
    } else {
        Write-Host "DryRun: skipping export. Expected out dir: ..\\out" -ForegroundColor Yellow
        $outDir = Join-Path $PSScriptRoot '..\out'
    }

    # Publish to gh-pages using gh-pages via npx (skip in DryRun)
    if (-not $DryRun) {
        Write-Host "Publishing PWA to GitHub Pages (branch gh-pages)" -ForegroundColor Green
        npx gh-pages -d $outDir -r "https://github.com/$Owner/$Repo.git" -b gh-pages -m "Publish PWA $Tag"
    } else {
        Write-Host "DryRun: skipping gh-pages publish. Out directory: $outDir" -ForegroundColor Yellow
    }

    # Print URLs
    $releaseUrl = "https://github.com/$Owner/$Repo/releases/tag/$Tag"
    $pagesUrl = "https://$Owner.github.io/$Repo/"
    Write-Host "\nRelease URL: $releaseUrl" -ForegroundColor Cyan
    Write-Host "PWA URL: $pagesUrl" -ForegroundColor Cyan

    Write-Host "Done." -ForegroundColor Green
} catch {
    Write-Error "Failed: $($_.Exception.Message)"
    exit 1
}
