param(
    [string]$Server = 'root@104.248.239.23',
    [string]$DashboardDirectory = '',
    [switch]$BackendOnly,
    [switch]$SkipBuild,
    [switch]$PackageOnly
)
$ErrorActionPreference = 'Stop'
if ($Server -notmatch '^[a-zA-Z0-9_.-]+@[a-zA-Z0-9.-]+$') { throw 'Use user@hostname for Server.' }
if ($DashboardDirectory -and $DashboardDirectory -notmatch '^/[a-zA-Z0-9_./-]+$') { throw 'Use an absolute Linux dashboard directory without spaces.' }
$project = Split-Path -Parent $PSScriptRoot
Push-Location $project
try {
    if (-not $SkipBuild -and -not $BackendOnly) {
        npm run build
        if ($LASTEXITCODE -ne 0) { throw 'Dashboard build failed; nothing was uploaded.' }
    }
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $stage = Join-Path $project "artifacts/network-release-$stamp"
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    Copy-Item -LiteralPath "$project/hotspot/network-monitor.js" -Destination "$stage/network-monitor.js"
    if (-not $BackendOnly) {
        New-Item -ItemType Directory -Path "$stage/dashboard" -Force | Out-Null
        Copy-Item -LiteralPath "$project/dist/index.html" -Destination "$stage/dashboard/index.html"
        Copy-Item -LiteralPath "$project/dist/assets" -Destination "$stage/dashboard/assets" -Recurse
    }
    $deploy = @'
set -eu
stage="$1"
dashboard="${2:-}"
backend_only="${3:-false}"
backend=/var/www/ea-soft-api
cd "$stage"
tar -xzf release.tar.gz
sha256sum -c SHA256SUMS
node --check network-monitor.js
test -f "$backend/network-monitor.js"
test -f "$backend/.env"
pm2 describe ea-soft-api >/dev/null
if [ "$backend_only" != true ]; then
if [ -z "$dashboard" ]; then
  nginx -T > nginx-config.txt 2>/dev/null
  awk '$1 == "root" { gsub(/;/, "", $2); print $2 }' nginx-config.txt | sort -u > roots.txt
  : > candidates.txt
  while IFS= read -r candidate; do
    case "$candidate" in /*) ;; *) continue ;; esac
    if [ -f "$candidate/index.html" ] && grep -qi '<title>EA-Soft' "$candidate/index.html"; then
      realpath "$candidate" >> candidates.txt
    fi
  done < roots.txt
  sort -u candidates.txt > unique-candidates.txt
  if [ "$(wc -l < unique-candidates.txt)" -ne 1 ]; then
    echo 'Cannot identify one EA-Soft dashboard web root. Rerun with -DashboardDirectory /your/nginx/root.' >&2
    exit 1
  fi
  dashboard="$(cat unique-candidates.txt)"
fi
dashboard="$(realpath -e "$dashboard")"
test -f "$dashboard/index.html"
test -d "$dashboard/assets"
test ! -L "$dashboard/index.html"
test ! -L "$dashboard/assets"
test ! -L "$backend/network-monitor.js"
case "$dashboard" in /|"$backend"|"$backend"/*) echo 'Dashboard directory must be separate from backend data.' >&2; exit 1 ;; esac
fi
test ! -L "$backend/network-monitor.js"
umask 077
mkdir before
cp -p "$backend/network-monitor.js" before/network-monitor.js
if [ "$backend_only" != true ]; then cp -p "$dashboard/index.html" before/index.html; fi
rollback() {
  code=$?
  trap - EXIT
  if [ "$code" -ne 0 ]; then
    echo 'Update failed. Restoring the previous network module and dashboard index.' >&2
    cp -p "$stage/before/network-monitor.js" "$backend/network-monitor.js"
    if [ "$backend_only" != true ]; then cp -p "$stage/before/index.html" "$dashboard/index.html"; fi
    pm2 restart ea-soft-api --update-env || true
  fi
  exit "$code"
}
trap rollback EXIT
if [ "$backend_only" != true ]; then
for asset in dashboard/assets/*; do
  destination="$dashboard/assets/$(basename "$asset")"
  test ! -L "$destination"
  if [ -e "$destination" ] && ! cmp -s "$asset" "$destination"; then
    echo "Asset filename conflict: $destination" >&2; exit 1
  fi
  cp "$asset" "$destination"
  chmod 644 "$destination"
done
fi
cp network-monitor.js "$backend/network-monitor.js"
cd "$backend"
node <<'NODE'
require('dotenv').config({ override: true });
require('./network-monitor').installNetworkMonitor(require('express')(), (_req, _res, next) => next(), {
  env: process.env, router: async () => []
});
console.log('Network module and existing inventory load successfully.');
NODE
pm2 restart ea-soft-api --update-env
cd "$backend"
node <<'NODE'
require('dotenv').config({ override: true });
(async () => {
  const base = 'http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/towns/default/admin/network';
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      const responses = await Promise.all(['', '/internet', '/stations'].map(route => fetch(base + route, {
        method: route ? 'POST' : 'GET', signal: AbortSignal.timeout(2000)
      })));
      if (responses.every(response => response.status === 401)) {
        console.log('Network monitor routes are installed and require sign-in.'); return;
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw Error('Network monitor routes did not become ready.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
NODE
if [ "$backend_only" != true ]; then
  cp "$stage/dashboard/index.html" "$dashboard/index.html"
  chmod 644 "$dashboard/index.html"
fi
trap - EXIT
echo "Network monitor backend updated. Previous files: $stage/before"
if [ "$backend_only" != true ]; then echo "Dashboard updated: $dashboard"; fi
echo 'Sign in again and open Network monitor > Manage stations.'
'@
    [IO.File]::WriteAllText("$stage/deploy.sh", ($deploy -replace "`r`n", "`n") + "`n", [Text.UTF8Encoding]::new($false))
    $manifest = Get-ChildItem -LiteralPath $stage -Recurse -File | ForEach-Object {
        $relative = $_.FullName.Substring($stage.Length + 1).Replace('\', '/').Replace([char]92, [char]47)
        (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + $relative
    }
    [IO.File]::WriteAllText("$stage/SHA256SUMS", ($manifest -join "`n") + "`n", [Text.UTF8Encoding]::new($false))
    $archive = "$stage.tar.gz"
    tar -czf $archive -C $stage .
    if ($LASTEXITCODE -ne 0) { throw 'Could not package the network update.' }
    Write-Output "Network update archive: $archive"
    if ($PackageOnly) { return }
    $remoteStage = "/tmp/ea-network-$stamp"
    ssh $Server "umask 077 && mkdir '$remoteStage'"
    if ($LASTEXITCODE -ne 0) { throw 'SSH login failed; nothing was installed.' }
    scp $archive "$($Server):$remoteStage/release.tar.gz"
    if ($LASTEXITCODE -ne 0) { throw 'Upload failed; nothing was installed.' }
    scp "$stage/deploy.sh" "$($Server):$remoteStage/deploy.sh"
    if ($LASTEXITCODE -ne 0) { throw 'Deployment script upload failed; nothing was installed.' }
    $backendOnlyArgument = if ($BackendOnly) { 'true' } else { 'false' }
    ssh $Server "bash '$remoteStage/deploy.sh' '$remoteStage' '$DashboardDirectory' '$backendOnlyArgument'"
    if ($LASTEXITCODE -ne 0) { throw 'Network update failed. Review the error and rollback output.' }
} finally { Pop-Location }
