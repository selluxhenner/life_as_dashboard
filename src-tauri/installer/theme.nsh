; Agentic OS installer theme: the app's dark Orbital design on every installer and uninstaller page.
;
; How it fits together
; - tauri.conf.json points bundle.windows.nsis.template at installer.nsi (Tauri's own template plus a few
;   "AOS" hooks) and installerHooks at this file, so Tauri hands us its absolute path and ${__FILEDIR__} works.
; - Art comes from art/make_art.py: full-window welcome/finish pages, header bands and a splash, rendered at
;   100/125/150/200 %. At runtime the window's DPI picks the closest set, scaled to the exact control size.
; - Text is live, drawn with the app's own fonts (Space Grotesk, JetBrains Mono) loaded privately for this
;   process only (AddFontResourceEx FR_PRIVATE), so nothing is installed on the system.
; - Windows draws themed checkboxes/radios with black text, so each one becomes a dark box plus our own label.
;
; Preview without installing anything: npm run installer:preview  (see preview/preview.nsi)

!define AOS_DIR "${__FILEDIR__}"
!define AOS_ASSETS "${AOS_DIR}\assets"

; ---- Orbital tokens. RRGGBB for SetCtlColors, 0x00BBGGRR COLORREFs for Win32 calls.
!define AOS_VOID   "05070A"
!define AOS_HULL   "0B1016"
!define AOS_HULL2  "101821"
!define AOS_INK    "E6EDF3"
!define AOS_INK2   "A7B4C2"
!define AOS_INK3   "6B7A8C"
!define AOS_SIGNAL "4FE3FF"
!define AOS_FLARE  "FF4D5E"
!define AOS_REF_VOID    0x000A0705
!define AOS_REF_HULL2   0x00211810
!define AOS_REF_SIGNAL  0x00FFE34F
!define AOS_REF_SIGNAL2 0x00C9A92A
!define AOS_REF_FLARE   0x005E4DFF
!define AOS_REF_INK     0x00F3EDE6
!define AOS_REF_INK3    0x008C7A6B

; ---- Modern UI 2: colours, header art slot, our GUI-init hooks
!define MUI_BGCOLOR   "${AOS_VOID}"
!define MUI_TEXTCOLOR "${AOS_INK}"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP   "${AOS_ASSETS}\header-setup-100.bmp"
!define MUI_HEADERIMAGE_UNBITMAP "${AOS_ASSETS}\header-remove-100.bmp"
!define MUI_WELCOMEFINISHPAGE_BITMAP "${AOS_ASSETS}\welcome-100.bmp"
!define MUI_INSTFILESPAGE_COLORS "${AOS_INK3} ${AOS_VOID}"
!define MUI_INSTFILESPAGE_PROGRESSBAR "smooth"
!define MUI_CUSTOMFUNCTION_GUIINIT AosGuiInit
!define MUI_CUSTOMFUNCTION_UNGUIINIT un.AosGuiInit

; ---- Copy, in the app's voice (page-specific header texts are set next to each page in installer.nsi)
!define MUI_WELCOMEPAGE_TITLE "Bring your system online."
!define MUI_WELCOMEPAGE_TEXT "Your day, inbox, calendar and the world on one quiet screen, with a voice that briefs you every morning.$\r$\n$\r$\nSetup takes about ten seconds."
!define MUI_DIRECTORYPAGE_TEXT_TOP "Agentic OS installs here, just for you. Your tasks, notes and settings sync with your own server, so nothing important lives only in this folder."
!define MUI_DIRECTORYPAGE_TEXT_DESTINATION " "
!define MUI_FINISHPAGE_TITLE "Agentic OS is online."
!define MUI_FINISHPAGE_TEXT "Bring it up from anywhere with Ctrl+Alt+Space (or Ctrl+Alt+O). It waits in the tray and starts with Windows."
!define MUI_FINISHPAGE_RUN_TEXT "Launch Agentic OS now"
!define MUI_FINISHPAGE_BUTTON "Done"
!define MUI_UNCONFIRMPAGE_TEXT_TOP "Agentic OS will be removed from this folder. Everything you synced stays on your server, so a reinstall picks up exactly where you left off."
!define MUI_UNCONFIRMPAGE_TEXT_LOCATION "Removing from"

