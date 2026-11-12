import "../src/index.css";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, LOCAL } from "../src/api";
import { AppProvider, useStore } from "../src/store";
import { DEFAULT_PREFERENCES, normalizePreferences, PREFERENCES_KEY } from "../src/preferences";
import { createRecoveryBudget, createWheelGate, mergeUnique } from "../src/playback-policy";
import { useAsync, usePaged } from "../src/hooks";
import Feed from "../src/components/Feed";
import VideoSurface, { type VideoHandle } from "../src/components/VideoSurface";
import SelectMenu from "../src/components/SelectMenu";
import Search from "../src/pages/Search";
import type { Detail, PlayInfo, VideoCard } from "../src/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const checks: string[] = [];
function assert(value: unknown, label: string) { if (!value) throw new Error(label); checks.push(label); }
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const root = createRoot(document.querySelector("#fixture")!);
const render = async (view: React.ReactNode) => { await act(async () => root.render(view)); };
const clear = () => render(null);
const click = async (label: string) => {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.getAttribute("aria-label") === label || element.textContent === label);
  if (!button) throw new Error(`Missing button: ${label}`);
  await act(async () => button.click());
};
const originalApi = { boot: api.boot, video: api.video, play: api.play, search: api.search };
const originalPersist = localStorage.getItem("hghub_app_v1"), originalPreferences = localStorage.getItem(PREFERENCES_KEY);
const mediaPrototype = HTMLMediaElement.prototype;
const mediaKeys = ["src", "currentTime", "duration", "paused", "play", "pause", "load", "hasAttribute", "removeAttribute"];
const originalMedia = new Map(mediaKeys.map((key) => [key, Object.getOwnPropertyDescriptor(mediaPrototype, key)]));
const sources = new WeakMap<HTMLMediaElement, string>(), seconds = new WeakMap<HTMLMediaElement, number>(), isPaused = new WeakMap<HTMLMediaElement, boolean>();
let playCount = 0;
const nativeHas = Element.prototype.hasAttribute, nativeRemove = Element.prototype.removeAttribute;
Object.defineProperties(mediaPrototype, {
  src: { configurable: true, get() { return sources.get(this) || ""; }, set(value: string) {
    sources.set(this, value); queueMicrotask(() => { if (sources.get(this) === value) { this.dispatchEvent(new Event("loadedmetadata")); this.dispatchEvent(new Event("loadeddata")); } });
  } },
  currentTime: { configurable: true, get() { return seconds.get(this) || 0; }, set(value: number) { seconds.set(this, value); } },
  duration: { configurable: true, get() { return 120; } },
  paused: { configurable: true, get() { return isPaused.get(this) !== false; } },
  play: { configurable: true, value() { ++playCount; isPaused.set(this, false); this.dispatchEvent(new Event("playing")); return Promise.resolve(); } },
  pause: { configurable: true, value() { const playing = isPaused.get(this) === false; isPaused.set(this, true); if (playing) this.dispatchEvent(new Event("pause")); } },
  load: { configurable: true, value() {} },
  hasAttribute: { configurable: true, value(name: string) { return name === "src" ? sources.has(this) : nativeHas.call(this, name); } },
  removeAttribute: { configurable: true, value(name: string) { if (name === "src") sources.delete(this); else nativeRemove.call(this, name); } },
});
const card = (id: number, title = `作品 ${id}`) => ({ id, title, cover: "", tags: ["冒险"], episode_count: 3, score: 9 } as VideoCard);
const detail = (id: number) => ({ ...card(id), description: "测试简介", counts: { collect: 0, comment: 0, hot: 0, like: 0 }, author: { id: 1, name: "测试作者" }, episodes: [1, 2, 3].map((ep_num) => ({ ep_num, title: `第 ${ep_num} 集`, duration: 120, status: 1 })) } as Detail);
const info = (id: number, ep = 1): PlayInfo => ({ id, ep_num: ep, title: "fixture", duration: 120, video_url: `${LOCAL}/seg?u=https%3A%2F%2Fcdn.example%2F${id}-${ep}.mp4` });

