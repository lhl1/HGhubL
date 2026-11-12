export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
export type CatalogLayout = "grid" | "list";
export type Preferences = {
  autoplay: boolean;
  autoNext: boolean;
  defaultRate: number;
  enhancedBuffer: boolean;
  previewBeforePlay: boolean;
  catalogLayout: CatalogLayout;
};
export const PREFERENCES_KEY = "hghub_preferences_v1";
export const DEFAULT_PREFERENCES: Readonly<Preferences> = Object.freeze({
  autoplay: true, autoNext: true, defaultRate: 1, enhancedBuffer: true,
  previewBeforePlay: true, catalogLayout: "grid",
});

export function normalizePreferences(raw: unknown): Preferences {
  const next = { ...DEFAULT_PREFERENCES };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return next;
  const value = raw as Record<string, unknown>;
  for (const key of ["autoplay", "autoNext", "enhancedBuffer", "previewBeforePlay"] as const) {
    if (typeof value[key] === "boolean") next[key] = value[key];
  }
  if (PLAYBACK_RATES.includes(value.defaultRate as typeof PLAYBACK_RATES[number])) next.defaultRate = value.defaultRate as number;
  if (value.catalogLayout === "grid" || value.catalogLayout === "list") next.catalogLayout = value.catalogLayout;
  return next;
}

export function readPreferences(): Preferences {
  try { return normalizePreferences(JSON.parse(localStorage.getItem(PREFERENCES_KEY) || "null")); }
  catch { return { ...DEFAULT_PREFERENCES }; }
}
