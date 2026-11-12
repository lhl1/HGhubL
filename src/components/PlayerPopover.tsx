import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** An anchored, inert-when-closed media menu; never changes the video viewport. */
export default function PlayerPopover({ label, trigger, children, onOpenChange, enabled = true, width = 340, className = "" }: {
  label: string; trigger: ReactNode; children: (close: () => void) => ReactNode;
  onOpenChange: (open: boolean) => void; enabled?: boolean; width?: number; className?: string;
}) {
  const id = useId(), button = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [position, setPosition] = useState<React.CSSProperties>({ visibility: "hidden" });
  const notify = useRef(onOpenChange); notify.current = onOpenChange;
  const close = (focus = false) => { setOpen(false); if (focus) button.current?.focus({ preventScroll: true }); };
  useEffect(() => { notify.current(open); }, [open]);
  useEffect(() => () => { notify.current(false); }, []);
  useEffect(() => { if (!enabled) setOpen(false); }, [enabled]);
  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const anchor = button.current.getBoundingClientRect(), surface = button.current.closest(".hg-player-ui")?.getBoundingClientRect();
    const leftBound = Math.max(8, (surface?.left || 0) + 8), rightBound = Math.min(innerWidth - 8, surface?.right || innerWidth);
    const menuWidth = Math.min(width, rightBound - leftBound);
    setPosition({ position: "fixed", width: menuWidth, left: Math.max(leftBound, Math.min(anchor.right - menuWidth, rightBound - menuWidth)), bottom: Math.max(8, innerHeight - anchor.top + 10), maxHeight: Math.max(100, Math.min(430, anchor.top - Math.max(18, (surface?.top || 0) + 18))), visibility: "visible" });
  }, [open, width]);
  useEffect(() => {
    if (!open) return;
    popup.current?.querySelector<HTMLElement>("[data-initial-focus],button:not(:disabled),input:not(:disabled)")?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => { if (!button.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) close(); };
    const other = (event: Event) => { if ((event as CustomEvent).detail !== id) close(); };
    const dismiss = () => close();
    const scroll = (event: Event) => {
      if (event.target instanceof HTMLElement && event.target.classList.contains("player-feed-viewport")) return;
      if (!popup.current?.contains(event.target as Node)) close();
    };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.isComposing) { event.preventDefault(); event.stopPropagation(); close(true); } };
    document.addEventListener("pointerdown", outside, true); document.addEventListener("hg-select-open", other);
    document.addEventListener("keydown", key, true); document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", dismiss); window.addEventListener("blur", dismiss); window.addEventListener("hg-exit-immersive", dismiss);
    return () => {
      document.removeEventListener("pointerdown", outside, true); document.removeEventListener("hg-select-open", other);
      document.removeEventListener("keydown", key, true); document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", dismiss); window.removeEventListener("blur", dismiss); window.removeEventListener("hg-exit-immersive", dismiss);
    };
  }, [open, id]);
  return <>
    <button ref={button} type="button" className={`player-control player-menu-trigger ${className} ${open ? "is-on" : ""}`} aria-label={label} aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? id : undefined}
      onClick={() => { if (open) close(); else if (enabled) { document.dispatchEvent(new CustomEvent("hg-select-open", { detail: id })); setOpen(true); } }}>{trigger}</button>
    {open && enabled && createPortal(<div ref={popup} id={id} role="dialog" aria-label={label} className="player-popover hg-player-ui" style={position}
      onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>{children(() => close(true))}</div>, document.fullscreenElement || document.body)}
  </>;
}
