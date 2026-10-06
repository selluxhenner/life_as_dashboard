// Where are we running? Tauri desktop, Capacitor Android, or a plain browser.
const isTauri = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
const isCapacitor = typeof window !== 'undefined' && !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

export const platform = {
  kind: isTauri ? 'desktop' : isCapacitor ? 'android' : 'web',
  isTauri, isCapacitor,
  deviceName() {
    if (isTauri) return 'Desktop (Windows)';
    if (isCapacitor) return 'Phone (Android)';
    return 'Browser · ' + (navigator.userAgentData?.platform || navigator.platform || 'web');
  }
};

/* The element that scrolls the page: <main> on desktop, so the title bar and its window buttons
   reach the window edge with the scrollbar below them; the document everywhere else. */
export function scrollRoot() {
  return (isTauri && document.getElementById('main')) || document.scrollingElement || document.documentElement;
}

const tauriWindow = () => import('@tauri-apps/api/window').then(m => m.getCurrentWindow());

/* Window controls for the frameless Tauri window. 'close' hides it; the app keeps running in the tray. */
export async function windowAction(action) {
  if (!isTauri) return;
  const w = await tauriWindow();
  if (action === 'min') return w.minimize();
  if (action === 'max') return (await w.isMaximized()) ? w.unmaximize() : w.maximize();
  if (action === 'close') return w.hide();
  if (action === 'show') return w.show();
}

/* Calls fn(maximized) now and whenever the window is maximized or restored. */
export async function onMaximized(fn) {
  if (!isTauri) return;
  const w = await tauriWindow();
  let last = null, queued = false;
  const check = async () => {
    queued = false;
    const m = await w.isMaximized();
    if (m !== last) { last = m; fn(m); }
  };
  check();
  w.onResized(() => { if (!queued) { queued = true; requestAnimationFrame(check); } });
}

/* The window starts hidden. Tell the shell the launch screen is in place: it shows the window and
   answers whether it is visible now (false when autostart keeps it in the tray). */
export async function launchReady() {
  if (!isTauri) return true;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke('launch_ready');
  } catch {
    windowAction('show');
    return true;
  }
}

/* Shell events: 'os://shown' (the window was brought back) and 'os://close' (Alt+F4, taskbar close). */
export async function onShellEvent(name, fn) {
  if (!isTauri) return;
  const { listen } = await import('@tauri-apps/api/event');
  return listen(name, () => fn());
}

/* Phone-sized screen (matches the CSS breakpoint). Views use it to show a slimmer layout. */
export const phoneQuery = typeof window !== 'undefined' ? matchMedia('(max-width: 860px)') : { matches: false, addEventListener() {} };
export const isPhone = () => phoneQuery.matches;
