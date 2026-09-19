@echo off
title Northstar Hospital EMR Portal
cd /d "%~dp0"

echo.
echo Close any OLD black Python window named "Northstar Backend" if login fails.
echo Then leave THIS server window open.
echo.

echo Starting server at http://127.0.0.1:8000 ...
start "Northstar Backend" python -u backend\app.py

timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:8000"

echo.
echo Open: http://127.0.0.1:8000
echo Do not open frontend\index.html as a file.
echo Keep the "Northstar Backend" window open while you use the portal.
echo.
pause
