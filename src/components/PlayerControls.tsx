import { fmtTime } from "../api";
import { IBack, ICompress, IExpand, INext, IPauseF, IPip, IPlayF, ITheater, IVol, IVolMute } from "../icons";
import SelectMenu from "./SelectMenu";
import { PLAYBACK_RATES } from "../preferences";
import { useEffect, useRef, useState } from "react";
import { PlayerEpisodes, PlayerRating, type EpisodeControl } from "./PlayerTools";
import type { VideoRatingState } from "../ratings";

type Props = {
  paused: boolean;
  time: number;
  duration: number;
  buffered?: number;
  rate: number;
  muted: boolean;
  volume: number;
  theater?: boolean;
  fullscreen?: boolean;
  visible?: boolean;
  nextDisabled?: boolean;
  previousDisabled?: boolean;
  nextTitle?: string;
  onToggle: () => void;
  onSeek: (t: number) => void;
  onRate: (r: number) => void;
  onMute: () => void;
  onVolume: (v: number) => void;
  onPip: () => void;
  onTheater?: () => void;
  onFullscreen: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  onExitImmersive?: () => void;
  onActivity?: () => void;
  onMenuOpenChange?: (open: boolean) => void;
  episodeControl?: EpisodeControl;
  rating?: VideoRatingState;
  onToolsOpen?: () => void;
};

const clock = (s: number) => fmtTime(Math.max(0, s || 0)).padStart(5, "0");

