# Start admin-api + Admin_Frontend + Passenger_Frontend (3 terminals on Windows)
# Prerequisites: Node.js 18+ and npm on PATH; MongoDB URI in Backend/Admin_Backend/.env (MySQL optional for ticketing)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $Root

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "ERROR: Node.js not found. Install from https://nodejs.org/ then re-run this script." -ForegroundColor Red
  exit 1
}

Write-Host "Installing dependencies (first run may take a minute)..." -ForegroundColor Cyan

@(
  "Backend\Admin_Backend",
  "Frontend\Admin_Frontend",
  "Frontend\Passenger_Frontend"
) | ForEach-Object {
  $dir = Join-Path $Root $_
  if (-not (Test-Path $dir)) { Write-Warning "Skip missing: $dir"; return }
  Write-Host "  npm install -> $_" -ForegroundColor Gray
  Push-Location $dir
  npm install
  if ($LASTEXITCODE -ne 0) { Pop-Location; exit $LASTEXITCODE }
  Pop-Location
}

Write-Host "`nStarting servers in new windows..." -ForegroundColor Green
Write-Host "  admin-api:     http://localhost:4001/health" -ForegroundColor White
Write-Host "  Admin UI:      http://localhost:5173" -ForegroundColor White
Write-Host "  Passenger app: http://localhost:5174  (landing)  http://localhost:5174/dashboard" -ForegroundColor White
Write-Host "`nTip: Copy Backend\Admin_Backend\.env.example to .env and set MONGODB_URI (and MYSQL_* for ticketing)." -ForegroundColor DarkGray

$adminApi = Join-Path $Root "Backend\Admin_Backend"
$adminUi = Join-Path $Root "Frontend\Admin_Frontend"
$passUi = Join-Path $Root "Frontend\Passenger_Frontend"

Start-Process powershell -WorkingDirectory $adminApi -ArgumentList @("-NoExit", "-Command", "npm run dev")
Start-Sleep -Milliseconds 400
Start-Process powershell -WorkingDirectory $adminUi -ArgumentList @("-NoExit", "-Command", "npm run dev")
Start-Sleep -Milliseconds 400
Start-Process powershell -WorkingDirectory $passUi -ArgumentList @("-NoExit", "-Command", "npm run dev")

Write-Host "`nDone. Close those windows to stop the servers." -ForegroundColor Green
