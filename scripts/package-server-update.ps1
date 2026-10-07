$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$bundleName = "ea-soft-server-$stamp"
$artifactDirectory = Join-Path $projectDirectory 'artifacts'
$stagingDirectory = Join-Path $artifactDirectory $bundleName
New-Item -ItemType Directory -Path $stagingDirectory -Force | Out-Null
$files = @(
    'server.js', 'admin-auth.js', 'workspace-backup.js', 'gmail-email.js', 'agent-portal.js', 'terminal.js', 'towns.js', 'shared-vouchers.js',
    'business-operations.js', 'router-time.js', 'network-monitor.js', 'NETWORK-MONITOR.md', 'customer.html', 'BUSINESS-OPERATIONS.md',
    'package.json', 'package-lock.json', 'towns.example.json',
    'MULTI-TOWN.md', 'SHARED-VOUCHERS.md', 'DATA-CONSUMPTION.md', 'AGENTS-PORTAL.md', 'GMAIL-SETUP.md', 'BACKUP-RESTORE.md',
    'radius/ea-rest.conf', 'radius/ea-hotspot.conf', 'radius/clients.example.conf'
)
foreach ($relative in $files) {
    $source = Join-Path (Join-Path $projectDirectory 'hotspot') $relative
    $destination = Join-Path $stagingDirectory $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination
}
$manifest = foreach ($relative in $files) {
    $hash = (Get-FileHash -LiteralPath (Join-Path $stagingDirectory $relative) -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $relative"
}
[System.IO.File]::WriteAllText((Join-Path $stagingDirectory 'SHA256SUMS'), (($manifest -join "`n") + "`n"), [System.Text.UTF8Encoding]::new($false))
$archive = Join-Path $artifactDirectory "$bundleName.zip"
Compress-Archive -Path (Join-Path $stagingDirectory '*') -DestinationPath $archive
Write-Output "Server update archive: $archive"
Write-Output 'Includes only allowlisted code, package files, templates, and setup guides. No .env, credentials, or customer records.'
