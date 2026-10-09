param(
    [string]$Server = 'root@104.248.239.23',
    [switch]$PackageOnly
)
$ErrorActionPreference = 'Stop'
if ($Server -notmatch '^[a-zA-Z0-9_.-]+@[a-zA-Z0-9.-]+$') { throw 'Use user@hostname for Server.' }
$project = Split-Path -Parent $PSScriptRoot
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stage = Join-Path $project "artifacts/business-release-$stamp"
New-Item -ItemType Directory -Path $stage -Force | Out-Null
$files = @('server.js', 'towns.js', 'admin-auth.js', 'shared-vouchers.js', 'terminal.js',
    'workspace-backup.js', 'business-operations.js', 'customer-details.js', 'router-time.js', 'network-monitor.js', 'NETWORK-MONITOR.md', 'customer.html',
    'agent-portal.js', 'gmail-email.js', 'package.json', 'package-lock.json', 'BUSINESS-OPERATIONS.md')
foreach ($file in $files) {
    Copy-Item -LiteralPath (Join-Path "$project/hotspot" $file) -Destination (Join-Path $stage $file)
}
$manifest = $files | ForEach-Object { (Get-FileHash -LiteralPath (Join-Path $stage $_) -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + $_ }
[IO.File]::WriteAllText((Join-Path $stage 'SHA256SUMS'), ($manifest -join "`n") + "`n", [Text.UTF8Encoding]::new($false))
$archive = "$stage.tar.gz"
tar -czf $archive -C $stage .
if ($LASTEXITCODE -ne 0) { throw 'Could not package release.' }
Write-Output "Release archive: $archive"
if ($PackageOnly) { return }

$remoteStage = "/root/ea-soft-release-$stamp"
ssh $Server "umask 077 && mkdir '$remoteStage'"
if ($LASTEXITCODE -ne 0) { throw 'Could not create server staging directory.' }
scp $archive "${Server}:$remoteStage/release.tar.gz"
if ($LASTEXITCODE -ne 0) { throw 'Upload failed; backend was not changed.' }

# Single-quoted here-string preserves Bash syntax. No secrets enter the script.
$deploy = @'
set -eu
stage="$1"
backend=/var/www/ea-soft-api
cd "$stage"
tar -xzf release.tar.gz
sha256sum -c SHA256SUMS
node --check server.js
node --check business-operations.js
node --check network-monitor.js
test -f "$backend/.env"
test -f "$backend/package.json"
pm2 describe ea-soft-api >/dev/null
umask 077
mkdir before
while read -r checksum name; do
  if [ -f "$backend/$name" ]; then cp -p "$backend/$name" "before/$name"; fi
done < SHA256SUMS
pm2 stop ea-soft-api
rollback() {
  code=$?
  trap - EXIT
  if [ "$code" -ne 0 ]; then
    echo 'Installation failed. Restoring previous backend code.'
    for file in "$stage"/before/*; do [ ! -f "$file" ] || cp -p "$file" "$backend/"; done
    cd "$backend"
    npm ci --omit=dev || true
    pm2 restart ea-soft-api --update-env || true
  fi
  exit "$code"
}
trap rollback EXIT
while read -r checksum name; do cp "$stage/$name" "$backend/$name"; done < SHA256SUMS
cd "$backend"
npm ci --omit=dev
pm2 restart ea-soft-api --update-env
node <<'NODE'
require('dotenv').config({override:true});
(async () => {
  for (let attempt=0; attempt<15; attempt++) {
    try {
      const base='http://127.0.0.1:'+(process.env.PORT || 3000)+'/api/towns/default/admin/';
      const responses=await Promise.all(['operations','network'].map(route=>fetch(base+route, {signal:AbortSignal.timeout(2000)})));
      if(responses.every(response=>response.status===401)) { console.log('Operations and network monitor routes are installed and require authentication.'); return; }
    } catch {}
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  throw Error('Operations or network monitor endpoint did not become ready.');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
NODE
echo 'Backend installed. Sign in again and open Network monitor.'
echo "Previous code saved in $stage/before. Configuration and customer records were not replaced."
trap - EXIT
'@
$deployFile = Join-Path $stage 'deploy.sh'
[IO.File]::WriteAllText($deployFile, ($deploy -replace "`r`n", "`n") + "`n", [Text.UTF8Encoding]::new($false))
scp $deployFile "${Server}:$remoteStage/deploy.sh"
if ($LASTEXITCODE -ne 0) { throw 'Could not upload deployment script; backend was not changed.' }
ssh $Server "bash '$remoteStage/deploy.sh' '$remoteStage'"
if ($LASTEXITCODE -ne 0) { throw 'Deployment failed. Review the rollback output before retrying.' }