Var AosDpi           ; window DPI (96 = 100 %)
Var AosScale         ; art set: 100 | 125 | 150 | 200
Var AosFontTitle
Var AosFontHead
Var AosFontBody
Var AosFontMono
Var AosFontMicro
Var AosHdrW
Var AosHdrH
Var AosHdrBmp
Var AosPageBmp
Var AosPageW
Var AosPageH
Var AosArg0
Var AosArg1
Var AosArg2
Var AosArg3
Var AosArg4

; ---------------------------------------------------------------- build-time helpers
!macro AOS_FILE name
  File "/oname=$PLUGINSDIR\aos\${name}" "${AOS_ASSETS}\${name}"
!macroend
!macro AOS_FONTFILE name
  File "/oname=$PLUGINSDIR\aos\${name}" "${AOS_ASSETS}\fonts\${name}"
  System::Call 'gdi32::AddFontResourceExW(w "$PLUGINSDIR\aos\${name}", i 0x10, p 0)'
!macroend
!macro AOS_SCALESET name
  !insertmacro AOS_FILE "${name}-100.bmp"
  !insertmacro AOS_FILE "${name}-125.bmp"
  !insertmacro AOS_FILE "${name}-150.bmp"
  !insertmacro AOS_FILE "${name}-200.bmp"
!macroend

; Static text: colour + font. Colours must be literal tokens: SetCtlColors reads them at compile time.
!macro AOS_TEXT hwnd color bg font
  SetCtlColors ${hwnd} ${color} ${bg}
  SendMessage ${hwnd} ${WM_SETFONT} ${font} 1
!macroend

; Adds WS_CLIPSIBLINGS so an art control never paints over the text controls stacked above it.
!macro AOS_CLIPSIBLINGS hwnd
  System::Call 'user32::GetWindowLongW(p ${hwnd}, i -16)i.r0'
  IntOp $0 $0 | 0x04000000
  System::Call 'user32::SetWindowLongW(p ${hwnd}, i -16, i r0)'
!macroend

; New child windows start at the bottom of the z-order (under the page art); this lifts one to the top.
!macro AOS_TOP hwnd
  System::Call 'user32::SetWindowPos(p ${hwnd}, p 0, i 0, i 0, i 0, i 0, i 0x13)'
!macroend

; px at the current DPI for a size given at 100 %
!macro AOS_PX out design
  IntOp ${out} ${design} * $AosDpi
  IntOp ${out} ${out} / 96
!macroend

; Picks the art set for a DPI value in $0.
!macro AOS_PICKSCALE
  ${If} $0 <= 108
    StrCpy $AosScale 100
  ${ElseIf} $0 <= 132
    StrCpy $AosScale 125
  ${ElseIf} $0 <= 168
    StrCpy $AosScale 150
  ${Else}
    StrCpy $AosScale 200
  ${EndIf}
!macroend

; ---------------------------------------------------------------- .onInit / un.onInit
; Unpacks art and fonts; the installer also shows the boot splash (never in silent, passive or update runs).
!macro AOS_ONINIT
  InitPluginsDir
  CreateDirectory "$PLUGINSDIR\aos"
  !insertmacro AOS_SCALESET "welcome"
  !insertmacro AOS_SCALESET "finish"
  !insertmacro AOS_SCALESET "header-setup"
  !insertmacro AOS_SCALESET "header-install"
  !insertmacro AOS_FILE "splash-100.bmp"
  !insertmacro AOS_FILE "splash-150.bmp"
  !insertmacro AOS_FILE "splash-200.bmp"
  !insertmacro AOS_FILE "boot.wav"
  !insertmacro AOS_FONTFILE "aos-grotesk-light.ttf"
  !insertmacro AOS_FONTFILE "aos-grotesk-medium.ttf"
  !insertmacro AOS_FONTFILE "aos-grotesk.ttf"
  !insertmacro AOS_FONTFILE "aos-mono.ttf"
  ${IfNot} ${Silent}
  ${AndIf} $PassiveMode <> 1
  ${AndIf} $UpdateMode <> 1
    System::Call 'user32::GetDpiForSystem()i.r0'
    ${If} $0 <= 0
      StrCpy $0 96
    ${EndIf}
    ; the splash ships at 100/150/200 %
    ${If} $0 <= 120
      StrCpy $1 100
    ${ElseIf} $0 <= 168
      StrCpy $1 150
    ${Else}
      StrCpy $1 200
    ${EndIf}
    ; AdvSplash plays <name>.wav with the bitmap: a soft two-tone boot chime
    CopyFiles /SILENT "$PLUGINSDIR\aos\boot.wav" "$PLUGINSDIR\aos\splash-$1.wav"
    advsplash::show 1500 360 420 0xFF00FF "$PLUGINSDIR\aos\splash-$1"
    Pop $0
  ${EndIf}
