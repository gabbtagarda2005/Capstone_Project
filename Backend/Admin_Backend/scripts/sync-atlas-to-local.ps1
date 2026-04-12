param(
  [string]$AtlasUri = "",
  [string]$LocalUri = "mongodb://127.0.0.1:27017/CapstoneProject",
  [string]$DbName = "CapstoneProject"
)

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env"

if (-not $AtlasUri) {
  if (Test-Path $envFile) {
    $line = Select-String -Path $envFile -Pattern "^MONGODB_URI=" | Select-Object -First 1
    if ($line) {
      $AtlasUri = ($line.Line -replace "^MONGODB_URI=", "").Trim()
    }
  }
}

if (-not $AtlasUri) {
  Write-Host "Atlas URI not found. Set MONGODB_URI in .env or pass -AtlasUri." -ForegroundColor Red
  exit 1
}

if ($AtlasUri -notmatch "^mongodb(\+srv)?:\/\/") {
  Write-Host "AtlasUri does not look like a valid Mongo URI." -ForegroundColor Red
  exit 1
}

$dumpCmd = Get-Command mongodump -ErrorAction SilentlyContinue
$restoreCmd = Get-Command mongorestore -ErrorAction SilentlyContinue
if (-not $dumpCmd -or -not $restoreCmd) {
  Write-Host "mongodump/mongorestore not found. Install MongoDB Database Tools first." -ForegroundColor Red
  Write-Host "https://www.mongodb.com/try/download/database-tools" -ForegroundColor Yellow
  exit 1
}

$tmp = Join-Path $env:TEMP ("capstone-mongo-sync-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmp | Out-Null

try {
  Write-Host "Dumping Atlas database..." -ForegroundColor Cyan
  & mongodump --uri="$AtlasUri" --db="$DbName" --out="$tmp"
  if ($LASTEXITCODE -ne 0) { throw "mongodump failed." }

  Write-Host "Restoring to local MongoDB..." -ForegroundColor Cyan
  & mongorestore --uri="$LocalUri" --nsInclude="$DbName.*" --drop "$tmp\$DbName"
  if ($LASTEXITCODE -ne 0) { throw "mongorestore failed." }

  Write-Host "Atlas -> local sync completed for DB '$DbName'." -ForegroundColor Green
}
finally {
  if (Test-Path $tmp) {
    Remove-Item -Recurse -Force $tmp
  }
}
