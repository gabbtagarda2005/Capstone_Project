@echo off
cd /d "%~dp0"
echo.
echo  Bus Attendant (web-server) — Flutter hosts the app; YOU open the URL in Edge.
echo  This often avoids Edge debugger disconnects during reload.
echo  Hot reload: press r or R in this window while it stays open.
echo.
flutter run -d web-server --web-hostname=localhost --web-port=50015 --dart-define=API_BASE_URL=http://localhost:4011
