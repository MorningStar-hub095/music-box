@echo off
chcp 65001 >nul 2>&1
title Music Box - Startup
setlocal EnableDelayedExpansion

echo.
echo  ========================================
echo         Music Box - yin yue he zi
echo         Startup Script v2.0
echo  ========================================
echo.

set "ROOT_DIR=%~dp0"
set "SERVER_DIR=%ROOT_DIR%server"
set "WEB_DIR=%ROOT_DIR%web"

rem ===== Parse args =====
set "DEV_MODE=1"
set "SKIP_BUILD=0"
set "API_ONLY=0"
:parse
if "%~1"=="" goto :args_done
if /i "%~1"=="--prod" set "DEV_MODE=0"
if /i "%~1"=="--skip-build" set "SKIP_BUILD=1"
if /i "%~1"=="--api-only" set "API_ONLY=1"
if /i "%~1"=="--help" goto :help
if /i "%~1"=="-h" goto :help
shift
goto :parse
:args_done

if "%DEV_MODE%"=="1" (echo  Mode: Development) else (echo  Mode: Production)
echo.

rem ===== Step 1: Check Node.js =====
echo  [1/7] Check Node.js...
where node >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Node.js not found!
    echo  Please install Node.js 18+ from https://nodejs.org/
    goto :fail
)
for /f "tokens=*" %%i in ('node --version') do echo   Node.js: %%i

rem ===== Step 2: Check directories =====
echo  [2/7] Check project structure...
if not exist "%SERVER_DIR%\package.json" (
    echo  [ERROR] server/package.json not found!
    goto :fail
)
if not exist "%WEB_DIR%\package.json" (
    echo  [ERROR] web/package.json not found!
    goto :fail
)
echo   Project structure: OK

rem ===== Step 3: Check PostgreSQL =====
echo  [3/7] Check PostgreSQL...
powershell -NoProfile -Command "try{$t=New-Object Net.Sockets.TcpClient;$t.Connect('localhost',5432);$t.Close();exit 0}catch{exit 1}" >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] PostgreSQL not running on port 5432.
    echo  Please start PostgreSQL first, or: docker-compose up -d postgres
    goto :fail
)
echo   PostgreSQL: OK

rem ===== Step 4: Install dependencies =====
echo  [4/7] Install dependencies...
if not exist "%SERVER_DIR%\node_modules" (
    echo   Installing server dependencies...
    cd /d "%SERVER_DIR%"
    call npm install
    if errorlevel 1 (
        echo  [ERROR] Server npm install failed!
        goto :fail
    )
)
if "%API_ONLY%"=="0" (
    if not exist "%WEB_DIR%\node_modules" (
        echo   Installing web dependencies...
        cd /d "%WEB_DIR%"
        call npm install
        if errorlevel 1 (
            echo  [ERROR] Web npm install failed!
            goto :fail
        )
    )
)
echo   Dependencies: OK

rem ===== Step 5: Prisma + Build =====
echo  [5/7] Prepare database client...
cd /d "%SERVER_DIR%"
if not exist "node_modules\.prisma\client" (
    echo   Generating Prisma Client...
    call npx prisma generate >nul 2>&1
    if errorlevel 1 (
        echo  [ERROR] Prisma generate failed!
        goto :fail
    )
)
echo   Prisma: OK

if "%SKIP_BUILD%"=="0" (
    if "%DEV_MODE%"=="1" (
        echo  [6/7] Build [skipped - dev mode uses hot reload]
    ) else (
        echo  [6/7] Build...
        echo   Building backend...
        cd /d "%SERVER_DIR%"
        call npm run build
        if errorlevel 1 (
            echo  [WARN] Backend build failed, will use dev mode
            set "DEV_MODE=1"
        ) else (
            echo   Backend: OK
        )
        if "%API_ONLY%"=="0" (
            if not exist "%WEB_DIR%\dist\index.html" (
                echo   Building frontend...
                cd /d "%WEB_DIR%"
                call npm run build
                if errorlevel 1 (
                    echo  [WARN] Frontend build failed, will use dev mode
                ) else (
                    echo   Frontend: OK
                )
            ) else (
                echo   Frontend: already built
            )
        )
    )
) else (
    echo  [6/7] Build [skipped]
)

rem ===== Step 7: Start services =====
echo  [7/7] Start services...
echo.

rem --- Start API Server ---
echo   Starting API Server on port 49200...
cd /d "%SERVER_DIR%"
if "%DEV_MODE%"=="1" (
    start "MusicBox-Server" cmd /k "title MusicBox-Server && npm run dev"
) else (
    start "MusicBox-Server" cmd /k "title MusicBox-Server && node dist/index.js"
)
echo   Waiting for API Server...
timeout /t 5 /nobreak >nul

rem --- Health check ---
powershell -NoProfile -Command "try{$r=Invoke-RestMethod 'http://localhost:49200/api/health' -TimeoutSec 10;Write-Host '   API Server: OK'}catch{Write-Host '   [WARN] API Server may still be starting'}"

if "%API_ONLY%"=="1" goto :show_urls

rem --- Start Frontend ---
if "%DEV_MODE%"=="1" (
    echo   Starting Web Player on port 49201...
    cd /d "%WEB_DIR%"
    start "MusicBox-Web" cmd /k "title MusicBox-Web && npm run dev"
    timeout /t 1 /nobreak >nul
) else (
    echo   Frontend served by API Server (static files)
)

rem --- Start Admin & Browse (dev mode only) ---
if "%DEV_MODE%"=="1" (
    echo   Starting Admin on port 49202...
    cd /d "%WEB_DIR%\admin"
    start "MusicBox-Admin" cmd /k "title MusicBox-Admin && npm run dev"
    timeout /t 2 /nobreak >nul

    echo   Starting Browse on port 49203...
    cd /d "%WEB_DIR%\browse"
    start "MusicBox-Browse" cmd /k "title MusicBox-Browse && npm run dev"
    timeout /t 2 /nobreak >nul
) else (
    echo   Admin & Browse: skipped [production mode]
)

:show_urls
echo.
echo  ========================================
echo    Music Box Started!
echo  ========================================
echo.
echo    API Server:  http://localhost:49200
if "%API_ONLY%"=="0" (
    if "%DEV_MODE%"=="1" (
        echo    Web Player:  http://localhost:49201
        echo    Admin:       http://localhost:49202
        echo    Browse:      http://localhost:49203
    ) else (
        echo    Web Player:  http://localhost:49200  [static]
    )
)
echo.
echo    Commands:
echo      npm run health    - Health check
echo      npm run stop      - Stop all services
echo      npm run restart   - Restart
echo  ========================================
echo.

rem --- Open browser ---
timeout /t 2 /nobreak >nul
if "%DEV_MODE%"=="1" (
    start http://localhost:49201
) else (
    start http://localhost:49200
)

echo  This window monitors the startup.
echo  Close this window to stop monitoring.
echo  (Services run in their own windows)
echo.
pause >nul
goto :eof

:help
echo.
echo  Usage: start.bat [options]
echo.
echo  Options:
echo    --prod        Production mode (build + run compiled)
echo    --skip-build  Skip build step
echo    --api-only    Start API server only
echo    --help        Show this help
echo.
echo  Default: Development mode (hot reload)
echo.
echo  Ports: API=49200 Web=49201 Admin=49202 Browse=49203
echo.
pause >nul
goto :eof

:fail
echo.
echo  [FAILED] Startup aborted. See errors above.
echo.
pause >nul
exit /b 1
