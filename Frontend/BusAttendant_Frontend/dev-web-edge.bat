@echo off
cd /d "%~dp0"
echo.
echo  Bus Attendant (Edge) — keep this window OPEN while you code.
echo  After you change Dart files:
echo    - Press R  (capital R) = hot restart  ^(most reliable on web^)
echo    - Press r  (lowercase) = hot reload
echo    - Press q  = quit
echo  In Cursor/VS Code you can also use Debug ^> Start Debugging and save files
echo  ^(hot reload on save is enabled in .vscode/settings.json for this folder^).
echo.
echo  If you see "Service connection disposed", use dev-web-server.bat instead
echo  and open the printed URL in Edge.
echo.
flutter run -d edge --web-port=50015 --dart-define=API_BASE_URL=http://localhost:4011