try {
  api.boot = async () => ({ user: null, logged_in: false, base: "https://huangguoai.com", strict_security: true });
  api.video = async (id) => detail(id);
  assert(normalizePreferences(null).autoNext === DEFAULT_PREFERENCES.autoNext, "old installs receive playback defaults");
  const normalized = normalizePreferences({ defaultRate: 999, autoplay: "false", enhancedBuffer: false, catalogLayout: "list" });
  assert(normalized.defaultRate === 1 && normalized.autoplay && !normalized.enhancedBuffer && normalized.catalogLayout === "list", "invalid preferences cannot replace valid defaults");
  assert(mergeUnique([{ id: 1 }], [{ id: 1 }, { id: 2 }, { id: 2 }]).length === 2, "duplicates are removed within and across pages");
  const gate = createWheelGate();
  assert(gate(40, 0) === 0 && gate(40, 20) === 1, "wheel requires deliberate movement");
  assert(gate(150, 80) === 0 && gate(30, 180) === 0, "wheel inertia cannot skip multiple videos");
  assert(gate(80, 450) === 1 && gate(-80, 470) === -1, "new gestures and reversed gestures work");
  assert(gate(100, 800, true) === 0 && gate(100, 850) === 0, "scrolling a panel consumes that gesture");
  const budget = createRecoveryBudget();
  assert(budget.take() && budget.take() && !budget.take(), "automatic recovery stops after two attempts");
  budget.progress(0); budget.progress(100); assert(!budget.take(), "a seek cannot refill recovery budget");
  for (let time = 101; time <= 116; time++) budget.progress(time);
  assert(budget.take(), "sustained playback refills recovery budget");

  let paged!: ReturnType<typeof usePaged<{ id: number }>>;
  const a = deferred<{ items: { id: number }[]; pagination: { pages: number } }>(), b = deferred<{ items: { id: number }[]; pagination: { pages: number } }>();
  const calls: string[] = [];
  const second = deferred<{ items: { id: number }[]; pagination: { pages: number } }>();
  function PagedProbe({ group }: { group: string }) {
    paged = usePaged((page) => { calls.push(`${group}:${page}`); return page > 1 ? second.promise : group === "a" ? a.promise : b.promise; }, [group]); return null;
  }
  await render(<PagedProbe group="a" />); await render(<PagedProbe group="b" />);
  await act(async () => a.resolve({ items: [{ id: 1 }], pagination: { pages: 3 } }));
  assert(paged.loading && !paged.items.length, "late previous category cannot replace current results or loading state");
  await act(async () => b.resolve({ items: [{ id: 2 }, { id: 2 }], pagination: { pages: 3 } }));
  assert(paged.items.length === 1 && paged.items[0].id === 2, "current page publishes unique records");
  await act(async () => { void paged.loadMore(); void paged.loadMore(); });
  assert(calls.filter((value) => value === "b:2").length === 1, "overlapping pagination requests share the same request");
  await act(async () => second.resolve({ items: [], pagination: { pages: 3 } }));
  assert(!paged.hasMore && !paged.loading, "an empty page stops endless pagination");
  await clear();

  let asynchronous!: ReturnType<typeof useAsync<number>>;
  const old = deferred<number>(), current = deferred<number>();
  function AsyncProbe({ group }: { group: number }) { asynchronous = useAsync(() => group === 1 ? old.promise : current.promise, [group]); return null; }
  await render(<AsyncProbe group={1} />); await render(<AsyncProbe group={2} />);
  await act(async () => current.resolve(2)); await act(async () => old.reject(new Error("old failure")));
  assert(asynchronous.data === 2 && !asynchronous.error && !asynchronous.loading, "stale detail errors cannot overwrite a newer successful response");
  await clear();

  localStorage.setItem("hghub_app_v1", JSON.stringify({ likes: [9], favs: [8, ...Array.from({ length: 2001 }, (_, index) => 10000 + index)], volume: .4, muted: false, history: [] }));
  localStorage.removeItem(PREFERENCES_KEY);
  let store!: ReturnType<typeof useStore>;
  function StoreProbe() { store = useStore(); return null; }
  await render(<AppProvider><StoreProbe /></AppProvider>);
  assert(store.favs.includes(8) && store.volume === .4 && !store.muted, "new preferences preserve existing collection and audio state");
  assert(store.favs.length === 2002 && store.favs.includes(12000), "large existing collections are never silently truncated");
  let toggled = false;
  await act(async () => { toggled = store.toggleFavLocal(7); });
  assert(toggled && store.isFav(7), "collection returns the actual new state immediately");
  await act(async () => { toggled = store.toggleFavLocal(7); });
  assert(!toggled && !store.isFav(7), "collection removal returns false instead of a stale result");
  await act(async () => { store.addHistory(1, 1, 30, 120); store.addHistory(1, 2, 15, 120); });
  assert(store.history[0].ep === 2 && store.history[0].t === 15, "saving another episode preserves its explicit position");
  await act(async () => store.setPreferences({ defaultRate: 1.5, catalogLayout: "list", autoNext: false }));
  assert(JSON.parse(localStorage.getItem(PREFERENCES_KEY)!).defaultRate === 1.5, "validated playback preferences persist");
  await act(async () => store.push({ kind: "feed", videoIds: [1], index: 0, title: "fixture" }));
  assert(store.preview?.videoIds[0] === 1 && !store.stack.length, "catalog navigation previews details before playback");
  await act(async () => store.startPreview(2, 15));
  assert(!store.preview && store.stack[0]?.kind === "feed" && store.stack[0].startTime === 15, "preview starts the selected episode at its resume position");
  await clear();

  const handle = React.createRef<VideoHandle>(); let setIntent!: (intent: boolean) => void;
  function SurfaceProbe({ active }: { active: boolean }) { const [wanted, update] = useState(true); setIntent = update; return <VideoSurface ref={handle} src={info(1).video_url} active={active} autoPlay={wanted} onIntent={update} />; }
  playCount = 0;
  await render(<SurfaceProbe active={false} />);
  assert(playCount === 0, "an inactive page never starts after source resolution");
  await render(<SurfaceProbe active />); assert(playCount > 0, "returning to an active page resumes intended playback");
  await act(async () => handle.current!.pause()); const afterPause = playCount;
  await render(<SurfaceProbe active={false} />); await render(<SurfaceProbe active />);
  assert(playCount === afterPause && handle.current!.el()!.paused, "manual pause survives navigation away and back");
  await act(async () => setIntent(true)); assert(playCount > afterPause, "explicit play resumes a manually paused video");
  const previousVideo = handle.current!.el()!; await clear();
  assert(!sources.has(previousVideo), "teardown releases media sources and pending work");

  const searchCalls: string[] = [], searches = new Map<string, ReturnType<typeof deferred<Awaited<ReturnType<typeof api.search>>>>>();
  api.search = (query) => { searchCalls.push(query); const request = deferred<Awaited<ReturnType<typeof api.search>>>(); searches.set(query, request); return request.promise; };
  await render(<AppProvider><Search active wide /></AppProvider>);
  const input = document.querySelector<HTMLInputElement>('input[aria-label="搜索关键词"]')!;
  const setInput = async (value: string) => { await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true }));
  }); };
  await setInput("输入法");
  await act(async () => { input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })); input.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  assert(!searchCalls.length, "IME confirmation cannot submit a partial search");
  await act(async () => input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
  await setInput("甲"); await act(async () => input.form!.requestSubmit());
  await setInput("乙"); await act(async () => input.form!.requestSubmit());
  assert(searchCalls.join(",") === "甲,乙", "a new query is not blocked behind an old pending request");
  await act(async () => searches.get("乙")!.resolve({ items: [card(2, "当前结果")], pagination: { page: 1, pages: 1, size: 20, total: 1 }, keyword: "乙" }));
  await act(async () => searches.get("甲")!.resolve({ items: [card(1, "过时结果")], pagination: { page: 1, pages: 1, size: 20, total: 1 }, keyword: "甲" }));
  assert(document.body.textContent?.includes("当前结果") && !document.body.textContent?.includes("过时结果"), "search results always belong to the latest query");
  await click("详细列表"); assert(!!document.querySelector(".hg-catalog-list"), "catalog can switch to a readable list");
  await click("封面网格"); assert(!document.querySelector(".hg-catalog-list"), "catalog can return to its original grid");
  await setInput("丙"); await act(async () => input.form!.requestSubmit()); await click("清空搜索");
  await act(async () => searches.get("丙")!.resolve({ items: [card(3, "已清空结果")], pagination: { page: 1, pages: 1, size: 20, total: 1 }, keyword: "丙" }));
  assert(!document.body.textContent?.includes("已清空结果"), "clearing search invalidates an outstanding request");
  await clear();

  await render(<div style={{paddingTop:800,paddingBottom:800}}><SelectMenu label="首次打开验证" value="25" options={Array.from({length:30},(_,i)=>({value:String(i),label:`选项 ${i}`}))} onChange={()=>{}} /></div>);
  window.scrollTo(0,650);
  await act(async () => { await new Promise(resolve=>setTimeout(resolve,30)); });
  const originalScroll = window.scrollY;
  await click("首次打开验证");
  await act(async () => { await new Promise(resolve=>setTimeout(resolve,40)); });
  assert(!!document.querySelector('[role="listbox"]') && window.scrollY === originalScroll, "first opening a long select keeps its listbox open without scrolling the surrounding page");
  assert(document.querySelector<HTMLElement>('[role="listbox"]')!.scrollTop > 0, "the selected option scrolls inside the popup only");
  await act(async () => window.dispatchEvent(new Event("blur")));
  assert(!document.querySelector('[role="listbox"]'), "window blur still dismisses the popup");
  await clear(); window.scrollTo(0,0);
  let selected = "1";
  await render(<SelectMenu label="测试菜单" value={selected} options={[{ value: "1", label: "正常" }, { value: "2", label: "两倍" }]} onChange={(value) => { selected = value; }} />);
  await click("测试菜单"); assert(!!document.querySelector('[role="listbox"]'), "shared select opens an accessible listbox");
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  assert(selected === "2" && !document.querySelector('[role="listbox"]'), "select supports arrow keys and Enter");
  await clear();

  localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ autoplay: true, autoNext: false }));
  let playbackCalls = 0;
  api.play = async (id, ep) => { ++playbackCalls; return info(id, ep); };
  await render(<AppProvider><Feed videoIds={[12]} mode="home" active bottomInset={0} /></AppProvider>);
  assert(playbackCalls === 1, "feed performs one initial playback request");
  const errorVideo = async () => { await act(async () => {
    const video = document.querySelector("video")!;
    Object.defineProperty(video, "error", { configurable: true, value: { code: 2 } }); video.dispatchEvent(new Event("error"));
  }); };
  await act(async () => { document.querySelector("video")!.currentTime = 10; document.querySelector("video")!.dispatchEvent(new Event("timeupdate")); });
  await errorVideo(); assert(playbackCalls === 2 && document.querySelector("video")!.currentTime === 10, "media failure renews its address and resumes at the saved position");
  await errorVideo(); await errorVideo();
  assert(playbackCalls === 3 && document.body.textContent?.includes("视频暂时无法加载"), "repeated media failures stop at the recovery budget");
  await click("重试"); assert(playbackCalls === 4, "manual retry resets the recovery budget");
  await act(async () => document.querySelector("video")!.dispatchEvent(new Event("ended")));
  assert(playbackCalls === 4, "disabling automatic next episode stops at the current episode");
  await click("下一集 E"); assert(playbackCalls === 5, "explicit next episode works when automatic next is disabled");
  await click("上一集"); assert(playbackCalls === 6, "previous episode reloads a fresh signed address");

  document.querySelector("#results")!.textContent = JSON.stringify({ passed: checks.length, failed: 0, checks });
} catch (error) {
  document.querySelector("#results")!.textContent = JSON.stringify({ passed: checks.length, failed: 1, error: String(error), checks });
} finally {
  await act(async () => root.unmount());
  Object.assign(api, originalApi);
  for (const [key, descriptor] of originalMedia) { if (descriptor) Object.defineProperty(mediaPrototype, key, descriptor); else Reflect.deleteProperty(mediaPrototype, key); }
  if (originalPersist === null) localStorage.removeItem("hghub_app_v1"); else localStorage.setItem("hghub_app_v1", originalPersist);
  if (originalPreferences === null) localStorage.removeItem(PREFERENCES_KEY); else localStorage.setItem(PREFERENCES_KEY, originalPreferences);
}
