// Agentic OS desktop shell: frameless window, tray icon, global hotkey (Ctrl+Alt+Space, or a free fallback), autostart.
// Closing the window hides it; the app keeps running in the tray so the hotkey is instant.
// The window starts hidden. The page calls `launch_ready` once its launch screen can paint, so the window never
// opens on a blank or half-built frame, and never jumps while the saved size and position are restored.
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_window_state::StateFlags;

// is_focused() reports false while the embedded WebView2 holds keyboard focus, so focus is tracked from window events.
static FOCUSED: AtomicBool = AtomicBool::new(false);
// Started by autostart with --hidden: stay in the tray until the user opens the window.
static STARTED_HIDDEN: AtomicBool = AtomicBool::new(false);
// The page has called launch_ready (until then a close or a show can't be animated).
static READY: AtomicBool = AtomicBool::new(false);
// A close was handed to the page to animate out; hide anyway if it doesn't within a second.
static CLOSING: AtomicBool = AtomicBool::new(false);

fn show(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        CLOSING.store(false, Ordering::SeqCst);
        let _ = w.unminimize();
        let _ = w.show();
        // Windows blocks focus stealing; a short always-on-top pulse reliably brings the window forward.
        let _ = w.set_always_on_top(true);
        let _ = w.set_focus();
        let _ = w.set_always_on_top(false);
        // A window that was closed plays its launch animation again; one hidden by the hotkey just comes back.
        let _ = w.emit("os://shown", ());
    }
}

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

/// Called by the page once its launch screen is in place. Shows the window (unless started hidden)
/// and returns whether it is visible, so the page knows whether to play the launch animation now.
#[tauri::command]
fn launch_ready(app: AppHandle) -> bool {
    READY.store(true, Ordering::SeqCst);
    if STARTED_HIDDEN.load(Ordering::SeqCst) {
        return false;
    }
    if let Some(w) = app.get_webview_window("main") {
        if !w.is_visible().unwrap_or(false) {
            let _ = w.show();
            let _ = w.set_focus();
        }
        FOCUSED.store(true, Ordering::SeqCst);
    }
    true
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show(app)))
        // Size, position and maximized are restored; visibility is not, the page decides when the window appears.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
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
        .invoke_handler(tauri::generate_handler![launch_ready])
        .setup(|app| {
            STARTED_HIDDEN.store(std::env::args().any(|a| a == "--hidden"), Ordering::SeqCst);

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

            // Safety net: if the page never reports ready (a script error), show the window anyway.
            if !STARTED_HIDDEN.load(Ordering::SeqCst) {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(5));
                    if !READY.load(Ordering::SeqCst) {
                        show(&handle);
                    }
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                FOCUSED.store(false, Ordering::SeqCst);
                if READY.load(Ordering::SeqCst) && window.is_visible().unwrap_or(false) {
                    // Alt+F4 / taskbar close: the page fades out and hides the window itself.
                    CLOSING.store(true, Ordering::SeqCst);
                    let _ = window.emit("os://close", ());
                    let w = window.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(Duration::from_millis(1000));
                        if CLOSING.swap(false, Ordering::SeqCst) {
                            let _ = w.hide();
                        }
                    });
                } else {
                    let _ = window.hide();
                }
            }
            WindowEvent::Focused(f) => FOCUSED.store(*f, Ordering::SeqCst),
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running Agentic OS");
}
