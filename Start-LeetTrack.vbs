Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = root
shell.Environment("Process").Remove "ELECTRON_RUN_AS_NODE"
shell.Run Chr(34) & root & "\node_modules\electron\dist\electron.exe" & Chr(34) & " " & Chr(34) & root & Chr(34), 1, False
