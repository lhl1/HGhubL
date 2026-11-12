import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, platform as envPlatform } from "./api";
import { isStrictSecurity, setStrictSecurity as setHtmlStrictSecurity } from "./html";
import { normalizePreferences, PREFERENCES_KEY, readPreferences, type Preferences } from "./preferences";
import { CatalogLayoutProvider } from "./components/CatalogLayout";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { DiscoverySection, User } from "./types";

export type Platform = "android" | "windows" | "macos";
export type Theme = "dark" | "light" | "system";
export type Tab = "home" | "explore" | "watch" | "search" | "category" | "profile";

/** 播放页上下文：ids 是来源列表，index 是当前条目。 */
export type FeedContext = {
  kind: "feed";
  key: string;
  videoIds: number[];
  index: number;
  title: string;
  source: string;
  feedKind?: "video" | "post";
  /** 从观看记录续播：起始集数与秒数 */
  startEp?: number;
  startTime?: number;
};

export type Page =
  | FeedContext
  | { kind: "channel"; key: string; cate: string; name: string }
  | { kind: "ranks"; key: string }
  | { kind: "settings"; key: string }
  | { kind: "posts"; key: string }
  | { kind: "post"; key: string; id: number }
  | { kind: "topic"; key: string; slug: string; title: string }
  | { kind: "tag"; key: string; slug: string; title: string };

export type PageInput =
  | { kind: "feed"; videoIds: number[]; index: number; title: string; source?: string; feedKind?: "video" | "post"; startEp?: number; startTime?: number }
  | { kind: "channel"; cate: string; name: string }
  | { kind: "ranks" }
  | { kind: "settings" }
  | { kind: "posts" }
  | { kind: "post"; id: number }
  | { kind: "topic"; slug: string; title: string }
  | { kind: "tag"; slug: string; title: string };

export type Toast = { id: number; msg: string; icon?: "ok" | "heart" | "star" | "info" };

/** 观看记录：看到第几集、第几秒（`dur` 用来判断是否已看完） */
export type WatchProgress = { id: number; ep: number; t: number; dur: number; at: number };

type Persist = {
  likes: number[];
  favs: number[];
  history: WatchProgress[];
  follows: number[];
  muted: boolean;
  volume: number;
  searchHist: string[];
};

const LS = "hghub_app_v1";
const DEFAULTS: Persist = {
  likes: [], favs: [], history: [], follows: [],
  muted: true, volume: 0.7, searchHist: [],
};

/** 旧版本 history 是 number[]，读出来时升级成带进度的结构 */
function normalizeHistory(raw: unknown): WatchProgress[] {
  if (!Array.isArray(raw)) return [];
  const out: WatchProgress[] = [];
  raw.forEach((item, i) => {
    if (typeof item === "number" && Number.isSafeInteger(item) && item > 0) {
      out.push({ id: item, ep: 1, t: 0, dur: 0, at: Date.now() - i });
      return;
    }
    const h = item as Partial<WatchProgress> | null;
    if (h && Number.isSafeInteger(h.id) && h.id! > 0) {
      const nonnegative = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 0;
      out.push({ id: h.id!, ep: Math.max(1, Math.floor(nonnegative(h.ep))), t: nonnegative(h.t), dur: nonnegative(h.dur), at: nonnegative(h.at) || Date.now() - i });
    }
  });
  return [...new Map(out.map((h) => [h.id, h])).values()].sort((a, b) => b.at - a.at).slice(0, 80);
}

function loadPersist(): Persist {
  try {
    const raw = localStorage.getItem(LS);
    if (!raw) return DEFAULTS;
    const p = JSON.parse(raw) as Partial<Persist>;
    const ids = (value: unknown): number[] => Array.isArray(value) ? [...new Set(value.filter((id) => Number.isSafeInteger(id) && id > 0))] : [];
    return { likes: ids(p.likes), favs: ids(p.favs), follows: ids(p.follows), history: normalizeHistory(p.history),
      muted: typeof p.muted === "boolean" ? p.muted : DEFAULTS.muted,
      volume: typeof p.volume === "number" && Number.isFinite(p.volume) ? Math.max(0, Math.min(1, p.volume)) : DEFAULTS.volume,
      searchHist: Array.isArray(p.searchHist) ? [...new Set(p.searchHist.filter((q): q is string => typeof q === "string" && !!q.trim()).map((q) => q.slice(0, 100)))].slice(0, 12) : [] };
  } catch {
    return DEFAULTS;
  }
}

