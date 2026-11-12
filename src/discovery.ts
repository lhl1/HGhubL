import type { DiscoverySection, HomeData, Paged, RankItem, Topic, TopicDetail, VideoCard } from "./types";

export const DISCOVERY_SECTIONS: { value: DiscoverySection; label: string; intro: string }[] = [
  { value: "recommend", label: "精选推荐", intro: "从首页精选中发现下一部好剧" },
  { value: "latest", label: "最近上新", intro: "新作品，抢先看" },
  { value: "hot", label: "热播短剧", intro: "发现大家都在看的作品" },
  { value: "original", label: "黄果原创", intro: "探索原创故事与创作者" },
  { value: "short", label: "短剧", intro: "短小精彩，随时开看" },
  { value: "comic", label: "漫剧", intro: "走进画面里的故事" },
  { value: "topics", label: "专题合集", intro: "用一个主题，串起不同故事" },
  { value: "posts", label: "图文社区", intro: "浏览文章、剧评与社区分享" },
];
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === "object" ? value as RecordValue : {};
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const siteImage = (value: string, origin: string) => {
  if (!value) return "";
  try { const url = new URL(value, origin); return /^https?:$/.test(url.protocol) ? url.href : ""; } catch { return ""; }
};
export function videoCard(value: unknown): VideoCard {
  const item = record(value), episodes = number(item.episode_count);
  return { ...item, id: number(item.id ?? item.video_id), title: String(item.title || ""), cover: String(item.cover || ""),
    description: String(item.description || item.desc || ""), tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === "string") : [],
    score: number(item.score), episode_count: episodes, total_episodes: number(item.total_episodes) || episodes,
    hot: number(item.hot ?? item.metric_value), like_count: number(item.like_count), collect_count: number(item.collect_count), comment_count: number(item.comment_count),
    is_finished: item.is_finished === true || item.is_finished === 1, is_original: number(item.is_original) } as VideoCard;
}
export function videoPage(value: unknown): Paged<VideoCard> {
  const data = record(value), paging = record(data.pagination);
  if (typeof data.html === "string") return siteVideoPage(data.html, number(data.page) || 1, String(data.origin || ""), String(data.section || ""));
  const items = (Array.isArray(data.items) ? data.items : []).map(videoCard).filter((item) => item.id > 0);
  const page = Math.max(1, number(paging.page ?? data.page) || 1), size = Math.max(1, number(paging.size ?? data.size) || items.length || 20);
  const total = Math.max(0, number(paging.total ?? data.total));
  // Home endpoints return flat page/size/total; other routes return pagination.
  const pages = Math.max(page, number(paging.pages) || Math.ceil(total / size) || page);
  return { items, pagination: { page, size, total, pages } };
}
function siteVideoPage(html: string, page: number, origin: string, section: string): Paged<VideoCard> {
  // Template contents stay inert and are never attached to the live document.
  // Extract plain values only; site scripts, handlers and frames never run.
  const template = document.createElement("template"); template.innerHTML = html;
  const documentFragment = template.content;
  const grid = documentFragment.querySelector(".hg-card-grid.is-active") || documentFragment.querySelector(".hg-card-grid");
  if (!grid) throw new Error("列表页面结构已变化，请重试");
  const visibleText = (element: Element | null) => {
    const copy = element?.cloneNode(true) as Element | undefined;
    copy?.querySelectorAll(".sr-only,script,style").forEach((item) => item.remove());
    return copy?.textContent?.trim() || "";
  };
  const items = [...grid.querySelectorAll(".hg-drama-card")].map((card) => {
    const href = card.querySelector(".hg-drama-card__cover-link")?.getAttribute("href") || "";
    const id = Number(card.getAttribute("data-track-item-id") || href.match(/\/video\/(\d+)/)?.[1]);
    const image = card.querySelector(".hg-drama-card__cover img");
    let cover = image?.getAttribute("data-src") || image?.getAttribute("data-original") || image?.getAttribute("src") || "";
    cover = siteImage(cover, origin);
    const episode = card.querySelector(".hg-drama-card__episode");
    const episodeText = episode?.getAttribute("data-ep-base") || visibleText(episode);
    const heatText = visibleText(card.querySelector(".hg-drama-card__views"));
    const heat = (parseFloat(heatText) || 0) * (/[w万]/i.test(heatText) ? 10000 : heatText.includes("亿") ? 100000000 : 1);
    return videoCard({ id, title: card.getAttribute("data-track-title") || visibleText(card.querySelector(".hg-drama-card__title")), cover,
      description: visibleText(card.querySelector(".hg-drama-card__desc")), score: parseFloat(visibleText(card.querySelector(".hg-drama-card__score"))) || 0,
      episode_count: Number(episodeText.match(/(\d+)\s*集/)?.[1]) || 0, is_finished: /^(全|已完结)/.test(episodeText), is_original: section.startsWith("original") || visibleText(card.querySelector(".hg-drama-card__badges")).includes("原创") ? 1 : 0, hot: heat,
      tags: [...card.querySelectorAll(".hg-drama-card__tags .hg-tag")].map(visibleText) });
  }).filter((item) => item.id > 0);
  const unique = [...new Map(items.map((item) => [item.id, item])).values()];
  const channel = grid.getAttribute("data-channel-panel");
  const pager = channel ? [...documentFragment.querySelectorAll(".hg-channel-pager")].find((element) => element.getAttribute("data-channel-panel") === channel) : undefined;
  const pages = Math.max(page, Number((pager || documentFragment).querySelector("[data-pages]")?.getAttribute("data-pages")) || page);
  const total = Number(grid.getAttribute("data-panel-total")) || unique.length;
  return { items: unique, pagination: { page, pages, total, size: unique.length || 20 } };
}
export function homeData(value: unknown): HomeData {
  const data = record(value);
  if (typeof data.html === "string") return siteHomeData(data.html, String(data.origin || ""));
  const videos = (items: unknown) => (Array.isArray(items) ? items : []).map(videoCard).filter((item) => item.id > 0);
  return { banners: (Array.isArray(data.banners) ? data.banners : []).filter((item) => number(item?.video_id) > 0),
    featured: videos(data.featured), latest: videos(data.latest),
    cate_rec: (Array.isArray(data.cate_rec) ? data.cate_rec : []).map((group) => ({ ...group, videos: videos(group.videos) })),
    topic_rec: Array.isArray(data.topic_rec) ? data.topic_rec.filter((topic) => topic?.slug) : [] };
}
function siteHomeData(html: string, origin: string): HomeData {
  const template = document.createElement("template"); template.innerHTML = html;
  const documentFragment = template.content;
  const sections = [...documentFragment.querySelectorAll("section.hg-section")];
  const find = (name: string) => sections.find((section) => section.querySelector(".hg-section-title h2")?.textContent?.trim() === name);
  if (!find("精选推荐") || !find("最近上新")) throw new Error("首页结构已变化，请重试");
  const cards = (section?: Element) => section?.querySelector(".hg-card-grid") ? siteVideoPage(section.outerHTML, 1, origin, "home").items : [];
  let slides: RecordValue[] = [];
  try { const data: unknown = JSON.parse(documentFragment.querySelector("script[data-hero-slides]")?.textContent || "[]"); if (Array.isArray(data)) slides = data; } catch { /* The content sections remain available if the optional hero is absent. */ }
  const banners: HomeData["banners"] = slides.filter((slide) => !slide.isAd).map((slide, index) => ({
    id: index + 1, video_id: Number(String(slide.detailHref || slide.href || "").match(/\/video\/(\d+)/)?.[1]) || 0,
    title: String(slide.title || ""), image: siteImage(String(slide.cover || slide.thumb || ""), origin), desc: String(slide.desc || ""), score: number(slide.score),
  })).filter((item) => item.video_id > 0);
  const topic_rec = [...documentFragment.querySelectorAll(".hg-topic-card")].map((element) => {
    const href = element.getAttribute("href") || element.querySelector("a[href]")?.getAttribute("href") || "";
    const image = element.querySelector("img");
    return { id: Number(element.getAttribute("data-id")) || 0, slug: href.match(/\/topics\/([a-zA-Z0-9_-]+)/)?.[1] || "",
      title: element.querySelector(".hg-topic-card__title")?.textContent?.trim() || "", cover: siteImage(image?.getAttribute("data-src") || image?.getAttribute("src") || "", origin),
      intro: element.querySelector(".hg-topic-card__desc")?.textContent?.trim() || "", video_count: Number(element.querySelector(".hg-topic-card__meta")?.textContent?.match(/\d+/)?.[0]) || 0 };
  }).filter((topic) => topic.slug);
  const tagTitle = documentFragment.querySelector("#home-popular-tags-title");
  const tagScope = tagTitle?.closest("section") || tagTitle?.parentElement?.parentElement;
  const hot_tags = [...(tagScope?.querySelectorAll('a[href*="/tag/"]') || [])].map((element) => ({ id: 0,
    name: element.textContent?.trim() || "", slug: element.getAttribute("href")?.match(/\/tag\/([a-zA-Z0-9_-]+)/)?.[1] || "" })).filter((tag) => tag.slug && tag.name);
  return { banners, featured: cards(find("精选推荐")), latest: cards(find("最近上新")), hot: cards(find("热播短剧")), topic_rec, hot_tags,
    cate_rec: sections.filter((section) => !["精选推荐", "最近上新", "热播短剧", "专题推荐"].includes(section.querySelector(".hg-section-title h2")?.textContent?.trim() || "") && section.querySelector(".hg-card-grid")).map((section) => ({
      cate_id: Number(section.getAttribute("data-category-id")) || 0, cate_name: section.querySelector("h2")?.textContent?.trim() || "分类推荐", videos: cards(section),
    })) };
}
export function rankingCards(items: RankItem[]): VideoCard[] { return items.map((item) => videoCard({ ...item, id: item.video_id, hot: item.metric_value })); }
export function topicData(value: unknown, slug: string): TopicDetail {
  const data = record(value);
  if (typeof data.html !== "string") return { topic: data.topic as Topic, related: Array.isArray(data.related) ? data.related : [], videos: videoPage(data.videos) };
  const template = document.createElement("template"); template.innerHTML = data.html;
  const fragment = template.content, origin = String(data.origin || "");
  const banner = fragment.querySelector(".hg-topic-banner"), image = banner?.querySelector(".hg-topic-banner__cover img");
  if (!banner) throw new Error("专题页面结构已变化，请重试");
  const related = [...fragment.querySelectorAll(".hg-topic-related .hg-topic-card")].map((element) => {
    const href = element.getAttribute("href") || element.querySelector("a[href]")?.getAttribute("href") || "";
    const cover = element.querySelector("img");
    return { id: 0, slug: href.match(/\/topics\/([a-zA-Z0-9_-]+)/)?.[1] || "", title: element.querySelector(".hg-topic-card__title")?.textContent?.trim() || "",
      cover: siteImage(cover?.getAttribute("data-src") || cover?.getAttribute("src") || "", origin), intro: element.querySelector(".hg-topic-card__desc")?.textContent?.trim() || "",
      video_count: Number(element.querySelector(".hg-topic-card__meta")?.textContent?.match(/\d+/)?.[0]) || 0 };
  }).filter((item) => item.slug);
  return { topic: { id: 0, slug, title: banner.querySelector("h1")?.textContent?.trim() || "专题", cover: siteImage(image?.getAttribute("data-src") || image?.getAttribute("src") || "", origin),
    intro: fragment.querySelector(".hg-topic-lead p")?.textContent?.trim() || banner.querySelector("p")?.textContent?.trim() || "",
    video_count: Number(fragment.querySelector(".hg-topic-lead__total")?.textContent?.match(/\d+/)?.[0]) || 0 },
    related, videos: videoPage(data) };
}
