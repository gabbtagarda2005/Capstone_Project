$ErrorActionPreference = "Stop"

Write-Host "Checking Flutter mobile devices..." -ForegroundColor Cyan
$deviceLines = flutter devices | Select-String "\(mobile\)"

if (-not $deviceLines) {
  Write-Host "No mobile device detected." -ForegroundColor Red
  Write-Host "Tip: Connect phone via USB, enable USB debugging, and accept RSA prompt." -ForegroundColor Yellow
  exit 1
}

$firstMobile = $deviceLines[0].ToString().Trim()
$afterMobile = ($firstMobile -split "\(mobile\)", 2)[1]
$tokenMatches = [regex]::Matches($afterMobile, "[A-Za-z0-9:_\.-]{6,}")
$deviceId = if ($tokenMatches.Count -gt 0) { $tokenMatches[0].Value.Trim() } else { "" }

if (-not $deviceId) {
  Write-Host "Could not parse device id from: $firstMobile" -ForegroundColor Red
  exit 1
}
Write-Host "Running on device: $deviceId" -ForegroundColor Green

# For physical Android phones, map device localhost:4011 -> PC localhost:4011.
$adbPath = Join-Path $env:LOCALAPPDATA "Android\sdk\platform-tools\adb.exe"
if (Test-Path $adbPath) {
  & $adbPath -s $deviceId reverse tcp:4011 tcp:4011 | Out-Null
  Write-Host "ADB reverse enabled: device 127.0.0.1:4011 -> PC 127.0.0.1:4011" -ForegroundColor DarkCyan
}

flutter run -d $deviceId --dart-define API_BASE_URL=http://127.0.0.1:4011
