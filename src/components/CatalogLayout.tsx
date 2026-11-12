import { createContext, useContext, useEffect, useState } from "react";
import { IGrid, IList } from "../icons";
import type { CatalogLayout } from "../preferences";

const Context = createContext<{ layout: CatalogLayout; setLayout: (layout: CatalogLayout) => void }>({ layout: "grid", setLayout() {} });
export function CatalogLayoutProvider({ children, defaultLayout = "grid" }: { children: React.ReactNode; defaultLayout?: CatalogLayout }) {
  const [layout, setLayout] = useState<CatalogLayout>(defaultLayout);
  useEffect(() => setLayout(defaultLayout), [defaultLayout]);
  return <Context.Provider value={{ layout, setLayout }}>{children}</Context.Provider>;
}
export const useCatalogLayout = () => useContext(Context);
export function CatalogViewSwitch() {
  const { layout, setLayout } = useCatalogLayout();
  return <div className="ref-view-switch" role="group" aria-label="目录排列">
    <button aria-label="封面网格" title="卡片排列" aria-pressed={layout === "grid"} onClick={() => setLayout("grid")}><IGrid size={17} /></button>
    <button aria-label="详细列表" title="一行一部剧" aria-pressed={layout === "list"} onClick={() => setLayout("list")}><IList size={17} /></button>
  </div>;
}
