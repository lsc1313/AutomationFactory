Set shell = CreateObject("WScript.Shell")
base = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & base & "\start-hidden.ps1"""
shell.Run command, 0, True
WScript.Sleep 1800
shell.Run "http://127.0.0.1:8040/app", 1, False