function readTheme(): Theme {
  try {
    if (localStorage.getItem("hghub_theme_policy") !== "system-v1") return "system";
    const saved = localStorage.getItem("hghub_theme");
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

function applyTheme(theme: "dark" | "light") {
  document.documentElement.classList.toggle("theme-light", theme === "light");
  document.documentElement.style.colorScheme = theme;
}

type Store = {
  platform: Platform;
  theme: Theme; resolvedTheme: "dark" | "light"; setTheme: (t: Theme) => void;
  tab: Tab; setTab: (t: Tab) => void;
  discoverySection: DiscoverySection; openExplore: (section?: DiscoverySection) => void;
  stack: Page[]; push: (p: PageInput) => void; pop: () => void;
  preview: Extract<PageInput, { kind: "feed" }> | null;
  closePreview: () => void;
  startPreview: (ep?: number, time?: number) => void;
  preferences: Preferences; setPreferences: (patch: Partial<Preferences>) => void;
  user: User | null; setUser: (u: User | null) => void;
  loginOpen: boolean; setLoginOpen: (b: boolean) => void;
  logout: () => Promise<void>;
  likes: number[]; favs: number[]; history: WatchProgress[]; follows: number[];
  isLiked: (id: number) => boolean; isFav: (id: number) => boolean;
  toggleLikeLocal: (id: number) => boolean;
  toggleFavLocal: (id: number) => boolean;
  /** 记一条观看记录；`ep/t/dur` 省略时保留原进度，`ep` 变了就把进度归零 */
  addHistory: (id: number, ep?: number, t?: number, dur?: number) => void;
  clearHistory: () => void;
  toggleFollowLocal: (uid: number) => boolean;
  theater: boolean; setTheater: (v: boolean | ((p: boolean) => boolean)) => void;
  fs: boolean; setFs: (v: boolean | ((p: boolean) => boolean)) => void;
  nativeFullscreen: boolean; setNativeFullscreen: (fullscreen: boolean) => void;
  exitImmersive: () => boolean;
  muted: boolean; setMuted: (v: boolean | ((p: boolean) => boolean)) => void;
  volume: number; setVolume: (v: number) => void;
  searchHist: string[]; addSearch: (q: string) => void; clearSearchHist: () => void;
  strictSecurity: boolean; strictSecurityReady: boolean; securityPending: boolean; cliRelaxed: boolean; setStrictSecurity: (on: boolean) => Promise<void>;
  searchQuery: string; searchRequest: number; requestSearch: (query: string) => void;
  homeChannel: string; setHomeChannel: (channel: string) => void;
  libraryTab: "fav" | "history"; setLibraryTab: (tab: "fav" | "history") => void;
  toasts: Toast[]; toast: (msg: string, icon?: Toast["icon"]) => void;
};

const Ctx = createContext<Store>(null as unknown as Store);
export const useStore = () => useContext(Ctx);
let seq = 0;

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [p, setP] = useState<Persist>(loadPersist);
  const persistRef = useRef(p);
  const setPersist = useCallback((update: (previous: Persist) => Persist) => {
    const next = update(persistRef.current); persistRef.current = next; setP(next);
  }, []);
  const [preferences, setPreferencesState] = useState(readPreferences);
  const [preview, setPreview] = useState<Extract<PageInput, { kind: "feed" }> | null>(null);
  const [theme, setThemeState] = useState<Theme>(readTheme);
  const [systemDark, setSystemDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  const resolvedTheme = theme === "system" ? systemDark ? "dark" : "light" : theme;
  const [tab, setTabRaw] = useState<Tab>("watch");
  const [discoverySection, setDiscoverySection] = useState<DiscoverySection>("recommend");
  const [searchQuery, setSearchQuery] = useState(""), [searchRequest, setSearchRequest] = useState(0);
  const [homeChannel, setHomeChannel] = useState("");
  const [libraryTab, setLibraryTab] = useState<"fav" | "history">("fav");
  const [stack, setStack] = useState<Page[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [theater, setTheaterState] = useState(false);
  const [fs, setFsState] = useState(false);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const exitImmersive = useCallback(() => {
    if (!theater && !fs && !nativeFullscreen && !document.fullscreenElement) return false;
    setTheaterState(false); setFsState(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    if (nativeFullscreen) void getCurrentWindow().setFullscreen(false).then(() => setNativeFullscreen(false)).catch(() => {});
    window.dispatchEvent(new Event("hg-exit-immersive"));
    return true;
  }, [theater, fs, nativeFullscreen]);
  const [strictSecurity, setStrictSecurityState] = useState<boolean>(isStrictSecurity);
  const [cliRelaxed, setCliRelaxed] = useState(false);
  const [strictSecurityReady, setStrictSecurityReady] = useState(false);
  const [securityPending, setSecurityPending] = useState(false);
  const toastSeq = useRef(0);
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const setPreferences = useCallback((patch: Partial<Preferences>) => {
    setPreferencesState((previous) => normalizePreferences({ ...previous, ...patch }));
  }, []);
  useEffect(() => {
    try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences)); } catch { /* Read-only storage keeps the active session usable. */ }
  }, [preferences]);

  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const changed = () => setSystemDark(media.matches);
    media.addEventListener("change", changed); return () => media.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    applyTheme(resolvedTheme);
    try { localStorage.setItem("hghub_theme", theme); localStorage.setItem("hghub_theme_policy", "system-v1"); } catch { /* ignore */ }
  }, [theme, resolvedTheme]);

  useEffect(() => {
    const save = () => { try { localStorage.setItem(LS, JSON.stringify(persistRef.current)); } catch { /* ignore */ } };
    const timer = window.setTimeout(save, 250);
    window.addEventListener("pagehide", save);
    return () => { window.clearTimeout(timer); window.removeEventListener("pagehide", save); };
  }, [p]);
  useEffect(() => () => {
    try { localStorage.setItem(LS, JSON.stringify(persistRef.current)); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    api.boot()
      .then((r) => {
        if (r.user && (r.user as User).id) setUser(r.user as User);
        if (typeof r.strict_security === "boolean") {
          setStrictSecurityState(r.strict_security);
          setHtmlStrictSecurity(r.strict_security);
          setStrictSecurityReady(true);
        }
        setCliRelaxed(!!r.cli_relaxed);
      })
      .catch(() => { /* 离线也能用 */ });
  }, []);

  const setStrictSecurity = useCallback(async (on: boolean) => {
    if (!strictSecurityReady) throw new Error("安全设置尚未读取，请重新启动应用");
    setSecurityPending(true);
    try {
      const saved = await api.securitySet(on);
      setHtmlStrictSecurity(saved);
      setStrictSecurityState(saved);
    } finally {
      setSecurityPending(false);
    }
  }, [strictSecurityReady]);

  const toast = useCallback((msg: string, icon?: Toast["icon"]) => {
    const id = ++toastSeq.current;
    setToasts((t) => [...t.slice(-2), { id, msg, icon }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2200);
  }, []);

  const setTab = useCallback((t: Tab) => { setTabRaw(t); setStack([]); setPreview(null); }, []);
  const openExplore = useCallback((section: DiscoverySection = "recommend") => { setDiscoverySection(section); setTab("explore"); }, [setTab]);
  const requestSearch = useCallback((query: string) => {
    const value = query.trim().slice(0, 100); if (!value) return;
    setSearchQuery(value); setSearchRequest((request) => request + 1); setTab("search");
  }, [setTab]);
  const push = useCallback((pg: PageInput) => {
    if (pg.kind === "feed" && pg.feedKind !== "post" && pg.startEp === undefined && pg.startTime === undefined && preferencesRef.current.previewBeforePlay) {
      setPreview(pg); return;
    }
    setStack((s) => [...s, { ...pg, key: `p${++seq}` } as Page]);
  }, []);
  const closePreview = useCallback(() => setPreview(null), []);
  const startPreview = useCallback((ep?: number, time?: number) => {
    if (!preview) return;
    setStack((s) => [...s, { ...preview, startEp: ep || 1, startTime: time || 0, key: `p${++seq}` } as Page]);
    setPreview(null);
  }, [preview]);
  const pop = useCallback(() => setStack((s) => s.slice(0, -1)), []);

  const toggleLikeLocal = useCallback((id: number) => {
    let on = false;
    setPersist((s) => {
      on = !s.likes.includes(id);
      return { ...s, likes: on ? [id, ...s.likes] : s.likes.filter((x) => x !== id) };
    });
    return on;
  }, []);
  const toggleFavLocal = useCallback((id: number) => {
    let on = false;
    setPersist((s) => {
      on = !s.favs.includes(id);
      return { ...s, favs: on ? [id, ...s.favs] : s.favs.filter((x) => x !== id) };
    });
    return on;
  }, []);
  const toggleFollowLocal = useCallback((uid: number) => {
    let on = false;
    setPersist((s) => {
      on = !s.follows.includes(uid);
      return { ...s, follows: on ? [uid, ...s.follows] : s.follows.filter((x) => x !== uid) };
    });
    return on;
  }, []);
  const addHistory = useCallback((id: number, ep?: number, t?: number, dur?: number) => {
    if (!id) return;
    setPersist((s) => {
      const prev = s.history.find((x) => x.id === id);
      const epChanged = ep !== undefined && prev !== undefined && prev.ep !== ep;
      const entry: WatchProgress = {
        id,
        ep: ep ?? prev?.ep ?? 1,
        t: t ?? (epChanged ? 0 : prev?.t ?? 0),
        dur: dur ?? (epChanged ? 0 : prev?.dur ?? 0),
        at: Date.now(),
      };
      return { ...s, history: [entry, ...s.history.filter((x) => x.id !== id)].slice(0, 80) };
    });
  }, []);
  const clearHistory = useCallback(() => setPersist((s) => ({ ...s, history: [] })), [setPersist]);
  const addSearch = useCallback((q: string) => {
    const t = q.trim();
    if (!t) return;
    setPersist((s) => ({ ...s, searchHist: [t.slice(0, 100), ...s.searchHist.filter((x) => x !== t)].slice(0, 12) }));
  }, []);
  const clearSearchHist = useCallback(() => setPersist((s) => ({ ...s, searchHist: [] })), [setPersist]);

  const logout = useCallback(async () => {
    try { await api.logout(); } catch { /* ignore */ }
    setUser(null);
    toast("已退出登录", "info");
  }, [toast]);

  const setTheater = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    setTheaterState((prev) => (typeof v === "function" ? (v as (p: boolean) => boolean)(prev) : v));
  }, []);

  const setFs = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    setFsState((prev) => (typeof v === "function" ? (v as (p: boolean) => boolean)(prev) : v));
  }, []);

  const setMuted = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    setPersist((s) => ({ ...s, muted: typeof v === "function" ? v(s.muted) : v }));
  }, []);
  const setVolume = useCallback((v: number) => {
    if (!Number.isFinite(v)) return;
    const volume = Math.max(0, Math.min(1, v));
    setPersist((s) => ({ ...s, volume, muted: volume === 0 }));
  }, []);

  const value = useMemo<Store>(() => ({
    platform: envPlatform,
    theme, resolvedTheme, setTheme: setThemeState,
    tab, setTab, discoverySection, openExplore, stack, push, pop,
    searchQuery, searchRequest, requestSearch, homeChannel, setHomeChannel, libraryTab, setLibraryTab,
    preview, closePreview, startPreview, preferences, setPreferences,
    user, setUser, loginOpen, setLoginOpen, logout,
    likes: p.likes, favs: p.favs, history: p.history, follows: p.follows,
    isLiked: (id) => p.likes.includes(id),
    isFav: (id) => p.favs.includes(id),
    toggleLikeLocal, toggleFavLocal, toggleFollowLocal, addHistory, clearHistory,
    muted: p.muted, setMuted, volume: p.volume, setVolume, theater, setTheater, fs, setFs,
    nativeFullscreen, setNativeFullscreen, exitImmersive,
    searchHist: p.searchHist, addSearch, clearSearchHist,
    strictSecurity, strictSecurityReady, securityPending, cliRelaxed, setStrictSecurity,
    toasts, toast,
  }), [theme, resolvedTheme, tab, setTab, discoverySection, openExplore, stack, push, pop, searchQuery, searchRequest, requestSearch, homeChannel, libraryTab, preview, closePreview, startPreview, preferences, setPreferences, user, loginOpen, logout,
    p, toggleLikeLocal, toggleFavLocal, toggleFollowLocal, addHistory, clearHistory,
    setMuted, setVolume, addSearch, clearSearchHist, strictSecurity, strictSecurityReady, securityPending, cliRelaxed, setStrictSecurity,
    toasts, toast, theater, setTheater, fs, setFs, nativeFullscreen, exitImmersive]);

  return <Ctx.Provider value={value}><CatalogLayoutProvider defaultLayout={preferences.catalogLayout}>{children}</CatalogLayoutProvider></Ctx.Provider>;
}
