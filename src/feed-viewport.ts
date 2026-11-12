import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

/** A viewport resize changes pixel offsets, never the logical video selection. */
export function useFeedViewport(box: RefObject<HTMLDivElement | null>, index: number, count: number, presentation: string) {
  const selected = useRef(index); selected.current = index;
  const total = useRef(count); total.current = count;
  const layout = useRef({ height: 0, aligning: false, frame: 0, snap: "", behavior: "" });
  const release = useCallback(() => {
    const state = layout.current, element = box.current;
    cancelAnimationFrame(state.frame);
    if (element && state.aligning) { element.style.scrollSnapType = state.snap; element.style.scrollBehavior = state.behavior; }
    state.aligning = false;
    if (element?.clientHeight) state.height = element.clientHeight;
  }, [box]);
  const align = useCallback(() => {
    const element = box.current, state = layout.current;
    if (!element || !element.clientHeight) return;
    cancelAnimationFrame(state.frame);
    if (!state.aligning) { state.snap = element.style.scrollSnapType; state.behavior = element.style.scrollBehavior; }
    state.aligning = true;
    element.style.scrollSnapType = "none"; element.style.scrollBehavior = "auto";
    const place = () => {
      state.height = element.clientHeight;
      element.scrollTop = Math.max(0, Math.min(total.current - 1, selected.current)) * state.height;
    };
    place();
    // WebView2 may adjust scroll anchoring/snap again after fullscreen layout.
    state.frame = requestAnimationFrame(() => {
      place(); state.frame = requestAnimationFrame(() => { place(); release(); });
    });
  }, [box, release]);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    align();
    const observer = new ResizeObserver(() => { if (element.clientHeight > 0 && element.clientHeight !== layout.current.height) align(); });
    observer.observe(element);
    window.addEventListener("resize", align); window.addEventListener("hg-exit-immersive", align);
    document.addEventListener("fullscreenchange", align);
    return () => {
      observer.disconnect(); release();
      window.removeEventListener("resize", align); window.removeEventListener("hg-exit-immersive", align);
      document.removeEventListener("fullscreenchange", align);
    };
  }, [box, align, release, count]);
  useLayoutEffect(() => { align(); }, [presentation, align]);
  const readIndex = useCallback(() => {
    const element = box.current;
    if (!element || !element.clientHeight) return null;
    if (element.clientHeight !== layout.current.height) { align(); return null; }
    if (layout.current.aligning) return null;
    const next = Math.max(0, Math.min(total.current - 1, Math.round(element.scrollTop / element.clientHeight)));
    selected.current = next;
    return next;
  }, [box, align]);
  return { readIndex, prepare: align, allowNavigation: release };
}
