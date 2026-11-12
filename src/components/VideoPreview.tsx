import { ScoreBadge } from "./Score";
import { api, fmtTime } from "../api";
import { useAsync } from "../hooks";
import { useStore } from "../store";
import { IClose, IPlayF, IRefresh } from "../icons";
import { Img, Modal } from "./ui";

export default function VideoPreview() {
  const { preview, closePreview, startPreview, history } = useStore();
  const id = preview?.videoIds[preview.index];
  return id ? <PreviewBody key={id} id={id} onClose={closePreview} onPlay={startPreview} progress={history.find((entry) => entry.id === id)} /> : null;
}

function PreviewBody({ id, onClose, onPlay, progress }: {
  id: number; onClose: () => void; onPlay: (ep?: number, time?: number) => void;
  progress?: { ep: number; t: number; dur: number };
}) {
  const { data, loading, error, reload } = useAsync(() => api.video(id), [id]);
  const resumed = progress && (!progress.dur || progress.t < progress.dur - 3);
  return <Modal open onClose={onClose} width={680} label="剧集详情">
    <div className="hg-preview">
      <header><span>剧集详情</span><button aria-label="关闭详情" onClick={onClose}><IClose size={19} /></button></header>
      <div className="hg-preview-body" aria-busy={loading}>
        {loading ? <div className="hg-preview-loading"><div className="hg-skeleton hg-preview-poster" /><div className="flex-1 space-y-4"><div className="hg-skeleton h-7" /><div className="hg-skeleton h-28" /></div></div>
          : error ? <div className="hg-preview-error" role="alert"><span>详情暂时无法加载</span><small>{error}</small><button onClick={reload}><IRefresh size={14} />重试</button></div>
          : data ? <>
            <div className="hg-preview-summary">
              <div className="hg-preview-poster"><Img src={data.cover} eager /></div>
              <div className="min-w-0 flex-1">
                <h2>{data.title}</h2>
                <div className="hg-preview-meta">{data.episode_count || data.episodes?.length || 0} 集{data.is_finished ? " · 已完结" : " · 连载中"} · <ScoreBadge score={data.score} /></div>
                <div className="hg-preview-tags">{data.tags?.slice(0, 5).map((tag) => <span key={tag}>{tag}</span>)}</div>
                <p>{data.description?.replace(/<[^>]*>/g, " ") || "暂无简介"}</p>
              </div>
            </div>
            <div className="hg-preview-actions">
              <button className="hg-action-primary" onClick={() => onPlay(resumed ? progress.ep : 1, resumed ? progress.t : 0)}><IPlayF size={15} />{resumed ? `继续第 ${progress.ep} 集 · ${fmtTime(progress.t)}` : "开始播放"}</button>
              {resumed && <button onClick={() => onPlay(1, 0)}>从头播放</button>}
            </div>
            {data.episodes?.length > 0 && <section className="hg-preview-episodes"><h3>选集 <small>{data.episodes.length} 集</small></h3>
              <div>{data.episodes.map((episode) => <button key={episode.ep_num} title={episode.title || `第 ${episode.ep_num} 集`}
                aria-label={`播放第 ${episode.ep_num} 集`} onClick={() => onPlay(episode.ep_num, 0)}>{episode.ep_num}</button>)}</div>
            </section>}
          </> : null}
      </div>
    </div>
  </Modal>;
}
