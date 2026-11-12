import Feed from "../components/Feed";
import { api } from "../api";
import { usePaged } from "../hooks";
import { Empty } from "../components/ui";
import { useStore } from "../store";
import { IPlayF } from "../icons";

/** The original continuous player remains available as its own destination. */
export default function Watch({ active, bottomInset }: { active: boolean; bottomInset: number }) {
  const { homeChannel } = useStore();
  const { items, loading, error, loadMore, reset } = usePaged((page) => homeChannel ? api.category(homeChannel, page, 10) : api.feed(page, 10), [homeChannel]);
  return <div className="absolute inset-0 bg-black">
    {items.length ? <Feed videoIds={items.map((item) => item.id)} mode="home" active={active} bottomInset={bottomInset} onNearEnd={() => { if (active && !loading && !error) void loadMore(); }} />
      : loading ? <div className="absolute inset-0 flex items-center justify-center"><div className="w-9 h-9 spinner" /></div>
        : <Empty icon={<IPlayF size={24} />} title={error ? "推荐暂时无法加载" : "暂时没有推荐"} sub={error || undefined} action="重新加载" onAction={reset} />}
    {items.length > 0 && error && <div className="hg-feed-load-error"><span>后续推荐加载失败</span><button onClick={loadMore}>重试</button></div>}
  </div>;
}
