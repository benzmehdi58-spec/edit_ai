Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "c:\Users\benzm\OneDrive\Bureau\AI edit\hormozi-sub\frontend"
WshShell.Run """node_modules\electron\dist\electron.exe"" .", 1, False
