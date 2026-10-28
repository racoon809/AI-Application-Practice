@echo off
REM ============================================================================
REM File    : Week03-DigitRecognition/desktop_version/install_requirements.bat
REM Created : 2026-09-23 12:10 (KST, UTC+09:00)
REM Updated : 2026-10-28 12:50 (KST, UTC+09:00) - folder renamed to Week03-DigitRecognition
REM Purpose : Install the libraries the desktop version needs (lecture p51)
REM ============================================================================
setlocal
cd /d "%~dp0"
set "PY=python"
python --version >nul 2>nul
if errorlevel 1 set "PY=py -3"

echo Installing required libraries (numpy, pillow, pytest)...
%PY% -m pip install -r requirements.txt
if errorlevel 1 (
    echo Installation failed. Check the internet connection and try again.
) else (
    echo Installation complete.
)
if /i not "%~1"=="nopause" pause
endlocal
