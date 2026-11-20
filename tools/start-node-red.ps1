$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$portNumber = 1884
$environmentFile = Join-Path $projectDirectory '.env'
if (Test-Path -LiteralPath $environmentFile) {
    $portLine = Get-Content -LiteralPath $environmentFile | Where-Object { $_ -match '^PORT=\d+\s*$' } | Select-Object -First 1
    if ($portLine) { $portNumber = [int]($portLine -replace '^PORT=', '') }
}
$listener = Get-NetTCPConnection -LocalPort $portNumber -State Listen -ErrorAction SilentlyContinue
if ($listener) {
    Write-Output "Cong $portNumber dang duoc su dung. Khong mo them Node-RED."
    exit 0
}
$runtimeDirectory = Join-Path $projectDirectory 'data/runtime'
New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
$nodeExecutable = (Get-Command node -ErrorAction Stop).Source
$entryPoint = Join-Path $projectDirectory 'node_modules/node-red/red.js'
$userDirectory = Join-Path $projectDirectory 'node-red'
$settingsFile = Join-Path $userDirectory 'settings.js'
$arguments = @(('"' + $entryPoint + '"'), '--userDir', ('"' + $userDirectory + '"'), '--settings', ('"' + $settingsFile + '"'))
$nodeRedProcess = Start-Process -FilePath $nodeExecutable -ArgumentList $arguments -WorkingDirectory $projectDirectory -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDirectory 'node-red.log') -RedirectStandardError (Join-Path $runtimeDirectory 'node-red-error.log')
$nodeRedProcess.Id | Set-Content -LiteralPath (Join-Path $runtimeDirectory 'node-red.pid')
Write-Output "Node-RED dang chay nen. Mo http://localhost:$portNumber/auth/login"
