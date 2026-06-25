@echo off
title AutoLib Public Sharing Tunnel
cls
echo ===================================================
echo             AUTOLIB PUBLIC SHARING TUNNEL           
echo ===================================================
echo.
echo LocalTunnel ki madad se server ko public kiya ja raha hai...
echo.
echo [IMPORTANT] Make sure karein ki server (start_server.bat) pehle se ON hai!
echo.
echo Public Link connect ho raha hai...
echo (Agar pehli baar run kar rahe hain, toh thoda time lag sakta hai...)
echo ---------------------------------------------------
npx localtunnel --port 4000
pause