!macroend

!macro AOS_UNONINIT
  InitPluginsDir
  CreateDirectory "$PLUGINSDIR\aos"
  !insertmacro AOS_SCALESET "header-remove"
  !insertmacro AOS_FONTFILE "aos-grotesk-light.ttf"
  !insertmacro AOS_FONTFILE "aos-grotesk-medium.ttf"
  !insertmacro AOS_FONTFILE "aos-grotesk.ttf"
  !insertmacro AOS_FONTFILE "aos-mono.ttf"
!macroend

; ---------------------------------------------------------------- functions (installer "" and uninstaller "un.")
!macro AOS_COMMON_FUNCTIONS UN

; Window chrome, fonts, buttons, branding line and the header band.
Function ${UN}AosGuiInit
  System::Call 'user32::GetDpiForWindow(p $HWNDPARENT)i.r0'
  ${If} $0 <= 0
    StrCpy $0 96
  ${EndIf}
  StrCpy $AosDpi $0
  !insertmacro AOS_PICKSCALE

  ; Windows 11 chrome: dark title bar, void caption, a thin signal border (ignored on older Windows)
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 20, *i 1, i 4)'
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 35, *i ${AOS_REF_VOID}, i 4)'
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 36, *i ${AOS_REF_INK}, i 4)'
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 34, *i ${AOS_REF_SIGNAL2}, i 4)'
  SetCtlColors $HWNDPARENT ${AOS_INK} ${AOS_VOID}

  CreateFont $AosFontTitle "AOS Grotesk Light" 16 400
  CreateFont $AosFontHead "AOS Grotesk Medium" 11 400
  CreateFont $AosFontBody "AOS Grotesk" 9 400
  CreateFont $AosFontMono "AOS Mono" 8 400
  CreateFont $AosFontMicro "AOS Mono" 7 400

  ; Back / Next / Cancel in dark mode
  GetDlgItem $1 $HWNDPARENT 1
  System::Call 'uxtheme::SetWindowTheme(p r1, w "DarkMode_Explorer", p 0)'
  SendMessage $1 ${WM_SETFONT} $AosFontBody 1
  GetDlgItem $1 $HWNDPARENT 2
  System::Call 'uxtheme::SetWindowTheme(p r1, w "DarkMode_Explorer", p 0)'
  SendMessage $1 ${WM_SETFONT} $AosFontBody 1
  GetDlgItem $1 $HWNDPARENT 3
  System::Call 'uxtheme::SetWindowTheme(p r1, w "DarkMode_Explorer", p 0)'
  SendMessage $1 ${WM_SETFONT} $AosFontBody 1

  ; branding line in the footer, like the app's status bar readouts; no etched separator
  GetDlgItem $1 $HWNDPARENT 1028
  EnableWindow $1 1
  SetCtlColors $1 ${AOS_INK3} ${AOS_VOID}
  SendMessage $1 ${WM_SETFONT} $AosFontMicro 1
  GetDlgItem $1 $HWNDPARENT 1035
  ShowWindow $1 ${SW_HIDE}
  GetDlgItem $1 $HWNDPARENT 1045
  ShowWindow $1 ${SW_HIDE}
  GetDlgItem $1 $HWNDPARENT 1036
  ShowWindow $1 ${SW_HIDE}

  ; header band: the art covers it edge to edge, title and subtitle sit on its flat left side
  GetDlgItem $1 $HWNDPARENT 1034
  GetDlgItem $2 $HWNDPARENT 1046
  System::Call '*(i,i,i,i)p.r5'
  System::Call 'user32::GetWindowRect(p r1, p r5)'
  System::Call 'user32::MapWindowPoints(p 0, p $HWNDPARENT, p r5, i 2)'
  System::Call '*$5(i.r6,i.r7,i.r8,i.r9)'
  System::Free $5
  IntOp $8 $8 - $6
  IntOp $9 $9 - $7
  StrCpy $AosHdrW $8
  StrCpy $AosHdrH $9
  System::Call 'user32::SetWindowPos(p r2, p 1, i r6, i r7, i r8, i r9, i 0x10)'
  Push $0
  !insertmacro AOS_CLIPSIBLINGS $2
  Pop $0
  ShowWindow $1 ${SW_HIDE}
  GetDlgItem $3 $HWNDPARENT 1037
  GetDlgItem $4 $HWNDPARENT 1038
  !insertmacro AOS_PX $0 18
  IntOp $0 $0 + $6
  !insertmacro AOS_PX $1 11
  IntOp $1 $1 + $7
  !insertmacro AOS_PX $5 300
  !insertmacro AOS_PX $8 19
  System::Call 'user32::SetWindowPos(p r3, p 0, i r0, i r1, i r5, i r8, i 0x14)'
  !insertmacro AOS_PX $1 31
  IntOp $1 $1 + $7
  !insertmacro AOS_PX $8 20
  System::Call 'user32::SetWindowPos(p r4, p 0, i r0, i r1, i r5, i r8, i 0x14)'
  SendMessage $3 ${WM_SETFONT} $AosFontHead 1
  SendMessage $4 ${WM_SETFONT} $AosFontBody 1
  ; opaque void behind the text matches the art exactly and never leaves ghosts when the text changes
  SetCtlColors $3 ${AOS_INK} ${AOS_VOID}
  SetCtlColors $4 ${AOS_INK2} ${AOS_VOID}
  !if "${UN}" == "un."
    Push "remove"
  !else
    Push "setup"
  !endif
  Call ${UN}AosHeaderArt
