Param(
  [Parameter(Mandatory = $true)]
  [string]$OutDir,

  [Parameter(Mandatory = $false)]
  [string[]]$VolumeNames,

  [Parameter(Mandatory = $false)]
  [string[]]$VolumeSuffixes = @('masterhub_storage', 'masterhub_outbox', 'masterhub_redisdata'),

  [Parameter(Mandatory = $false)]
  [string]$ProjectName,

  [Parameter(Mandatory = $false)]
  [int]$KeepDays = 14,

  [Parameter(Mandatory = $false)]
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Ensure-Directory([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path | Out-Null
  }
}

function Get-RepoRoot() {
  return Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
}

function Normalize-ProjectName([string]$Name) {
  $normalized = $Name.ToLowerInvariant()
  $normalized = [regex]::Replace($normalized, '[^a-z0-9_-]+', '')
  $normalized = $normalized.Trim('_', '-')
  if ([string]::IsNullOrWhiteSpace($normalized)) {
    throw 'Project name could not be resolved. Pass -ProjectName explicitly.'
  }

  return $normalized
}

function Resolve-ProjectName() {
  if (-not [string]::IsNullOrWhiteSpace($ProjectName)) {
    return Normalize-ProjectName $ProjectName
  }

  if (-not [string]::IsNullOrWhiteSpace($env:COMPOSE_PROJECT_NAME)) {
    return Normalize-ProjectName $env:COMPOSE_PROJECT_NAME
  }

  $repoRoot = Get-RepoRoot
  return Normalize-ProjectName (Split-Path -Leaf $repoRoot)
}

function Resolve-VolumeNames() {
  if ($VolumeNames -and $VolumeNames.Count -gt 0) {
    return $VolumeNames
  }

  $resolvedProjectName = Resolve-ProjectName
  $resolved = @()
  foreach ($suffix in $VolumeSuffixes) {
    if ([string]::IsNullOrWhiteSpace($suffix)) { continue }
    $resolved += ('{0}_{1}' -f $resolvedProjectName, $suffix.Trim())
  }

  return $resolved
}

function Get-DockerExecutable() {
  $docker = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $docker) {
    throw 'docker command not found. Install Docker Desktop or Docker Engine first.'
  }

  return $docker.Source
}

function Test-VolumeExists([string]$DockerExe, [string]$VolumeName) {
  & $DockerExe volume inspect $VolumeName *> $null
  return $LASTEXITCODE -eq 0
}

function Safe-ArchiveName([string]$Name) {
  return ($Name -replace '[^A-Za-z0-9._-]+', '_')
}

function Invoke-VolumeArchive(
  [string]$DockerExe,
  [string]$VolumeName,
  [string]$OutPath,
  [switch]$DryRun
) {
  $resolvedOutDir = (Resolve-Path -LiteralPath (Split-Path -Parent $OutPath)).ProviderPath
  $archiveName = Split-Path -Leaf $OutPath

  if ($DryRun) {
    Write-Host ('[dry-run] docker run --rm -v {0}:/volume:ro -v {1}:/backup alpine:3.20 sh -lc "tar -czf /backup/{2} -C /volume ."' -f $VolumeName, $resolvedOutDir, $archiveName) -ForegroundColor Yellow
    return
  }

  & $DockerExe run --rm --pull=missing `
    -v "${VolumeName}:/volume:ro" `
    -v "${resolvedOutDir}:/backup" `
    alpine:3.20 `
    sh -lc "tar -czf '/backup/$archiveName' -C /volume ."

  if ($LASTEXITCODE -ne 0) {
    throw ("docker run failed while archiving volume: {0}" -f $VolumeName)
  }
}

function Prune-OldArchives([string]$Dir, [int]$KeepDays, [switch]$DryRun) {
  if ($KeepDays -lt 1) { return 0 }

  $cutoff = (Get-Date).AddDays(-$KeepDays)
  $removed = 0
  $files = Get-ChildItem -LiteralPath $Dir -File -Filter 'volume_*.tar.gz' -ErrorAction SilentlyContinue
  foreach ($file in $files) {
    if ($file.LastWriteTime -ge $cutoff) { continue }

    if ($DryRun) {
      Write-Host ("[dry-run] prune {0}" -f $file.FullName) -ForegroundColor DarkYellow
    } else {
      Remove-Item -LiteralPath $file.FullName -Force
    }

    $removed++
  }

  return $removed
}

try {
  Ensure-Directory $OutDir
  $volumeOutDir = Join-Path $OutDir 'volumes'
  Ensure-Directory $volumeOutDir

  $dockerExe = Get-DockerExecutable
  $resolvedVolumes = Resolve-VolumeNames
  if ((@($resolvedVolumes)).Count -eq 0) {
    throw 'No volumes resolved. Pass -VolumeNames or adjust -VolumeSuffixes.'
  }

  $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
  $backedUp = 0
  $missing = @()

  foreach ($volumeName in $resolvedVolumes) {
    if (-not (Test-VolumeExists -DockerExe $dockerExe -VolumeName $volumeName)) {
      $missing += $volumeName
      Write-Warning ("Volume not found: {0}" -f $volumeName)
      continue
    }

    $safeName = Safe-ArchiveName $volumeName
    $archivePath = Join-Path $volumeOutDir ("volume_{0}_{1}.tar.gz" -f $safeName, $stamp)
    Write-Host ("Archiving volume: {0}" -f $volumeName) -ForegroundColor Cyan
    Invoke-VolumeArchive -DockerExe $dockerExe -VolumeName $volumeName -OutPath $archivePath -DryRun:$DryRun
    Write-Host ("OK: {0}" -f $archivePath) -ForegroundColor Green
    $backedUp++
  }

  if ($backedUp -eq 0) {
    throw 'No Docker volumes were archived. Check -ProjectName or -VolumeNames.'
  }

  $removed = Prune-OldArchives -Dir $volumeOutDir -KeepDays $KeepDays -DryRun:$DryRun
  Write-Host ("Pruned: {0}" -f $removed) -ForegroundColor DarkGray

  if ($missing.Count -gt 0) {
    Write-Host ("Missing volumes: {0}" -f ($missing -join ', ')) -ForegroundColor Yellow
  }
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 1
}