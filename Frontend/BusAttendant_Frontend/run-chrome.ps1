$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$port = 50015
Write-Host "Bus Attendant web -> http://localhost:$port/" -ForegroundColor Cyan
Write-Host "Ensure BusAttendant_Backend is running: node server.js (port 4011)" -ForegroundColor DarkGray

flutter run -d chrome --web-port=$port --dart-define API_BASE_URL=http://localhost:4011
