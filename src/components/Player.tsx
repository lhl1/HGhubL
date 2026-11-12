import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import VideoSurface, { type VideoHandle } from "./VideoSurface";
import PlayerControls from "./PlayerControls";
import { IPlayF } from "../icons";
import { usePlayerChrome } from "../immersive";

type Props = {
  src: string; poster?: string; autoPlay?: boolean; active?: boolean; muted?: boolean; loop?: boolean;
  onEnded?: () => void; onPlaying?: () => void; onTogglePlay?: (playing: boolean) => void;
  onToggleMute?: () => void; controls?: boolean; className?: string;
};

/** Embedded content shares the same media engine and controls as the main feed. */
export default function Player({ src, poster, autoPlay, active = true, muted, loop, onEnded, onPlaying, onTogglePlay, onToggleMute, controls = true, className = "" }: Props) {
  const store = useStore();
  const video = useRef<VideoHandle>(null), wrap = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(true), [waiting, setWaiting] = useState(true), [error, setError] = useState("");
  const [wanted, setWanted] = useState(autoPlay ?? store.preferences.autoplay);
  const [time, setTime] = useState(0), [duration, setDuration] = useState(0), [attempt, setAttempt] = useState(0);
  const [rate, setRate] = useState(store.preferences.defaultRate), [full, setFull] = useState(false);
  const immersive = full || store.nativeFullscreen;
  const chrome = usePlayerChrome(immersive, active, paused);
  const resume = useRef(0);
  const retry = () => { resume.current = video.current?.el()?.currentTime || time; setError(""); setWaiting(true); setWanted(true); setAttempt((value) => value + 1); };
  useEffect(() => {
    const changed = () => setFull(document.fullscreenElement === wrap.current);
    document.addEventListener("fullscreenchange", changed); return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  useEffect(() => { setTime(0); setDuration(0); setError(""); setWaiting(true); }, [src]);
  return <div ref={wrap} className={`relative bg-black overflow-hidden hg-player-ui ${immersive ? "is-immersive" : ""} ${!chrome.visible ? "is-idle" : ""} ${error ? "has-playback-error" : ""} ${className}`}
    onPointerMove={chrome.move} onPointerDown={chrome.reveal} onPointerLeave={() => { if (immersive) chrome.hide(); }}>
    <VideoSurface key={`${src}:${attempt}`} ref={video} src={src} poster={poster} autoPlay={wanted} active={active}
      muted={muted ?? store.muted} volume={store.volume} rate={rate} loop={loop} enhancedBuffer={store.preferences.enhancedBuffer}
      onClick={() => video.current?.toggle()} onIntent={setWanted} onResumeRequired={retry}
      onPlaying={() => { setPaused(false); setWaiting(false); setError(""); onPlaying?.(); onTogglePlay?.(true); }}
      onPause={() => { setPaused(true); onTogglePlay?.(false); }} onWaiting={() => setWaiting(true)} onTime={setTime}
      onDuration={(value) => { setDuration(value); if (resume.current > 0 && resume.current < value - 1) video.current?.seek(resume.current); resume.current = 0; }}
      onEnded={onEnded} onError={(message) => { setWaiting(false); setError(message); }} />
    {waiting && !error && <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><div className="w-8 h-8 spinner" /></div>}
    {paused && !waiting && !error && !immersive && <button className="absolute inset-0 flex items-center justify-center" aria-label="播放视频" onClick={() => video.current?.play()}><span className="w-14 h-14 rounded-full bg-black/50 flex items-center justify-center"><IPlayF size={24} className="text-white" /></span></button>}
    {!!error && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/65 text-white text-xs"><span>{error}</span><button className="hg-link" onClick={retry}>重试</button></div>}
    {controls && <PlayerControls paused={paused} time={time} duration={duration} rate={rate} muted={muted ?? store.muted} volume={store.volume} fullscreen={full}
      visible={chrome.visible} onActivity={chrome.reveal} onMenuOpenChange={chrome.setHeld}
      onExitImmersive={immersive ? () => { store.exitImmersive(); } : undefined}
      onToggle={() => video.current?.toggle()} onSeek={(value) => { video.current?.seek(value); setTime(value); }} onRate={setRate}
      onMute={() => onToggleMute ? onToggleMute() : store.setMuted((value) => !value)} onVolume={store.setVolume}
      onPip={() => { const element = video.current?.el(); if (element && document.pictureInPictureEnabled) void element.requestPictureInPicture().catch(() => {}); }}
      onFullscreen={() => { if (document.fullscreenElement || store.nativeFullscreen) store.exitImmersive(); else void wrap.current?.requestFullscreen().catch(() => {}); }} />}
  </div>;
}
