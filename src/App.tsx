import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore, type Page, type Tab } from "./store";
import { selfTest } from "./api";
import { addPluginListener, invoke } from "@tauri-apps/api/core";
import { runBack } from "./back";
import Home from "./pages/Home";
import Explore from "./pages/Explore";
import Watch from "./pages/Watch";
import { TagPage, TopicPage } from "./components/DiscoveryContent";
import Search, { RankPage } from "./pages/Search";
import Category, { ChannelPage } from "./pages/Category";
import Profile from "./pages/Profile";
import SettingsPage from "./pages/Settings";
import Feed from "./components/Feed";
import { PostsPage, PostDetail } from "./pages/Posts";
import LoginModal from "./components/LoginModal";
import { ToastHost } from "./components/ui";
import { DesktopRail, DesktopTitleBar } from "./components/DesktopChrome";
import ResizeHandles from "./components/ResizeHandles";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isImmersiveBack } from "./immersive";
import VideoPreview from "./components/VideoPreview";
import { IGrid, IGridF, IHome, IHomeF, ISearch, IUser, IUserF, Logo } from "./icons";

/* ============ 底部标签栏（Android）—— 细瘦纯文字、低侵入 ============ */
function TabBar() {
  const { tab, setTab, resolvedTheme: theme } = useStore();
  const items: { k: Tab; label: string }[] = [
    { k: "watch", label: "放映" },
    { k: "home", label: "首页" },
    { k: "explore", label: "探索" },
    { k: "category", label: "分类" },
    { k: "profile", label: "我的" },
  ];
  /* 放映使用深色底栏；浏览内容的页面跟随主题。 */
  const overVideo = tab === "watch";
  const lightBar = !overVideo && theme === "light";
  return (
    <nav className="hg-tabbar absolute bottom-0 inset-x-0 z-30"
      style={{
        paddingBottom: "var(--sab, 0px)",
        background: lightBar ? "rgba(250, 250, 250, .97)" : overVideo ? "#000000" : "#141414",
        borderTop: lightBar ? "1px solid rgba(0,0,0,.08)" : overVideo ? "none" : "1px solid rgba(255,255,255,.07)",
        boxShadow: lightBar ? "0 -2px 14px rgba(0,0,0,.05)" : "none",
      }}>
      <div className="h-[40px] flex items-center px-1">
        {items.map(({ k, label }) => {
          const on = tab === k;
          return (
            <button key={k} onClick={() => setTab(k)} className="flex-1 h-full flex items-center justify-center pressable">
              <span className="text-[12.5px] leading-none transition-colors duration-200"
                style={{
                  fontWeight: on ? 700 : 400,
                  color: lightBar
                    ? (on ? "var(--p-primary)" : "rgba(0,0,0,.45)")
                    : (on ? "#ffffff" : "rgba(255,255,255,.6)"),
                }}>
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/* ============ 堆栈页面 ============ */
function StackPage({ page, onBack, wide, top, bottomInset }: {
  page: Page; onBack: () => void; wide: boolean; top: boolean; bottomInset: number;
}) {
  if (page.kind === "feed") {
    return (
      <Feed videoIds={page.videoIds} startIndex={page.index} title={page.title} kind={page.feedKind || "video"}
        startEp={page.startEp} startTime={page.startTime}
        mode="context" active={top} bottomInset={bottomInset} onBack={onBack} />
    );
  }
  if (page.kind === "channel") return <ChannelPage cate={page.cate} name={page.name} onBack={onBack} wide={wide} />;
  if (page.kind === "ranks") return <RankPage onBack={onBack} wide={wide} />;
  if (page.kind === "settings") return <SettingsPage onBack={onBack} wide={wide} />;
  if (page.kind === "posts") return <PostsPage onBack={onBack} wide={wide} />;
  if (page.kind === "post") return <PostDetail id={page.id} onBack={onBack} active={top} />;
  if (page.kind === "topic") return <TopicPage slug={page.slug} title={page.title} onBack={onBack} active={top} wide={wide} />;
  if (page.kind === "tag") return <TagPage slug={page.slug} title={page.title} onBack={onBack} active={top} wide={wide} />;
  return null;
}

/* ============ 应用主体 ============ */
function useVisitedTabs(tab: Tab) {
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set([tab]));
  useEffect(() => { setVisited((previous) => previous.has(tab) ? previous : new Set([...previous, tab])); }, [tab]);
  return (candidate: Tab) => candidate === tab || visited.has(candidate);
}

function AppBody() {
  const { platform, tab, setTab, stack, pop, loginOpen, setLoginOpen, fs, preview } = useStore();
  const mainRef = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(platform !== "android");
  const [collapsed, setCollapsed] = useState(false);
  const visited = useVisitedTabs(tab);

  useLayoutEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWide(el.clientWidth > 640));
    ro.observe(el);
    setWide(el.clientWidth > 640);
    return () => ro.disconnect();
  }, []);

  /* 全局键盘 */
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (e.key === "Escape" && document.fullscreenElement) { e.preventDefault(); void document.exitFullscreen().catch(() => {}); return; }
      if (e.key === "Escape" && runBack()) { e.preventDefault(); return; }
      const t = e.target as HTMLElement;
      if (e.defaultPrevented || e.isComposing || t?.closest('[role="dialog"],[role="listbox"],[role="combobox"],[contenteditable="true"]')) return;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) {
        if (e.key === "Escape") t.blur();
        return;
      }
      if (loginOpen) { if (e.key === "Escape") setLoginOpen(false); return; }
      if (e.key === "Escape") { if (stack.length) pop(); return; }
      if (e.key === "/") { e.preventDefault(); setTab("search"); return; }
      if (["1", "2", "3", "4"].includes(e.key) && !e.repeat) {
        setTab((["watch", "home", "explore", "category"] as Tab[])[Number(e.key) - 1]);
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [stack.length, pop, setTab, loginOpen, setLoginOpen]);

  const vis = (k: Tab) => (tab === k ? "absolute inset-0" : "absolute inset-0 invisible pointer-events-none");
  const pageActive = stack.length === 0 && !loginOpen && !preview;
  const bottomInset = platform === "android" ? (fs ? 0 : 40) : 14;
  /* 栈页（从搜索/分类/我的进入的播放页、图文页）没有底栏，
     底部只让出安全区。之前多留了 20px，视频底边会露出一条
     「底栏」似的窄缝（底部的压暗渐变到不了屏幕最底）。 */
  const stackInset = platform === "android" ? 0 : 14;

  return (
    <div className={`absolute inset-0 flex bg-canvas plat-${platform}`}>
      {platform !== "android" && <DesktopRail collapsed={collapsed} />}
      <div ref={mainRef} className="relative flex-1 min-w-0 overflow-hidden win-main">
        <div className={vis("home")}><Home active={pageActive && tab === "home"} bottomInset={bottomInset} wide={wide} /></div>
        {visited("explore") && <div className={vis("explore")}><Explore active={pageActive && tab === "explore"} wide={wide} /></div>}
        {visited("watch") && <div className={vis("watch")}><Watch active={pageActive && tab === "watch"} bottomInset={bottomInset} /></div>}
        {visited("search") && <div className={vis("search")}><Search active={pageActive && tab === "search"} wide={wide} /></div>}
        {visited("category") && <div className={vis("category")}><Category wide={wide} /></div>}
        {visited("profile") && <div className={vis("profile")}><Profile wide={wide} /></div>}

        {stack.map((p, i) => (
          <div key={p.key} className="absolute inset-0 z-30 bg-bg a-page-in" style={{ boxShadow: "-18px 0 40px rgba(0,0,0,.5)" }}>
            <StackPage page={p} onBack={pop} wide={wide} top={i === stack.length - 1 && !loginOpen && !preview} bottomInset={stackInset} />
          </div>
        ))}

        {platform === "android" && !fs && stack.length === 0 && <TabBar />}
      </div>
    </div>
  );
}

/* ============ 桌面窗口壳（Windows / macOS）============ */
function DesktopShell() {
  const { theater, platform, nativeFullscreen, setNativeFullscreen } = useStore();
  useEffect(() => {
    let alive = true, unlisten: (() => void) | undefined;
    const native = getCurrentWindow();
    const sync = () => { void native.isFullscreen().then((value) => { if (alive) setNativeFullscreen(value); }).catch(() => {}); };
    sync(); void native.onResized(sync).then((off) => { if (alive) unlisten = off; else off(); }).catch(() => {});
    return () => { alive = false; unlisten?.(); };
  }, [setNativeFullscreen]);
  useEffect(() => {
    document.documentElement.classList.toggle("ref-native-fullscreen", nativeFullscreen);
    return () => document.documentElement.classList.remove("ref-native-fullscreen");
  }, [nativeFullscreen]);
  return (
    <div className={`absolute inset-0 flex flex-col bg-canvas win-root ref-desktop-shell plat-${platform} ${theater ? "ref-theater" : ""}`}>
      <div className="relative flex-1 min-h-0">
        <ShellInner collapsed={false} theater={theater} />
      </div>
      {/* 边缘缩放热区只对无边框窗口（Windows）有效，macOS 走原生窗口边框 */}
      {platform === "windows" && !theater && !nativeFullscreen && <ResizeHandles />}
    </div>
  );
}

function ShellInner({ collapsed, theater }: { collapsed: boolean; theater: boolean }) {
  const { stack, pop, loginOpen, setLoginOpen, tab, setTab, platform, preview } = useStore();
  const mainRef = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(true);
  const visited = useVisitedTabs(tab);

  useLayoutEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWide(el.clientWidth > 640));
    ro.observe(el);
    setWide(el.clientWidth > 640);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (e.key === "Escape" && document.fullscreenElement) { e.preventDefault(); void document.exitFullscreen().catch(() => {}); return; }
      if (e.key === "Escape" && runBack()) { e.preventDefault(); return; }
      const t = e.target as HTMLElement;
      if (e.defaultPrevented || e.isComposing || t?.closest('[role="dialog"],[role="listbox"],[role="combobox"],[contenteditable="true"]')) return;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) {
        if (e.key === "Escape") t.blur();
        return;
      }
      if (loginOpen) { if (e.key === "Escape") setLoginOpen(false); return; }
      if (e.key === "Escape") { if (stack.length) pop(); return; }
      if (e.key === "/") { e.preventDefault(); setTab("search"); return; }
      if (["1", "2", "3", "4"].includes(e.key) && !e.repeat) {
        setTab((["watch", "home", "explore", "category"] as Tab[])[Number(e.key) - 1]);
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [stack.length, pop, setTab, loginOpen, setLoginOpen]);

  const vis = (k: Tab) => (tab === k ? "absolute inset-0" : "absolute inset-0 invisible pointer-events-none");
  const pageActive = stack.length === 0 && !loginOpen && !preview;

  return (
    <div className={`absolute inset-0 flex bg-canvas plat-${platform}`}>
      {!theater && <DesktopRail collapsed={collapsed} />}
      <div ref={mainRef} className="ref-main-column relative flex flex-col flex-1 min-w-0 overflow-hidden">
        {!theater && <DesktopTitleBar />}
        <div className="ref-main-content relative flex-1 min-h-0">
        <div className={vis("home")}><Home active={pageActive && tab === "home"} bottomInset={0} wide={wide} /></div>
        {visited("explore") && <div className={vis("explore")}><Explore active={pageActive && tab === "explore"} wide={wide} /></div>}
        {visited("watch") && <div className={vis("watch")}><Watch active={pageActive && tab === "watch"} bottomInset={0} /></div>}
        {visited("search") && <div className={vis("search")}><Search active={pageActive && tab === "search"} wide={wide} /></div>}
        {visited("category") && <div className={vis("category")}><Category wide={wide} /></div>}
        {visited("profile") && <div className={vis("profile")}><Profile wide={wide} /></div>}
        {stack.map((p, i) => (
          <div key={p.key} className="absolute inset-0 z-30 bg-bg win-page-in">
            <StackPage page={p} onBack={pop} wide={wide} top={i === stack.length - 1 && !loginOpen && !preview} bottomInset={14} />
          </div>
        ))}
        </div>
      </div>
    </div>
  );
}

