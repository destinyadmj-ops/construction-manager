# Loads .env.home into environment then starts Next dev
$root = Resolve-Path "$PSScriptRoot\.."
$envPath = Join-Path $root ".env.home"
if (Test-Path $envPath) {
    Get-Content $envPath | ForEach-Object {
        $_ = $_.Trim()
        if ($_ -eq "" -or $_ -like "#*") { return }
        $parts = $_ -split '=', 2
        if ($parts.Length -eq 2) {
            $k = $parts[0].Trim()
            $v = $parts[1].Trim()
            # strip optional surrounding quotes
            if ($v.StartsWith('"') -and $v.EndsWith('"')) { $v = $v.Substring(1, $v.Length - 2) }
            Write-Host "Setting env: $k"
            Set-Item -Path "Env:$k" -Value $v
        }
    }
    Write-Host "Loaded .env.home from $envPath"
} else {
    Write-Warning ".env.home not found at $envPath"
}
# Start dev server (inherits env vars set above)
npm run dev
