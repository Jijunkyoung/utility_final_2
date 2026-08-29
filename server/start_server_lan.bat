@echo off
rem 여러 PC 공개용. 회사 IT/보안 담당자가 방화벽과 포트 사용을 승인한 뒤에만 실행하세요.
cd /d "%~dp0"
set FACILITY_AI_HOST=0.0.0.0
py -3 facility_server.py
if errorlevel 1 python facility_server.py
pause
