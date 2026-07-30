/**
 * iOS Safari keeps its double-tap-to-zoom even when the viewport is declared
 * non-scalable — `user-scalable=no` has been ignored there for accessibility
 * reasons since iOS 10. And `touch-action` is *not* an inherited property, so
 * setting it on <body> does nothing for the canvas or the on-screen pedals.
 *
 * Hammering the gas pedal therefore reads as a double tap and the whole page
 * zooms. Three layers stop that:
 *
 *  1. `touch-action` declared explicitly on every game surface (styles.css)
 *  2. the second tap of a fast pair is swallowed on those surfaces
 *  3. Safari's non-standard `gesture*` events are cancelled outright
 *
 * The menus keep working because anything that genuinely needs a synthetic
 * click — a real <button> outside the driving controls — is exempt from (2).
 */

// `.screen` covers the garage, the pause overlay and the loading screen —
// they sit on top of everything, so a double tap there hits them, not the canvas.
const GAME_SURFACES = '#scene, #hud, #touch, #mapview, #mapcanvas, .screen';

/** Elements that still rely on the browser turning a tap into a click. */
const NEEDS_CLICK = 'button:not([data-hold]):not([data-tap]), a, input, select, label';

const DOUBLE_TAP_MS = 380;

export function installTouchGuards() {
  // -Infinity, not 0: performance.now() is still tiny right after load, so a
  // zero seed would make the very first tap of the session look like a repeat
  let lastTap = -Infinity;

  document.addEventListener('touchend', (e) => {
    const now = performance.now();
    const fast = now - lastTap < DOUBLE_TAP_MS;
    lastTap = now;
    if (!fast) return;

    const t = e.target;
    if (!t || typeof t.closest !== 'function') return;
    if (t.closest(NEEDS_CLICK)) return;

    const onSurface = t === document.body ||
      t === document.documentElement ||
      t.closest(GAME_SURFACES);
    if (onSurface) e.preventDefault();
  }, { passive: false });

  // two fingers on a game surface must never scale or pan the page
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length < 2) return;
    const t = e.target;
    if (t?.closest?.(GAME_SURFACES)) e.preventDefault();
  }, { passive: false });

  // Safari-only pinch events, fired alongside the touch events
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  }

  // iOS fires this when a tap is held long enough to start a selection
  document.addEventListener('selectstart', (e) => {
    if (e.target?.closest?.(GAME_SURFACES)) e.preventDefault();
  });
}
