# Simple Database Sync (File-based)
# ファイル共有フォルダ経由でDB同期（VPN/共有ドライブ利用）

param(
    [Parameter(Mandatory=$true)]
    [string]$SharedFolder,
    
    [string]$Container = "master-hub-postgres",
    [string]$DbName = "master_hub",
    [string]$DbUser = "postgres",
    [int]$IntervalMinutes = 30,
    [switch]$Once,
    [switch]$AutoMode = $true
)

$ErrorActionPreference = "Continue"

function Write-ColorLog {
    param($Message, $Color = "White")
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $Message" -ForegroundColor $Color
}

function Get-LocalDbHash {
    # Get a quick hash of database content (row counts + last update times)
    $query = @"
SELECT 
    SUM(n_live_tup) as total_rows,
    MAX(last_vacuum) as last_change
FROM pg_stat_user_tables;
"@
    
    $result = docker exec -t $Container psql -U $DbUser -d $DbName -t -c $query 2>$null | Out-String
    return $result.Trim()
}

function Export-LocalDatabase {
    param([string]$OutputFile)
    
    Write-ColorLog "Exporting local database..." -Color Yellow
    
    docker exec -t $Container pg_dump -U $DbUser $DbName > $OutputFile
    
    if ($LASTEXITCODE -ne 0) {
        Write-ColorLog "Export failed!" -Color Red
        return $false
    }
    
    $fileSize = (Get-Item $OutputFile).Length
    Write-ColorLog "Exported: $([math]::Round($fileSize/1MB, 2)) MB" -Color Green
    return $true
}

function Import-RemoteDatabase {
    param([string]$InputFile)
    
    Write-ColorLog "Importing remote database..." -Color Yellow
    
    # Safety backup
    $safetyBackup = "backup_before_sync_$(Get-Date -Format 'yyyyMMdd_HHmmss').sql"
    Write-ColorLog "Creating safety backup: $safetyBackup" -Color Cyan
    docker exec -t $Container pg_dump -U $DbUser $DbName > $safetyBackup 2>$null
    
    # Clear existing data and import
    Get-Content $InputFile | docker exec -i $Container psql -U $DbUser $DbName 2>$null
    
    if ($LASTEXITCODE -ne 0) {
        Write-ColorLog "Import failed!" -Color Red
        return $false
    }
    
    Write-ColorLog "Database imported successfully." -Color Green
    return $true
}

