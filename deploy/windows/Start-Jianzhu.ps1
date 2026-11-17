param(
    [Parameter(Mandatory=$true)][string]$NodePath,
    [Parameter(Mandatory=$true)][string]$ReleasePath,
    [Parameter(Mandatory=$true)][string]$EnvPath,
    [Parameter(Mandatory=$true)][string]$LogPath,
    [ValidateRange(1,65535)][int]$Port = 80
)
$ErrorActionPreference = 'Stop'
$env:NODE_ENV = 'production'
$env:NEXT_TELEMETRY_DISABLED = '1'
Set-Location -LiteralPath $ReleasePath
# Windows PowerShell 5.1 treats native stderr as ErrorRecord objects. Next.js
# warnings must be logged without turning a healthy process into a failure.
$ErrorActionPreference = 'Continue'
& $NodePath "--env-file=$EnvPath" (Join-Path $ReleasePath 'node_modules\next\dist\bin\next') start --hostname 0.0.0.0 --port $Port 1>> (Join-Path $LogPath 'stdout.log') 2>> (Join-Path $LogPath 'stderr.log')
exit $LASTEXITCODE
