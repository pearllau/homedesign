[CmdletBinding()]
param(
    [string]$PublicKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICgPkZk2sEgsObZXTT8PhdH9w61KLEpLXbcDZMcPblR1 codex-jianzhu-deploy'
)

$ErrorActionPreference = 'Stop'
$deployIdentity = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $deployIdentity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this script from an elevated PowerShell session.'
}
$PublicKey = $PublicKey.Trim()
if ($PublicKey -notmatch '^ssh-ed25519 [A-Za-z0-9+/=]+(?: [^\r\n]+)?$') {
    throw 'A single valid Ed25519 public key is required.'
}
$authorized = 'C:\ProgramData\ssh\administrators_authorized_keys'

Add-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0' | Out-Null
Set-Service -Name sshd -StartupType Automatic
Start-Service sshd
if (-not (Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server (sshd)' `
        -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null
}
Enable-NetFirewallRule -Name 'OpenSSH-Server-In-TCP'

New-Item -ItemType Directory -Path (Split-Path -Parent $authorized) -Force | Out-Null
if (-not (Test-Path -LiteralPath $authorized) -or -not (Select-String -LiteralPath $authorized -SimpleMatch $PublicKey -Quiet)) {
    Add-Content -LiteralPath $authorized -Value $PublicKey -Encoding ASCII
}
icacls.exe $authorized /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Unable to set administrators_authorized_keys ACL.' }
Write-Host 'OpenSSH is enabled and the deployment key is authorized.'
