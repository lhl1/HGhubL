import React, { act } from "react";
import { createRoot } from "react-dom/client";
import App from "../src/App";
import { api, LOCAL } from "../src/api";
import { AppProvider, useStore } from "../src/store";
import { PREFERENCES_KEY } from "../src/preferences";
import { IMMERSIVE_HIDE_MS } from "../src/immersive";
import { ratingSummary } from "../src/ratings";
import "../src/index.css";
import "../src/reference.css";

// Offline media and native-window stubs exercise the actual App and Feed components.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const checks: string[] = [];
const assert = (value: unknown, label: string) => { if (!value) throw new Error(label); checks.push(label); };
const root = createRoot(document.querySelector("#fixture")!);
let store!: ReturnType<typeof useStore>;
function Probe() { store = useStore(); return null; }
const nativeCommands: { command: string; args: Record<string, unknown> }[] = [];
Object.assign(window, { __TAURI_INTERNALS__: { metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
  invoke: async (command: string, args: Record<string, unknown>) => { nativeCommands.push({ command, args }); return command.includes("is_") ? false : 1; }, transformCallback: () => 1, unregisterCallback() {} } });
let fullscreen: Element | null = null;
Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fullscreen });
Element.prototype.requestFullscreen = async function () {
  fullscreen = this; (this as HTMLElement).style.height = "960px";
  this.querySelector(".snap-y")?.dispatchEvent(new Event("scroll", { bubbles: false }));
  document.dispatchEvent(new Event("fullscreenchange"));
};
document.exitFullscreen = async () => {
  const previous = fullscreen; fullscreen = null;
  if (previous instanceof HTMLElement) { previous.style.height = ""; previous.querySelector(".snap-y")?.dispatchEvent(new Event("scroll", { bubbles: false })); }
  document.dispatchEvent(new Event("fullscreenchange"));
};
const sources = new WeakMap<HTMLMediaElement, string>(), seconds = new WeakMap<HTMLMediaElement, number>(), paused = new WeakMap<HTMLMediaElement, boolean>();
const nativeHas = Element.prototype.hasAttribute, nativeRemove = Element.prototype.removeAttribute;
Object.defineProperties(HTMLMediaElement.prototype, {
  src: { configurable: true, get() { return sources.get(this) || ""; }, set(value: string) {
    sources.set(this, value); queueMicrotask(() => { if (sources.get(this) === value) { this.dispatchEvent(new Event("loadedmetadata")); this.dispatchEvent(new Event("loadeddata")); } });
  } },
  currentTime: { configurable: true, get() { return seconds.get(this) || 0; }, set(value: number) { seconds.set(this, value); } },
  duration: { configurable: true, get: () => 120 }, paused: { configurable: true, get() { return paused.get(this) !== false; } },
  play: { configurable: true, value() { paused.set(this, false); this.dispatchEvent(new Event("playing")); return Promise.resolve(); } },
  pause: { configurable: true, value() { const playing = paused.get(this) === false; paused.set(this, true); if (playing) this.dispatchEvent(new Event("pause")); } },
  load: { configurable: true, value() {} },
  hasAttribute: { configurable: true, value(name: string) { return name === "src" ? sources.has(this) : nativeHas.call(this, name); } },
  removeAttribute: { configurable: true, value(name: string) { if (name === "src") sources.delete(this); else nativeRemove.call(this, name); } },
});
localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ autoplay: false }));
localStorage.setItem("hghub_theme_policy", "system-v1");
localStorage.setItem("hghub_theme", new URLSearchParams(location.search).get("theme") || "dark");
api.boot = async () => ({ user: null, logged_in: false, base: "https://huangguoai.com", strict_security: true });
api.feed = async () => ({ items: [], pagination: { page: 1, pages: 1, size: 10, total: 0 } });
api.video = async (id) => ({ id, title: "离线界面验证", cover: "", description: "离线模拟媒体", tags: [], score: 9, episode_count: 3, total_episodes: 3, is_finished: true, is_original: 1, author: { id: 1, name: "测试作者" }, counts: { collect: 0, comment: 0, hot: 0, like: 0 },
  episodes: [1, 2, 3].map((ep_num) => ({ ep_num, title: `第 ${ep_num} 集`, duration: 120, status: 1 })) });
