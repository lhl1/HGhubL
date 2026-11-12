/** One trackpad wheel burst advances once, including its decaying inertia. */
export function createWheelGate(minInterval = 0) {
  let lastAt = -Infinity, lastEmittedAt = -Infinity, sum = 0, direction = 0, consumed = false;
  return (delta: number, at: number, blocked = false): -1 | 0 | 1 => {
    if (!Number.isFinite(delta) || !delta) return 0;
    const sign = Math.sign(delta);
    if (at - lastAt > 220 || sign !== direction) { sum = 0; consumed = false; }
    lastAt = at; direction = sign;
    if (blocked) { consumed = true; return 0; }
    if (consumed) return 0;
    sum += Math.abs(delta);
    if (sum < 65) return 0;
    consumed = true;
    if (at - lastEmittedAt < minInterval) return 0;
    lastEmittedAt = at;
    return sign as -1 | 1;
  };
}

/** A seek or a single timeupdate cannot refill a failing stream's retry budget. */
export function createRecoveryBudget(limit = 2) {
  let used = 0, last: number | null = null, gained = 0;
  return {
    take() { last = null; gained = 0; return used < limit ? (++used, true) : false; },
    progress(time: number) {
      if (!Number.isFinite(time)) return;
      if (last === null || time < last || time - last > 3) gained = 0;
      else gained += time - last;
      last = time;
      if (gained >= 15) used = 0;
    },
    reset() { used = 0; last = null; gained = 0; },
  };
}

export function mergeUnique<T>(current: T[], incoming: T[], key: (item: T) => unknown = (item) => (item as { id: number }).id): T[] {
  const seen = new Set(current.map(key));
  return [...current, ...incoming.filter((item) => { const id = key(item); if (seen.has(id)) return false; seen.add(id); return true; })];
}
