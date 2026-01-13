# Database Auto Sync Script
# PostgreSQL データベースを自宅⇔会社で自動同期

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("push", "pull", "auto")]
    [string]$Mode,
    
    [string]$RemoteHost,
    [string]$RemoteUser,
    [string]$RemotePassword,
    [string]$RemotePath = "~/master-hub-backup",
    [string]$Container = "master-hub-postgres",
    [string]$DbName = "master_hub",
    [string]$DbUser = "postgres",
    [int]$IntervalMinutes = 30,
    [switch]$Once
)

$ErrorActionPreference = "Stop"

function Write-ColorLog {
    param($Message, $Color = "White")
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $Message" -ForegroundColor $Color
}

function Get-BackupFileName {
    return "master_hub_backup_$(Get-Date -Format 'yyyyMMdd_HHmmss').sql"
}

function Export-Database {
    param([string]$OutputFile)
    
    Write-ColorLog "Exporting database to $OutputFile..." -Color Yellow
    
    docker exec -t $Container pg_dump -U $DbUser $DbName > $OutputFile
    
    if ($LASTEXITCODE -ne 0) {
        Write-ColorLog "Database export failed!" -Color Red
        return $false
    }
    
    $fileSize = (Get-Item $OutputFile).Length
    Write-ColorLog "Exported: $([math]::Round($fileSize/1MB, 2)) MB" -Color Green
    return $true
}

function Import-Database {
    param([string]$InputFile)
    
    Write-ColorLog "Importing database from $InputFile..." -Color Yellow
    
    # Backup current DB first
    $backupFile = "backup_before_import_$(Get-Date -Format 'yyyyMMdd_HHmmss').sql"
    Write-ColorLog "Creating safety backup: $backupFile" -Color Cyan
    docker exec -t $Container pg_dump -U $DbUser $DbName > $backupFile
    
    # Import
    Get-Content $InputFile | docker exec -i $Container psql -U $DbUser $DbName
    
    if ($LASTEXITCODE -ne 0) {
        Write-ColorLog "Database import failed! Rolling back..." -Color Red
        Get-Content $backupFile | docker exec -i $Container psql -U $DbUser $DbName
        return $false
    }
    
    Write-ColorLog "Database imported successfully." -Color Green
    return $true
}

function Push-DatabaseToRemote {
    Write-ColorLog "=== Push Mode: Upload DB to remote ===" -Color Cyan
    
    # Export local DB
    $localFile = Get-BackupFileName
    if (-not (Export-Database -OutputFile $localFile)) {
        return $false
    }
    
    # Upload via SCP (requires SSH/SCP setup)
    if ($RemoteHost) {
        Write-ColorLog "Uploading to ${RemoteUser}@${RemoteHost}:${RemotePath}..." -Color Yellow
        
        # Using scp
        scp $localFile "${RemoteUser}@${RemoteHost}:${RemotePath}/${localFile}"
        
        if ($LASTEXITCODE -ne 0) {
            Write-ColorLog "Upload failed!" -Color Red
            return $false
        }
        
        Write-ColorLog "Uploaded successfully." -Color Green
    } else {
        Write-ColorLog "No remote host specified. Backup saved locally: $localFile" -Color Yellow
    }
    
    return $true
}

function Pull-DatabaseFromRemote {
    Write-ColorLog "=== Pull Mode: Download DB from remote ===" -Color Cyan
    
    if (-not $RemoteHost) {
        Write-ColorLog "Error: RemoteHost is required for pull mode." -Color Red
        return $false
    }
    
    # Get latest backup file from remote
    Write-ColorLog "Finding latest backup on ${RemoteUser}@${RemoteHost}..." -Color Yellow
    
    $remoteLatest = ssh "${RemoteUser}@${RemoteHost}" "ls -t ${RemotePath}/master_hub_backup_*.sql 2>/dev/null | head -n1"
    
    if (-not $remoteLatest) {
        Write-ColorLog "No backup found on remote." -Color Red
        return $false
    }
    
    Write-ColorLog "Latest remote backup: $remoteLatest" -Color Cyan
    
    # Download
    $localFile = Split-Path $remoteLatest -Leaf
    scp "${RemoteUser}@${RemoteHost}:${remoteLatest}" $localFile
    
    if ($LASTEXITCODE -ne 0) {
        Write-ColorLog "Download failed!" -Color Red
        return $false
    }
    
    Write-ColorLog "Downloaded successfully." -Color Green
    
    # Import
    return Import-Database -InputFile $localFile
}

