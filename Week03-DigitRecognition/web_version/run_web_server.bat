@echo off
REM ============================================================================
REM File    : Week03-DigitRecognition/web_version/run_web_server.bat
REM Created : 2026-09-23 14:50 (KST, UTC+09:00)
REM Updated : 2026-10-28 12:50 (KST, UTC+09:00) - folder renamed to Week03-DigitRecognition
REM Purpose : Start the local web server by double-clicking it in Windows
REM           Explorer; the browser opens http://localhost:8000 by itself
REM           (lecture p72-73). Close this window or press Ctrl+C to stop.
REM ============================================================================
setlocal
cd /d "%~dp0"

set "PY="
python --version >nul 2>nul
if not errorlevel 1 set "PY=python"
if not defined PY (
    py -3 --version >nul 2>nul
    if not errorlevel 1 set "PY=py -3"
)
if not defined PY (
    echo Python was not found. Install Python 3.10 or newer and tick
    echo "Add python.exe to PATH", then run this file again.
    pause
    exit /b 1
)

%PY% -c "import numpy, sklearn, pandas" >nul 2>nul
if errorlevel 1 (
    echo Installing required libraries for the web version...
    %PY% -m pip install -r requirements.txt
)

echo Starting the web version of Handwritten Digit Recognition...
echo The browser opens automatically. If not, open http://localhost:8000
%PY% server.py %*
if errorlevel 1 pause
endlocal
