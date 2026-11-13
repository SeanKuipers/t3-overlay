# Builds the T3 Overlay installer.  Run:  scripts\build.cmd   (or this file with PowerShell)
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

foreach ($cmd in "node", "npm", "cargo") {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    throw "$cmd not found. Run scripts\setup-windows.ps1 first (then open a new terminal)."
  }
}

Write-Host "==> Installing JavaScript dependencies" -ForegroundColor Cyan
npm ci
if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }

Write-Host "==> Building (the first build compiles Rust crates and takes a few minutes)" -ForegroundColor Cyan
npm run tauri build
if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }

$bundle = "src-tauri\target\release\bundle"
$installer = Get-ChildItem "$bundle\nsis\*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
Write-Host ""
Write-Host "Built:" -ForegroundColor Green
Get-ChildItem "$bundle\nsis\*.exe", "$bundle\msi\*.msi" -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $($_.FullName)" }
Write-Host "  src-tauri\target\release\t3-overlay.exe  (portable, no install)"
if ($installer) {
  $answer = Read-Host "Run the installer now? [Y/n]"
  if ($answer -ne "n") { Start-Process $installer.FullName }
}
