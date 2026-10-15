# Tries a built Windows installer the way a person would, short of the
# browser: a silent install, the icon opened, a password chosen on the
# first-run page, the app and the WhatsApp bridge up on the bundled Node,
# then a stop and a silent uninstall.
#
#   pwsh desktop/test/smoke-windows.ps1 dist\Ormma-<version>-windows-setup.exe
#
# It installs Ormma for real, for this Windows account, on the usual ports:
# it is for a computer with no one's Ormma on it (CI — .github/workflows).
# Its bridge has no WhatsApp link, so it never connects to WhatsApp, and
# nothing is sent.

param([Parameter(Mandatory)] [string] $Installer)
$ErrorActionPreference = "Stop"
$env:ORMMA_NO_BROWSER = "1"
$install = Join-Path $env:LOCALAPPDATA "Programs\Ormma"
$data = Join-Path $env:LOCALAPPDATA "Ormma"
$ormma = Join-Path $install "Ormma.exe"
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$port = 3210

function Say($message) { Write-Host "smoke: $message" }
function Fail($message) {
  Say "FAILED: $message"
  Get-ChildItem "$data\logs\*.log" -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "--- $_"; Get-Content $_ -Tail 30 }
  exit 1
}
function Health {
  try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://127.0.0.1:$port/healthz").Content } catch { $null }
}
function WaitFor($what, [scriptblock] $check) {
  for ($i = 0; $i -lt 90; $i++) { if (& $check) { return }; Start-Sleep -Milliseconds 500 }
  Fail $what
}
# Waits for that one program, not for what it leaves running (Start-Process
# -Wait would wait for Ormma itself, which runs on).
function Run($file, $arguments = @()) {
  $process = Start-Process -FilePath $file -ArgumentList $arguments -PassThru
  $process.WaitForExit()
  return $process.ExitCode
}
function RunValue { (Get-ItemProperty $runKey -ErrorAction SilentlyContinue).Ormma }

Run $Installer @("/S") | Out-Null
if (-not (Test-Path $ormma)) { Fail "nothing was installed at $install" }
if ((RunValue) -ne "`"$ormma`" serve") { Fail "the Run key says: $(RunValue)" }
if (-not (Test-Path "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Ormma\Ormma.lnk")) { Fail "no Start menu shortcut" }
Say "installed, with its Start menu shortcuts and the Run key"

# What the icon does.
$code = Run $ormma
if ($code -ne 0) { Fail "opening Ormma ended with $code" }
WaitFor "the first-run page did not answer" { (Health) -match "setup" }
$page = (Invoke-WebRequest -UseBasicParsing "http://localhost:$port/").Content
if ($page -notmatch "Choose a password for Ormma") { Fail "the first-run page is not the first-run page" }
Say "first-run page up"

$answer = Invoke-WebRequest -UseBasicParsing -Method Post -Uri "http://localhost:$port/" -Headers @{ Origin = "http://localhost:$port" } -Body @{ password = "smoke-test-1"; again = "smoke-test-1" }
if ($answer.StatusCode -ne 200) { Fail "choosing a password answered $($answer.StatusCode)" }
WaitFor "the app did not take over its port" { $h = Health; $h -and $h -notmatch "setup" }
Say "password chosen; the app is up"

$token = (Get-Content "$data\ormma.env" | Where-Object { $_ -like "WHATSAPP_BRIDGE_TOKEN=*" }) -replace "^WHATSAPP_BRIDGE_TOKEN=", ""
WaitFor "the bridge did not answer" { try { Invoke-RestMethod "http://127.0.0.1:3211/healthz" } catch { $null } }
$status = Invoke-RestMethod -Uri "http://127.0.0.1:3211/status" -Headers @{ Authorization = "Bearer $token" }
if ($status.state -ne "idle") { Fail "the bridge is '$($status.state)', not idle" }
Say "the bridge is up, with no phone linked"

$processes = @(Get-Process ormma-node -ErrorAction SilentlyContinue)
if ($processes.Count -ne 3) { Fail "$($processes.Count) Ormma processes, not 3 (Ormma, the app, the bridge)" }
if ($processes | Where-Object { $_.MainWindowHandle -ne 0 }) { Fail "an Ormma process has a window" }
Say "3 Ormma processes, none with a window"

Run $ormma @("stop") | Out-Null
WaitFor "it did not stop" { -not (Get-Process ormma-node -ErrorAction SilentlyContinue) }
Say "stopped"

Run (Join-Path $install "Uninstall Ormma.exe") @("/S") | Out-Null
# The uninstaller runs on from a copy of itself in the temporary folder.
WaitFor "the uninstaller did not finish" { -not (Test-Path $ormma) }
if (RunValue) { Fail "the Run key is still there" }
if (-not (Test-Path "$data\app\birthdays.db")) { Fail "uninstalling took the data too" }
Say "uninstalled, and the data stays — all good"