/* ============ 移动端（无壳） ============ */
function MobileShell() {
  return (
    <div className="absolute inset-0 flex flex-col bg-canvas plat-android"
      style={{ "--sat": "max(env(safe-area-inset-top), 8px)", "--sab": "max(env(safe-area-inset-bottom), 6px)" } as React.CSSProperties}>
      <div className="relative flex-1 min-h-0">
        <AppBody />
      </div>
    </div>
  );
}

/* ============ 入口 ============ */
export default function App() {
  const { platform, loginOpen, setLoginOpen, tab, setTab, stack, pop, fs, setFs, preview, closePreview, theater, nativeFullscreen, exitImmersive } = useStore();
  const [browserFullscreen, setBrowserFullscreen] = useState(!!document.fullscreenElement);
  useEffect(() => {
    let wasFull = !!document.fullscreenElement;
    const sync = () => {
      const nowFull = !!document.fullscreenElement;
      setBrowserFullscreen(nowFull);
      if (wasFull && !nowFull) exitImmersive();
      wasFull = nowFull;
    };
    document.addEventListener("fullscreenchange", sync); return () => document.removeEventListener("fullscreenchange", sync);
  }, [exitImmersive]);
  useEffect(() => {
    document.documentElement.classList.toggle("hg-immersive", theater || nativeFullscreen || fs || browserFullscreen);
    return () => document.documentElement.classList.remove("hg-immersive");
  }, [theater, nativeFullscreen, fs, browserFullscreen]);
  // Capture before menu/dialog and player shortcuts: returning exits presentation, never the video page.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (isImmersiveBack(event) && exitImmersive()) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    const mouseBack = (event: MouseEvent) => { if (event.button === 3 && exitImmersive()) { event.preventDefault(); event.stopImmediatePropagation(); } };
    window.addEventListener("keydown", key, true); window.addEventListener("auxclick", mouseBack, true);
    return () => { window.removeEventListener("keydown", key, true); window.removeEventListener("auxclick", mouseBack, true); };
  }, [exitImmersive]);

  /* —— 安卓硬件返回键 ——
     层级：全屏 → 面板/弹层 → 登录框 → 页面栈 → 回首页 → 退出应用。
     不注册这个监听，Tauri 会直接 webView.goBack() 或退出，表现就是「任意页面返回都回桌面」。 */
  const backRef = useRef<() => void>(() => {});
  backRef.current = () => {
    if (exitImmersive()) return;
    if (runBack()) return;                                  // 播放器的选集/评论/图文面板
    if (preview) { closePreview(); return; }
    if (loginOpen) { setLoginOpen(false); return; }
    if (stack.length) { pop(); return; }
    if (tab !== "home") { setTab("home"); return; }
    invoke("plugin:app|exit", { code: 0 }).catch(() => {});
  };

  useEffect(() => {
    if (platform !== "android") return undefined;
    let disposed = false;
    let handle: { unregister: () => Promise<void> } | null = null;
    addPluginListener("app", "back-button", () => backRef.current())
      .then((l) => { if (disposed) l.unregister().catch(() => {}); else handle = l; })
      .catch(() => { /* 非安卓宿主忽略 */ });
    return () => {
      disposed = true;
      handle?.unregister().catch(() => {});
    };
  }, [platform]);

  useEffect(() => {
    const prevent = (e: Event) => e.preventDefault();
    document.addEventListener("contextmenu", prevent);
    return () => document.removeEventListener("contextmenu", prevent);
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV || !new URLSearchParams(location.search).has("selftest")) return;
    const t = window.setTimeout(() => {
      selfTest().then((r) => { invoke("debug_log", { msg: r }).catch(() => {}); }).catch(() => {});
    }, 2500);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <>
      {platform === "android" ? <MobileShell /> : <DesktopShell />}
      <LoginModal />
      <VideoPreview />
      <ToastHost />
      {/* 登录遮罩键盘处理占位 */}
      {loginOpen && <div className="hidden" onClick={() => setLoginOpen(false)} />}
    </>
  );
}
