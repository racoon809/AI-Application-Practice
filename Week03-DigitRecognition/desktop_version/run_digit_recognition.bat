@echo off
REM ============================================================================
REM File    : Week03-DigitRecognition/desktop_version/run_digit_recognition.bat
REM Created : 2026-09-23 12:10 (KST, UTC+09:00)
REM Updated : 2026-10-28 12:50 (KST, UTC+09:00) - folder renamed to Week03-DigitRecognition
REM Purpose : Start the handwritten digit recognition program by
REM           double-clicking it in Windows Explorer (lecture p47-53)
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

%PY% -c "import numpy, PIL.ImageTk" >nul 2>nul
if errorlevel 1 call "%~dp0install_requirements.bat" nopause

echo Starting Handwritten Digit Recognition Program...
echo Please wait while the program loads (this may take a few minutes)...
%PY% digit_recognition.py %*
if errorlevel 1 pause
endlocal
