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
