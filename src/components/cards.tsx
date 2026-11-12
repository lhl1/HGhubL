import React from "react";
import { ScoreBadge } from "./Score";
import { cover, fmt } from "../api";
import type { VideoCard } from "../types";
import { IGrid, IHeartF, IList, IPlayF } from "../icons";
import { Img } from "./ui";
import { useEffect, useState } from "react";
import { useStore } from "../store";
import type { CatalogLayout } from "../preferences";
import { CatalogViewSwitch, useCatalogLayout } from "./CatalogLayout";

/* ——— 瀑布流卡片 ——— */
export function WaterfallCard({ v, onOpen }: { v: VideoCard; onOpen: () => void }) {
  const { isFav, toggleFavLocal } = useStore();
  return (
    <button onClick={onOpen} className="ref-series-card" title={isFav(v.id) ? "右键取消追剧" : "右键添加追剧"}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); toggleFavLocal(v.id); }}>
      <div className="ref-card-cover"><Img src={v.cover} alt={v.title} />
        <ScoreBadge score={v.score} cover /><span className="ref-episode-stamp">{v.is_finished ? `全 ${v.episode_count} 集` : `更新至 ${v.episode_count} 集`}</span>
        {isFav(v.id) && <span className="ref-followed-stamp">已追剧</span>}
        <span className="ref-play-hover"><IPlayF size={26} /></span>
      </div>
      <div className="ref-card-copy"><h3>{v.title}</h3><p>{v.tags?.slice(0, 3).join(" · ") || "查看剧集"}</p>
        <small>{v.episode_count} 集</small>
        <p className="ref-card-intro">{v.description?.replace(/<[^>]+>/g, " ")}</p></div><span className="ref-card-action">查看 ›</span>
    </button>
  );
}

/* ——— 近无缝瀑布流 ——— */
export function Masonry({ videos, onOpen, wide = false, gap = "gap-1", tools = true }: {
  videos: VideoCard[]; onOpen: (v: VideoCard) => void; wide?: boolean; gap?: string; tools?: boolean;
}) {
  const { layout } = useCatalogLayout();
  return (
    <div>
      {tools && <div className="hg-catalog-tools"><span>{videos.length} 部作品</span><CatalogViewSwitch /></div>}
      {layout === "list" ? <div className="hg-catalog-list">{videos.map((video) => <button key={video.id} className="hg-catalog-row" onClick={() => onOpen(video)}>
        <div className="hg-catalog-row-cover"><Img src={video.cover} /></div>
        <div><h3>{video.title}</h3><p>{video.tags?.slice(0, 4).join(" · ")}</p>
          <small>{video.episode_count} 集{video.is_finished ? " · 已完结" : " · 连载中"} · <ScoreBadge score={video.score} /></small>
          <span>{video.description?.replace(/<[^>]*>/g, " ") || video.author?.name || "查看简介与选集"}</span>
        </div><IPlayF size={18} />
      </button>)}</div> : <div className="ref-card-grid">
      {videos.map((v) => (
        <div key={v.id}>
          <WaterfallCard v={v} onOpen={() => onOpen(v)} />
        </div>
      ))}
      </div>}
    </div>
  );
}

export function CatalogSkeleton({ wide = false }: { wide?: boolean }) {
  return <div className={`hg-catalog-skeleton ${wide ? "is-wide" : ""}`} role="status" aria-label="正在加载作品">
    {Array.from({ length: wide ? 6 : 4 }, (_, index) => <div key={index}><div className="hg-skeleton hg-skeleton-cover" /><div className="hg-skeleton h-3 mt-3 w-4/5" /><div className="hg-skeleton h-2 mt-2 w-3/5" /></div>)}
  </div>;
}

/* ——— 分类横向卡片 ——— */
export function RowCard({ v, onOpen }: { v: VideoCard; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="w-[104px] shrink-0 text-left snap-start pressable group">
      <div className="relative w-full rounded-(--r-sm) overflow-hidden bg-s1 elev-1" style={{ paddingTop: "133%" }}>
        <Img src={v.cover} />
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/75 to-transparent" />
        <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md text-[8.5px] font-bold brand-grad">
          {v.is_finished ? "完结" : `${v.episode_count}集`}
        </span>
        <span className="absolute bottom-1.5 right-1.5 flex items-center gap-0.5 text-[9px] font-semibold text-white/90 tsh"><IPlayF size={9} />{fmt(v.hot)}</span>
      </div>
      <div className="mt-1.5 text-[11.5px] font-medium text-on clamp-1 leading-tight">{v.title}</div>
      <div className="text-[10px] text-mut clamp-1 mt-0.5">{v.tags?.slice(0, 2).join(" · ")}</div>
    </button>
  );
}

/* ——— 排行榜条目 ——— */
export function RankRow({ item, onOpen, metricMax }: {
  item: { rank: number; video_id: number; title: string; cover: string; tags: string[]; score: number; metric_value: number; metric_label: string };
  onOpen: () => void; metricMax: number;
}) {
  const i = item.rank - 1;
  return (
    <button onClick={onOpen}
      className={`w-full flex items-center gap-3 p-2.5 rounded-(--r-md) text-left mb-2 pressable a-rise ${i < 3 ? "bg-s3" : "bg-s2"}`}
      style={{ animationDelay: `${Math.min(i * 35, 300)}ms` }}>
      <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[13px] font-bold shrink-0 tabular-nums ${i === 0 ? "bg-primary text-on-primary" : i < 3 ? "tonal" : "text-dim"}`}>{item.rank}</span>
      <div className="relative w-[52px] h-[68px] rounded-lg overflow-hidden bg-s3 shrink-0">
        <Img src={item.cover} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] font-medium text-on clamp-2 leading-snug">{item.title}</div>
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-[10px] text-mut truncate">{item.tags?.slice(0, 2).join(" · ")}</span>
          <span className="flex items-center gap-0.5 text-[10px] font-bold text-primary">{fmt(item.metric_value)}</span>
        </div>
        <div className="mt-1.5 h-[3px] rounded-full bg-s4 overflow-hidden">
          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(6, Math.round((item.metric_value / Math.max(1, metricMax)) * 100))}%` }} />
        </div>
      </div>
    </button>
  );
}
