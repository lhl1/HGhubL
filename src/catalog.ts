import type { CatalogMetadata, CatalogOption, VideoCard, RankItem } from "./types";

export const FALLBACK_CATEGORIES: CatalogOption[] = [
  { name: "AI成人短剧", route: "ai-duanju" }, { name: "AI成人漫剧", route: "ai-manju" },
  { name: "AI换脸", route: "ai-huanlian" }, { name: "AI魔改", route: "ai-mogai" },
];
export const CATALOG_SORTS = [{ value: "", label: "最近更新" }, { value: "score", label: "评分优先" }, { value: "hot", label: "当前最热" }, { value: "original", label: "原创作品" }];
export function catalogCategories(metadata: CatalogMetadata | null) {
  return metadata?.categories?.length ? [...metadata.categories].sort((a, b) => (b.sort || 0) - (a.sort || 0)) : FALLBACK_CATEGORIES;
}
export function filterCatalog<T extends Pick<VideoCard, "tags" | "is_finished">>(items: T[], selected: Record<string, string>, finished = "") {
  const tags = Object.values(selected).filter(Boolean);
  return items.filter((item) => tags.every((tag) => item.tags?.includes(tag)) && (!finished || item.is_finished === (finished === "finished")));
}
export function filterRanks(items: RankItem[], category: string, tags: Record<string, string>, finished: string) {
  return filterCatalog(items.filter((item) => !category || item.cate_name === category), tags, finished);
}

export function scoreValue(value: unknown): number {
  const score = Number(value);
  return Number.isFinite(score) && score > 0 && score <= 10 ? score : 0;
}
/** Unrated entries last; equal scores retain source order. */
export function orderByScore<T extends { score?: unknown }>(items: T[], priority: boolean): T[] {
  return priority ? [...items].sort((a, b) => scoreValue(b.score) - scoreValue(a.score)) : items;
}
