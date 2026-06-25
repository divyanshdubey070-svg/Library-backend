@echo off
setlocal enabledelayedexpansion
title AutoLib Server Manager
cls
echo ===================================================
echo             AUTOLIB ECOSYSTEM SERVER           
echo ===================================================
echo.
echo Server ko start kiya ja raha hai...
echo.
echo [Addresses to Access the Server]
echo ---------------------------------------------------
echo 1. Iss PC par: http://localhost:4000
echo 2. Dusre devices (Mobile/Tablet/Laptop) par:
for /f "tokens=2 delims=:" %%i in ('ipconfig ^| findstr /i "IPv4"') do (
    set "ip=%%i"
    set "ip=!ip: =!"
    echo    =^> http://!ip!:4000
)
echo ---------------------------------------------------
echo.
echo [Server ON/OFF Instruction]
echo =^> Server ko band (OFF) karne ke liye iss Window ko band (close) karein
echo    ya fir Keyboard par [Ctrl + C] press karein.
echo.
echo Server console output niche dekh sakte hain:
echo ---------------------------------------------------
npm start
pause
