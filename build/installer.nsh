!macro customCheckAppRunning
  ; By overriding this macro, electron-builder skips the default "App is running" popup prompt.
!macroend

!macro customInit
  ; Silently kill the watchdog script (kill all wscript instances)
  nsExec::ExecToStack 'taskkill /F /IM "wscript.exe"'
  
  ; Silently kill the application
  nsExec::ExecToStack 'taskkill /F /IM "CML Loader.exe"'
  
  ; Give it a tiny bit of time to fully close
  Sleep 1000
!macroend

!macro customInstall
  ; Remove existing desktop shortcuts to prevent showing the app on target laptop during update
  Delete "$DESKTOP\CML Loader.lnk"
  Delete "$DESKTOP\cml-loader.lnk"
  
  ; Remove start menu shortcuts if they exist
  Delete "$SMPROGRAMS\CML Loader.lnk"
  RMDir /r "$SMPROGRAMS\CML Loader"

  ; -- FIX FOR APT-1 TO APT-3 RESTART ISSUE --
  ; Write a VBScript to the temp folder that will forcefully start the app after 15 seconds
  ; This bypasses the faulty .bat script in older versions.
  FileOpen $0 "$TEMP\force_start_cml.vbs" w
  FileWrite $0 'WScript.Sleep 15000$\r$\n'
  FileWrite $0 'Set objShell = CreateObject("WScript.Shell")$\r$\n'
  FileWrite $0 'objShell.Run """$INSTDIR\CML Loader.exe""", 0, False$\r$\n'
  FileWrite $0 'Set objFSO = CreateObject("Scripting.FileSystemObject")$\r$\n'
  FileWrite $0 'objFSO.DeleteFile WScript.ScriptFullName$\r$\n'
  FileClose $0

  ; Execute the VBScript silently without any window
  ExecWait 'cmd.exe /c start /b wscript.exe "$TEMP\force_start_cml.vbs"'
!macroend
