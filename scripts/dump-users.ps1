try {
    $r = Invoke-RestMethod "http://localhost:3001/api/users?kind=normal" -UseBasicParsing
    Write-Host "TYPE: $($r.GetType().FullName)"
    $r | ConvertTo-Json -Depth 6
} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
}
