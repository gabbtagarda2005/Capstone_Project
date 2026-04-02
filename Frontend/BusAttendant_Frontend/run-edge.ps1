$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# Fixed URL: http://localhost:50015/
$port = 50015

function Test-PortFree([int] $p) {
  try {
    $l = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $p)
    $l.Start()
    $l.Stop()
    return $true
  } catch {
    return $false
  }
}

if (-not (Test-PortFree $port)) {
  Write-Host "Port $port is already in use (Windows errno 10048)." -ForegroundColor Red
  Write-Host ""
  Write-Host "Fix: quit the other Flutter web session (terminal -> press q), OR kill the process:" -ForegroundColor Yellow
  Write-Host "  netstat -ano | findstr :$port" -ForegroundColor Cyan
  Write-Host "  taskkill /PID <PID_from_last_column> /F" -ForegroundColor Cyan
  exit 1
}

Write-Host "Bus Attendant web -> http://localhost:$port/" -ForegroundColor Cyan
Write-Host "Ensure BusAttendant_Backend: node server.js (port 4011)" -ForegroundColor DarkGray

# Use localhost (not 127.0.0.1) for web so it matches the page origin and avoids browser blocks.
flutter run -d edge --web-port=$port --dart-define API_BASE_URL=http://localhost:4011
