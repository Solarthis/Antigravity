@echo off
setlocal ENABLEDELAYEDEXPANSION
:: =============================================================================
:: PROJECT ANTIGRAVITY - Windows one-click launcher
:: =============================================================================
:: Double-click from Explorer. Mirrors Antigravity.command behavior.
:: =============================================================================

title Antigravity - MAT Solutions

cd /d "%~dp0"

echo ==================================================================
echo         PROJECT ANTIGRAVITY - MAT Solutions
echo         Flash-Drive Portable Sourcing Pipeline
echo ==================================================================
echo.

:: --- 1. Docker checks ------------------------------------------------------
docker version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker is not installed or not in PATH.
    echo Install Docker Desktop: https://www.docker.com/products/docker-desktop
    echo.
    pause
    exit /b 1
)

docker info >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker daemon is not running. Start Docker Desktop and retry.
    echo.
    pause
    exit /b 1
)

docker compose version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker Compose v2 is not available. Update Docker Desktop.
    echo.
    pause
    exit /b 1
)

:: --- 2. Env + data bootstrap ----------------------------------------------
if not exist ".env" (
    if exist ".env.example" (
        copy /Y ".env.example" ".env" >nul
        echo [OK] Generated .env from .env.example
    ) else (
        echo [ERROR] .env.example template is missing. Restore it to continue.
        pause
        exit /b 1
    )
)
if not exist "data" mkdir "data"

:: --- 3. Build + start ------------------------------------------------------
echo [INFO] Building and starting services...
docker compose up -d --build --wait
if errorlevel 1 (
    echo [ERROR] docker compose up failed. See output above.
    pause
    exit /b 1
)

:: --- 4. Discover published URL --------------------------------------------
set "HOST_PORT=3000"
for /f "tokens=2 delims=:" %%a in ('docker compose port antigravity 3000 2^>nul') do set "HOST_PORT=%%a"
set "APP_URL=http://localhost:%HOST_PORT%"

start "" "%APP_URL%"

echo.
echo ==================================================================
echo           Antigravity is LIVE at %APP_URL%
echo ==================================================================
echo.
echo   Follow logs:  docker compose logs -f antigravity
echo   Stop:         docker compose down
echo   Full reset:   docker compose down -v ^&^& rmdir /s /q data
echo.

docker compose logs -f antigravity
endlocal
