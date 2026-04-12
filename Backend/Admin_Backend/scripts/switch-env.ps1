param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("atlas", "localmongo")]
  [string]$Target
)

$root = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $root ".env"

if ($Target -eq "atlas") {
  $source = Join-Path $root ".env.atlas.local"
}
else {
  $source = Join-Path $root ".env.local-mongo.local"
}

if (-not (Test-Path $source)) {
  Write-Host "Missing file: $source" -ForegroundColor Red
  Write-Host "Create it from the matching .example file first." -ForegroundColor Yellow
  exit 1
}

Copy-Item -Path $source -Destination $dest -Force
Write-Host "Switched Admin_Backend .env -> $Target" -ForegroundColor Green
Write-Host "Now restart backend: npm run start" -ForegroundColor Cyan
