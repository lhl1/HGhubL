import React, { act } from "react";
import { createRoot } from "react-dom/client";
import App from "../src/App";
import { api } from "../src/api";
import { AppProvider, useStore } from "../src/store";
import { DISCOVERY_SECTIONS, videoPage } from "../src/discovery";
import { PREFERENCES_KEY } from "../src/preferences";
import "../src/index.css";
import "../src/reference.css";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const params = new URLSearchParams(location.search), preview = params.get("scene");
const checks: string[] = [], calls: { command: string; args: Record<string, unknown> }[] = [];
const assert = (value: unknown, label: string) => { if (!value) throw new Error(label); checks.push(label); };
const card = (id: number, title = `山海来信 ${id}`) => ({ id, title, cover: "", desc: "一次关于勇气、选择与重新出发的旅程。", tags: ["冒险", "成长"], score: id === 23 ? 9.9 : id % 2 === 0 ? 9.6 : 7.2, episode_count: 12, total_episodes: 16, hot: 25000, is_finished: false });
const topic = (slug = "mountains", id = 1) => ({ id, slug, title: slug === "mountains" ? "山海之间" : "城市奇遇", cover: "", intro: "不同的故事，相同的勇气。沿着群山与河流，探索新的可能。", video_count: 4 });
const metadata = { categories: [{ id: 1, name: "短剧", route: "ai-duanju" }, { id: 2, name: "漫剧", route: "ai-manju" }], sorts: [], tags: [], hot: [{ id: 1, name: "冒险", slug: "adventure" }] };
const page = <T,>(items: T[], current = 1, pages = 1) => ({ items, pagination: { page: current, pages, size: 2, total: pages * 2 } });
let failHome = false, failDiscovery = false, oldRecommend: Promise<unknown> | null = null;
let store!: ReturnType<typeof useStore>;
function Probe() { store = useStore(); return null; }
Object.assign(window, { __TAURI_INTERNALS__: { metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } }, transformCallback: () => 1, unregisterCallback() {},
  invoke: async (command: string, args: Record<string, unknown> = {}) => {
    calls.push({ command, args });
    const current = Number(args.page) || 1;
    if (command === "app_boot") return { user: null, logged_in: false, base: "https://huangguoai.com", strict_security: true };
    if (command === "api_home") {
      if (failHome) throw "home offline";
      return { banners: [1, 2].map((id) => ({ id, video_id: id, title: id === 1 ? "山海之间" : "银河来信", image: "", desc: "跨越群山与城市，在未知旅途中重新出发。" })),
        featured: [1, 2, 3, 4].map((id) => card(id)), latest: [5, 6, 7, 8].map((id) => card(id)), cate_rec: [{ cate_id: 1, cate_name: "短剧", videos: [card(9), card(10)] }], topic_rec: [topic(), topic("city", 2)] };
    }
    if (command === "api_catalog_metadata") return preview === "rank" ? {...metadata,tags:[{code:"genre",name:"题材",tags:Array.from({length:24},(_,i)=>({id:i+1,name:`题材 ${i+1}`,slug:`genre-${i+1}`}))}]} : metadata;
    if (command === "api_search_hot") return { items: [{word:"#山海 #城市 #银河",heat:12345},{word:"＃夏日＃勇气＃旅程",heat:9876}] };
    if (command === "api_rank") return { type: "hot", items: [1, 2, 3, 4].map((id) => ({ ...card(id), video_id: id, rank: id, metric_value: 20000, metric_label: "热度", cate_name: "短剧" })) };
    if (command === "api_discover") {
      if (args.section === "recommend" && oldRecommend) return oldRecommend;
      if (failDiscovery) throw "section offline";
      const items = current === 1 ? [card(21, `${args.section} 第一部`), card(22, `${args.section} 第二部`)] : [card(22), card(23, `${args.section} 第三部`)];
      return { items, page: current, size: 2, total: 4 };
    }
    if (command === "api_topics") return page(current === 1 ? [topic()] : [topic("city", 2)], current, 2);
    if (command === "api_topic") return { topic: { ...topic(String(args.slug)), faq: [{ q: "如何开始观看？", a: "选择作品并打开剧集详情。" }] }, related: [topic("city", 2)], videos: page<unknown>(current === 1 ? [{ id: 31, title: "专题中的旅程", cover: "", episode_count: 3 }] : [card(32, "专题的下一站")], current, 2) };
    if (command === "api_tag") return page([card(41, "标签下的冒险")]);
    if (command === "api_post_categories") return { items: [{ id: 1, name: "资讯", route: "news" }, { id: 2, name: "剧评", route: "reviews" }] };
    if (command === "api_discover_posts") return page([{ id: 51, title: args.category === "reviews" ? "关于山海的剧评" : "今日故事手记", cover: "", tags: [], hot: 1200, desc: "从故事中寻找新的视角。" }]);
    if (command === "api_post") return { id: args.id, title: "关于山海的剧评", cover: "", tags: [], hot: 1200, content: "<h2>故事里的选择</h2><p>用勇气面对下一次出发。</p>" };
    if (command === "api_video") return { ...card(Number(args.id)), description: "跨越群山，走向新的生活。", author: { id: 1, name: "山海影像" }, counts: { collect: 0, comment: 0, hot: 0, like: 0 }, episodes: [1, 2, 3].map((ep_num) => ({ ep_num, title: `第 ${ep_num} 集`, duration: 120, status: 1 })) };
    if (command === "api_play") throw "离线测试不加载媒体";
    if (command === "api_feed" || command === "api_category" || command === "api_catalog" || command === "api_search") return page([]);
    return command.includes("is_") ? false : 1;
  } } });
