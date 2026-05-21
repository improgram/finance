// -------------------- Helpers Market --------------------

export const getCloses = (hist = []) => hist.map(d => d.close);
export const getMin = (arr) => arr.length ? Math.min(...arr) : null;
export const hasEnoughHist = (hist) => hist.length >= 10;
export const safeValue = (value) => (value == null || Number.isNaN(value)) ? null : value;
export const fallbackMin = (fallback) => fallback != null ? fallback : "N/E";
export const safeWithFallback = (newPreco, oldPreco) => newPreco == null ? (oldPreco ?? null) : newPreco;
export const safeNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n)
    ? n
    : null;
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

  // const last = sorted.at(-1)?.close;

  const prev = sorted.at(-1)?.close;
  if (!prev || prev === 0) return null;
  return ((currentPrice - prev) / prev) * 100;

};


// Buscar preços historicos: Yahoo = preço rápido
// BRAPI = enriquecimento de dados

export const getMax = (arr) => arr.length ? Math.max(...arr) : null;


export const getDayRangeFromHist = (hist = []) => {
  if (!Array.isArray(hist) || hist.length === 0) {
    return {
      low: null,
      high: null
    };
  }

  // candles válidos
  const valid = hist
    .filter(d =>
      d &&
      Number(d.low) > 0 &&
      Number(d.high) > 0 &&
      Number(d.close) > 0
    )
    .sort((a, b) => b.date - a.date);

  if (!valid.length) {
    return {
      low: null,
      high: null
    };
  }

  // último candle válido
  const last = valid[0];

  return {
    low: last.low,
    high: last.high
  };
};


export const get52WeekRangeFromHist = (hist) => {
  if (!hist.length) return { low: null, high: null };
  const closes = hist.map(d => d.close).filter(v => v != null);
  return {
    low: getMin(closes),
    high: getMax(closes)
  };
};


export const isMarketOpen = () => {
    const now = new Date();

    // horário Brasil (B3 usa São Paulo)
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const time = hours * 60 + minutes;

    // B3: 10:00 - 17:55 (aproximação prática)
    const open = 10 * 60;
    const close = 17 * 60 + 55;
    const isWeekday = now.getDay() >= 1 && now.getDay() <= 5;
    return isWeekday && time >= open && time <= close;
};
