# signa CLI installer for Windows. v0.2
#
# Recommended (works from cmd.exe, PowerShell, and Windows Terminal):
#   powershell -ExecutionPolicy Bypass -Command "iwr https://www.signaagent.xyz/install.ps1 -UseBasicParsing | iex"
#
# Native PowerShell:
#   iwr https://www.signaagent.xyz/install.ps1 -UseBasicParsing | iex
#
# Lays down:
#   %USERPROFILE%\.signa\signa.mjs           the CLI source
#   %USERPROFILE%\.signa\package.json        declares viem as a dep
#   %USERPROFILE%\.signa\node_modules\viem\  pulled by npm install
#   %USERPROFILE%\.signa\bin\signa.cmd       cmd wrapper -> node signa.mjs %*
#
# Idempotent. Re-running upgrades signa.mjs in place and refreshes deps.
#
# IMPORTANT: this file is intentionally ASCII-only. PowerShell 5.1 reads
# .ps1 files in the system OEM/ANSI codepage unless they carry a UTF-8
# BOM. Smart quotes and arrows in here would mojibake the parser and
# fail the whole install. Keep it boring ASCII.

$ErrorActionPreference = "Stop"

$BaseUrl     = if ($env:SIGNA_BASE_URL) { $env:SIGNA_BASE_URL } else { "https://www.signaagent.xyz" }
$SignaHome   = Join-Path $env:USERPROFILE ".signa"
$BinDir      = Join-Path $SignaHome "bin"
$CliPath     = Join-Path $SignaHome "signa.mjs"
$WrapperPath = Join-Path $BinDir "signa.cmd"
$PkgPath     = Join-Path $SignaHome "package.json"
$SourceUrl   = "$BaseUrl/signa.mjs"

# ---------- prereqs ----------

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "signa needs Node.js (18 or newer). install it first:" -ForegroundColor Red
    Write-Host "  https://nodejs.org/en/download"
    Write-Host ""
    Write-Host "then re-run this installer."
    exit 1
}

$nodeMajor = [int](& node -e "console.log(process.versions.node.split('.')[0])")
if ($nodeMajor -lt 18) {
    Write-Host "signa needs Node 18 or newer. you have $(& node -v)." -ForegroundColor Red
    Write-Host "upgrade Node and re-run this installer."
    exit 1
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "npm is required to fetch wallet deps (viem). install npm (ships with Node.js) and re-run." -ForegroundColor Red
    exit 1
}

# ---------- layout ----------

New-Item -ItemType Directory -Path $SignaHome -Force | Out-Null
New-Item -ItemType Directory -Path $BinDir   -Force | Out-Null

# ---------- download CLI source ----------

Write-Host "[1/4] downloading signa.mjs from $SourceUrl"
Invoke-WebRequest -Uri $SourceUrl -OutFile $CliPath -UseBasicParsing

# ---------- declare deps + install ----------

$pkgJson = @'
{
  "name": "signa-cli-runtime",
  "version": "0.3.0",
  "private": true,
  "description": "Local dep bag for the signa CLI. Do not edit by hand.",
  "type": "module",
  "dependencies": {
    "viem": "^2.21.0",
    "@xmtp/node-sdk": "^4.0.0"
  }
}
'@
Set-Content -Path $PkgPath -Value $pkgJson -Encoding UTF8

Write-Host "[2/4] installing viem + xmtp into $SignaHome\node_modules (one-time, ~45s on windows)"
Write-Host "      xmtp pulls native crypto bindings — first install is the slowest"
Push-Location $SignaHome
try {
    # --silent + --no-audit + --no-fund keep the output clean. --no-package-lock
    # so we do not litter a lock the user did not ask for.
    & npm install --silent --no-audit --no-fund --no-package-lock 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "npm install failed with exit code $LASTEXITCODE"
    }
} finally {
    Pop-Location
}

# ---------- bin wrapper ----------

Write-Host "[3/4] writing wrapper $WrapperPath"
$wrapper = "@echo off`r`nnode `"$CliPath`" %*`r`n"
Set-Content -Path $WrapperPath -Value $wrapper -Encoding ASCII -NoNewline

# ---------- PATH ----------

# Append %USERPROFILE%\.signa\bin to the user PATH if not already there.
# Uses the User scope so it persists across shells without admin rights.
Write-Host "[4/4] updating user PATH"
$userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
if (-not $userPath) { $userPath = "" }
$pathEntries = $userPath.Split(";") | Where-Object { $_ -ne "" }
if ($pathEntries -notcontains $BinDir) {
    if ($userPath.TrimEnd(";") -eq "") {
        $newPath = $BinDir
    } else {
        $newPath = $userPath.TrimEnd(";") + ";" + $BinDir
    }
    [Environment]::SetEnvironmentVariable("PATH", $newPath, "User")
    $env:PATH = "$env:PATH;$BinDir"   # so it works in *this* session too
    $pathAdded = $true
} else {
    $pathAdded = $false
}

# ---------- verify ----------

$version = & node $CliPath version 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "[X] installed binary failed self-check. try re-running the installer." -ForegroundColor Red
    Write-Host $version
    exit 1
}

# ---------- done ----------

Write-Host ""
Write-Host "[OK] signa installed at $WrapperPath" -ForegroundColor Green
Write-Host "[OK] $version" -ForegroundColor Green
Write-Host "[OK] viem installed at $SignaHome\node_modules\viem" -ForegroundColor Green
if ($pathAdded) {
    Write-Host "[OK] added $BinDir to your user PATH" -ForegroundColor Green
    Write-Host ""
    Write-Host "open a NEW terminal (or restart this one) so the PATH change picks up." -ForegroundColor Yellow
} else {
    Write-Host "(PATH already had $BinDir)" -ForegroundColor DarkGray
}
Write-Host ""
Write-Host "then try:"
Write-Host "  signa --help"
Write-Host "  signa ask `"price of `$USDC on base`""
Write-Host "  signa login --new"
Write-Host "  signa wallet"
Write-Host "  signa post `"hello from the signa cli`""
Write-Host "  signa inbox"
Write-Host ""
Write-Host "decentralized cli for the signa network. base mainnet."
