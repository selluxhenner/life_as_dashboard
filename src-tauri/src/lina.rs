// "Hey Lina" on Windows. Runs lina-wake.exe (src-tauri/lina, built by scripts/build-lina-wake.sh, shipped next to the
// app) hidden in the background and turns its lines into events for the page: lina://wake (the window comes forward),
// lina://speech (base64 WAV of what Kevin said), lina://nospeech and lina://status. The page answers with
// pause / resume / listen (src/voice/wake.js). Closing the app closes its stdin, which ends it.
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct Lina(Mutex<Option<(Child, ChildStdin)>>);

/// Starts (or restarts, e.g. with a new sensitivity) or stops listening for "Hey Lina". Returns whether it listens.
#[tauri::command]
pub fn lina_wake(app: AppHandle, lina: State<Lina>, on: bool, sensitivity: Option<String>) -> Result<bool, String> {
    let mut slot = lina.0.lock().map_err(|e| e.to_string())?;
    if let Some((mut child, _)) = slot.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    if !on {
        return Ok(false);
    }
    let dir = app.path().resource_dir().map_err(|e| e.to_string())?.join("lina");
    let exe = dir.join("lina-wake.exe");
    if !exe.exists() {
        return Err("“Hey Lina” isn’t part of this build".into());
    }
    let sens = match sensitivity.as_deref() {
        Some("low") => "low",
        Some("high") => "high",
        _ => "normal",
    };
    let mut cmd = Command::new(&exe);
    cmd.arg(dir.join("kws")).arg(sens).current_dir(&dir).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let stdin = child.stdin.take().ok_or("no stdin")?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let handle = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let (kind, rest) = line.split_once(' ').unwrap_or((line.as_str(), ""));
            match kind {
                "WAKE" => {
                    crate::show(&handle);
                    let _ = handle.emit("lina://wake", rest);
                }
                "SPEECH" => {
                    let _ = handle.emit("lina://speech", rest);
                }
                "NOSPEECH" => {
                    let _ = handle.emit("lina://nospeech", ());
                }
                _ => {
                    let _ = handle.emit("lina://status", line.as_str());
                }
            }
        }
        let _ = handle.emit("lina://status", "STOPPED");
    });
    *slot = Some((child, stdin));
    Ok(true)
}

/// pause (Lina is talking) | resume (back to waiting for "Hey Lina") | listen (record a follow-up answer).
#[tauri::command]
pub fn lina_send(lina: State<Lina>, cmd: String) -> bool {
    if !matches!(cmd.as_str(), "pause" | "resume" | "listen") {
        return false;
    }
    let Ok(mut slot) = lina.0.lock() else { return false };
    match slot.as_mut() {
        Some((_, stdin)) => writeln!(stdin, "{cmd}").and_then(|_| stdin.flush()).is_ok(),
        None => false,
    }
}
