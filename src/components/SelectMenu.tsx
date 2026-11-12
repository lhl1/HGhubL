import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ICheck, IChevronDown } from "../icons";

type Option = { value: string; label: string };
export default function SelectMenu({ label, value, options, onChange, media = false, onOpenChange }: {
  label: string; value: string; options: Option[]; onChange: (value: string) => void; media?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const notify = useRef(onOpenChange); notify.current = onOpenChange;
  useEffect(() => { notify.current?.(open); }, [open]);
  useEffect(() => () => { notify.current?.(false); }, []);
  useEffect(() => {
    const dismiss = () => setOpen(false);
    window.addEventListener("hg-exit-immersive", dismiss);
    window.addEventListener("blur", dismiss);
    return () => { window.removeEventListener("hg-exit-immersive", dismiss); window.removeEventListener("blur", dismiss); };
  }, []);
  const [position, setPosition] = useState<React.CSSProperties>({ visibility: "hidden" });
  const close = (focus = false) => { setOpen(false); if (focus) trigger.current?.focus({ preventScroll: true }); };
  const show = () => {
    document.dispatchEvent(new CustomEvent("hg-select-open", { detail: id }));
    setActive(Math.max(0, options.findIndex((item) => item.value === value))); setOpen(true);
  };
  const choose = (index: number) => { if (options[index]) onChange(options[index].value); close(true); };
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 170), innerWidth - 24);
    const desired = Math.min(310, options.length * 38 + 12), below = innerHeight - rect.bottom - 12, above = rect.top - 12;
    const up = below < desired && above > below;
    setPosition({ position: "fixed", width, left: Math.max(12, Math.min(rect.left, innerWidth - width - 12)),
      maxHeight: Math.max(60, Math.min(desired, up ? above : below)), visibility: "visible",
      ...(up ? { bottom: innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }) });
  }, [open, options.length]);
  useLayoutEffect(() => {
    const menu = popup.current, option = menu?.querySelector<HTMLElement>('[data-active="true"]');
    if (!open || position.visibility !== "visible" || !menu || !option) return;
    // Scroll only the listbox. scrollIntoView also scrolls page ancestors and
    // those external scroll events would immediately dismiss a newly opened menu.
    const top = option.offsetTop, bottom = top + option.offsetHeight;
    if (top < menu.scrollTop) menu.scrollTop = top;
    else if (bottom > menu.scrollTop + menu.clientHeight) menu.scrollTop = bottom - menu.clientHeight;
  }, [active, open, position]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!trigger.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) close(); };
    const other = (event: Event) => { if ((event as CustomEvent).detail !== id) close(); };
    const scroll = (event: Event) => { if (!popup.current?.contains(event.target as Node)) close(); };
    const resize = () => close();
    const key = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === "Tab") { close(); return; }
      if (!["Escape", "ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      if (event.key === "Escape") close(true);
      else if (event.key === "Enter" || event.key === " ") choose(active);
      else if (options.length) setActive(event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (active + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
    };
    document.addEventListener("pointerdown", outside, true); document.addEventListener("keydown", key, true);
    document.addEventListener("hg-select-open", other); document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", key, true);
      document.removeEventListener("hg-select-open", other); document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", resize);
    };
  }, [open, active, options, id]);
  return <>
    <button ref={trigger} type="button" className={`hg-select-trigger ${media ? "hg-select-media" : ""}`}
      role="combobox" aria-label={label} aria-expanded={open} aria-haspopup="listbox" aria-controls={open ? id : undefined}
      aria-activedescendant={open ? `${id}-${active}` : undefined} onClick={() => open ? close() : show()}
      onKeyDown={(event) => { if (!open && ["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); show(); } }}>
      <span>{options.find((option) => option.value === value)?.label || value}</span><IChevronDown size={13} />
    </button>
    {open && createPortal(<div ref={popup} id={id} role="listbox" aria-label={label} className={`hg-select-menu ${media ? "hg-player-ui" : ""}`} style={position}
      onWheel={(event) => event.stopPropagation()}>
      {options.map((option, index) => <button key={option.value} id={`${id}-${index}`} role="option" type="button" tabIndex={-1}
        aria-selected={option.value === value} data-active={active === index} onPointerMove={() => setActive(index)} onClick={() => choose(index)}>
        <span>{option.label}</span>{value === option.value && <ICheck size={14} />}
      </button>)}
    </div>, document.fullscreenElement || document.body)}
  </>;
}