api.rating = async () => ({ score: "9.6", rating_cnt: 154 });
let requests = 0;
const playRequests: { id: number; ep: number }[] = [];
api.play = async (id, ep_num) => { ++requests; playRequests.push({ id, ep: ep_num }); return { id, ep_num, title: "fixture", duration: 120, video_url: `${LOCAL}/seg?u=https%3A%2F%2Fcdn.example%2F${id}-${ep_num}.mp4` }; };
const click = async (label: string) => {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((element) => !element.closest("[inert]") && (element.getAttribute("aria-label") === label || element.textContent === label));
  if (!button) throw new Error(`Missing control: ${label}`);
  await act(async () => button.click());
  if (label === "全屏") await act(async()=>new Promise<void>(resolve=>setTimeout(resolve,220)));
};
const player = () => [...document.querySelectorAll<HTMLElement>(".player-root")].at(-1)!;
const controls = () => player().querySelector<HTMLElement>(".desktop-controls")!;
const key = async (name: string, options: KeyboardEventInit = {}, target: EventTarget = document.body) => {
  await act(async () => target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: name, ...options })));
};
const move = async (x: number, y = 400) => {
  await act(async () => player().dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: x, clientY: y })));
};
const waitHide = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, IMMERSIVE_HIDE_MS + 100)); }); };
const enter = () => click("全屏窗口");
const hidden = () => controls().inert && getComputedStyle(controls()).visibility === "hidden";
try {
  await act(async () => root.render(<AppProvider><Probe /><App /></AppProvider>));
  await act(async () => store.push({ kind: "feed", videoIds: [10, 11, 12, 13, 14], index: 2, title: "离线测试", startEp: 2 }));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
  document.querySelectorAll(".win-page-in").forEach((element) => element.getAnimations().forEach((animation) => animation.finish()));
  const originalVideo = player().querySelector("video")!;
  const playerBox = player().getBoundingClientRect(), contentBox = document.querySelector(".ref-main-content")!.getBoundingClientRect();
  assert(playerBox.x === contentBox.x && playerBox.y === contentBox.y && playerBox.width === contentBox.width && playerBox.height === contentBox.height, "ordinary playback fills the entire available desktop content area");
  assert(getComputedStyle(player()).clipPath === "none" && getComputedStyle(originalVideo).borderRadius === "0px" && getComputedStyle(player(), "::after").display === "none", "ordinary playback also removes inner clipping and decorative borders");
  assert(getComputedStyle(originalVideo).transform === "none" && getComputedStyle(player()).willChange === "auto" && getComputedStyle(player().closest(".player-stack-page")!).animationName === "none", "presentation uses a stable unanimated playback page without redundant forced layers");
  await key("t", {repeat:true}); await key("f", {repeat:true});
  assert(!store.theater && !document.fullscreenElement, "held fullscreen shortcuts cannot repeatedly toggle presentation");
  assert(!!originalVideo && requests === 1, "context player loads one media source");
  originalVideo.currentTime = 37;
  await act(async () => originalVideo.dispatchEvent(new Event("timeupdate")));
  const pageKey = store.stack.at(-1)?.key;
  await enter();
  assert(store.theater && player().classList.contains("is-immersive") && hidden(), "entering window immersive mode immediately hides controls");
  assert(!player().querySelector(".desktop-context-header,.desktop-social,.desktop-video-meta,.player-pause-overlay"), "immersive mode removes both top corners, social tools, metadata and pause badge");
  assert(!document.querySelector(".ref-toolbar,.ref-window-actions,.ref-rail,.win-resize"), "window immersive mode removes native toolbar, rail and resize hotspots");
  assert(!player().querySelector(".player-info-shade"), "immersive mode has no information gradient layer");
  assert(getComputedStyle(player()).cursor === "none", "idle immersive mode hides the cursor");
  assert(getComputedStyle(player()).clipPath === "none" && getComputedStyle(originalVideo).borderRadius === "0px" && getComputedStyle(player(), "::after").display === "none", "immersive video removes rounded clipping and decorative edge borders");
  assert(player().querySelector("video") === originalVideo && originalVideo.currentTime === 37 && originalVideo.paused && requests === 1, "presentation changes preserve the media element, source, time and manual pause");
  await move(100); await move(102);
  assert(hidden(), "initial and tiny pointer movements do not reveal chrome");
  await move(104); await move(106);
  assert(!hidden(), "slow cumulative pointer movement still reveals controls");
  await move(120);
  assert(!hidden() && !controls().inert, "deliberate pointer movement reveals usable bottom controls");
  const cornerBack = player().querySelector<HTMLElement>('.player-immersive-back')!;
  const cornerBounds = cornerBack.getBoundingClientRect(), immersiveBounds = player().getBoundingClientRect();
  assert(getComputedStyle(cornerBack).visibility === "visible" && cornerBounds.left - immersiveBounds.left === 16 && cornerBounds.top - immersiveBounds.top === 16 && !controls().querySelector('[aria-label="返回普通窗口"]'), "window immersive return lives at the upper-left instead of the playback bar");
  await waitHide();
  assert(getComputedStyle(cornerBack).visibility === "hidden" && cornerBack.inert, "upper-left return auto-hides and becomes inert with the playback controls");
  assert(hidden() && originalVideo.paused, "paused immersive video still auto-hides controls after 1.2 seconds");
  await move(135);
  await act(async () => player().querySelector('[aria-label="播放进度"]')!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
  await waitHide();
  assert(!hidden(), "active timeline dragging keeps the controls available");
  await act(async () => window.dispatchEvent(new PointerEvent("pointerup")));
  await waitHide();
  assert(hidden(), "releasing a timeline drag restarts immersive auto-hide");
  await move(150);
  await click("倍速");
  await waitHide();
  assert(!hidden() && !!document.querySelector('[role="listbox"]'), "an open speed menu stays usable through the idle timeout");
  await key("Escape", {}, document.querySelector('[role="combobox"]')!);
  assert(!store.theater && !document.querySelector('[role="listbox"]') && store.stack.at(-1)?.key === pageKey, "Escape with a focused speed menu exits immersive mode and keeps the player page");
  assert(document.querySelector(".ref-toolbar") && player().querySelector(".desktop-context-header") && !hidden(), "returning restores normal window chrome");
  await enter(); await move(100); await move(130); await click("返回普通窗口");
  assert(!store.theater && store.stack.at(-1)?.key === pageKey, "upper-left return exits window immersive mode without navigating away");
  await enter(); await key("ArrowLeft", { altKey: true });
  assert(!store.theater && store.stack.at(-1)?.key === pageKey, "Alt Left returns to the ordinary window");
  await enter();
  await act(async () => window.dispatchEvent(new MouseEvent("auxclick", { button: 3, cancelable: true })));
  assert(!store.theater && store.stack.at(-1)?.key === pageKey, "mouse back exits immersive mode before page navigation");
  await enter(); await key("BrowserBack");
  assert(!store.theater && store.stack.at(-1)?.key === pageKey, "browser back key exits immersive mode");
  await enter();
  const input = document.createElement("input"); document.body.append(input);
  await key("Backspace", {}, input);
  assert(store.theater, "Backspace in editable fields does not leave immersive mode");
  input.remove(); await key("Backspace");
  assert(!store.theater && store.stack.at(-1)?.key === pageKey, "Backspace outside editable fields returns to the ordinary window");
  await click("全屏");
  assert(fullscreen === player() && hidden(), "DOM fullscreen enters with immediately hidden controls");
  assert(player().querySelector("video") === originalVideo && requests === 1 && originalVideo.currentTime === 37 && playRequests[0].id === 12 && playRequests[0].ep === 2, "fullscreen viewport growth cannot change a non-first video or reload its episode");
  await move(100); await move(140); await click("返回普通窗口");
  assert(!fullscreen && !store.theater && store.stack.at(-1)?.key === pageKey, "return button exits DOM fullscreen and retains the video page");
  await enter(); await move(100); await move(140); await click("全屏");
  await act(async () => document.exitFullscreen());
  assert(!store.theater && !fullscreen, "browser-driven fullscreen exit also clears window immersive mode");
  await act(async () => store.setNativeFullscreen(true));
  assert(hidden() && !player().querySelector(".desktop-context-header,.desktop-social"), "native fullscreen also removes top corner elements");
  await key("Escape");
  assert(!store.nativeFullscreen && nativeCommands.some((call) => call.command.endsWith("set_fullscreen") && call.args.value === false), "return from native fullscreen calls the native exit API");
  await enter(); await move(100); await move(140);
  await act(async () => window.dispatchEvent(new Event("blur")));
  assert(hidden(), "window blur immediately hides immersive controls");
  await act(async () => store.toast("后台通知", "info"));
  assert(getComputedStyle(document.querySelector(".hg-toast-host")!).display === "none", "background toasts do not interrupt immersive video");
  assert(player().querySelector("video") === originalVideo && originalVideo.currentTime === 37 && requests === 1, "all fullscreen and return transitions preserve playback state");
  const preview = new URLSearchParams(location.search).get("preview");
  if (preview) {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    document.querySelector<HTMLElement>("#results")!.style.display = "none";
    originalVideo.style.background = "radial-gradient(ellipse at 70% 30%, #64788a, #203c4a 50%, #101e30)";
    if (preview === "black") {
      await act(async () => { store.exitImmersive(); });
      Object.assign(originalVideo.style, { width: "60%", height: "56%", position: "absolute", left: "20%", top: "12%" });
      await act(async () => player().querySelector('[aria-label="播放进度"]')!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    }
    if (preview === "normal") await act(async () => { store.exitImmersive(); });
    if (preview === "episodes" || preview === "rating") {
      await act(async () => { store.exitImmersive(); });
      await click(preview === "episodes" ? "选集" : "评分");
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
      const popup = document.querySelector<HTMLElement>(".player-popover");
      document.querySelector("#results")!.textContent = JSON.stringify({ popup: popup?.getBoundingClientRect(), style: popup ? { display: getComputedStyle(popup).display, visibility: getComputedStyle(popup).visibility, opacity: getComputedStyle(popup).opacity, zIndex: getComputedStyle(popup).zIndex } : null, parent: popup?.parentElement?.tagName, player: player().getBoundingClientRect(), scroll: player().querySelector(".player-feed-viewport")?.scrollTop });
    }
    if (preview === "controls") {
      await move(100); await move(150);
      await act(async () => player().querySelector('[aria-label="播放进度"]')!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    }
  } else {
    await act(async () => { store.exitImmersive(); });
    await click("播放");
    originalVideo.currentTime = 73;
    await act(async () => { originalVideo.dispatchEvent(new Event("timeupdate")); store.setVolume(.42); store.setPreferences({ defaultRate: 1.5 }); });
    for (let repeat = 0; repeat < 3; ++repeat) {
      await click("全屏");
      await act(async () => document.exitFullscreen());
    }
    assert(player().querySelector("video") === originalVideo && requests === 1 && originalVideo.currentTime === 73 && !originalVideo.paused, "repeated fullscreen transitions retain the playing video and its progress without refreshing");
    assert(originalVideo.playbackRate === 1.5 && originalVideo.volume === .42, "fullscreen transitions retain speed and volume");
    const scroller = player().querySelector<HTMLElement>(".player-feed-viewport")!;
    await act(async () => { player().style.height = "720px"; scroller.dispatchEvent(new Event("scroll")); window.dispatchEvent(new Event("resize")); });
    assert(player().querySelector("video") === originalVideo && requests === 1 && originalVideo.currentTime === 73, "window resizing cannot turn layout-generated scrolling into a video change");
    await act(async () => { player().style.height = ""; window.dispatchEvent(new Event("resize")); });
    await act(async () => {
      scroller.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      scroller.scrollTop = 3 * scroller.clientHeight;
      scroller.dispatchEvent(new Event("scroll"));
    });
    assert(requests === 2 && playRequests.at(-1)?.id === 13 && playRequests.at(-1)?.ep === 1, "deliberate video navigation still works after fullscreen and resize stabilization");
    const baseCount = requests, currentVideo = player().querySelector("video")!, initialWidth = player().getBoundingClientRect().width;
    assert(!player().querySelector(".desktop-social")?.textContent?.includes("选集") && !!controls().querySelector('[aria-label="选集"]'), "episodes move from the right social rail into the playback bar");
    await click("选集");
    assert(!!document.querySelector('[role="dialog"][aria-label="选集"]') && document.querySelector('[data-episode="1"]')?.getAttribute("aria-current") === "true", "playback bar opens a selector highlighting the current episode");
    assert(player().getBoundingClientRect().width === initialWidth && requests === baseCount && player().querySelector("video") === currentVideo, "opening episodes never shrinks the viewport or reloads media");
    const episodeInput = document.querySelector<HTMLInputElement>('[aria-label="查找集数"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(episodeInput, "3"); episodeInput.dispatchEvent(new Event("input", { bubbles: true })); });
    assert(document.querySelectorAll("[data-episode]").length === 1 && !!document.querySelector('[data-episode="3"]'), "episode search filters by the actual episode number");
    await key("Enter", {}, episodeInput);
    assert(!document.querySelector('[role="dialog"][aria-label="选集"]') && playRequests.at(-1)?.id === 13 && playRequests.at(-1)?.ep === 3, "Enter selects the searched episode of the same video");
    await click("选集");
    const beforeCurrent = requests;
    await click("播放第 3 集");
    assert(requests === beforeCurrent, "choosing the current episode closes the menu without reloading");
    await click("选集");
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>(".player-episode-toolbar button")].find((button) => button.textContent === "倒序")!.click());
    assert(document.querySelector("[data-episode]")?.getAttribute("data-episode") === "3", "episode ordering can reverse without changing selection");
    await key("Escape", {}, document.querySelector('[aria-label="查找集数"]')!);
    assert(!document.querySelector('[role="dialog"][aria-label="选集"]') && store.stack.at(-1)?.key === pageKey, "Escape closes an ordinary episode menu before navigating away");
    await click("评分");
    assert(document.querySelector('[aria-label="接口综合评分"]')?.textContent?.includes("9.6") && document.querySelector('.player-popover header small')?.textContent?.includes("154"), "rating menu reads the interface aggregate and participant count");
    assert(!document.querySelector('[aria-label="我的评分"]') && !document.body.textContent?.includes("提交评分") && !document.body.textContent?.includes("登录后评分"), "aggregate score display has no personal rating or login-to-rate controls");
    const ratingVideo = player().querySelector("video"), ratingRequests = requests;
    assert(controls().querySelector('.player-rating-trigger')?.textContent?.includes("9.6 分") && player().querySelector('.desktop-video-meta')?.textContent?.includes("9.6"), "playback bar and metadata display the interface score directly");
    await click("关闭评分"); await click("评分");
    assert(player().querySelector("video") === ratingVideo && requests === ratingRequests && !store.loginOpen, "viewing scores preserves media identity and never requires login");
    await click("选集");
    assert(!document.querySelector('[role="dialog"][aria-label="评分"]') && !!document.querySelector('[role="dialog"][aria-label="选集"]'), "rating, episode and speed menus are mutually exclusive");
    await click("关闭选集");
    await click("全屏"); await move(100); await move(150); await click("选集");
    assert(!!document.fullscreenElement?.querySelector('[role="dialog"][aria-label="选集"]'), "episode menu is hosted in the fullscreen element");
    await waitHide();
    assert(!!document.fullscreenElement?.querySelector('[role="dialog"][aria-label="选集"]') && !hidden(), "fullscreen episodes stay inside the fullscreen surface and hold the controls open");
    await key("Escape", {}, document.querySelector('[aria-label="查找集数"]')!);
    assert(!fullscreen && !document.querySelector('.player-popover') && store.stack.at(-1)?.key === pageKey, "fullscreen return dismisses the episode menu and preserves the player page");
    assert(ratingSummary({ score: "9.6", rating_cnt: "12", my: "4" }).score === 9.6 && ratingSummary({ rating_cnt: "12" }).count === 12 && ratingSummary({ score: "9.6" }).count === null, "rating parser reads aggregate scores and distinguishes unknown counts");
    assert(ratingSummary({ score: "invalid" }, 8.1).score === 8.1 && ratingSummary({ score: "99" }).score === 0, "invalid aggregate scores use valid fallbacks without inventing ratings");
    // A delayed response for the previous video must not leak into the next.
    let finishOld!: (value: { score: string; my: number }) => void;
    api.rating = (id) => id === 14 ? new Promise((resolve) => { finishOld = resolve; }) : Promise.resolve({ score: "7.4", my: 0 });
    await act(async () => store.push({ kind: "feed", videoIds: [14], index: 0, title: "新作品", startEp: 1 }));
    await act(async () => store.pop());
    await act(async () => finishOld({ score: "1.0", my: 5 }));
    assert(!controls().querySelector('.player-rating-trigger')?.textContent?.includes("1.0"), "late previous-video ratings cannot overwrite the current video's score");
    const loadVideo = api.video;
    let rejectDetails = true;
    api.video = async (id) => { if (id === 15 && rejectDetails) throw new Error("测试剧集加载失败"); return loadVideo(id); };
    await act(async () => store.push({ kind: "feed", videoIds: [15], index: 0, title: "剧集重试", startEp: 1 }));
    await click("选集");
    assert(document.querySelector('.player-tool-error')?.textContent?.includes("选集加载失败"), "episode metadata failure is visible in the playback-bar menu");
    rejectDetails = false;
    const retryMedia = player().querySelector("video"), retryRequests = requests;
    await click("重试选集");
    assert(document.querySelectorAll("[data-episode]").length === 3 && player().querySelector("video") === retryMedia && requests === retryRequests, "episode retry restores the actual list without restarting playback");
    await click("关闭选集");
    await act(async()=>store.push({kind:"feed",videoIds:[16],index:0,startEp:2,title:"窗口操作验证"}));
    await enter();
    const dragRegion = player().querySelector<HTMLElement>('.player-window-drag')!, dragBounds = dragRegion.getBoundingClientRect();
    nativeCommands.length = 0;
    await act(async()=>dragRegion.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,button:0})));
    assert(dragBounds.width === player().getBoundingClientRect().width && dragBounds.height === 88 && nativeCommands.some(call=>call.command.endsWith("start_dragging")), "window immersive mode exposes an 88px full-width native drag region");
    const beforeWheel = requests;
    for(let pulse=0;pulse<8;pulse++)await act(async()=>player().dispatchEvent(new WheelEvent("wheel",{bubbles:true,cancelable:true,deltaY:120})));
    assert(requests === beforeWheel + 1 && playRequests.at(-1)?.ep === 3 && playRequests.at(-1)?.id === 16, "one wheel burst changes to exactly the next episode in the current work");
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,750));player().dispatchEvent(new WheelEvent("wheel",{bubbles:true,cancelable:true,deltaY:120}));});
    assert(requests === beforeWheel + 1, "wheel navigation stops at the last episode instead of changing works");
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,750));player().dispatchEvent(new WheelEvent("wheel",{bubbles:true,cancelable:true,deltaY:-120}));});
    assert(requests === beforeWheel + 2 && playRequests.at(-1)?.ep === 2, "upward scrolling selects the previous episode after cooldown");
    await act(async () => root.unmount());
    document.querySelector("#results")!.textContent = JSON.stringify({ passed: true, count: checks.length, checks }, null, 2);
  }
} catch (error) {
  document.querySelector("#results")!.textContent = JSON.stringify({ passed: false, checks, error: String(error), stack: (error as Error).stack }, null, 2);
}
