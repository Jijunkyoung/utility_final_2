@echo off
cd /d "%~dp0"
py -3 run_jobs.py >> job-run.log 2>&1
if errorlevel 1 python run_jobs.py >> job-run.log 2>&1
