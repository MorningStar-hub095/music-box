@echo off
chcp 65001 > nul 2>&1
setlocal EnableDelayedExpansion
title 音乐盒子 - 后端服务器启动器

REM ============================================================
REM 此 .bat 可放置在以下任一位置:
REM   - 项目根目录 (D:\music_box\)
REM   - scripts\ 子目录 (D:\music_box\scripts\)
REM 脚本会自动查找 start-server.cjs 的位置
REM ============================================================

REM ---- 定位 .bat 所在目录 ----
set "BAT_DIR=%~dp0"
if "!BAT_DIR:~-1!"=="\" set "BAT_DIR=!BAT_DIR:~0,-1!"

REM ---- 多路径查找 start-server.cjs ----
set "TARGET_SCRIPT="
REM 候选路径 1: 与 .bat 同目录 (例如 .bat 在 scripts\)
if exist "!BAT_DIR!\start-server.cjs" set "TARGET_SCRIPT=!BAT_DIR!\start-server.cjs"
REM 候选路径 2: .bat 所在目录的 scripts\ 子目录 (例如 .bat 在根目录)
if not defined TARGET_SCRIPT if exist "!BAT_DIR!\scripts\start-server.cjs" set "TARGET_SCRIPT=!BAT_DIR!\scripts\start-server.cjs"
REM 候选路径 3: .bat 父目录的 scripts\ 子目录 (兼容 .bat 在子目录的子目录)
if not defined TARGET_SCRIPT if exist "!BAT_DIR!\..\scripts\start-server.cjs" set "TARGET_SCRIPT=!BAT_DIR!\..\scripts\start-server.cjs"

if not defined TARGET_SCRIPT (
    echo.
    echo [ERROR] 未找到 start-server.cjs
    echo   已检查以下路径:
    echo     - !BAT_DIR!\start-server.cjs
    echo     - !BAT_DIR!\scripts\start-server.cjs
    echo     - !BAT_DIR!\..\scripts\start-server.cjs
    echo.
    echo   请将此 .bat 文件放置在项目根目录或 scripts\ 子目录
    echo.
    pause
    exit /b 1
)

REM ---- 推导项目根目录 (用于日志路径) ----
for %%F in ("!TARGET_SCRIPT!") do set "TARGET_DIR=%%~dpF"
if "!TARGET_DIR:~-1!"=="\" set "TARGET_DIR=!TARGET_DIR:~0,-1!"
REM 修复: 原为 -7，但 \scripts 是 8 个字符，改为 -8 才能正确匹配
if /i "!TARGET_DIR:~-8!"=="\scripts" (
    set "APP_ROOT=!TARGET_DIR:~0,-8!"
) else (
    set "APP_ROOT=!TARGET_DIR!"
)

REM ---- 查找 Node.js ----
set "NODE_CMD="
where node >nul 2>&1
if !errorlevel! equ 0 (
    set "NODE_CMD=node"
    goto :found_node
)
if exist "D:\Vue\Node\node.exe" (
    set "NODE_CMD=D:\Vue\Node\node.exe"
    goto :found_node
)
if exist "C:\Program Files\nodejs\node.exe" (
    set "NODE_CMD=C:\Program Files\nodejs\node.exe"
    goto :found_node
)
if exist "C:\Program Files (x86)\nodejs\node.exe" (
    set "NODE_CMD=C:\Program Files (x86)\nodejs\node.exe"
    goto :found_node
)
if exist "%LOCALAPPDATA%\nvm" (
    for /d %%D in ("%LOCALAPPDATA%\nvm\v*") do (
        if exist "%%D\node.exe" set "NODE_CMD=%%D\node.exe"
    )
    if defined NODE_CMD goto :found_node
)

echo.
echo [ERROR] 未找到 Node.js，请先安装 Node.js 18.x 或更高版本
echo         下载地址: https://nodejs.org/
echo.
echo 已检查的路径:
echo   - PATH 中的 node
echo   - D:\Vue\Node\node.exe
echo   - C:\Program Files\nodejs\node.exe
echo   - C:\Program Files ^(x86^)\nodejs\node.exe
echo   - %%LOCALAPPDATA%%\nvm\v*
echo.
pause
exit /b 99

:found_node

REM ---- 显示 Banner ----
echo.
echo ============================================================
echo   音乐盒子 - 后端服务器启动器
echo   Backend Server Launcher
echo ============================================================
echo   Node.js:    !NODE_CMD!
echo   启动脚本:   !TARGET_SCRIPT!
echo   项目根目录: !APP_ROOT!
echo ============================================================
echo.

REM ---- 调用 .cjs 脚本，透传所有参数 ----
"!NODE_CMD!" "!TARGET_SCRIPT!" %*
set "EXITCODE=!errorlevel!"

echo.
echo ============================================================
if !EXITCODE! equ 0 (
    echo   [成功] 后端服务器启动完成
    goto :done
)
echo   [失败] 启动失败，退出码: !EXITCODE!
echo   常见原因:
echo     1 = 环境检查失败 ^(Node 版本/依赖/MySQL^)
echo     2 = Prisma Client 生成失败
echo     3 = 端口被占用且无法释放
echo     4 = 服务启动超时
echo     5 = 健康检查失败 ^(非致命^)
echo    99 = 内部异常
echo.
echo   排查建议:
echo     - 查看 !APP_ROOT!\logs\start-server.log
echo     - 查看 !APP_ROOT!\logs\api-server.log
echo     - 运行 db-tool.bat ping 验证数据库

:done
echo ============================================================
echo.

REM ---- 失败时暂停以便用户查看错误 ----
if !EXITCODE! neq 0 pause

endlocal & exit /b !EXITCODE!
