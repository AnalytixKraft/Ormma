; The Windows installer for Ormma. desktop/build.mjs runs makensis on this
; with the app laid out in SOURCE, and sets VERSION, ICON and OUTFILE.
;
; It installs for the one person running it — in %LOCALAPPDATA%\Programs,
; no administrator needed — and has Ormma start when they sign in (the Run
; key; Task Manager > Startup apps turns it off). Their data is not here but
; in %LOCALAPPDATA%\Ormma, and uninstalling leaves it, as an update must.

Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"

!macro Needs NAME
  !ifndef ${NAME}
    !error "Run desktop/build.mjs, which sets VERSION, SOURCE, ICON and OUTFILE."
  !endif
!macroend
!insertmacro Needs VERSION
!insertmacro Needs SOURCE
!insertmacro Needs ICON
!insertmacro Needs OUTFILE

!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Ormma"
!define RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"

Name "Ormma"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\Ormma"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "Ormma ${VERSION} · AnalytixKraft"
ShowInstDetails nevershow
ShowUninstDetails nevershow

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Ormma"
VIAddVersionKey "CompanyName" "AnalytixKraft"
VIAddVersionKey "FileDescription" "Ormma setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "© 2026 AnalytixKraft · Apache License 2.0"

!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Welcome to Ormma"
!define MUI_WELCOMEPAGE_TEXT "Your diary and reminders, with WhatsApp as the way in and out.$\r$\n$\r$\nOrmma runs on this computer and opens in your browser. It starts when you sign in to Windows, so the day's wishes and reminders go out on time: keep this computer on, and awake.$\r$\n$\r$\nA word about WhatsApp: Ormma sends through a linked device, an unofficial client, which is against WhatsApp's Terms of Service. WhatsApp can ban a number that uses one. Link a spare number if you can."
!define MUI_FINISHPAGE_RUN "$INSTDIR\Ormma.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Open Ormma"
!define MUI_FINISHPAGE_LINK "Read the guide"
!define MUI_FINISHPAGE_LINK_LOCATION "https://github.com/AnalytixKraft/Ormma#readme"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${SOURCE}\LICENSE.txt"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

; What the installer puts in $INSTDIR, and so what the uninstaller may take.
!macro RemoveProgram
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\whatsapp"
  RMDir /r "$INSTDIR\desktop"
  RMDir /r "$INSTDIR\node"
  RMDir /r "$INSTDIR\licenses"
  Delete "$INSTDIR\Ormma.exe"
  Delete "$INSTDIR\ormma.ico"
  Delete "$INSTDIR\LICENSE.txt"
  Delete "$INSTDIR\NOTICE.txt"
!macroend

Section "Ormma"
  ; An Ormma already here — this is an update — is stopped first, so its
  ; files can be replaced: asked, and waited for (the bridge saves the
  ; WhatsApp link as it stops); then anything of it still running, ended.
  IfFileExists "$INSTDIR\Ormma.exe" 0 +2
    ExecWait '"$INSTDIR\Ormma.exe" stop'
  nsExec::Exec 'taskkill /F /IM ormma-node.exe'
  Pop $0
  Sleep 500

  SetOutPath "$INSTDIR"
  !insertmacro RemoveProgram
  File /r "${SOURCE}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall Ormma.exe"

  CreateDirectory "$SMPROGRAMS\Ormma"
  CreateShortcut "$SMPROGRAMS\Ormma\Ormma.lnk" "$INSTDIR\Ormma.exe" "" "$INSTDIR\ormma.ico"
  CreateShortcut "$SMPROGRAMS\Ormma\Stop Ormma.lnk" "$INSTDIR\Ormma.exe" "stop" "$INSTDIR\ormma.ico"
  CreateShortcut "$SMPROGRAMS\Ormma\Back up Ormma.lnk" "$INSTDIR\Ormma.exe" "backup" "$INSTDIR\ormma.ico"
  CreateShortcut "$SMPROGRAMS\Ormma\Reset Ormma password.lnk" "$INSTDIR\Ormma.exe" "reset-password" "$INSTDIR\ormma.ico"
  CreateShortcut "$SMPROGRAMS\Ormma\Uninstall Ormma.lnk" "$INSTDIR\Uninstall Ormma.exe"
  CreateShortcut "$DESKTOP\Ormma.lnk" "$INSTDIR\Ormma.exe" "" "$INSTDIR\ormma.ico"

  WriteRegStr HKCU "${RUN_KEY}" "Ormma" '"$INSTDIR\Ormma.exe" serve'

  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "Ormma"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "AnalytixKraft"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\ormma.ico"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall Ormma.exe"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall Ormma.exe" /S'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "URLInfoAbout" "https://github.com/AnalytixKraft/Ormma"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "HelpLink" "https://github.com/AnalytixKraft/Ormma/blob/main/docs/install.md"
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" "$0"
SectionEnd

Section "Uninstall"
  ; Stopped, and no longer started at sign-in. --quiet: this uninstaller
  ; says what needs saying.
  IfFileExists "$INSTDIR\Ormma.exe" 0 +2
    ExecWait '"$INSTDIR\Ormma.exe" uninstall --quiet'
  nsExec::Exec 'taskkill /F /IM ormma-node.exe'
  Pop $0
  Sleep 500

  !insertmacro RemoveProgram
  Delete "$INSTDIR\Uninstall Ormma.exe"
  RMDir "$INSTDIR"

  Delete "$SMPROGRAMS\Ormma\*.lnk"
  RMDir "$SMPROGRAMS\Ormma"
  Delete "$DESKTOP\Ormma.lnk"
  DeleteRegValue HKCU "${RUN_KEY}" "Ormma"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"

  IfSilent +2
    MessageBox MB_OK|MB_ICONINFORMATION "Ormma is uninstalled. Your list, calendar, notes and WhatsApp link are still in $LOCALAPPDATA\Ormma — delete that folder to remove them too."
SectionEnd
