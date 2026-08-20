' World Clock Widget launcher - starts the app in the background with no console window.
' Double-click this file; everything else is managed from the tray icon.

Dim fso, sh, base, exe
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")

base = fso.GetParentFolderName(WScript.ScriptFullName)
exe  = base & "\node_modules\electron\dist\electron.exe"

If Not fso.FileExists(exe) Then
  MsgBox "Electron is not installed yet." & vbCrLf & vbCrLf & _
         "Run these in this folder first:" & vbCrLf & _
         "  npm install" & vbCrLf & _
         "  node node_modules\electron\install.js", _
         vbExclamation, "World Clock Widget"
  WScript.Quit 1
End If

sh.CurrentDirectory = base
' 0 = hidden window, False = do not wait
sh.Run """" & exe & """ """ & base & """", 0, False
