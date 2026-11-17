[CmdletBinding()]
param(
    [string]$InstallRoot = 'C:\Apps\Jianzhu',
    [ValidateRange(1,65535)][int]$Port = 80,
    [string]$EnvFile,
    [string]$PublicAddress = '101.37.71.218',
    [string]$NpmRegistry = 'https://registry.npmjs.org'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$deployIdentity = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $deployIdentity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this installer from an elevated PowerShell session.'
}
$deploySource = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
if (-not (Test-Path -LiteralPath (Join-Path $deploySource 'package-lock.json'))) {
    throw 'Extract the entire source archive before running this script.'
}
$deployTaskName = 'Jianzhu-Web'
if (Get-ScheduledTask -TaskName $deployTaskName -ErrorAction SilentlyContinue) {
    throw 'Jianzhu-Web already exists. This initial installer will not replace a running deployment.'
}
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
    throw "Port $Port is already in use. Choose a free port with -Port; no existing site was changed."
}
$deployShared = Join-Path $InstallRoot 'shared'
$deploySecretPath = Join-Path $deployShared '.env.local'
$deployLogs = Join-Path $InstallRoot 'logs'
$deployRelease = Join-Path $InstallRoot ('releases\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$null = New-Item -ItemType Directory -Path $deployShared,$deployLogs,$deployRelease -Force
& icacls.exe $InstallRoot /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Unable to restrict deployment directory permissions.' }

function Read-SecretValue([string]$Prompt) {
    $deploySecure = Read-Host $Prompt -AsSecureString
    $deployPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($deploySecure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($deployPointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($deployPointer) }
}
if ($EnvFile) {
    Copy-Item -LiteralPath (Resolve-Path -LiteralPath $EnvFile).Path -Destination $deploySecretPath
} elseif (-not (Test-Path -LiteralPath $deploySecretPath)) {
    $deployKey = Read-SecretValue 'DeepSeek API key (hidden)'
    $deployVisionKey = Read-SecretValue 'Vision API key (hidden)'
    $deployVisionUrl = Read-Host 'Vision base URL [https://ark.cn-beijing.volces.com/api/v3]'
    if (-not $deployVisionUrl) { $deployVisionUrl = 'https://ark.cn-beijing.volces.com/api/v3' }
    $deployVisionModel = Read-Host 'Vision model or endpoint ID'
    if (-not $deployKey -or -not $deployVisionKey -or -not $deployVisionModel) {
        throw 'Both AI services must be configured. No site has been started.'
    }
    $deployEnvLines = @(
        "DEEPSEEK_API_KEY=$deployKey",
        'DEEPSEEK_MODEL=deepseek-chat',
        "VISION_API_KEY=$deployVisionKey",
        "VISION_BASE_URL=$deployVisionUrl",
        "VISION_MODEL=$deployVisionModel"
    )
    [IO.File]::WriteAllLines($deploySecretPath, $deployEnvLines, [Text.UTF8Encoding]::new($false))
    $deployKey = $null; $deployVisionKey = $null; $deployEnvLines = $null
}
$deployEnvText = [IO.File]::ReadAllText($deploySecretPath)
foreach ($deploySetting in @('DEEPSEEK_API_KEY','VISION_API_KEY','VISION_BASE_URL','VISION_MODEL')) {
    if ($deployEnvText -notmatch ('(?m)^' + $deploySetting + '=\S+')) {
        throw "Missing required server setting: $deploySetting"
    }
}
$deployEnvText = $null

$deployNodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$deployNode = if ($deployNodeCommand) { $deployNodeCommand.Source } else { $null }
if ($deployNode) {
    $deployNodeMajor = [int]((& $deployNode -p 'process.versions.node.split(".")[0]').Trim())
    if ($deployNodeMajor -lt 22) { $deployNode = $null }
}
if (-not $deployNode) {
    $deployRuntime = Join-Path $InstallRoot 'runtime'
    $null = New-Item -ItemType Directory -Path $deployRuntime -Force
    $deployBase = 'https://nodejs.org/dist/latest-v22.x/'
    $deployChecksums = (Invoke-WebRequest -UseBasicParsing -Uri ($deployBase + 'SHASUMS256.txt')).Content
    if ($deployChecksums -is [byte[]]) { $deployChecksums = [Text.Encoding]::UTF8.GetString($deployChecksums) }
    $deployChecksumLine = $deployChecksums -split "`n" | Where-Object { $_ -match '\snode-v[\d.]+-win-x64\.zip\s*$' } | Select-Object -First 1
    if (-not $deployChecksumLine) { throw 'Node.js download manifest did not contain a Windows x64 archive.' }
    $deployChecksumLine = $deployChecksumLine.Trim()
    $deployParts = $deployChecksumLine -split '\s+'
    $deployRuntimeZip = Join-Path $deployRuntime $deployParts[1]
    Invoke-WebRequest -UseBasicParsing -Uri ($deployBase + $deployParts[1]) -OutFile $deployRuntimeZip
    if ((Get-FileHash -LiteralPath $deployRuntimeZip -Algorithm SHA256).Hash -ne $deployParts[0]) {
        throw 'Node.js archive checksum verification failed.'
    }
    Expand-Archive -LiteralPath $deployRuntimeZip -DestinationPath $deployRuntime -Force
    $deployNode = Join-Path $deployRuntime ([IO.Path]::GetFileNameWithoutExtension($deployParts[1]) + '\node.exe')
}
$deployNpm = Join-Path (Split-Path -Parent $deployNode) 'node_modules\npm\bin\npm-cli.js'
if (-not (Test-Path -LiteralPath $deployNpm)) { throw 'Node.js installation is missing npm.' }
$env:PATH = (Split-Path -Parent $deployNode) + ';' + $env:PATH
$env:NEXT_TELEMETRY_DISABLED = '1'

$deployFiles = @('src','public','scripts','deploy','package.json','package-lock.json','next.config.ts','postcss.config.mjs','tsconfig.json','tsconfig.node.json')
foreach ($deployItem in $deployFiles) {
    Copy-Item -LiteralPath (Join-Path $deploySource $deployItem) -Destination $deployRelease -Recurse
}
# Keep the checked-in application price book beside the release. Raw source
# sheets under data\price-sources are deliberately excluded from deployments.
$deployPriceSource = Join-Path $deploySource 'data\prices'
$deployPriceDestination = Join-Path $deployRelease 'data\prices'
$null = New-Item -ItemType Directory -Path $deployPriceDestination -Force
Get-ChildItem -LiteralPath $deployPriceSource -Force | Copy-Item -Destination $deployPriceDestination -Recurse -Force
Push-Location $deployRelease
try {
    & $deployNode $deployNpm ci --include=dev "--registry=$NpmRegistry"
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    & $deployNode $deployNpm run build:ecs
    if ($LASTEXITCODE -ne 0) { throw 'Production build failed. No running site was replaced.' }
} finally { Pop-Location }

$deployRunner = Join-Path $deployRelease 'deploy\windows\Start-Jianzhu.ps1'
$deployTaskArgs = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -NodePath "{1}" -ReleasePath "{2}" -EnvPath "{3}" -LogPath "{4}" -Port {5}' -f $deployRunner,$deployNode,$deployRelease,$deploySecretPath,$deployLogs,$Port
$deployAction = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument $deployTaskArgs -WorkingDirectory $deployRelease
$deployTrigger = New-ScheduledTaskTrigger -AtStartup
$deploySettings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$null = Register-ScheduledTask -TaskName $deployTaskName -Action $deployAction -Trigger $deployTrigger -Settings $deploySettings -User 'SYSTEM' -RunLevel Highest
$deployFirewallName = "Jianzhu-Web-$Port"
if (-not (Get-NetFirewallRule -Name $deployFirewallName -ErrorAction SilentlyContinue)) {
    $null = New-NetFirewallRule -Name $deployFirewallName -DisplayName $deployFirewallName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port
}
Start-ScheduledTask -TaskName $deployTaskName
$deployHealthy = $false
for ($deployAttempt = 0; $deployAttempt -lt 30; $deployAttempt++) {
    try {
        $deployResponse = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/" -TimeoutSec 2
        if ($deployResponse.StatusCode -eq 200) { $deployHealthy = $true; break }
    } catch { Start-Sleep -Seconds 2 }
}
if (-not $deployHealthy) { throw "Startup health check failed. Check $deployLogs and scheduled task $deployTaskName." }
$deployReadiness = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/api/floorplan/recognize" -TimeoutSec 10
Write-Host ('Local website: OK; vision configuration: ' + $deployReadiness.StatusCode)
Write-Host ("Open http://{0}{1}/ after allowing TCP {2} in the ECS security group." -f $PublicAddress, $(if ($Port -eq 80) { '' } else { ':' + $Port }), $Port)
Write-Host "Logs: $deployLogs; task: $deployTaskName; release: $deployRelease"
