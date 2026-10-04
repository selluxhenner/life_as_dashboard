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

/* Window controls for the frameless Tauri window. */
export async function windowAction(action) {
  if (!isTauri) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const w = getCurrentWindow();
  if (action === 'min') return w.minimize();
  if (action === 'max') return (await w.isMaximized()) ? w.unmaximize() : w.maximize();
  if (action === 'close') return w.hide();
}
