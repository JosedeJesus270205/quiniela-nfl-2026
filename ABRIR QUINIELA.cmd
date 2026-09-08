@echo off
REM Arranca la quiniela y abre el navegador. Doble clic y listo.
REM Para apagarla, cierra esta ventana negra.

title Quiniela NFL - no cierres esta ventana
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   No encuentro Node.js en esta computadora.
  echo   Bajalo de https://nodejs.org e instalalo, luego vuelve a dar doble clic aqui.
  echo.
  pause
  exit /b 1
)

echo.
echo   Arrancando la quiniela...
echo   Esta ventana tiene que quedarse abierta.
echo.

REM Darle un respiro al servidor antes de abrir el navegador.
start "" /b cmd /c "timeout /t 2 >nul & start http://localhost:4400"

node servidor.js

echo.
echo   La quiniela se detuvo.
pause
