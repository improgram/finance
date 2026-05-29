// -------------------- Helpers Market --------------------

export const getCloses = (hist = []) => hist.map(d => d.close);
export const getMin = (arr) => arr.length ? Math.min(...arr) : null;
export const hasEnoughHist = (hist) => hist.length >= 10;
export const DIFF_TOLERANCE = 0.5;
export const HARD_DIFF_TOLERANCE = 1.2;
export const safeValue = (value) => (value == null || Number.isNaN(value)) ? null : value;
export const fallbackMin = (fallback) => fallback != null ? fallback : "N/E";
export const safeWithFallback = (newPreco, oldPreco) => newPreco == null ? (oldPreco ?? null) : newPreco;
export const safeNumber = (v, fallback = null) => {
  const n = Number(v);      // safeNumber -> sanitização
  return Number.isFinite(n) ? n : fallback;
};

export const filterByDays = (hist, days) => {
  if (!Array.isArray(hist)) return [];
  const now = Math.floor(Date.now() / 1000);
  const limit = now - (days * 24 * 60 * 60);
  const normalizeTs = (t) => t > 1e12 ? Math.floor(t / 1000) : t;
  return hist.filter(d => normalizeTs(d.date) >= limit);
};

export const getValidHist = (hist) => (hist || []).filter(d =>
  d &&
  typeof d.date === "number" &&
  typeof d.close === "number"
);

export const getVariation30d = (hist, currentPrice) => {
  if (!hist.length || currentPrice == null) return null;
  const valid = getValidHist(hist)
    .filter(d => d.close > 0)
    .sort((a, b) => a.date - b.date);

  if (!valid.length) return null;
  const now = new Date();
  now.setHours(0,0,0,0);
  const targetTs = Math.floor(Date.now()/1000) - (30 * 24 * 60 * 60);
  // findLast: só funciona em runtimes modernos (Node 18+) entao usar reverse
  let base = [...valid].reverse().find(d => d.date <= targetTs)?.close;
  if (!base) {
    base = valid[0]?.close ?? null;
  }
  if (!base || base === 0) return null;
  return ((currentPrice - base) / base) * 100;
};

// cálculo próprio de variação diária (FALLBACK REAL)
export const getDailyVariation = (hist, currentPrice) => {
  const valid = getValidHist(hist).filter(d => d.close > 0);
  if (!valid.length || currentPrice == null) return null;
  const sorted = [...valid].sort((a, b) => a.date - b.date);
  const prev = sorted.at(-1)?.close;
  if (!prev || prev === 0) return null;
  return ((currentPrice - prev) / prev) * 100;
};

export const getMax = (arr) => arr.length ? Math.max(...arr) : null;

export const get52WeekRangeFromHist = (hist) => {
  if (!hist.length) return { low: null, high: null };
  const closes = hist.map(d => d.close).filter(v => v != null);
  return {
    low: getMin(closes),
    high: getMax(closes)
  };
};

export const getDayRangeFromHist = (hist = []) => {
  if (!Array.isArray(hist) || !hist.length) {
    return { low: null, high: null };
  }

  const valid = hist.filter(d =>
    d &&
    Number(d.low) > 0 &&
    Number(d.high) > 0
  );

  if (!valid.length) {
    return { low: null, high: null };
  }

  const today = new Date().toISOString().slice(0, 10);
  const todayCandles = valid.filter(d => {
    const candleDate = new Date(d.date * 1000).toISOString().slice(0, 10);
    return candleDate === today;
  });

  const source = todayCandles.length
    ? todayCandles
    : [valid[valid.length - 1]];

  return {
    low: Math.min(...source.map(d => d.low)),
    high: Math.max(...source.map(d => d.high))
  };
};
