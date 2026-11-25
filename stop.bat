@echo off
chcp 65001 >nul
title 停止音乐盒子

echo.
echo  正在停止音乐盒子服务...
echo.

:: 查找并关闭后端窗口
taskkill /FI "WINDOWTITLE eq 音乐盒子-后端*" /F >nul 2>&1
if not errorlevel 1 (
    echo  [OK] 后端服务已停止
) else (
    echo  [跳过] 未找到后端服务
)

:: 查找并关闭前端窗口
taskkill /FI "WINDOWTITLE eq 音乐盒子-前端*" /F >nul 2>&1
if not errorlevel 1 (
    echo  [OK] 前端服务已停止
) else (
    echo  [跳过] 未找到前端服务
)

:: 查找并关闭 Node.js 进程（可选，取消注释以下行）
:: taskkill /IM node.exe /F >nul 2>&1

echo.
echo  音乐盒子服务已停止
echo.
pause
