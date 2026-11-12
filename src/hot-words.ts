export function normalizeHotWords(input: { word?: unknown; heat?: unknown }[]) {
  const words = new Map<string, { word: string; heat: number }>();
  for (const item of input) {
    if (typeof item?.word !== "string") continue;
    const text = item.word.trim();
    const parts = /[#＃]/.test(text) ? [...text.matchAll(/[#＃]([^#＃]+)/g)].map(match => match[1]) : [text];
    for (const part of parts) {
      const word = part.trim().replace(/^[，,。！!：:;；、]+|[，,。！!：:;；、]+$/g, "").trim();
      if (!word || [...word].length > 24 || /https?:|[<>]/i.test(word)) continue;
      const value = Number(item.heat), heat = Number.isFinite(value) && value > 0 ? value : 0;
      const previous = words.get(word);
      if (!previous || heat > previous.heat) words.set(word, { word, heat });
    }
  }
  return [...words.values()];
}
