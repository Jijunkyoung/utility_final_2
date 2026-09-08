@echo off
setlocal
rem 여러 PC 공개용. 회사 IT/보안 담당자가 방화벽과 포트 사용을 승인한 뒤에만 실행하세요.
cd /d "%~dp0"
if not exist config.local.json (
  copy /y config.example.json config.local.json >nul
  echo [설정 필요] config.local.json을 만들었습니다.
  echo apiToken을 32자 이상의 실제 임의 문자열로 바꾸고 sharedPath를 확인하세요.
  start "" notepad.exe "%CD%\config.local.json"
  pause
  exit /b 1
)
set FACILITY_AI_HOST=0.0.0.0
set FACILITY_AI_PORT=8765
set FACILITY_AI_OPEN_BROWSER=1
where py >nul 2>&1
if errorlevel 1 goto use_python
py -3 facility_server.py --check-lan
if errorlevel 1 goto blocked
py -3 facility_server.py
goto finished
:use_python
python facility_server.py --check-lan
if errorlevel 1 goto blocked
python facility_server.py
goto finished
:blocked
echo.
echo 사전 점검을 통과하지 못해 사내망 공개를 시작하지 않았습니다.
:finished
pause
