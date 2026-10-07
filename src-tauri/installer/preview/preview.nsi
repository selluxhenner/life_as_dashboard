; Design preview of the Agentic OS installer. Same theme, same pages, but the install is simulated:
; it only writes a throwaway uninstaller to %TEMP% so the uninstall pages can be previewed too.
;   npm run installer:preview            (builds and opens it; add --uninstall for the uninstaller)
Unicode true
ManifestDPIAware true
ManifestDPIAwareness PerMonitorV2
SetCompressor /SOLID lzma

!include MUI2.nsh
!include LogicLib.nsh
!include nsDialogs.nsh
!include FileFunc.nsh

!define PRODUCTNAME "Agentic OS"
!ifndef VERSION
  !define VERSION "0.0.0-preview"
!endif

!include "..\theme.nsh"

Name "${PRODUCTNAME}"
OutFile "$%TEMP%\agentic-os-installer-preview.exe"
Caption "${PRODUCTNAME}  ·  Setup (preview)"
UninstallCaption "${PRODUCTNAME}  ·  Uninstall (preview)"
BrandingText "AGENTIC/OS  ·  v${VERSION}  ·  PREVIEW"
RequestExecutionLevel user
InstallDir "$TEMP\agentic-os-installer-preview"
ShowInstDetails show
ShowUninstDetails show

; Tauri template variables the theme relies on
Var PassiveMode
Var UpdateMode
Var DeleteAppDataCheckbox

!define MUI_PAGE_CUSTOMFUNCTION_SHOW AosWelcomeShow
!insertmacro MUI_PAGE_WELCOME

Page custom PreviewReinstall

!define MUI_PAGE_HEADER_TEXT "Choose a home"
!define MUI_PAGE_HEADER_SUBTEXT "Where Agentic OS lives on this PC."
!define MUI_PAGE_CUSTOMFUNCTION_SHOW AosDirShow
!insertmacro MUI_PAGE_DIRECTORY

!define MUI_PAGE_HEADER_TEXT "Bringing it online"
!define MUI_PAGE_HEADER_SUBTEXT "Laying out the system, a few seconds."
!define MUI_INSTFILESPAGE_FINISHHEADER_TEXT "Installed"
!define MUI_INSTFILESPAGE_FINISHHEADER_SUBTEXT "Everything is in place. One more step."
!define MUI_PAGE_CUSTOMFUNCTION_SHOW AosInstShow
!insertmacro MUI_PAGE_INSTFILES

!define MUI_FINISHPAGE_NOAUTOCLOSE
!define MUI_FINISHPAGE_SHOWREADME
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Add a desktop shortcut"
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION PreviewNothing
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION PreviewNothing
!define MUI_PAGE_CUSTOMFUNCTION_SHOW AosFinishShow
!insertmacro MUI_PAGE_FINISH

!define MUI_PAGE_CUSTOMFUNCTION_SHOW un.PreviewConfirmShow
!define MUI_PAGE_HEADER_TEXT "Take Agentic OS offline"
!define MUI_PAGE_HEADER_SUBTEXT "Removes the app. Your server keeps your data."
!insertmacro MUI_UNPAGE_CONFIRM
!define MUI_PAGE_HEADER_TEXT "Taking it offline"
!define MUI_PAGE_HEADER_SUBTEXT "Removing Agentic OS from this PC."
!define MUI_INSTFILESPAGE_FINISHHEADER_TEXT "Offline"
!define MUI_INSTFILESPAGE_FINISHHEADER_SUBTEXT "Removed. Your server still has everything."
!define MUI_PAGE_CUSTOMFUNCTION_SHOW un.AosInstShow
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

!insertmacro AOS_COMMON_FUNCTIONS ""
!insertmacro AOS_COMMON_FUNCTIONS "un."
!insertmacro AOS_INSTALLER_FUNCTIONS
!insertmacro AOS_UNINSTALLER_FUNCTIONS

Function .onInit
  StrCpy $PassiveMode 0
  StrCpy $UpdateMode 0
  !insertmacro AOS_ONINIT
FunctionEnd

Function un.onInit
  !insertmacro AOS_UNONINIT
FunctionEnd

Function PreviewNothing
FunctionEnd

; Tauri's "already installed" page, same controls and copy.
Function PreviewReinstall
  !insertmacro MUI_HEADER_TEXT "Already Installed" "Choose the maintenance option to perform."
  nsDialogs::Create 1018
  Pop $R4
  ${NSD_CreateLabel} 0 0 100% 24u "${PRODUCTNAME} ${VERSION} is already installed. Select the operation you want to perform and click Next to continue."
  Pop $R1
  ${NSD_CreateRadioButton} 30u 50u -30u 8u "Add/Reinstall components"
  Pop $R2
  ${NSD_CreateRadioButton} 30u 70u -30u 8u "Uninstall ${PRODUCTNAME}"
  Pop $R3
  SendMessage $R2 ${BM_SETCHECK} ${BST_CHECKED} 0
  ${NSD_SetFocus} $R2
  Call AosReinstallShow
  nsDialogs::Show
FunctionEnd

; Tauri's uninstall confirm page adds a "delete app data" checkbox the same way.
Function un.PreviewConfirmShow
  FindWindow $1 "#32770" "" $HWNDPARENT
  System::Call "user32::GetDpiForWindow(p r1) i .r2"
  IntOp $4 0 * $2
  IntOp $5 100 * $2
  IntOp $6 400 * $2
  IntOp $7 25 * $2
  IntOp $4 $4 / 96
  IntOp $5 $5 / 96
  IntOp $6 $6 / 96
  IntOp $7 $7 / 96
  System::Call 'user32::CreateWindowEx(i ${__NSD_CheckBox_EXSTYLE}, w "${__NSD_CheckBox_CLASS}", w "Delete the application data", i ${__NSD_CheckBox_STYLE}, i r4, i r5, i r6, i r7, p r1, i0, i0, i0) i .s'
  Pop $DeleteAppDataCheckbox
  Call un.AosConfirmShow
FunctionEnd

Section "Simulated install"
  DetailPrint "Output folder: $INSTDIR"
  StrCpy $0 0
  ${Do}
    IntOp $0 $0 + 1
    ${Select} $0
      ${Case} 1
        DetailPrint "Checking WebView2 runtime... present"
      ${Case} 4
        DetailPrint "Extract: agentic-os.exe"
      ${Case} 9
        DetailPrint "Extract: resources\world-dots.json"
      ${Case} 13
        DetailPrint "Registering Ctrl+Alt+Space"
      ${Case} 16
        DetailPrint "Creating shortcut: Start menu\Agentic OS"
      ${Case} 19
        DetailPrint "Created uninstaller: uninstall.exe"
    ${EndSelect}
    Sleep 140
  ${LoopUntil} $0 >= 22
  CreateDirectory "$INSTDIR"
  WriteUninstaller "$INSTDIR\uninstall-preview.exe"
SectionEnd

Section "un.Simulated uninstall"
  StrCpy $0 0
  ${Do}
    IntOp $0 $0 + 1
    ${If} $0 = 3
      DetailPrint "Stopping Agentic OS"
    ${ElseIf} $0 = 8
      DetailPrint "Delete file: agentic-os.exe"
    ${ElseIf} $0 = 13
      DetailPrint "Removing shortcuts"
    ${EndIf}
    Sleep 140
  ${LoopUntil} $0 >= 16
  Delete "$INSTDIR\uninstall-preview.exe"
  RMDir "$INSTDIR"
SectionEnd
