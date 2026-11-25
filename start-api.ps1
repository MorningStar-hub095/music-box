# Music Box - Start API Server
param(
    [string]$NodeExe = "D:\Vue\Node\node.exe",
    [string]$ServerDir = (Join-Path $PSScriptRoot "server"),
    [string]$ScriptDir = $PSScriptRoot
)

# Try to find node if default doesn't exist
if (-not (Test-Path $NodeExe)) {
    $nodeInPath = Get-Command node -ErrorAction SilentlyContinue
    if ($nodeInPath) {
        $NodeExe = $nodeInPath.Source
    } else {
        $candidates = @(
            "C:\Program Files\nodejs\node.exe",
            "C:\Program Files (x86)\nodejs\node.exe"
        )
        foreach ($c in $candidates) {
            if (Test-Path $c) { $NodeExe = $c; break }
        }
    }
}

$entryPoint = Join-Path $ServerDir "dist\index.js"
if (-not (Test-Path $entryPoint)) {
    Write-Host "[ERROR] $entryPoint not found" -ForegroundColor Red
    exit 1
}

Start-Process -FilePath $NodeExe -ArgumentList "`"$entryPoint`"" -WorkingDirectory $ServerDir -WindowStyle Hidden
Write-Host "[OK] API Server started"
