# Higgs TTS — Windows PowerShell shortcut creator
#
# Creates:
#   - Desktop shortcut "Higgs TTS.lnk" pointing at scripts\launch-higgs.vbs
#   - Start Menu shortcut under "Higgs TTS\Higgs TTS.lnk"
#
# Both shortcuts use the project's icon.ico.
#
# Idempotent: re-running just overwrites the existing shortcuts.

[CmdletBinding()]
param(
    [string]$Target = "scripts\launch-higgs.vbs",
    [string]$Workdir = ".",
    [string]$IconPath = "electron\assets\icon.ico"
)

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptDir "..")
Set-Location $projectRoot

# Resolve Target/Workdir/IconPath — accept either relative or absolute
function Resolve-Absolute([string]$p) {
    if ([System.IO.Path]::IsPathRooted($p)) { return $p }
    return Join-Path $projectRoot $p
}
$targetAbs = Resolve-Absolute $Target
$workAbs   = Resolve-Absolute $Workdir
$iconAbs   = Resolve-Absolute $IconPath

if (-not (Test-Path $targetAbs)) {
    Write-Error "Target not found: $targetAbs"
    exit 1
}

$shell = New-Object -ComObject WScript.Shell

# Desktop shortcut
$desktop = [Environment]::GetFolderPath("Desktop")
$deskLink = Join-Path $desktop "Rungano.lnk"
$sc = $shell.CreateShortcut($deskLink)
$sc.TargetPath = "wscript.exe"
$sc.Arguments   = "`"$targetAbs`""
$sc.WorkingDirectory = $workAbs
$sc.WindowStyle = 7  # 7 = minimized (no console flash)
$sc.IconLocation = "$iconAbs,0"
$sc.Description = "Rungano - Shona folktale narrator"
$sc.Save()
Write-Host "Created: $deskLink"

# Start Menu shortcut
$startMenu = [Environment]::GetFolderPath("StartMenu")
$appMenu = Join-Path $startMenu "Programs\Rungano"
if (-not (Test-Path $appMenu)) {
    New-Item -ItemType Directory -Path $appMenu -Force | Out-Null
}
$menuLink = Join-Path $appMenu "Rungano.lnk"
$sc = $shell.CreateShortcut($menuLink)
$sc.TargetPath = "wscript.exe"
$sc.Arguments   = "`"$targetAbs`""
$sc.WorkingDirectory = $workAbs
$sc.WindowStyle = 7
$sc.IconLocation = "$iconAbs,0"
$sc.Description = "Rungano - Shona folktale narrator"
$sc.Save()
Write-Host "Created: $menuLink"

Write-Host "Done."
