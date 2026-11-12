import { useEffect, useRef, useState } from "react";
import { api, APP_VERSION, fmt, fmtTime, platform } from "../api";
import type { Detail } from "../types";
import { useStore } from "../store";
import { Avatar, Empty, Img } from "../components/ui";
import { IChevR, IClock, ILogout, ISettings, IStar, IUser } from "../icons";

/* 我的：结构固定（资料卡 + 我的收藏 / 观看历史）。
   收藏与观看记录都存在本地，所以未登录也照常展示；未登录时资料卡本身就是登录入口。 */
export default function Profile({ wide }: { wide: boolean }) {
  const { user, setLoginOpen, logout, history, favs, clearHistory, push, libraryTab: tab, setLibraryTab: setTab } = useStore();
  const [cards, setCards] = useState<Detail[]>([]);
  const [loading, setLoading] = useState(false);
  const [limit, setLimit] = useState(12), [reload, setReload] = useState(0), [failed, setFailed] = useState(false);
  const cache = useRef(new Map<number, Detail>());

  const ids = tab === "fav" ? favs : history.map((h) => h.id);
  /** 观看记录里这条的进度（收藏页没有） */
  const progressOf = (id: number) => (tab === "history" ? history.find((h) => h.id === id) : undefined);

  useEffect(() => {
    let alive = true;
    if (!ids.length) { setCards([]); setLoading(false); setFailed(false); return; }
    const requested = ids.slice(0, limit), missing = requested.filter((id) => !cache.current.has(id));
    setCards(requested.flatMap((id) => cache.current.get(id) || []));
    setLoading(missing.length > 0); setFailed(false);
    void (async () => {
      let failures = 0;
      for (let offset = 0; offset < missing.length && alive; offset += 4) {
        const results = await Promise.allSettled(missing.slice(offset, offset + 4).map((id) => api.video(id)));
        if (!alive) return;
        for (const result of results) { if (result.status === "fulfilled" && result.value) cache.current.set(result.value.id, result.value); else ++failures; }
        setCards(requested.flatMap((id) => cache.current.get(id) || []));
      }
      if (alive) { setLoading(false); setFailed(failures > 0); }
    })();
    return () => { alive = false; };
  }, [ids.join(","), limit, reload]);

  return (
    <div className="absolute inset-0 bg-bg flex flex-col">
      <div className="shrink-0 px-4 pb-2 flex items-center" style={{ paddingTop: "calc(var(--sat, 0px) + 14px)" }}>
        <div className="text-[24px] font-bold text-on leading-none">我的</div>
        {platform === "android" && (
          <button onClick={() => push({ kind: "settings" })} aria-label="设置"
            className="ml-auto w-9 h-9 rounded-full bg-s3 flex items-center justify-center text-mut pressable">
            <ISettings size={17} strokeWidth={1.7} />
          </button>
        )}
      </div>

      <div className="flex-1 scroll-y px-4 pt-2 pb-24">
        {/* 资料卡：已登录 / 未登录（点开登录抽屉） */}
        {user ? (
          <div className="rounded-(--r-lg) bg-s1 p-4 elev-1 flex items-center gap-3.5 a-rise">
            <Avatar size={56} name={user.nickname} hue={280} ring />
            <div className="flex-1 min-w-0">
              <div className="text-[16px] font-bold text-on truncate">{user.nickname}</div>
              <div className="text-[11px] text-mut mt-0.5">@{user.username} · ID {user.id}</div>
              <div className="flex gap-3 mt-2 text-[10.5px] text-mut">
                <span>点赞 <b className="text-on">{fmt(user.counts?.like)}</b></span>
                <span>收藏 <b className="text-on">{fmt(user.counts?.collect)}</b></span>
                <span>关注 <b className="text-on">{fmt(user.counts?.following)}</b></span>
              </div>
            </div>
            <button onClick={async () => { await logout(); }}
              className="w-9 h-9 rounded-full bg-s3 flex items-center justify-center text-mut pressable" aria-label="退出登录">
              <ILogout size={17} />
            </button>
          </div>
        ) : (
          <button onClick={() => setLoginOpen(true)}
            className="w-full text-left rounded-(--r-lg) bg-s1 p-4 elev-1 flex items-center gap-3.5 pressable a-rise">
            <Avatar size={56} icon={<IUser size={26} />} hue={220} ring />
            <div className="flex-1 min-w-0">
              <div className="text-[16px] font-bold text-on">未登录</div>
              <div className="text-[11px] text-mut mt-0.5">登录后可同步点赞、收藏与评论</div>
              <div className="flex gap-3 mt-2 text-[10.5px] text-mut">
                <span>收藏 <b className="text-on">{favs.length}</b></span>
                <span>观看 <b className="text-on">{history.length}</b></span>
              </div>
            </div>
            <span className="flex items-center gap-0.5 h-8 pl-3 pr-2 rounded-full bg-primary text-on-primary text-[11.5px] font-semibold">
              登录<IChevR size={13} />
            </span>
          </button>
        )}

        {/* 我的内容 */}
        <div className="flex bg-s3 rounded-(--r-ctl) p-1 mt-4">
          {([["fav", "我的收藏"], ["history", "观看历史"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`flex-1 h-8 rounded-(--r-ctl) text-[12px] font-semibold pressable ${tab === k ? "tonal text-on-sec" : "text-mut"}`}
              style={tab === k ? { background: "var(--p-sec)", color: "var(--p-primary)" } : undefined}>{l}</button>
          ))}
        </div>

        <div className="mt-3">
          {loading && !cards.length ? (
            <div className="flex justify-center py-8"><div className="w-7 h-7 spinner" /></div>
          ) : cards.length ? (
            <div className="grid grid-cols-3 gap-2">
              {cards.map((c) => {
                const p = progressOf(c.id);
                return (
                <button key={c.id} onClick={() => push({
                  kind: "feed", videoIds: cards.map((x) => x.id), index: cards.findIndex((x) => x.id === c.id),
                  title: tab === "fav" ? "我的收藏" : "观看历史",
                  startEp: p?.ep, startTime: p?.t,
                })}
                  className="relative rounded-(--r-sm) overflow-hidden bg-s1 elev-1 pressable" style={{ paddingTop: "133%" }}>
                  <Img src={c.cover} />
                  {!!p && (
                    <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-full bg-black/65 text-[9.5px] text-white/90 leading-none">
                      第 {p.ep} 集{p.t > 3 ? ` · ${fmtTime(p.t)}` : ""}
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-1.5">
                    <div className="text-[10.5px] text-white clamp-2 leading-tight">{c.title}</div>
                  </div>
                </button>
                );
              })}
            </div>
          ) : (
            <Empty icon={tab === "fav" ? <IStar size={24} /> : <IClock size={24} />}
              title={failed ? "作品暂时无法加载" : tab === "fav" ? "还没有收藏" : "还没有观看记录"}
              sub={failed ? "本地记录仍然保留，可以重新加载" : tab === "fav" ? "在剧集页点收藏，之后就能在这里找到" : "看过的剧集会出现在这里"}
              action={failed ? "重新加载" : "去逛逛"} onAction={failed ? () => setReload((value) => value + 1) : () => push({ kind: "ranks" })} />
          )}
          {cards.length > 0 && (failed || limit < ids.length || loading) && <div className="hg-load-more">
            {loading ? <span>正在加载更多作品</span> : <button onClick={() => failed ? setReload((value) => value + 1) : setLimit((value) => value + 12)}>{failed ? "重试未加载的作品" : `查看更多 · 共 ${ids.length} 部`}</button>}
          </div>}
          {cards.length > 0 && tab === "history" && (
            <button onClick={clearHistory} className="mt-3 w-full h-9 rounded-(--r-ctl) bg-s3 text-[12px] text-mut pressable">清空观看历史</button>
          )}
        </div>

        <div className="text-center text-[10px] text-dim mt-5">HGhub {APP_VERSION} · {platform === "android" ? "Android" : platform === "macos" ? "macOS" : "Windows"} 客户端</div>
      </div>
    </div>
  );
}
