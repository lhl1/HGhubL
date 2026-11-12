import { useState } from "react";
import type { Episode } from "../types";
import type { VideoRatingState } from "../ratings";
import { IClose, IList, IStarF } from "../icons";
import PlayerPopover from "./PlayerPopover";

export type EpisodeControl = { videoId: number; episodes: Episode[]; current: number; loading?: boolean; error?: string; onPick: (episode: number) => void; onRetry: () => void };
export function PlayerEpisodes({ control, visible, onOpenChange }: { control: EpisodeControl; visible: boolean; onOpenChange: (open: boolean) => void }) {
  const [query, setQuery] = useState(""), [ascending, setAscending] = useState(true);
  const { episodes, current } = control;
  const filtered = episodes.filter((item) => !query.trim() || String(item.ep_num).includes(query.trim()) || item.title?.includes(query.trim()));
  const items = ascending ? filtered : [...filtered].reverse();
  const tabEpisode = items.some((item) => item.ep_num === current) ? current : items[0]?.ep_num;
  return <PlayerPopover label="选集" enabled={visible} onOpenChange={(open) => { if (open) setQuery(""); onOpenChange(open); }} trigger={<><IList size={17} /><span>选集</span><small className="player-episode-count">{current}/{episodes.length || "—"}</small></>}>
    {(close) => <><header><div><strong>选集</strong><small>当前第 {current} 集 · 共 {episodes.length} 集</small></div><button type="button" aria-label="关闭选集" onClick={close}><IClose size={17} /></button></header>
      <div className="player-episode-toolbar"><input data-initial-focus aria-label="查找集数" type="search" inputMode="search" placeholder="输入集数或标题" value={query} onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
          const exact = episodes.find((item) => item.ep_num === Number(query.trim())) || (items.length === 1 ? items[0] : undefined);
          if (exact) { event.preventDefault(); control.onPick(exact.ep_num); close(); }
        }} /><button type="button" onClick={() => setAscending((value) => !value)}>{ascending ? "倒序" : "正序"}</button></div>
      <div className="player-episode-body">
        {control.loading ? <p role="status">正在加载剧集</p> : control.error ? <div className="player-tool-error" role="alert"><p>选集加载失败</p><small>{control.error}</small><button type="button" onClick={control.onRetry}>重试选集</button></div>
          : !items.length ? <p>{episodes.length ? "没有匹配的集数" : "暂无选集"}</p> : <div className="player-episode-grid" aria-label="剧集列表" onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
            const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-episode]")];
            const index = buttons.indexOf(event.target as HTMLButtonElement); if (index < 0) return;
            event.preventDefault(); event.stopPropagation();
            const step = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" ? -6 : 6;
            buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + step))]?.focus();
          }}>{items.map((episode) => <button key={episode.ep_num} type="button" data-episode={episode.ep_num} aria-label={`播放第 ${episode.ep_num} 集`} aria-current={episode.ep_num === current ? "true" : undefined}
            tabIndex={episode.ep_num === tabEpisode ? 0 : -1} title={episode.title || `第 ${episode.ep_num} 集`} onClick={() => { control.onPick(episode.ep_num); close(); }}>{episode.ep_num}</button>)}</div>}
      </div><footer>选择剧集后切换播放</footer>
    </>}
  </PlayerPopover>;
}

export function PlayerRating({ state, visible, onOpenChange }: { state: VideoRatingState; visible: boolean; onOpenChange: (open: boolean) => void }) {
  return <PlayerPopover label="评分" width={310} enabled={visible} onOpenChange={onOpenChange} className="player-rating-trigger"
    trigger={<><IStarF size={14} /><span>{state.score > 0 ? `${state.score.toFixed(1)} 分` : "暂无评分"}</span></>}>
    {(close) => <><header><div><strong>综合评分</strong><small>{state.count === null ? "" : `${state.count} 人评分`}</small></div><button type="button" aria-label="关闭评分" onClick={close}><IClose size={17} /></button></header>
      <div className="player-rating-body"><div className="player-rating-score" aria-label="接口综合评分">{state.score > 0 ? state.score.toFixed(1) : "暂无"}<small>{state.score > 0 ? "/ 10 分" : "评分"}</small></div>
        {state.loading && <p role="status">正在读取评分</p>}
        {!!state.error && <div className="player-tool-error" role="alert"><p>评分加载失败</p><small>{state.error}</small><button type="button" onClick={() => { void state.reload(); }}>重试评分</button></div>}

      </div>
    </>}
  </PlayerPopover>;
}