FunctionEnd

; Loads header-<kind>-<scale>.bmp into the header band. Stack: kind.
Function ${UN}AosHeaderArt
  Exch $0
  Push $1
  Push $2
  Push $3
  GetDlgItem $1 $HWNDPARENT 1046
  System::Call 'user32::LoadImageW(p 0, w "$PLUGINSDIR\aos\header-$0-$AosScale.bmp", i 0, i $AosHdrW, i $AosHdrH, i 0x2010)p.r2'
  ${If} $2 P<> 0
    SendMessage $1 0x172 0 $2 $3
    ${If} $AosHdrBmp != ""
      System::Call 'gdi32::DeleteObject(p $AosHdrBmp)'
    ${EndIf}
    StrCpy $AosHdrBmp $2
  ${EndIf}
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; Dark page body for the classic (non-nsDialogs) pages. Returns the inner dialog in $R9.
Function ${UN}AosInner
  GetDlgItem $R9 $HWNDPARENT 1035
  ShowWindow $R9 ${SW_HIDE}
  FindWindow $R9 "#32770" "" $HWNDPARENT
  SetCtlColors $R9 ${AOS_INK2} ${AOS_VOID}
FunctionEnd

; Dark single-line edit. $AosArg0 hwnd
Function ${UN}AosEdit
  System::Call 'uxtheme::SetWindowTheme(p $AosArg0, w "DarkMode_CFD", p 0)'
  SetCtlColors $AosArg0 ${AOS_INK} ${AOS_HULL2}
  SendMessage $AosArg0 ${WM_SETFONT} $AosFontMono 1
FunctionEnd

