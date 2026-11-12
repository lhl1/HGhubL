import { ScoreSort, ScoreSortNote, ScoreBadge } from "../components/Score";
import { orderByScore } from "../catalog";
import { useMemo, useState } from "react";
import { api, fmt } from "../api";
import { useAsync } from "../hooks";
import { useStore } from "../store";
import { catalogCategories, filterRanks } from "../catalog";
import CatalogFilters from "../components/CatalogFilters";
import { CatalogViewSwitch, useCatalogLayout } from "../components/CatalogLayout";
import { CatalogSkeleton } from "../components/cards";
import { Empty, Img } from "../components/ui";
import { IBack, IRefresh, ITrophy } from "../icons";

const RANKS = [
  { value: "hot", label: "热播榜", description: "按上游热播指数排序" },
  { value: "recommend", label: "推荐榜", description: "发现值得追看的作品" },
  { value: "potential", label: "潜力榜", description: "寻找正在被发现的好剧" },
] as const;
export default function RankPage({ onBack, wide }: { onBack: () => void; wide: boolean }) {
  const { push, isFav, toggleFavLocal } = useStore();
  const { layout } = useCatalogLayout();
  const [kind, setKind] = useState<"hot" | "recommend" | "potential">("hot");
  const [priority, setPriority] = useState(false);
  const [category, setCategory] = useState(""), [selected, setSelected] = useState<Record<string, string>>({}), [finished, setFinished] = useState("");
  const metadata = useAsync(() => api.catalogMetadata());
  const ranking = useAsync(() => api.rank(kind), [kind]);
  const categories = catalogCategories(metadata.data);
  const items = useMemo(() => orderByScore(filterRanks(ranking.data?.items || [], category, selected, finished), priority), [ranking.data, category, selected, finished, priority]);
  const current = RANKS.find((rank) => rank.value === kind)!;
  return <div className="absolute inset-0 scroll-y ref-page-scroll"><section className="ref-rank-page" aria-busy={ranking.loading}>
    <header className="ref-rank-heading"><div><span className="ref-eyebrow">HGhub 榜单</span><h2>发现大家都在看的好剧</h2></div><div className="ref-heading-actions"><ScoreSort priority={priority} onChange={setPriority} /><CatalogViewSwitch /><button disabled={ranking.loading} onClick={ranking.reload}><IRefresh size={14} />刷新</button></div></header>
    <div className="ref-filter-surface">
      <div className="ref-filter-row"><span>分类</span><div role="group" aria-label="榜单分类"><button aria-pressed={!category} onClick={() => { setCategory(""); setSelected({}); }}>全部</button>{categories.map((item) => <button key={item.route} aria-pressed={category === item.name} onClick={() => { setCategory(item.name); setSelected({}); }}>{item.name}</button>)}</div></div>
      <div className="ref-filter-row"><span>榜单</span><div role="group" aria-label="榜单类型">{RANKS.map((rank) => <button key={rank.value} aria-pressed={kind === rank.value} onClick={() => setKind(rank.value)}>{rank.label}</button>)}</div></div>
      <CatalogFilters compact metadata={metadata.data} selected={selected} onChange={setSelected} finished={finished} onFinished={setFinished} loading={metadata.loading} />
      {metadata.error && <div className="ref-inline-error">筛选选项加载失败<button onClick={metadata.reload}>重试</button></div>}
    </div>
    <div className="ref-rank-description"><span>{current.description} · {items.length} 部作品</span><button onClick={() => { setCategory(""); setSelected({}); setFinished(""); setPriority(false); }}>重置筛选</button></div>
    <p className="ref-filter-note">{priority ? "当前按综合评分排列，封面数字仍为原榜名次。" : "保留上游真实名次；分类、题材及状态筛选本次榜单返回的作品。"}</p>
    <ScoreSortNote priority={priority} />
    {ranking.loading ? <CatalogSkeleton wide={wide} /> : ranking.error ? <Empty icon={<ITrophy size={28} />} title="榜单暂时无法加载" sub={ranking.error} action="重试" onAction={ranking.reload} />
      : items.length ? <div className={`ref-rank-grid ${layout === "list" ? "is-list" : ""}`}>{items.map((item) => <button key={item.video_id} className="ref-rank-card"
        title={isFav(item.video_id) ? "右键取消追剧" : "右键添加追剧"}
        onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); toggleFavLocal(item.video_id); }}
        onClick={() => push({ kind: "feed", videoIds: items.map((video) => video.video_id), index: items.findIndex((video) => video.video_id === item.video_id), title: current.label })}>
        <div className="ref-rank-cover"><Img src={item.cover} alt={item.title} /><span className={`ref-rank-number ${item.rank <= 3 ? "is-top" : ""}`}>{item.rank}</span></div>
        <div className="ref-rank-copy"><h3>{item.title}</h3><p>{item.tags?.slice(0, 3).join(" · ")}</p><small>{item.is_finished ? "已完结" : "连载中"} · {item.episode_count} 集</small><ScoreBadge score={item.score} /><p className="ref-rank-metric">{item.metric_label || "热度"} · {fmt(item.metric_value)}</p>{isFav(item.video_id) && <span className="ref-rank-followed">已追剧</span>}</div><span className="ref-card-action">查看 ›</span>
      </button>)}</div> : <Empty icon={<ITrophy size={28} />} title="当前筛选暂无结果" sub="试试其他分类或榜单" />}
  </section></div>;
}
