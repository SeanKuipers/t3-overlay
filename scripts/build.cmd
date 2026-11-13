@echo off
rem Double-click to build T3 Overlay. Run setup-windows.ps1 once first.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-windows.ps1"
pause
