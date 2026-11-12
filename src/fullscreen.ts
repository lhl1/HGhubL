/** One request per player until the fullscreen layout has settled. */
const pending = new WeakMap<HTMLElement, Promise<void>>();
export const isPlayerFullscreenPending = (element: HTMLElement) => pending.has(element);
export function enterPlayerFullscreen(element: HTMLElement): Promise<void> {
  const existing = pending.get(element);
  if (existing) return existing;
  let request: Promise<void>;
  try { request = element.requestFullscreen({ navigationUI: "hide" }); }
  catch (reason) { return Promise.reject(reason); }
  const settled = request.then(() => new Promise<void>((resolve) => {
    let first = 0, second = 0, done = false;
    const finish = () => {
      if (done) return;
      done = true; clearTimeout(fallback);
      cancelAnimationFrame(first); cancelAnimationFrame(second); resolve();
    };
    // Animation frames may pause in an inactive window; never leave the gate locked.
    const fallback = window.setTimeout(finish, 200);
    first = requestAnimationFrame(() => { second = requestAnimationFrame(finish); });
  })).finally(() => pending.delete(element));
  pending.set(element, settled);
  return settled;
}
