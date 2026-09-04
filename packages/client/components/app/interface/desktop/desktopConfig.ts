import { createSignal } from "solid-js";

/** Shape handed over by the desktop client's preload script. */
type DesktopConfig = ReturnType<Window["desktopConfig"]["get"]>;

const isNative = !!window.native;

/**
 * The desktop client sends its configuration to the renderer over IPC, and the
 * main process only pushes it from its `did-finish-load` handler. That fires
 * after the page's load event — ~210ms on a real instance — while the app bundle
 * served out of the service worker precache starts rendering well before then.
 * So `window.desktopConfig.get()` returns `undefined` for the first frames of a
 * cold start, and reading through it threw during render, leaving `#root` empty:
 * a permanently black window, since the desktop client has no `did-fail-load`
 * handler and draws no error state.
 *
 * That is also why the black screen looked superstitious. Clearing
 * `%APPDATA%/stoat-desktop` "fixed" it only because uncached assets are slow
 * enough to lose the race, and it came back as soon as the precache warmed up.
 *
 * The preload script keeps the config in a private variable and emits no event,
 * so there is nothing to subscribe to — poll briefly until it lands, then stop.
 */
const [desktopConfig, setDesktopConfig] = createSignal<
  DesktopConfig | undefined
>(isNative ? window.desktopConfig?.get() : undefined);

if (isNative && !desktopConfig()) {
  // ~10s at 50ms; if it has not arrived by then it is not coming, and every
  // read below has a defined fallback anyway
  let attemptsRemaining = 200;

  const interval = setInterval(() => {
    const config = window.desktopConfig?.get();

    if (config) {
      setDesktopConfig(config);
      clearInterval(interval);
    } else if (--attemptsRemaining <= 0) {
      clearInterval(interval);
    }
  }, 50);
}

export { desktopConfig };

/**
 * Whether the client draws its own window frame.
 *
 * Defaults to `true` while the config is still in flight: the desktop client
 * creates the window with `frame: !customFrame` and defaults `customFrame` to
 * true, so assuming `false` would leave a window with neither a titlebar nor an
 * OS frame — no way to move, maximise or close it. A titlebar that is briefly
 * redundant is the safe direction to be wrong in.
 */
export function usesCustomFrame() {
  return isNative && (desktopConfig()?.customFrame ?? true);
}
