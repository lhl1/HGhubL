import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useStore } from "../store";
import { APP_VERSION } from "../api";
import { IClock, IClose, IGrid, IHeart, IHome, IMinus, IPlayF, IRestore, ISearch, ISettings, ISquare, ITrophy, Logo } from "../icons";

export function DesktopTitleBar() {
  const { tab, stack, requestSearch, platform, homeChannel, setHomeChannel, libraryTab, searchQuery } = useStore();
  const [query, setQuery] = useState(searchQuery), [composing, setComposing] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const top = stack.at(-1);
  const title = top?.kind === "settings" ? "设置" : top?.kind === "ranks" ? "排行榜" : top?.kind === "feed" ? top.title || "正在播放"
    : top?.kind === "channel" ? top.name : top?.kind === "topic" || top?.kind === "tag" ? top.title : top?.kind === "posts" || top?.kind === "post" ? "图文社区"
      : tab === "explore" ? "探索" : tab === "category" ? "分类" : tab === "profile" ? libraryTab === "history" ? "观看记录" : "我的追剧" : tab === "search" ? "搜索短剧" : "首页";
  useEffect(() => setQuery(searchQuery), [searchQuery]);
  useEffect(() => {
    let alive = true, unlisten: (() => void) | undefined;
    const window = getCurrentWindow();
    const sync = () => {
      void window.isMaximized().then((value) => { if (alive) setMaximized(value); }).catch(() => {});
    };
    sync(); void window.onResized(sync).then((off) => { if (alive) unlisten = off; else off(); }).catch(() => {});
    return () => { alive = false; unlisten?.(); };
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("ref-maximized", maximized);
    return () => { document.documentElement.classList.remove("ref-maximized"); };
  }, [maximized]);
  const isBlank = (target: EventTarget | null) => target instanceof HTMLElement && !target.closest("button,input,form,select,a,[role='combobox']");
  return <>
    {platform !== "macos" && <div className="ref-window-actions" aria-label="窗口操作">
      <button aria-label="最小化" onClick={() => void getCurrentWindow().minimize().catch(() => {})}><IMinus size={16} /></button>
      <button aria-label={maximized ? "还原窗口" : "最大化"} onClick={() => void getCurrentWindow().toggleMaximize().catch(() => {})}>{maximized ? <IRestore size={14} /> : <ISquare size={14} />}</button>
      <button className="ref-window-close" aria-label="关闭窗口" onClick={() => void getCurrentWindow().close().catch(() => {})}><IClose size={16} /></button>
    </div>}
    <header className="ref-toolbar" data-testid="window-toolbar"
      onPointerDown={(event) => { if (event.button === 0 && event.detail < 2 && isBlank(event.target)) void getCurrentWindow().startDragging().catch(() => {}); }}
      onDoubleClick={(event) => { if (isBlank(event.target)) void getCurrentWindow().toggleMaximize().catch(() => {}); }}>
      {tab === "watch" && !top ? <div className="ref-category-tabs" role="group" aria-label="放映频道">
        {[{ value: "", label: "推荐" }, { value: "ai-duanju", label: "短剧" }, { value: "ai-manju", label: "漫剧" }].map((channel) => <button key={channel.value} aria-pressed={homeChannel === channel.value} onClick={() => setHomeChannel(channel.value)}>{channel.label}</button>)}
      </div> : <h1>{title}</h1>}
      <div className="ref-window-drag-region" aria-hidden="true" />
      <form className="ref-search-form" role="search" onSubmit={(event) => { event.preventDefault(); if (!composing) requestSearch(query); }}>
        <ISearch size={17} /><input aria-label="顶部搜索关键词" placeholder="搜索剧名或关键词" value={query} maxLength={100}
          onChange={(event) => setQuery(event.target.value)} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
          onKeyDown={(event) => { if (event.key === "Enter" && (composing || event.nativeEvent.isComposing)) event.preventDefault(); }} />
        <button type="submit">搜索</button>
      </form>
    </header>
  </>;
}

export function DesktopRail({ collapsed = false }: { collapsed?: boolean }) {
  const { tab, setTab, stack, push, libraryTab, setLibraryTab, platform, homeChannel, setHomeChannel } = useStore();
  const top = stack.at(-1), page = top?.kind === "ranks" ? "ranks" : top?.kind === "settings" ? "settings" : stack.length ? "context" : tab === "profile" ? libraryTab : tab;
  const navigate = (target: string) => {
    if (target === "ranks" || target === "settings") { if (page !== target) { setTab("home"); push({ kind: target }); } }
    else if (target === "fav" || target === "history") { setLibraryTab(target); setTab("profile"); }
    else setTab(target as "home" | "explore" | "watch" | "category");
  };
  return <aside className={`ref-rail ${collapsed ? "is-compact" : ""}`}>
    <button className="ref-brand" onClick={() => setTab("home")} aria-label="HGhub 首页"><Logo size={38} className="ref-brand-mark" /><span className="ref-brand-copy"><span className="ref-brand-word"><b>HG</b><span>hub</span></span></span></button>
    <nav aria-label="主导航">{[{ value: "watch", label: "放映", icon: IPlayF }, { value: "home", label: "首页", icon: IHome }, { value: "explore", label: "探索", icon: ISearch }, { value: "ranks", label: "排行榜", icon: ITrophy }, { value: "category", label: "分类", icon: IGrid }, { value: "fav", label: "追剧", icon: IHeart }, { value: "history", label: "记录", icon: IClock }].map((item) => <button key={item.value}
      aria-current={page === item.value || item.value === "category" && page === "search" ? "page" : undefined}
      onClick={() => navigate(item.value)} className="ref-nav-button"><item.icon size={21} /><span>{item.label}</span></button>)}</nav>
    <div className="ref-rail-bottom"><button className="ref-nav-button" aria-current={page === "settings" ? "page" : undefined} onClick={() => navigate("settings")}><ISettings size={21} /><span>设置</span></button>
      <small>{platform === "macos" ? "macOS" : "Windows"} · {APP_VERSION}</small></div>
  </aside>;
}
