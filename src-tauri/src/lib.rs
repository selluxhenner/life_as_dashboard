// Agentic OS desktop shell: frameless window, tray icon, global hotkey (Ctrl+Alt+Space, or a free fallback), autostart.
// Closing the window hides it; the app keeps running in the tray so the hotkey is instant.
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

fn show(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

// is_focused() reports false while the embedded WebView2 holds keyboard focus, so focus is tracked from window events.
static FOCUSED: AtomicBool = AtomicBool::new(false);

fn toggle(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let visible = w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false);
        if visible && FOCUSED.load(Ordering::SeqCst) {
            let _ = w.hide();
            FOCUSED.store(false, Ordering::SeqCst);
        } else {
            show(app);
            FOCUSED.store(true, Ordering::SeqCst);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show(app)))
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            // Global hotkey. Ctrl+Alt+Space is preferred; if another app already owns it
            // (e.g. a dictation tool), fall back to Ctrl+Alt+O, then Win+Alt+Space.
            let candidates = [
                ("Ctrl+Alt+Space", Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space)),
                ("Ctrl+Alt+O", Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyO)),
                ("Win+Alt+Space", Shortcut::new(Some(Modifiers::SUPER | Modifiers::ALT), Code::Space)),
            ];
            let mut active = "none";
            for (label, sc) in candidates {
                if app.global_shortcut().register(sc).is_ok() {
                    active = label;
                    break;
                }
            }

            // Start with Windows (hidden in the tray). Can be turned off in Windows startup apps.
            let _ = app.autolaunch().enable();

            let open = MenuItem::with_id(app, "open", format!("Open Agentic OS   {active}"), true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            TrayIconBuilder::with_id("tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip(format!("Agentic OS  ·  {active}"))
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, e| match e.id.as_ref() {
                    "open" => show(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        toggle(tray.app_handle());
                    }
                })
                .build(app)?;

            if std::env::args().any(|a| a == "--hidden") {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
                FOCUSED.store(false, Ordering::SeqCst);
            }
            WindowEvent::Focused(f) => FOCUSED.store(*f, Ordering::SeqCst),
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running Agentic OS");
}
