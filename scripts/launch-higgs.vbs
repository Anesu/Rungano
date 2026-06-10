' VBS wrapper that launches launch-higgs.bat with NO console window flash.
' Used by the desktop shortcut so the user double-clicks and gets a clean
' native-window experience.
Option Explicit
Dim strBatPath
strBatPath = CreateObject("WScript.Shell").CurrentDirectory & "\scripts\launch-higgs.bat"
' If launched from a shortcut, CurrentDirectory may not be the project root.
' Resolve relative to this script's location.
Dim fso, scriptDir
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
scriptDir = fso.GetParentFolderName(scriptDir)  ' ..\scripts → project root
strBatPath = scriptDir & "\scripts\launch-higgs.bat"

Dim shell
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = scriptDir
shell.Run """" & strBatPath & """", 0, False  ' 0 = hidden window, False = don't wait
