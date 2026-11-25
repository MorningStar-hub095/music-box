# 音乐盒子启动脚本
# 用法: .\start.ps1

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "  ╔══════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║        音乐盒子 - Music Box          ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# 项目目录
$rootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverDir = Join-Path $rootDir "server"
$webDir = Join-Path $rootDir "web"

# 检查 Node.js
Write-Host "[检查] Node.js 环境..." -ForegroundColor Yellow
try {
    $nodeVersion = & node --version 2>&1
    Write-Host "[OK] Node.js $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "[错误] 未安装 Node.js，请先安装 Node.js (建议版本 18+)" -ForegroundColor Red
    Write-Host "       下载地址: https://nodejs.org/" -ForegroundColor Gray
    Read-Host "按 Enter 退出"
    exit 1
}

# 检查目录
if (-not (Test-Path $serverDir)) {
    Write-Host "[错误] 未找到 server 目录" -ForegroundColor Red
    Read-Host "按 Enter 退出"
    exit 1
}
if (-not (Test-Path $webDir)) {
    Write-Host "[错误] 未找到 web 目录" -ForegroundColor Red
    Read-Host "按 Enter 退出"
    exit 1
}

# 检查并安装后端依赖
Write-Host ""
Write-Host "[1/4] 检查后端依赖..." -ForegroundColor Yellow
if (-not (Test-Path (Join-Path $serverDir "node_modules"))) {
    Write-Host "      安装中..." -ForegroundColor Gray
    Push-Location $serverDir
    & npm install --silent 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[错误] 后端依赖安装失败" -ForegroundColor Red
        Pop-Location
        Read-Host "按 Enter 退出"
        exit 1
    }
    Pop-Location
}
Write-Host "      [OK] 后端依赖就绪" -ForegroundColor Green

# 检查并安装前端依赖
Write-Host "[2/4] 检查前端依赖..." -ForegroundColor Yellow
if (-not (Test-Path (Join-Path $webDir "node_modules"))) {
    Write-Host "      安装中..." -ForegroundColor Gray
    Push-Location $webDir
    & npm install --silent 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[错误] 前端依赖安装失败" -ForegroundColor Red
        Pop-Location
        Read-Host "按 Enter 退出"
        exit 1
    }
    Pop-Location
}
Write-Host "      [OK] 前端依赖就绪" -ForegroundColor Green

# 生成 Prisma Client
Write-Host "[3/4] 生成 Prisma Client..." -ForegroundColor Yellow
Push-Location $serverDir
& npx prisma generate --silent 2>&1 | Out-Null
Pop-Location
Write-Host "      [OK] Prisma Client 就绪" -ForegroundColor Green

# 启动服务
Write-Host "[4/4] 启动服务..." -ForegroundColor Yellow
Write-Host ""

# 启动后端
Write-Host "      启动后端服务 (端口 49200)..." -ForegroundColor Gray
$backendProcess = Start-Process -FilePath "cmd" -ArgumentList "/k", "title 音乐盒子-后端 && color 0A && echo [后端服务] 正在启动... && cd /d `"$serverDir`" && npm run dev" -PassThru -WindowStyle Normal

# 等待后端启动
Write-Host "      等待后端启动..." -ForegroundColor Gray
Start-Sleep -Seconds 5

# 启动前端
Write-Host "      启动前端服务 (端口 49201)..." -ForegroundColor Gray
$frontendProcess = Start-Process -FilePath "cmd" -ArgumentList "/k", "title 音乐盒子-前端 && color 0B && echo [前端服务] 正在启动... && cd /d `"$webDir`" && npm run dev" -PassThru -WindowStyle Normal

# 等待前端启动
Write-Host "      等待前端启动..." -ForegroundColor Gray
Start-Sleep -Seconds 8

Write-Host ""
Write-Host "  ╔══════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║        音乐盒子已启动！               ║" -ForegroundColor Green
Write-Host "  ╠══════════════════════════════════════╣" -ForegroundColor Green
Write-Host "  ║  前端: http://localhost:49201        ║" -ForegroundColor Green
Write-Host "  ║  后端: http://localhost:49200        ║" -ForegroundColor Green
Write-Host "  ╚══════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  提示:" -ForegroundColor Yellow
Write-Host "    - 关闭此窗口不会停止服务" -ForegroundColor Gray
Write-Host "    - 请分别关闭'音乐盒子-后端'和'音乐盒子-前端'窗口停止服务" -ForegroundColor Gray
Write-Host "    - 或运行 stop.bat 停止所有服务" -ForegroundColor Gray
Write-Host ""
Read-Host "按 Enter 退出"