function Sync-Database {
    Write-ColorLog "=== Starting DB Sync ===" -Color Cyan
    
    # Validate shared folder
    if (-not (Test-Path $SharedFolder)) {
        Write-ColorLog "Error: Shared folder not accessible: $SharedFolder" -Color Red
        Write-ColorLog "Make sure VPN is connected or network drive is mounted." -Color Yellow
        return $false
    }
    
    $sharedDbFile = Join-Path $SharedFolder "master_hub_latest.sql"
    $sharedMetaFile = Join-Path $SharedFolder "master_hub_meta.json"
    $localTempFile = "local_temp_backup.sql"
    
    # Get local DB state
    $localHash = Get-LocalDbHash
    $localTime = Get-Date
    
    Write-ColorLog "Local DB hash: $localHash" -Color Cyan
    
    # Check if remote DB exists
    if (Test-Path $sharedDbFile) {
        # Load remote metadata
        if (Test-Path $sharedMetaFile) {
            $remoteMeta = Get-Content $sharedMetaFile | ConvertFrom-Json
            $remoteTime = [DateTime]$remoteMeta.timestamp
            $remoteHash = $remoteMeta.hash
            $remoteHost = $remoteMeta.hostname
            
            Write-ColorLog "Remote DB from: $remoteHost at $remoteTime" -Color Cyan
            Write-ColorLog "Remote hash: $remoteHash" -Color Cyan
            
            # Compare hashes
            if ($localHash -eq $remoteHash) {
                Write-ColorLog "Databases are in sync. No action needed." -Color Green
                return $true
            }
            
            # Decide: push or pull?
            if ($AutoMode) {
                # Time-based: newer wins
                if ($localTime -gt $remoteTime) {
                    Write-ColorLog "Local is newer. Pushing..." -Color Green
                    $doPush = $true
                } else {
                    Write-ColorLog "Remote is newer. Pulling..." -Color Green
                    $doPush = $false
                }
            } else {
                # Ask user
                Write-Host "`nConflict detected!" -ForegroundColor Yellow
                Write-Host "  Local:  $env:COMPUTERNAME at $localTime" -ForegroundColor Cyan
                Write-Host "  Remote: $remoteHost at $remoteTime" -ForegroundColor Cyan
                $choice = Read-Host "Push local (L) or Pull remote (R)? [L/R]"
                $doPush = $choice -eq "L"
            }
            
            if ($doPush) {
                # Push local to shared
                if (-not (Export-LocalDatabase -OutputFile $localTempFile)) {
                    return $false
                }
                
                Copy-Item $localTempFile $sharedDbFile -Force
                
                # Update metadata
                $meta = @{
                    timestamp = $localTime.ToString("o")
                    hash = $localHash
                    hostname = $env:COMPUTERNAME
                } | ConvertTo-Json
                
                Set-Content -Path $sharedMetaFile -Value $meta
                
                Write-ColorLog "Pushed to shared folder." -Color Green
                Remove-Item $localTempFile -ErrorAction SilentlyContinue
            } else {
                # Pull remote to local
                if (-not (Import-RemoteDatabase -InputFile $sharedDbFile)) {
                    return $false
                }
                
                Write-ColorLog "Pulled from shared folder." -Color Green
            }
        } else {
            Write-ColorLog "Remote metadata missing. Treating as outdated..." -Color Yellow
            
            # Export and push
            if (-not (Export-LocalDatabase -OutputFile $localTempFile)) {
                return $false
            }
            
            Copy-Item $localTempFile $sharedDbFile -Force
            
            $meta = @{
                timestamp = $localTime.ToString("o")
                hash = $localHash
                hostname = $env:COMPUTERNAME
            } | ConvertTo-Json
            
            Set-Content -Path $sharedMetaFile -Value $meta
            
            Write-ColorLog "Initialized shared database." -Color Green
            Remove-Item $localTempFile -ErrorAction SilentlyContinue
        }
    } else {
        Write-ColorLog "No shared database found. Creating initial backup..." -Color Yellow
        
        # Create initial shared DB
        if (-not (Export-LocalDatabase -OutputFile $localTempFile)) {
            return $false
        }
        
        Copy-Item $localTempFile $sharedDbFile -Force
        
        $meta = @{
            timestamp = $localTime.ToString("o")
            hash = $localHash
            hostname = $env:COMPUTERNAME
        } | ConvertTo-Json
        
        Set-Content -Path $sharedMetaFile -Value $meta
        
        Write-ColorLog "Initialized shared database." -Color Green
        Remove-Item $localTempFile -ErrorAction SilentlyContinue
    }
    
    Write-ColorLog "=== Sync Complete ===" -Color Cyan
    return $true
}

# Main execution
Write-ColorLog "=====================================" -Color Cyan
Write-ColorLog "  Master Hub DB Sync (Simple)       " -Color Cyan
Write-ColorLog "=====================================" -Color Cyan
Write-ColorLog "Shared folder: $SharedFolder" -Color Yellow

# Validate Docker container
$containerStatus = docker ps --filter "name=$Container" --format "{{.Status}}" 2>$null

if (-not $containerStatus) {
    Write-ColorLog "Error: Container '$Container' is not running." -Color Red
    Write-ColorLog "Start it with: npm run docker:up" -Color Yellow
    exit 1
}

Write-ColorLog "Container is running." -Color Green

# Execute sync
if ($Once) {
    Sync-Database
} else {
    # Continuous mode
    Write-ColorLog "Starting continuous sync (interval: $IntervalMinutes minutes)" -Color Cyan
    Write-ColorLog "Press Ctrl+C to stop" -Color Yellow
    
    while ($true) {
        Sync-Database
        
        $seconds = $IntervalMinutes * 60
        Write-ColorLog "Waiting $IntervalMinutes minutes until next sync..." -Color DarkGray
        Start-Sleep -Seconds $seconds
    }
}
