import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export const IMMERSIVE_HIDE_MS = 1200;
export const NORMAL_HIDE_MS = 2800;

/** Enter immersive mode cleanly; only deliberate input reveals the controls. */
export function usePlayerChrome(immersive: boolean, active: boolean, paused: boolean) {
  const [visible, setVisible] = useState(!immersive), [held, setHeld] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef({ immersive, active, paused, held }); latest.current = { immersive, active, paused, held };
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    if (!latest.current.held) setVisible(false);
  }, []);
  const reveal = useCallback(() => {
    window.clearTimeout(timer.current);
    if (!latest.current.active) return;
    setVisible(true);
    if (!latest.current.held && (latest.current.immersive || !latest.current.paused)) {
      timer.current = window.setTimeout(() => setVisible(false), latest.current.immersive ? IMMERSIVE_HIDE_MS : NORMAL_HIDE_MS);
    }
  }, []);
  const move = useCallback((event: React.PointerEvent) => {
    const previous = pointer.current;
    if (!previous) pointer.current = { x: event.clientX, y: event.clientY };
    else if (Math.hypot(event.clientX - previous.x, event.clientY - previous.y) >= 5) {
      pointer.current = { x: event.clientX, y: event.clientY }; reveal();
    }
  }, [reveal]);
  useLayoutEffect(() => {
    pointer.current = null;
    window.clearTimeout(timer.current);
    if (immersive || !active) { setVisible(false); setHeld(false); }
    else reveal();
    return () => window.clearTimeout(timer.current);
  }, [immersive, active, reveal]);
  useEffect(() => {
    if (held) { window.clearTimeout(timer.current); setVisible(true); }
    else if (visible) reveal();
  }, [held, reveal]);
  useEffect(() => {
    if (!immersive && paused && active) reveal();
  }, [immersive, paused, active, reveal]);
  useEffect(() => {
    const blur = () => { window.clearTimeout(timer.current); setHeld(false); setVisible(false); };
    window.addEventListener("blur", blur);
    return () => { window.removeEventListener("blur", blur); window.clearTimeout(timer.current); };
  }, []);
  return { visible: active && visible, reveal, hide, move, setHeld };
}

export function isImmersiveBack(event: KeyboardEvent): boolean {
  if (event.isComposing) return false;
  if (event.key === "Escape" || event.key === "BrowserBack" || event.key === "GoBack" || event.altKey && event.key === "ArrowLeft") return true;
  return event.key === "Backspace" && !(event.target instanceof HTMLElement && event.target.closest("input,textarea,[contenteditable='true']"));
}