; Flat progress line in an accent colour. $AosArg0 hwnd, $AosArg1 COLORREF
Function ${UN}AosProgress
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  System::Call 'uxtheme::SetWindowTheme(p $AosArg0, w " ", w " ")'
  System::Call 'user32::GetWindowLongW(p $AosArg0, i -20)i.r0'
  IntOp $1 0x20200 ~
  IntOp $0 $0 & $1
  System::Call 'user32::SetWindowLongW(p $AosArg0, i -20, i r0)'
  System::Call 'user32::GetWindowLongW(p $AosArg0, i -16)i.r0'
  IntOp $1 0x800000 ~
  IntOp $0 $0 & $1
  System::Call 'user32::SetWindowLongW(p $AosArg0, i -16, i r0)'
  System::Call 'user32::SetWindowPos(p $AosArg0, p 0, i 0, i 0, i 0, i 0, i 0x37)'
  SendMessage $AosArg0 0x409 0 $AosArg1
  SendMessage $AosArg0 0x2001 0 ${AOS_REF_HULL2}
  ; a 4 px line, centred where the bar was
  System::Call '*(i,i,i,i)p.r0'
  System::Call 'user32::GetWindowRect(p $AosArg0, p r0)'
  System::Call 'user32::GetParent(p $AosArg0)p.r1'
  System::Call 'user32::MapWindowPoints(p 0, p r1, p r0, i 2)'
  System::Call '*$0(i.r2,i.r3,i.r4,i.r5)'
  System::Free $0
  IntOp $4 $4 - $2
  IntOp $5 $5 - $3
  !insertmacro AOS_PX $0 4
  IntOp $1 $5 - $0
  IntOp $1 $1 / 2
  IntOp $3 $3 + $1
  System::Call 'user32::SetWindowPos(p $AosArg0, p 0, i r2, i r3, i r4, i r0, i 0x14)'
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; Install log as a quiet terminal: mono, muted, no border, dark scrollbar. $AosArg0 hwnd
Function ${UN}AosLog
  Push $0
  Push $1
  System::Call 'uxtheme::SetWindowTheme(p $AosArg0, w "DarkMode_Explorer", p 0)'
  System::Call 'user32::GetWindowLongW(p $AosArg0, i -20)i.r0'
  IntOp $1 0x20200 ~
  IntOp $0 $0 & $1
  System::Call 'user32::SetWindowLongW(p $AosArg0, i -20, i r0)'
  System::Call 'user32::SetWindowPos(p $AosArg0, p 0, i 0, i 0, i 0, i 0, i 0x37)'
  SendMessage $AosArg0 0x1001 0 ${AOS_REF_VOID}
  SendMessage $AosArg0 0x1026 0 ${AOS_REF_VOID}
  SendMessage $AosArg0 0x1024 0 ${AOS_REF_INK3}
  SendMessage $AosArg0 ${WM_SETFONT} $AosFontMicro 1
  Pop $1
  Pop $0
FunctionEnd

!macroend

; Installer-only pages ---------------------------------------------------------------
!macro AOS_INSTALLER_FUNCTIONS

; A label created on a classic page (where nsDialogs can't add controls). $AosArg0 parent, $AosArg1 text,
; $AosArg2 x, $AosArg3 y, $AosArg4 width (px). Returns hwnd in $R8.
Function AosMicroLabel
  Push $0
  !insertmacro AOS_PX $0 14
  System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "$AosArg1", i 0x50000000, i $AosArg2, i $AosArg3, i $AosArg4, i r0, p $AosArg0, p 0, p 0, p 0)p.R8'
  SetCtlColors $R8 ${AOS_INK3} ${AOS_VOID}
  SendMessage $R8 ${WM_SETFONT} $AosFontMicro 1
  Pop $0
FunctionEnd


