// Runs synchronously in <head> so the stored theme applies before first paint.
// No stored value means "follow the OS" via prefers-color-scheme.
(() => {
  try {
    const stored = localStorage.getItem('localeguard:theme');
    if (stored === 'light' || stored === 'dark') document.documentElement.dataset.theme = stored;
  } catch {
    // Storage can be unavailable (private mode, blocked cookies); the OS preference still applies.
  }
})();