export default function PlayerControls({
  paused, time, duration, buffered = 0, rate, muted, volume, theater = false, fullscreen = false,
  visible = true, nextDisabled = false, previousDisabled = false, nextTitle = "下一个", onToggle, onSeek, onRate, onMute, onVolume, onPip, onTheater, onFullscreen, onNext, onPrevious,
  onExitImmersive, onActivity, onMenuOpenChange, episodeControl, rating, onToolsOpen,
}: Props) {
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const seekPointer = useRef<number | null>(null);
  const shownTime = seekPreview ?? time;
  const pct = duration ? Math.min(100, shownTime / duration * 100) : 0;
  const cancelSeek = () => { seekPointer.current = null; setSeekPreview(null); };
  const [menuOpen, setMenuOpen] = useState(false), [dragging, setDragging] = useState(false);
  const [episodesOpen, setEpisodesOpen] = useState(false), [ratingOpen, setRatingOpen] = useState(false);
  const toolOpen = menuOpen || episodesOpen || ratingOpen;
  useEffect(() => { onMenuOpenChange?.(toolOpen || dragging); }, [toolOpen, dragging, onMenuOpenChange]);
  useEffect(() => { if (toolOpen) onToolsOpen?.(); }, [toolOpen, onToolsOpen]);
  useEffect(() => {
    const release = () => { setDragging(false); cancelSeek(); };
    window.addEventListener("pointerup", release); window.addEventListener("pointercancel", release);
    window.addEventListener("blur", release); window.addEventListener("hg-exit-immersive", release);
    return () => {
      window.removeEventListener("pointerup", release); window.removeEventListener("pointercancel", release);
      window.removeEventListener("blur", release); window.removeEventListener("hg-exit-immersive", release);
    };
  }, []);

  return (
    <div className={`desktop-controls ${fullscreen ? "is-fullscreen" : ""} ${visible ? "" : "is-hidden"}`}
      inert={!visible} aria-hidden={!visible}
      onPointerDown={(e) => {
        e.stopPropagation(); onActivity?.();
        if (e.target instanceof HTMLInputElement && e.target.type === "range") setDragging(true);
      }}
      onPointerMove={onActivity} onFocusCapture={onActivity} onKeyDownCapture={onActivity}>
      <div className="desktop-seek">
        <div className="desktop-seek-track">
          <span className="desktop-seek-buffer" style={{ width: `${Math.min(1, buffered) * 100}%` }} />
          <span className="desktop-seek-played" style={{ width: `${pct}%` }} />
        </div>
        <input aria-label="播放进度" aria-valuetext={`${clock(shownTime)} / ${clock(duration)}`} disabled={duration <= 0} type="range" min={0} max={duration || 1} step={0.1} value={Math.min(shownTime, duration || 0)}
          onPointerDown={(event) => {
            if (event.button !== 0 || duration <= 0) return;
            seekPointer.current = event.pointerId; setSeekPreview(time);
            try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Native range still handles release. */ }
          }}
          onChange={(event) => {
            const value = Number(event.currentTarget.value);
            if (seekPointer.current !== null) setSeekPreview(value);
            else onSeek(value);
          }}
          onPointerUp={(event) => {
            if (seekPointer.current !== event.pointerId) return;
            const value = Number(event.currentTarget.value);
            cancelSeek(); onSeek(value);
          }}
          onPointerCancel={cancelSeek} onLostPointerCapture={cancelSeek}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); event.stopPropagation(); onSeek(Math.max(0, Math.min(duration, shownTime + (event.key === "ArrowLeft" ? -5 : 5)))); }
          }} />
      </div>

      <div className="desktop-control-row">
        {onExitImmersive && <button className="player-control" aria-label="返回普通窗口" data-tooltip="返回普通窗口 Esc" onClick={onExitImmersive}><IBack size={19} /></button>}
        <button className="player-control primary-play" aria-label={paused ? "播放" : "暂停"} data-tooltip={paused ? "播放 Space" : "暂停 Space"} onClick={onToggle}>
          {paused ? <IPlayF size={19} /> : <IPauseF size={18} />}
        </button>
        {onPrevious && <button className="player-control" aria-label="上一集" data-tooltip="上一集 Q" disabled={previousDisabled} onClick={onPrevious}><INext size={18} className="rotate-180" /></button>}
        {onNext && (
          <button className="player-control" aria-label={nextTitle} data-tooltip={nextTitle} disabled={nextDisabled} onClick={onNext}>
            <INext size={18} strokeWidth={1.7} />
          </button>
        )}
        <span className="player-timecode"><span>{clock(shownTime)}</span><span className="player-time-separator">/</span>{clock(duration)}</span>
        <div className="player-control-spacer" />
        {rating && <PlayerRating key={`rating:${episodeControl?.videoId}`} state={rating} visible={visible} onOpenChange={setRatingOpen} />}
        {episodeControl && <PlayerEpisodes key={`episodes:${episodeControl.videoId}`} control={episodeControl} visible={visible} onOpenChange={setEpisodesOpen} />}
        <div className="player-speed-slot">
          <SelectMenu label="倍速" value={String(rate)} media onOpenChange={setMenuOpen} options={PLAYBACK_RATES.map((value) => ({ value: String(value), label: `${value === 1 ? "1.0" : value}x` }))} onChange={(value) => onRate(Number(value))} />
        </div>
        <div className="player-volume">
          <button className="player-control" aria-label={muted ? "开启声音" : "静音"} data-tooltip="静音 M" onClick={onMute}>
            {muted || volume === 0 ? <IVolMute size={20} strokeWidth={1.6} /> : <IVol size={20} strokeWidth={1.6} />}
          </button>
          <div className="player-volume-slider">
            <input aria-label="音量" type="range" min={0} max={1} step={0.01} value={muted ? 0 : volume}
              style={{ "--fill": `${(muted ? 0 : volume) * 100}%` } as React.CSSProperties}
              onChange={(e) => onVolume(Number(e.target.value))} />
          </div>
        </div>
        <button className="player-control" aria-label="画中画" data-tooltip="画中画" onClick={onPip}><IPip size={20} strokeWidth={1.6} /></button>
        {!fullscreen && onTheater && (
          <button className={`player-control ${theater ? "is-on" : ""}`} aria-label="全屏窗口" aria-pressed={theater}
            data-tooltip={theater ? "退出全屏窗口 T / Esc" : "全屏窗口 T"} onClick={onTheater}><ITheater size={20} strokeWidth={1.6} /></button>
        )}
        <button className="player-control" aria-label={fullscreen ? "退出全屏" : "全屏"} data-tooltip={fullscreen ? "退出全屏 Esc" : "全屏 F"} onClick={onFullscreen}>
          {fullscreen ? <ICompress size={19} strokeWidth={1.6} /> : <IExpand size={19} strokeWidth={1.6} />}
        </button>
      </div>
    </div>
  );
}