; Places a control on a full-window page (welcome/finish) in the 497x305 design grid of the art.
; $AosArg0 hwnd, $AosArg1 x, $AosArg2 y, $AosArg3 w, $AosArg4 h
Function AosPlace
  Push $0
  Push $1
  Push $2
  Push $3
  IntOp $0 $AosArg1 * $AosPageW
  IntOp $0 $0 / 497
  IntOp $1 $AosArg2 * $AosPageH
  IntOp $1 $1 / 305
  IntOp $2 $AosArg3 * $AosPageW
  IntOp $2 $2 / 497
  IntOp $3 $AosArg4 * $AosPageH
  IntOp $3 $3 / 305
  System::Call 'user32::SetWindowPos(p $AosArg0, p 0, i r0, i r1, i r2, i r3, i 0x14)'
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; Full-window page art: stretches <name>-<scale>.bmp over the page. $AosArg0 page, $AosArg1 image control, $AosArg2 name
Function AosPageArt
  Push $0
  Push $1
  System::Call '*(i,i,i,i)p.r0'
  System::Call 'user32::GetClientRect(p $AosArg0, p r0)'
  System::Call '*$0(i,i,i.r1,i)'
  StrCpy $AosPageW $1
  System::Call '*$0(i,i,i,i.r1)'
  StrCpy $AosPageH $1
  System::Free $0
  SetCtlColors $AosArg0 ${AOS_INK} ${AOS_VOID}
  GetDlgItem $0 $HWNDPARENT 1045
  ShowWindow $0 ${SW_HIDE}
  !insertmacro AOS_CLIPSIBLINGS $AosArg1
  System::Call 'user32::SetWindowPos(p $AosArg1, p 1, i 0, i 0, i $AosPageW, i $AosPageH, i 0x10)'
  System::Call 'user32::LoadImageW(p 0, w "$PLUGINSDIR\aos\$AosArg2-$AosScale.bmp", i 0, i $AosPageW, i $AosPageH, i 0x2010)p.r0'
  ${If} $0 P<> 0
    SendMessage $AosArg1 0x172 0 $0 $1
    ${If} $AosPageBmp != ""
      System::Call 'gdi32::DeleteObject(p $AosPageBmp)'
    ${EndIf}
    StrCpy $AosPageBmp $0
  ${EndIf}
  Pop $1
  Pop $0
FunctionEnd

; Turns a checkbox/radio on an nsDialogs page into a dark box + our own clickable label.
; $AosArg0 control. Windows' dark theme draws toggle text in black, so the text moves to a label.
Function AosToggle
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  System::Call 'user32::GetWindowTextW(p $AosArg0, w .r0, i ${NSIS_MAX_STRLEN})'
  SendMessage $AosArg0 ${WM_SETTEXT} 0 "STR:"
  System::Call 'user32::GetParent(p $AosArg0)p.r1'
  System::Call '*(i,i,i,i)p.r2'
  System::Call 'user32::GetWindowRect(p $AosArg0, p r2)'
  System::Call 'user32::MapWindowPoints(p 0, p r1, p r2, i 2)'
  System::Call '*$2(i.r3,i.r4,i.r5,i.r6)'
  System::Free $2
  IntOp $5 $5 - $3
  IntOp $6 $6 - $4
  !insertmacro AOS_PX $7 17
  System::Call 'user32::SetWindowPos(p $AosArg0, p 0, i r3, i r4, i r7, i r6, i 0x14)'
  System::Call 'uxtheme::SetWindowTheme(p $AosArg0, w "DarkMode_Explorer", p 0)'
  ${If} $AosArg1 = 1
    SetCtlColors $AosArg0 ${AOS_INK} ${AOS_HULL}
  ${Else}
    SetCtlColors $AosArg0 ${AOS_INK} ${AOS_VOID}
  ${EndIf}
  IntOp $3 $3 + $7
  !insertmacro AOS_PX $2 5
  IntOp $3 $3 + $2
  IntOp $5 $5 - $7
  IntOp $5 $5 - $2
  nsDialogs::CreateControl STATIC ${__NSD_Label_STYLE}|${SS_CENTERIMAGE} ${__NSD_Label_EXSTYLE} $3 $4 $5 $6 $0
  Pop $2
  !insertmacro AOS_TOP $2
  SendMessage $2 ${WM_SETFONT} $AosFontBody 1
  System::Call 'user32::IsWindowEnabled(p $AosArg0)i.r7'
  ${If} $AosArg1 = 1
    SetCtlColors $2 ${AOS_INK} ${AOS_HULL}
  ${ElseIf} $7 = 0
    SetCtlColors $2 ${AOS_INK3} ${AOS_VOID}
  ${Else}
    SetCtlColors $2 ${AOS_INK} ${AOS_VOID}
  ${EndIf}
  System::Call 'user32::SetWindowLongPtrW(p r2, i -21, p $AosArg0)'
  ${NSD_OnClick} $2 AosToggleClick
  Pop $7
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

Function AosToggleClick
  Pop $0
  System::Call 'user32::GetWindowLongPtrW(p r0, i -21)p.r0'
  System::Call 'user32::IsWindowEnabled(p r0)i.r1'
  ${If} $1 <> 0
    SendMessage $0 ${BM_CLICK} 0 0
  ${EndIf}
FunctionEnd