function Sync-DatabaseAuto {
    Write-ColorLog "=== Auto Mode: Bidirectional sync ===" -Color Cyan
    
    # Compare local vs remote timestamps
    # For simplicity, we'll use "last modified wins" strategy
    
    if (-not $RemoteHost) {
        Write-ColorLog "Error: RemoteHost is required for auto mode." -Color Red
        return $false
    }
    
    # Get local DB last modified time (from pg_stat_database)
    Write-ColorLog "Checking local database modification time..." -Color Yellow
    $localTime = docker exec -t $Container psql -U $DbUser -d $DbName -t -c "SELECT stats_reset FROM pg_stat_database WHERE datname='$DbName'" 2>$null | Out-String
    $localTime = $localTime.Trim()
    
    # Get remote DB last modified time
    Write-ColorLog "Checking remote database modification time..." -Color Yellow
    $remoteTime = ssh "${RemoteUser}@${RemoteHost}" "docker exec -t $Container psql -U $DbUser -d $DbName -t -c \"SELECT stats_reset FROM pg_stat_database WHERE datname='$DbName'\" 2>/dev/null" | Out-String
    $remoteTime = $remoteTime.Trim()
    
    Write-ColorLog "Local time: $localTime" -Color Cyan
    Write-ColorLog "Remote time: $remoteTime" -Color Cyan
    
    # For now, use simple file timestamp check instead
    # Export local
    $localFile = "local_" + (Get-BackupFileName)
    if (-not (Export-Database -OutputFile $localFile)) {
        return $false
    }
    $localTimestamp = (Get-Item $localFile).LastWriteTime
    
    # Get remote latest
    $remoteLatest = ssh "${RemoteUser}@${RemoteHost}" "ls -t ${RemotePath}/master_hub_backup_*.sql 2>/dev/null | head -n1"
    
    if ($remoteLatest) {
        $remoteTimestampStr = ssh "${RemoteUser}@${RemoteHost}" "stat -c %Y ${remoteLatest} 2>/dev/null"
        $remoteTimestamp = [DateTimeOffset]::FromUnixTimeSeconds($remoteTimestampStr).LocalDateTime
        
        Write-ColorLog "Local DB: $localTimestamp" -Color Cyan
        Write-ColorLog "Remote DB: $remoteTimestamp" -Color Cyan
        
        if ($localTimestamp -gt $remoteTimestamp) {
            Write-ColorLog "Local is newer. Pushing..." -Color Green
            return Push-DatabaseToRemote
        } else {
            Write-ColorLog "Remote is newer. Pulling..." -Color Green
            return Pull-DatabaseFromRemote
        }
    } else {
        Write-ColorLog "No remote backup found. Pushing..." -Color Yellow
        return Push-DatabaseToRemote
    }
}

# Main execution
Write-ColorLog "=====================================" -Color Cyan
Write-ColorLog "  Master Hub DB Sync                " -Color Cyan
Write-ColorLog "=====================================" -Color Cyan

# Validate Docker container
Write-ColorLog "Checking Docker container: $Container" -Color Yellow
$containerStatus = docker ps --filter "name=$Container" --format "{{.Status}}" 2>$null

if (-not $containerStatus) {
    Write-ColorLog "Error: Container '$Container' is not running." -Color Red
    Write-ColorLog "Start it with: npm run docker:up" -Color Yellow
    exit 1
}

Write-ColorLog "Container is running." -Color Green

# Execute sync based on mode
if ($Once) {
    switch ($Mode) {
        "push" { Push-DatabaseToRemote }
        "pull" { Pull-DatabaseFromRemote }
        "auto" { Sync-DatabaseAuto }
    }
} else {
    # Continuous mode
    Write-ColorLog "Starting continuous sync (interval: $IntervalMinutes minutes)" -Color Cyan
    Write-ColorLog "Press Ctrl+C to stop" -Color Yellow
    
    while ($true) {
        switch ($Mode) {
            "push" { Push-DatabaseToRemote }
            "pull" { Pull-DatabaseFromRemote }
            "auto" { Sync-DatabaseAuto }
        }
        
        $seconds = $IntervalMinutes * 60
        Write-ColorLog "Waiting $IntervalMinutes minutes until next sync..." -Color DarkGray
        Start-Sleep -Seconds $seconds
    }
}
