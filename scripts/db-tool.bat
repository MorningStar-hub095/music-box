@echo off
chcp 65001 > nul 2>&1
setlocal EnableDelayedExpansion
title 音乐盒子 - 数据库访问工具

REM ============================================================
REM 此 .bat 可放置在以下任一位置:
REM   - 项目根目录 (D:\music_box\)
REM   - scripts\ 子目录 (D:\music_box\scripts\)
REM 脚本会自动查找 db-tool.cjs 的位置
REM ============================================================

REM ---- 定位 .bat 所在目录 ----
set "BAT_DIR=%~dp0"
if "!BAT_DIR:~-1!"=="\" set "BAT_DIR=!BAT_DIR:~0,-1!"

REM ---- 多路径查找 db-tool.cjs ----
set "TARGET_SCRIPT="
if exist "!BAT_DIR!\db-tool.cjs" set "TARGET_SCRIPT=!BAT_DIR!\db-tool.cjs"
if not defined TARGET_SCRIPT if exist "!BAT_DIR!\scripts\db-tool.cjs" set "TARGET_SCRIPT=!BAT_DIR!\scripts\db-tool.cjs"
if not defined TARGET_SCRIPT if exist "!BAT_DIR!\..\scripts\db-tool.cjs" set "TARGET_SCRIPT=!BAT_DIR!\..\scripts\db-tool.cjs"

if not defined TARGET_SCRIPT (
    echo.
    echo [ERROR] 未找到 db-tool.cjs
    echo   已检查以下路径:
    echo     - !BAT_DIR!\db-tool.cjs
    echo     - !BAT_DIR!\scripts\db-tool.cjs
    echo     - !BAT_DIR!\..\scripts\db-tool.cjs
    echo.
    echo   请将此 .bat 文件放置在项目根目录或 scripts\ 子目录
    echo.
    pause
    exit /b 1
)

REM ---- 推导项目根目录 ----
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
pause
exit /b 99

:found_node

REM ---- 统计参数数量 ----
set "ARG_COUNT=0"
for %%A in (%*) do set /a ARG_COUNT+=1

REM ---- 有参数直接透传 ----
if !ARG_COUNT! gtr 0 goto :run_direct
goto :menu

:run_direct
"!NODE_CMD!" "!TARGET_SCRIPT!" %*
set "EXITCODE=!errorlevel!"
echo.
if !EXITCODE! neq 0 (
    echo ============================================================
    echo   [失败] 命令执行失败，退出码: !EXITCODE!
    echo ============================================================
    pause
)
endlocal & exit /b !EXITCODE!

REM ---- 无参数：显示交互菜单 ----
:menu
cls
echo.
echo ============================================================
echo   音乐盒子 - 数据库访问工具
echo   Database Access Tool
echo ============================================================
echo   Node.js:    !NODE_CMD!
echo   脚本路径:   !TARGET_SCRIPT!
echo ============================================================
echo.
echo   可用命令:
echo.
echo   [1] ping                验证数据库连接
echo   [2] stats               数据库统计
echo   [3] tables              列出所有表
echo   [4] users               列出用户 ^(默认 20 个^)
echo   [5] songs                列出歌曲 ^(默认 20 首^)
echo   [6] auth ^<用户名^>       交互式身份认证
echo   [7] user ^<id^>           查询用户详情
echo   [8] song ^<id^>           查询歌曲详情
echo   [9] help                显示完整帮助
echo   [0] 退出
echo.
set /p "CHOICE=请选择 [0-9]: "

if "!CHOICE!"=="0" goto :eof
if "!CHOICE!"=="1" (
    "!NODE_CMD!" "!TARGET_SCRIPT!" ping
    goto :after_run
)
if "!CHOICE!"=="2" (
    "!NODE_CMD!" "!TARGET_SCRIPT!" stats
    goto :after_run
)
if "!CHOICE!"=="3" (
    "!NODE_CMD!" "!TARGET_SCRIPT!" tables
    goto :after_run
)
if "!CHOICE!"=="4" (
    "!NODE_CMD!" "!TARGET_SCRIPT!" users --limit 20
    goto :after_run
)
if "!CHOICE!"=="5" (
    "!NODE_CMD!" "!TARGET_SCRIPT!" songs --limit 20
    goto :after_run
)
if "!CHOICE!"=="6" (
    set /p "USERNAME=请输入用户名: "
    if "!USERNAME!"=="" (
        echo 用户名不能为空
        goto :after_run
    )
    "!NODE_CMD!" "!TARGET_SCRIPT!" auth !USERNAME!
    goto :after_run
)
if "!CHOICE!"=="7" (
    set /p "USERID=请输入用户 ID: "
    if "!USERID!"=="" (
        echo 用户 ID 不能为空
        goto :after_run
    )
    "!NODE_CMD!" "!TARGET_SCRIPT!" user !USERID!
    goto :after_run
)
if "!CHOICE!"=="8" (
    set /p "SONGID=请输入歌曲 ID: "
    if "!SONGID!"=="" (
        echo 歌曲 ID 不能为空
        goto :after_run
    )
    "!NODE_CMD!" "!TARGET_SCRIPT!" song "!SONGID!"
    goto :after_run
)
if "!CHOICE!"=="9" (
    "!NODE_CMD!" "!TARGET_SCRIPT!" help
    goto :after_run
)
echo 无效的选项: !CHOICE!

:after_run
echo.
echo ------------------------------------------------------------
pause
goto :menu

endlocal