Function AosWelcomeShow
  StrCpy $AosArg0 $mui.WelcomePage
  StrCpy $AosArg1 $mui.WelcomePage.Image
  StrCpy $AosArg2 "welcome"
  Call AosPageArt
  StrCpy $AosArg0 $mui.WelcomePage.Title
  StrCpy $AosArg1 274
  StrCpy $AosArg2 42
  StrCpy $AosArg3 196
  StrCpy $AosArg4 62
  Call AosPlace
  !insertmacro AOS_TEXT $mui.WelcomePage.Title ${AOS_INK} ${AOS_HULL} $AosFontTitle
  !insertmacro AOS_TOP $mui.WelcomePage.Title
  StrCpy $AosArg0 $mui.WelcomePage.Text
  StrCpy $AosArg1 274
  StrCpy $AosArg2 104
  StrCpy $AosArg3 196
  StrCpy $AosArg4 124
  Call AosPlace
  !insertmacro AOS_TEXT $mui.WelcomePage.Text ${AOS_INK2} ${AOS_HULL} $AosFontBody
  !insertmacro AOS_TOP $mui.WelcomePage.Text
  ; version readout above the stage track
  nsDialogs::CreateControl STATIC ${__NSD_Label_STYLE} ${__NSD_Label_EXSTYLE} 0 0 10 10 "v${VERSION}  ·  JUST FOR YOU  ·  NO ADMIN"
  Pop $0
  !insertmacro AOS_TOP $0
  StrCpy $AosArg0 $0
  StrCpy $AosArg1 274
  StrCpy $AosArg2 230
  StrCpy $AosArg3 196
  StrCpy $AosArg4 12
  Call AosPlace
  !insertmacro AOS_TEXT $0 ${AOS_INK3} ${AOS_HULL} $AosFontMicro
FunctionEnd

Function AosFinishShow
  StrCpy $AosArg0 $mui.FinishPage
  StrCpy $AosArg1 $mui.FinishPage.Image
  StrCpy $AosArg2 "finish"
  Call AosPageArt
  StrCpy $AosArg0 $mui.FinishPage.Title
  StrCpy $AosArg1 274
  StrCpy $AosArg2 42
  StrCpy $AosArg3 196
  StrCpy $AosArg4 58
  Call AosPlace
  !insertmacro AOS_TEXT $mui.FinishPage.Title ${AOS_INK} ${AOS_HULL} $AosFontTitle
  !insertmacro AOS_TOP $mui.FinishPage.Title
  StrCpy $AosArg0 $mui.FinishPage.Text
  StrCpy $AosArg1 274
  StrCpy $AosArg2 104
  StrCpy $AosArg3 196
  StrCpy $AosArg4 72
  Call AosPlace
  !insertmacro AOS_TEXT $mui.FinishPage.Text ${AOS_INK2} ${AOS_HULL} $AosFontBody
  !insertmacro AOS_TOP $mui.FinishPage.Text
  ${If} $mui.FinishPage.Run != ""
    StrCpy $AosArg0 $mui.FinishPage.Run
    StrCpy $AosArg1 274
    StrCpy $AosArg2 186
    StrCpy $AosArg3 196
    StrCpy $AosArg4 15
    Call AosPlace
    StrCpy $AosArg1 1
    Call AosToggle
  ${EndIf}
  ${If} $mui.FinishPage.ShowReadme != ""
    StrCpy $AosArg0 $mui.FinishPage.ShowReadme
    StrCpy $AosArg1 274
    StrCpy $AosArg2 205
    StrCpy $AosArg3 196
    StrCpy $AosArg4 15
    Call AosPlace
    StrCpy $AosArg1 1
    Call AosToggle
  ${EndIf}
FunctionEnd

