import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import App from "../src/App";
import { AppProvider, useStore } from "../src/store";
import { api } from "../src/api";
import type { Detail, VideoCard } from "../src/types";
import { PREFERENCES_KEY } from "../src/preferences";
import "../src/index.css";
import "../src/reference.css";

// Deterministic, offline UI fixture; never use account data or external media.
const params = new URLSearchParams(location.search), scene = params.get("scene") || "settings";
const internal = { metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } }, invoke: async () => false, transformCallback: () => 1, unregisterCallback() {} };
Object.assign(window, { __TAURI_INTERNALS__: internal });
localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ autoplay: false, catalogLayout: scene === "list" ? "list" : "grid" }));
localStorage.setItem("hghub_theme", params.get("theme") === "light" ? "light" : "dark");
const names = ["山海之间", "城市的第二种可能", "银河来信", "漫长夏日", "从零开始的旅程", "雨后见晴", "逆风飞行", "时光慢行"];
const items: VideoCard[] = names.map((title, index) => ({ id: index + 1, title, cover: "", description: "一段关于选择、成长与重新出发的故事。", tags: ["冒险", "成长"], score: 9.2 - index / 10, episode_count: 21, total_episodes: 24, hot: 21000, like_count: 8200, collect_count: 1200, comment_count: 103, is_finished: index % 2 === 0, is_original: 1 }));
api.boot = async () => ({ user: null, logged_in: false, base: "https://huangguoai.com", strict_security: true });
api.feed = async () => ({ items: [], pagination: { page: 1, pages: 1, size: 10, total: 0 } });
api.search = async (keyword) => ({ items, pagination: { page: 1, pages: 1, size: 20, total: items.length }, keyword });
api.video = async (id) => ({ ...(items.find((item) => item.id === id) || items[0]), description: "在城市与群山之间，主人公收到了来自未来的一封信。面对看似确定的命运，他们决定重新出发，寻找属于自己的答案。\n这是一段关于勇气与选择的旅程。", author: { id: 1, name: "山海影像" }, counts: { collect: 1200, comment: 103, hot: 21000, like: 8200 }, episodes: Array.from({ length: 21 }, (_, index) => ({ ep_num: index + 1, title: `第 ${index + 1} 集`, duration: 120, status: 1 })) } as Detail);
api.lineState = async () => ({ base: "https://huangguoai.com", default: "https://huangguoai.com", fixed: [] });
api.catalogMetadata = async () => ({ categories: [{ name: "短剧", route: "ai-duanju" }, { name: "漫剧", route: "ai-manju" }, { name: "原创", route: "original" }], sorts: [],
  tags: [{ code: "theme", name: "题材", tags: ["冒险", "成长", "都市", "奇幻", "古风", "悬疑", "职场", "科幻"].map((name, index) => ({ id: index + 1, name, slug: String(index) })) },
    { code: "background", name: "时代背景", tags: ["现代", "古代", "架空"].map((name, index) => ({ id: index + 100, name, slug: String(index) })) },
    { code: "audience", name: "受众", tags: ["男频", "女频", "合家欢"].map((name, index) => ({ id: index + 200, name, slug: String(index) })) }],
  hot: ["山海", "银河", "成长", "冒险"].map((name, index) => ({ id: index + 1, name, slug: String(index) })) });
api.catalog = async () => ({ items, pagination: { page: 1, pages: 1, size: 24, total: items.length } });
api.category = async () => ({ items, pagination: { page: 1, pages: 1, size: 24, total: items.length } });
api.rank = async (kind) => ({ type: kind, items: items.map((item, index) => ({ rank: index + 1, video_id: item.id, title: item.title, cover: item.cover, tags: item.tags, score: item.score, cate_name: "短剧", episode_count: item.episode_count, is_finished: item.is_finished, metric_label: "热度", metric_value: 2000000 - index * 100000, metrics: { collect: 0, comment: 0, like: 0, play: 0 } })) });

function Setup() {
  const store = useStore();
  useEffect(() => {
    if (scene === "settings") store.push({ kind: "settings" });
    else if (scene === "category") store.setTab("category");
    else if (scene === "rank") store.push({ kind: "ranks" });
    else if (scene === "preview") store.push({ kind: "feed", videoIds: [1], index: 0, title: "推荐" });
    else {
      store.setTab("search");
      window.setTimeout(() => {
        const input = document.querySelector<HTMLInputElement>('input[aria-label="搜索关键词"]');
        if (input) {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "山海");
          input.dispatchEvent(new Event("input", { bubbles: true }));
          window.setTimeout(() => input.form?.requestSubmit(), 50);
        }
      }, 150);
    }
  }, []);
  return <App />;
}
createRoot(document.querySelector("#root")!).render(<AppProvider><Setup /></AppProvider>);
