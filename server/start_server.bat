@echo off
cd /d "%~dp0"
py -3 facility_server.py
if errorlevel 1 python facility_server.py
pause