Function AosDirShow
  Push "setup"
  Call AosHeaderArt
  ; the start-menu page after this one is always skipped, so this is the last step before installing
  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:$(^InstallBtn)"
  Call AosInner
  GetDlgItem $0 $R9 1006
  !insertmacro AOS_TEXT $0 ${AOS_INK2} ${AOS_VOID} $AosFontBody
  ; the group box can't be themed: replace it with a micro label above the field
  GetDlgItem $0 $R9 1020
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $AosArg0 $R9 1019
  Call AosEdit
  System::Call '*(i,i,i,i)p.r1'
  System::Call 'user32::GetWindowRect(p $AosArg0, p r1)'
  System::Call 'user32::MapWindowPoints(p 0, p $R9, p r1, i 2)'
  System::Call '*$1(i.r2,i.r3,i.r4,i)'
  System::Free $1
  StrCpy $AosArg0 $R9
  StrCpy $AosArg1 "INSTALL FOLDER"
  StrCpy $AosArg2 $2
  !insertmacro AOS_PX $1 18
  IntOp $AosArg3 $3 - $1
  IntOp $AosArg4 $4 - $2
  Call AosMicroLabel
  GetDlgItem $0 $R9 1001
  System::Call 'uxtheme::SetWindowTheme(p r0, w "DarkMode_Explorer", p 0)'
  SendMessage $0 ${WM_SETFONT} $AosFontBody 1
  GetDlgItem $0 $R9 1023
  !insertmacro AOS_TEXT $0 ${AOS_INK3} ${AOS_VOID} $AosFontMicro
  GetDlgItem $0 $R9 1024
  !insertmacro AOS_TEXT $0 ${AOS_INK3} ${AOS_VOID} $AosFontMicro
FunctionEnd

Function AosInstShow
  Push "install"
  Call AosHeaderArt
  Call AosInner
  GetDlgItem $0 $R9 1006
  !insertmacro AOS_TEXT $0 ${AOS_SIGNAL} ${AOS_VOID} $AosFontMono
  GetDlgItem $AosArg0 $R9 1004
  StrCpy $AosArg1 ${AOS_REF_SIGNAL}
  Call AosProgress
  GetDlgItem $AosArg0 $R9 1016
  Call AosLog
FunctionEnd

; Tauri's "already installed" page: called right before nsDialogs::Show with the page in $R4,
; its label in $R1 and the two choices in $R2 / $R3.
Function AosReinstallShow
  Push "setup"
  Call AosHeaderArt
  Push $0
  GetDlgItem $0 $HWNDPARENT 1035
  ShowWindow $0 ${SW_HIDE}
  Pop $0
  SetCtlColors $R4 ${AOS_INK2} ${AOS_VOID}
  !insertmacro AOS_TEXT $R1 ${AOS_INK2} ${AOS_VOID} $AosFontBody
  StrCpy $AosArg0 $R2
  StrCpy $AosArg1 0
  Call AosToggle
  StrCpy $AosArg0 $R3
  StrCpy $AosArg1 0
  Call AosToggle
FunctionEnd

!macroend

; Uninstaller-only pages -------------------------------------------------------------
!macro AOS_UNINSTALLER_FUNCTIONS

; Called at the end of Tauri's un.ConfirmShow (the "delete app data" checkbox is $DeleteAppDataCheckbox).
Function un.AosConfirmShow
  Push "remove"
  Call un.AosHeaderArt
  Call un.AosInner
  GetDlgItem $0 $R9 1006
  !insertmacro AOS_TEXT $0 ${AOS_INK2} ${AOS_VOID} $AosFontBody
  GetDlgItem $0 $R9 1029
  !insertmacro AOS_TEXT $0 ${AOS_INK3} ${AOS_VOID} $AosFontMicro
  GetDlgItem $AosArg0 $R9 1000
  Call un.AosEdit
  ; a classic page can't host our label trick, so this one uses the unthemed box with light text
  System::Call 'uxtheme::SetWindowTheme(p $DeleteAppDataCheckbox, w " ", w " ")'
  SetCtlColors $DeleteAppDataCheckbox ${AOS_INK} ${AOS_VOID}
  SendMessage $DeleteAppDataCheckbox ${WM_SETFONT} $AosFontBody 1
FunctionEnd

Function un.AosInstShow
  Push "remove"
  Call un.AosHeaderArt
  Call un.AosInner
  GetDlgItem $0 $R9 1006
  !insertmacro AOS_TEXT $0 ${AOS_FLARE} ${AOS_VOID} $AosFontMono
  GetDlgItem $AosArg0 $R9 1004
  StrCpy $AosArg1 ${AOS_REF_FLARE}
  Call un.AosProgress
  GetDlgItem $AosArg0 $R9 1016
  Call un.AosLog
FunctionEnd

!macroend
