# Start essential services: Docker Desktop (if not running), Tailscale, and docker-compose services
# Run this script as the user that has permissions to start Docker and run docker-compose.

$ErrorActionPreference = 'Stop'

Write-Output "Starting essential services..."

# Try to start Docker Desktop if not running
$dockerServiceNames = @('com.docker.service','Docker Desktop Service')
$dockerStarted = $false
foreach ($name in $dockerServiceNames) {
    try {
        $svc = Get-Service -Name $name -ErrorAction Stop
        if ($svc.Status -ne 'Running') {
            Write-Output "Starting service $name..."
            Start-Service -Name $name
            Start-Sleep -Seconds 5
        }
        $dockerStarted = $true
        break
    } catch {
        # ignore and try next
    }
}

# Fallback: try to start Docker Desktop executable if service not found
if (-not $dockerStarted) {
    $dockerExe = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    if (Test-Path $dockerExe) {
        Write-Output "Launching Docker Desktop executable..."
        Start-Process -FilePath $dockerExe
        Start-Sleep -Seconds 10
    } else {
        Write-Output "Docker service/executable not found. Ensure Docker Desktop is installed."
    }
}

# Start Tailscale service
try {
    $tailsvc = Get-Service -Name Tailscale -ErrorAction Stop
    if ($tailsvc.Status -ne 'Running') {
        Write-Output "Starting Tailscale service..."
        Start-Service -Name Tailscale
        Start-Sleep -Seconds 3
    }
} catch {
    Write-Output "Tailscale service not found. If using Tailscale, ensure it's installed and set to auto-start."
}

# Move to repo root and run docker-compose up -d
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$repoRoot = Resolve-Path "$scriptDir\.."
Set-Location $repoRoot

Write-Output "Bringing up docker-compose services..."
# Use docker compose command
try {
    docker compose up -d --remove-orphans
    Write-Output "docker-compose services started."
} catch {
    Write-Output "Failed to run 'docker compose'. Ensure Docker CLI is available and logged in. Error: $_"
}

# Optionally start other local services (e.g., Next.js in dev mode) - commented out for production
# Write-Output "Starting Next.js (dev) - uncomment if desired"
# Start-Process -FilePath "powershell" -ArgumentList "-NoProfile -ExecutionPolicy Bypass -Command \"cd $repoRoot ; npm run dev -- -H 0.0.0.0 -p 3000\"" -WindowStyle Hidden

Write-Output "Startup script completed."