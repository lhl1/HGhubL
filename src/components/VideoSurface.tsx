import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type Hls from "hls.js";
import { isLocalMedia, mediaUrl } from "../api";

export type VideoHandle = {
  el: () => HTMLVideoElement | null; play: () => void; pause: () => void; toggle: () => void;
  seek: (time: number) => void; rate: (rate: number) => void; mute: (muted: boolean) => void; volume: (volume: number) => void;
};
type Props = {
  src: string; poster?: string; autoPlay?: boolean; active?: boolean; enhancedBuffer?: boolean;
  muted?: boolean; loop?: boolean; fit?: "contain" | "cover"; volume?: number; rate?: number;
  onTime?: (time: number) => void; onDuration?: (duration: number) => void; onSize?: (width: number, height: number) => void;
  onPlaying?: () => void; onPause?: () => void; onWaiting?: () => void; onEnded?: () => void;
  onError?: (message: string) => void; onClick?: () => void; onIntent?: (playing: boolean) => void;
  onResumeRequired?: () => void; className?: string;
};

/** Bounded HLS buffering, explicit play intent, lazy codec loading and complete teardown. */
const VideoSurface = forwardRef<VideoHandle, Props>(function VideoSurface(props, ref) {
  const { src, poster, autoPlay = true, active = true, enhancedBuffer = true, muted = false, loop = false,
    fit = "contain", volume = 1, rate = 1, className = "" } = props;
  const videoRef = useRef<HTMLVideoElement>(null), hlsRef = useRef<Hls | null>(null);
  const callbacks = useRef(props); callbacks.current = props;
  const wanted = useRef(autoPlay), released = useRef(false), releaseTimer = useRef<number | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const visible = () => callbacks.current.active !== false && document.visibilityState !== "hidden";
  const report = (message: string) => callbacks.current.onError?.(message);
  const start = () => {
    if (!visible() || !wanted.current) return;
    window.clearTimeout(releaseTimer.current);
    if (released.current) { callbacks.current.onResumeRequired?.(); return; }
    const video = videoRef.current;
    if (video?.src) video.play().catch((error: DOMException) => {
      if (error.name === "AbortError") return;
      if (error.name === "NotAllowedError") {
        wanted.current = false; callbacks.current.onIntent?.(false); callbacks.current.onPause?.();
      } else report("浏览器无法播放当前媒体，请重试");
    });
  };
  const suspend = () => {
    videoRef.current?.pause();
    window.clearTimeout(releaseTimer.current);
    releaseTimer.current = window.setTimeout(() => {
      hlsRef.current?.stopLoad(); released.current = true;
    }, 60_000);
  };
  const intent = (play: boolean) => {
    wanted.current = play; callbacks.current.onIntent?.(play);
    if (play) start(); else suspend();
  };
  useImperativeHandle(ref, () => ({
    el: () => videoRef.current,
    play: () => intent(true), pause: () => intent(false), toggle: () => intent(videoRef.current?.paused ?? true),
    seek: (time) => {
      const video = videoRef.current;
      if (video && Number.isFinite(time)) video.currentTime = Math.max(0, Math.min(Number.isFinite(video.duration) ? video.duration : time, time));
    },
    rate: (value) => { if (videoRef.current && Number.isFinite(value) && value > 0) videoRef.current.playbackRate = value; },
    mute: (value) => { if (videoRef.current) videoRef.current.muted = value; },
    volume: (value) => { if (videoRef.current && Number.isFinite(value)) videoRef.current.volume = Math.max(0, Math.min(1, value)); },
  }), []);

  const applySettings = () => {
    const video = videoRef.current; if (!video) return;
    video.volume = Math.max(0, Math.min(1, callbacks.current.volume ?? 1));
    video.muted = callbacks.current.muted ?? false;
    video.playbackRate = callbacks.current.rate ?? 1;
  };
  useEffect(applySettings, [volume, muted, rate]);
  useEffect(() => {
    wanted.current = autoPlay;
    if (active && document.visibilityState !== "hidden" && wanted.current) start(); else suspend();
    // Latest callbacks and settings are read through refs; never recreate the stream for play/pause.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay, active]);
  useEffect(() => {
    const visibility = () => { if (visible() && wanted.current) start(); else suspend(); };
    document.addEventListener("visibilitychange", visibility);
    return () => { document.removeEventListener("visibilitychange", visibility); window.clearTimeout(releaseTimer.current); };
  }, []);
  useEffect(() => {
    const hls = hlsRef.current;
    if (hls) { hls.config.maxBufferLength = enhancedBuffer ? 60 : 20; hls.config.maxBufferSize = (enhancedBuffer ? 32 : 20) * 1024 * 1024; }
  }, [enhancedBuffer]);

  useEffect(() => {
    const video = videoRef.current; if (!video || !src) return;
    let disposed = false, failed = false;
    let lastTime = -1, lastProgress = performance.now();
    released.current = false; setReady(false); applySettings();
    const url = isLocalMedia(src) ? src : mediaUrl(src);
    const fail = (message: string) => {
      if (disposed || failed) return;
      failed = true; hlsRef.current?.stopLoad(); report(message);
    };
    if (url.includes("/hls?u=")) {
      void import("hls.js").then(({ default: Hls }) => {
        if (disposed) return;
        if (!Hls.isSupported()) { video.src = url; start(); return; }
        const enhanced = callbacks.current.enhancedBuffer !== false;
        const hls = new Hls({
          interstitialsController: undefined, contentSteeringController: undefined, enableInterstitialPlayback: false,
          enableWorker: true, maxBufferLength: enhanced ? 60 : 20, maxMaxBufferLength: 90,
          maxBufferSize: (enhanced ? 32 : 20) * 1024 * 1024, backBufferLength: 15,
          manifestLoadingTimeOut: 15000, manifestLoadingMaxRetry: 2, levelLoadingMaxRetry: 2, fragLoadingMaxRetry: 3,
        });
        hlsRef.current = hls;
        hls.on(Hls.Events.MANIFEST_PARSED, start);
        hls.on(Hls.Events.ERROR, (_event, error) => {
          if (error.fatal) fail(`播放中断 · ${error.details}`);
        });
        hls.loadSource(url); hls.attachMedia(video);
      }).catch(() => fail("播放器组件加载失败，请重试"));
    } else { video.src = url; start(); }
    const watchdog = window.setInterval(() => {
      if (disposed || failed) return;
      const now = performance.now();
      if (!wanted.current || !visible() || video.paused || video.ended || video.seeking) { lastProgress = now; lastTime = video.currentTime; return; }
      if (Math.abs(video.currentTime - lastTime) > .15) { lastProgress = now; lastTime = video.currentTime; }
      else if (now - lastProgress > (callbacks.current.enhancedBuffer === false ? 20_000 : 12_000)) fail("视频长时间未响应，正在刷新播放地址");
    }, 1000);
    return () => {
      disposed = true; window.clearInterval(watchdog); window.clearTimeout(releaseTimer.current);
      hlsRef.current?.destroy(); hlsRef.current = null;
      video.pause(); video.removeAttribute("src"); video.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  return <video ref={videoRef} poster={poster} playsInline loop={loop} preload="metadata"
    onClick={props.onClick} className={`w-full h-full bg-black ${fit === "cover" ? "object-cover" : "object-contain"} ${className}`}
    style={{ opacity: ready || poster ? 1 : 0, transition: "opacity .25s" }}
    onLoadedData={() => { setReady(true); applySettings(); }}
    onLoadedMetadata={(event) => {
      const video = event.currentTarget; applySettings();
      callbacks.current.onDuration?.(Number.isFinite(video.duration) ? video.duration : 0);
      callbacks.current.onSize?.(video.videoWidth, video.videoHeight);
      start();
    }}
    onTimeUpdate={(event) => callbacks.current.onTime?.(event.currentTarget.currentTime)}
    onPause={() => callbacks.current.onPause?.()} onWaiting={() => callbacks.current.onWaiting?.()}
    onPlaying={() => callbacks.current.onPlaying?.()}
    onError={(event) => { if (event.currentTarget.error && event.currentTarget.hasAttribute("src")) report(`媒体加载失败 (${event.currentTarget.error.code})`); }}
    onEnded={() => callbacks.current.onEnded?.()} />;
});
export default VideoSurface;
