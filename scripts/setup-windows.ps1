# Installs everything needed to build T3 Overlay on Windows 10/11.
# Run from the repo root:  powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1
$ErrorActionPreference = "Stop"

function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

if (-not (Have "winget")) {
  throw "winget is missing. Install 'App Installer' from the Microsoft Store, then run this again."
}

Write-Host "==> Visual Studio C++ Build Tools (needed by Rust)" -ForegroundColor Cyan
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$hasVc = (Test-Path $vswhere) -and (& $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath)
if ($hasVc) { Write-Host "    already installed" }
else {
  winget install --id Microsoft.VisualStudio.2022.BuildTools -e --accept-source-agreements --accept-package-agreements `
    --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
}

Write-Host "==> Rust" -ForegroundColor Cyan
if (Have "cargo") { Write-Host "    already installed" }
else {
  winget install --id Rustlang.Rustup -e --accept-source-agreements --accept-package-agreements
  $env:Path += ";$env:USERPROFILE\.cargo\bin"
}
rustup default stable | Out-Null

Write-Host "==> Node.js" -ForegroundColor Cyan
if (Have "node") { Write-Host "    already installed ($(node --version))" }
else {
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
  $env:Path += ";$env:ProgramFiles\nodejs"
}

Write-Host ""
Write-Host "Done. Open a NEW terminal so PATH updates apply, then run scripts\build.cmd" -ForegroundColor Green