// Avoid viewport-driven pagination in this deterministic behavior fixture.
Object.assign(window, { IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} } });
localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ autoplay: false }));
localStorage.setItem("hghub_theme_policy", "system-v1");
localStorage.setItem("hghub_theme", params.get("theme") === "light" ? "light" : "dark");
const root = createRoot(document.querySelector("#root")!);
const click = async (element: Element | null | undefined) => { if (!element) throw new Error("Missing control"); await act(async () => (element as HTMLElement).click()); };
const button = (text: string, scope: ParentNode = document) => [...scope.querySelectorAll("button")].find((item) => item.textContent === text);
const escape = async () => { await act(async () => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))); };
const explore = () => document.querySelector<HTMLElement>(".ref-discovery-page")!;
try {
  await act(async () => root.render(<React.StrictMode><AppProvider><Probe /><App /></AppProvider></React.StrictMode>));
  assert(store.tab === "watch" && calls.some(call => call.command === "api_feed"), "startup enters continuous screening by default");
  assert(document.querySelector('[aria-label="主导航"] button')?.textContent === "放映", "screening is the first desktop navigation entry");
  await act(async () => store.setTab("home"));
  if (preview) {
    if (preview === "explore") await act(async () => store.openExplore());
    if (preview === "rank") await act(async () => store.push({kind:"ranks"}));
    if (preview === "topics") await act(async () => store.openExplore("topics"));
    if (preview === "topic") await act(async () => store.push({ kind: "topic", slug: "mountains", title: "山海之间" }));
    if (preview === "articles") await act(async () => store.openExplore("posts"));
    document.querySelector<HTMLElement>("#results")!.style.display = "none";
    const style = document.createElement("style");
    style.textContent = ".ref-home-hero-cover .bg-s3,.ref-card-cover .bg-s3,.ref-topic-cover .bg-s3,.ref-article-cover .bg-s3{background:linear-gradient(140deg,#233b55,#73544d);color:#ffffff38}.ref-card-grid>div:nth-child(2n) .bg-s3{background:linear-gradient(140deg,#2c5253,#62747b)}.ref-home-hero-cover .bg-s3{background:radial-gradient(ellipse at 80% 30%,#758995,#20384d 70%)}";
    document.head.append(style);
  } else {
    const adapted = videoPage({ origin: "https://example.invalid", section: "original", page: 2, html: `<script>window.__listingScriptRan=true</script><iframe src="https://should-not-load.invalid/"></iframe>
      <div class="hg-card-grid is-active" data-channel-panel="drama" data-panel-total="40"><div class="hg-drama-card" data-track-item-id="101" data-track-title="山海 &amp; 旅程">
        <div class="hg-drama-card__cover"><a class="hg-drama-card__cover-link" href="/video/101/"><img data-src="/covers/story.jpg" onerror="window.__listingScriptRan=true"></a></div>
        <span class="hg-drama-card__score">9.3分</span><span class="hg-drama-card__episode" data-ep-base="全4集"></span><span class="hg-drama-card__views">2.5w</span>
        <div class="hg-drama-card__tags"><a class="hg-tag">冒险<span class="sr-only">题材短剧</span></a></div></div></div>
      <template><div class="hg-drama-card" data-track-item-id="999"></div></template><span data-pages="3"></span>` });
    assert(adapted.items.length === 1 && adapted.items[0].id === 101 && adapted.items[0].title === "山海 & 旅程", "web listings import only active cards and decode titles as plain values");
    assert(adapted.items[0].cover === "https://example.invalid/covers/story.jpg" && adapted.items[0].tags.join() === "冒险", "web cards preserve relative covers and remove accessibility-only tag suffixes");
    assert(adapted.items[0].episode_count === 4 && adapted.items[0].is_finished && adapted.items[0].hot === 25000 && adapted.items[0].is_original === 1, "web cards preserve episodes, completion, heat and actual original membership");
    assert(adapted.pagination.page === 2 && adapted.pagination.pages === 3 && adapted.pagination.total === 40, "web pagination retains the source page counts without mixing API page sizes");
    assert(!(window as Window & { __listingScriptRan?: boolean }).__listingScriptRan && !document.querySelector("iframe"), "importing web listings never installs source scripts, frames or event handlers");
    let rejected = false; try { videoPage({ html: "<h1>not a listing</h1>" }); } catch { rejected = true; }
    assert(rejected, "changed web structures report a load error instead of a false empty collection");
    assert(document.querySelector('[aria-label="网页首页"]'), "web-compatible home remains available after screening startup");
    assert(["精选推荐", "最近上新", "短剧", "热播短剧", "专题推荐"].every((label) => document.querySelector(`.ref-home-page section[aria-label="${label}"]`)), "home includes all upstream content groups");
    const heading = document.querySelector('section[aria-label="最近上新"] .ref-section-heading')!.getBoundingClientRect();
    const firstCover = document.querySelector('section[aria-label="最近上新"] .ref-card-cover')!.getBoundingClientRect();
    assert(firstCover.top - heading.bottom >= 17, "section headings leave readable spacing before the first poster row");
    assert(document.querySelector(".ref-home-hero h2")?.textContent === "山海之间", "home reads real banner fields through the API adapter");
    await click(document.querySelector('[aria-label="下一张精选"]'));
    assert(document.querySelector(".ref-home-hero h2")?.textContent === "银河来信", "banner navigation switches the selected title");
    await click(document.querySelector('.ref-home-page [aria-label="评分优先"]'));
    assert(document.querySelector('section[aria-label="精选推荐"] .ref-series-card h3')?.textContent === "山海来信 2", "home score priority sorts within each original homepage section");
    assert(document.querySelector('section[aria-label="精选推荐"] .ref-score-badge')?.textContent?.includes("9.6"), "homepage posters expose the interface score for choosing a title");
    await click(document.querySelector('.ref-home-page [aria-label="评分优先"]'));
    await click(button("查看剧集"));
    assert(store.preview?.videoIds[0] === 2, "banner opens the correct video preview");
    await click(document.querySelector('[aria-label="关闭详情"]'));
    await click(document.querySelector('.ref-home-page section[aria-label="精选推荐"] .ref-series-card'));
    assert(store.preview?.videoIds.join(",") === "1,2,3,4", "home cards retain their section context for playback");
    await click(document.querySelector('[aria-label="关闭详情"]'));
    await click(button("查看全部 ›", document.querySelector('section[aria-label="最近上新"]')!));
    assert(store.tab === "explore" && store.discoverySection === "latest", "home more links open the matching discovery section");
    assert(calls.some((call) => call.command === "api_discover" && call.args.section === "latest"), "new releases request the dedicated upstream endpoint");
    assert(explore().querySelectorAll(".ref-series-card").length === 2 && !!button("加载更多", explore()), "flat home pagination becomes a working paged discovery list");
    await click(explore().querySelector('[aria-label="评分优先"]'));
    assert(explore().querySelector('.ref-series-card h3')?.textContent === "latest 第二部", "explore score priority sorts the actual current section");
    await click(button("加载更多", explore()));
    assert(explore().querySelectorAll(".ref-series-card").length === 3 && !button("加载更多", explore()), "discovery appends distinct records and stops at the last page");
    assert(explore().querySelector('.ref-series-card h3')?.textContent === "latest 第三部", "explore pagination inserts a higher-scored next page at the top");
    await click(explore().querySelector('[aria-label="评分优先"]'));
    assert(explore().querySelector('.ref-series-card h3')?.textContent === "latest 第一部", "explore can restore the upstream order after loading more");
    await act(async () => store.openExplore());
    assert(!document.querySelector('[aria-label="猜你想搜"]') && !explore().querySelector('.ref-guess-section'), "home and explore omit the removed search-suggestion module");
    for (const item of DISCOVERY_SECTIONS.filter((item) => !["topics", "posts"].includes(item.value))) {
      await click(button(item.label, document.querySelector('[aria-label="探索分区"]')!));
      assert(calls.some((call) => call.command === "api_discover" && call.args.section === item.value) && explore().querySelector(".ref-series-card")?.textContent?.includes(item.value), `${item.value} section requests and renders its own records`);
    }
    await act(async () => store.openExplore("original"));
    await click(button("原创短剧", document.querySelector('[aria-label="原创分类"]')!));
    assert(calls.some((call) => call.command === "api_discover" && call.args.section === "original-short") && explore().textContent?.includes("original-short 第一部"), "original short dramas load their own original-site category");
    await click(button("原创漫剧", document.querySelector('[aria-label="原创分类"]')!));
    assert(calls.some((call) => call.command === "api_discover" && call.args.section === "original-comic") && explore().textContent?.includes("original-comic 第一部"), "original comics load their own original-site category");
    let finishOld!: (value: unknown) => void;
    oldRecommend = new Promise((resolve) => { finishOld = resolve; });
    await act(async () => store.openExplore("recommend"));
    await act(async () => store.openExplore("latest"));
    await act(async () => finishOld({ items: [card(99, "过期作品")], page: 1, size: 20, total: 1 }));
    oldRecommend = null;
    assert(!explore().textContent?.includes("过期作品") && explore().textContent?.includes("latest 第一部"), "late previous-section responses cannot replace current discovery records");
    failDiscovery = true;
    await act(async () => store.openExplore("original"));
    assert(explore().textContent?.includes("加载失败") && !!button("重试", explore()), "failed sections expose a local retry action");
    failDiscovery = false; await click(button("重试", explore()));
    assert(!!explore().querySelector(".ref-series-card"), "retry restores the current section");
    await click(explore().querySelector(".ref-series-card"));
    assert(!!store.preview && !!document.querySelector('[aria-label="剧集详情"]'), "every video section shares native episode previews");
    await click(document.querySelector('[aria-label="播放第 2 集"]'));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
    document.querySelectorAll(".win-page-in").forEach((element) => element.getAnimations().forEach((animation) => animation.finish()));
    assert(store.stack.at(-1)?.kind === "feed" && !store.preview, "choosing an episode opens the existing player");
    const bounds = document.querySelector(".player-root")!.getBoundingClientRect(), content = document.querySelector(".ref-main-content")!.getBoundingClientRect();
    assert(Math.abs(bounds.x - content.x) < 1 && Math.abs(bounds.y - content.y) < 1 && bounds.width === content.width && bounds.height === content.height, "ordinary playback fills the desktop content area without outer framing");
    assert(getComputedStyle(document.querySelector(".player-root")!).clipPath === "none" && getComputedStyle(document.querySelector(".player-root")!, "::after").display === "none", "ordinary playback removes the second clipped border");
    await escape();
    assert(store.tab === "explore" && !store.stack.length && store.discoverySection === "original", "return from playback restores the previous discovery section");
    await act(async () => store.openExplore("topics"));
    assert(explore().querySelectorAll(".ref-topic-card").length === 1, "topics render from their own paged service");
    await click(button("加载更多", explore()));
    assert(explore().querySelectorAll(".ref-topic-card").length === 2, "topic collections support pagination");
    await click(explore().querySelector('[data-topic-slug="mountains"]'));
    assert(store.stack.at(-1)?.kind === "topic" && document.querySelector('[aria-label="专题详情"]')?.textContent?.includes("专题中的旅程"), "opening a topic loads its metadata and actual member videos");
    assert(document.querySelector('[aria-label="专题详情"] .ref-series-card small')?.textContent?.includes("3 集"), "sparse topic video records receive compatible display defaults");
    await click(button("加载更多", document.querySelector('[aria-label="专题详情"]')!));
    assert(document.querySelector('[aria-label="专题详情"]')?.textContent?.includes("专题的下一站"), "topic member videos support independent pagination");
    await click(document.querySelector('[aria-label="专题详情"] [aria-label="评分优先"]'));
    assert(document.querySelector('[aria-label="专题详情"] .ref-series-card h3')?.textContent === "专题的下一站", "topic score priority moves rated works ahead of unrated works across pages");
    assert([...document.querySelectorAll('[aria-label="专题详情"] .ref-score-badge')].at(-1)?.textContent?.includes("暂无评分"), "unrated works remain visible with an explicit unrated label");
    const faq = document.querySelector<HTMLDetailsElement>(".ref-topic-faq details")!;
    await click(faq.querySelector("summary"));
    assert(faq.open && faq.textContent?.includes("选择作品"), "topic questions expand as native text content");
    await click(document.querySelector('[aria-label="专题详情"] [data-topic-slug="city"]'));
    assert(store.stack.at(-1)?.kind === "topic" && (store.stack.at(-1) as { slug: string }).slug === "city", "related topics stay within native navigation");
    await escape(); await escape();
    assert(store.tab === "explore" && !store.stack.length && store.discoverySection === "topics", "return from nested topics restores the collection");
    await act(async () => store.openExplore("posts"));
    await click(button("剧评", document.querySelector('[aria-label="图文分类"]')!));
    assert(calls.some((call) => call.command === "api_discover_posts" && call.args.category === "reviews") && explore().textContent?.includes("关于山海的剧评"), "each dynamic article category requests and displays its actual content");
    await click(explore().querySelector(".ref-article-card"));
    assert(store.stack.at(-1)?.kind === "post" && document.querySelector(".article-body")?.textContent?.includes("故事里的选择"), "article categories open the existing sanitized reader");
    assert(!document.querySelector('[data-testid="article-media"]'), "text-only articles avoid an empty player and false play button");
    await escape();
    assert(!store.stack.length && store.discoverySection === "posts", "article return preserves its discovery destination");
    await act(async () => store.setTab("home"));
    await click(button("冒险", document.querySelector('[aria-label="热门标签"]')!));
    assert(store.stack.at(-1)?.kind === "tag" && calls.some((call) => call.command === "api_tag" && call.args.slug === "adventure"), "home tags load their real tag catalog instead of an unrelated search");
    await escape();
    await click(button("查看全部 ›", document.querySelector('.ref-home-page section[aria-label="短剧"]')!));
    assert(store.stack.at(-1)?.kind === "channel" && (store.stack.at(-1) as { cate: string }).cate === "ai-duanju", "category recommendation links map upstream category IDs to native catalog routes");
    await escape();
    await click(button("探索", document.querySelector('[aria-label="主导航"]')!));
    assert(store.tab === "explore", "explore has an independent persistent navigation entry");
    await click(button("首页", document.querySelector('[aria-label="主导航"]')!));
    await click(button("连续放映", document.querySelector('[aria-label="首页快捷入口"]')!));
    assert(store.tab === "watch" && calls.some((call) => call.command === "api_feed"), "the original continuous feed remains available in watch mode");
    await act(async () => store.setTheme("light"));
    assert(getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() === "#ed623e", "new sections preserve the reference light theme");
    await act(async () => store.setTab("home"));
    failHome = true;
    // Remount to verify initial home failure rather than a cached view.
    await act(async () => root.render(null));
    await act(async () => root.render(<AppProvider><Probe /><App /></AppProvider>));
    await act(async () => store.setTab("home"));
    assert(document.querySelector('[aria-label="网页首页"]')?.textContent?.includes("首页加载失败"), "home failures remain visible without breaking other destinations");
    failHome = false; await click(button("重试首页"));
    assert(!!document.querySelector(".ref-home-hero"), "home can recover independently through retry");
    await act(async () => root.unmount());
    document.querySelector("#results")!.textContent = JSON.stringify({ passed: true, count: checks.length, checks }, null, 2);
  }
} catch (error) {
  document.querySelector("#results")!.textContent = JSON.stringify({ passed: false, checks, error: String(error), stack: (error as Error).stack }, null, 2);
}
