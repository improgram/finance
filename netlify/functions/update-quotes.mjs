// schedule (cron)
// lógica completa
// chamada da Brapi
// processamento
// salvamento no Blobs

// CommonJS (require)  = (antigo)
// ES Modules (import/export) = (novo)
// permite o objeto de configuração simplificado.
// trata se do Coletor) Roda via CRON, busca na Brapi
// e salva cada ticker individualmente no Blobs


// ---------------- CONFIG ----------------
import { getStore } from "@netlify/blobs";

console.log("🚀 Iniciando update-quotes");
const STORE_NAME = "quotes-blobs";
const LOCK_KEY = "update-lock";
const LOCK_TTL = 30 * 1000;     // 30s = evitar concorrência e não bloqueia pipeline por minutos
const CACHE_TTL = 5 * 60 * 1000;

// ---------------- HELPERS ----------------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const safeSet = async (store, key, value) => {
  try {
    return await store.set(key, value, { type: "json" });
  } catch {
    return await store.set(key, JSON.stringify(value));
  }
};

const safeGet = async (store, key) => {
  try {
    return await store.get(key, { type: "json" });
  } catch {
    try {
      const raw = await store.get(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
};

const createResponse = (body, status = 200) => {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
};


// -------------------- Helpers Market --------------------

const isMarketOpen = () => {
  const now = new Date();
  const br = new Date(
    now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })
  );
  const day = br.getDay();
  const minutes = br.getHours() * 60 + br.getMinutes();
  if (day === 0 || day === 6) return false;
  return minutes >= 600 && minutes <= 1135; // 10:00 - 18:55
};

const getFormattedDateTime = () =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "medium"
  }).format(new Date());

const getCloses = (hist) => hist.map(d => d.close);
const getMin = (arr) => arr.length ? Math.min(...arr) : null;
const hasEnoughHist = (hist) => hist.length >= 10;
const safeValue = (value) =>
       (value == null || Number.isNaN(value)) ? null : value;
const fallbackMin = (fallback) => fallback != null ? fallback : "N/E";

const filterByDays = (hist, days) => {
  const now = Math.floor(Date.now() / 1000);
  const limit = now - (days * 24 * 60 * 60);
  return hist.filter(d => d.date >= limit);
};

const safeWithFallback = (newPreco, oldPreco) =>
  newPreco == null ? (oldPreco ?? null) : newPreco;

const getValidHist = (hist) => (hist || []).filter(d =>
  d && typeof d.date === "number" && typeof d.close === "number"
);

const getVariation30d = (hist, currentPrice) => {
  if (!hist.length || currentPrice == null) return null;
    const now = new Date();
    now.setHours(0,0,0,0);
    const target = new Date(now);
    target.setMonth(target.getMonth() - 1);
    const targetTs = Math.floor(target.getTime() / 1000);
    let base = null;
  for (let i = hist.length - 1; i >= 0; i--) {
      if (hist[i].date <= targetTs) {
        base = hist[i].close;
        break;
      }
  }
  if (!base) return null;
  return ((currentPrice - base) / base) * 100;
};


// ---------------- LOCK GLOBAL ----------------
const acquireLock = async (store) => {
  const now = Date.now();
  const existing = await safeGet(store, LOCK_KEY);

  if (existing && (now - existing.timestamp) < LOCK_TTL) {
    console.log("🔒 Execução já ativa");
    return null;
  }

  const lock = { timestamp: now };
  await safeSet(store, LOCK_KEY, lock);

  await sleep(200);

  return lock;
};

const releaseLock = async (store) => {
  await safeSet(store, LOCK_KEY, {
    timestamp: Date.now() - (LOCK_TTL + 1000)
  });
};

// ---------------- FILA (SEM LOCK) ----------------
const getNextTicker = async (store, list) => {
  const key = "ticker-index";
  const stored = await safeGet(store, key);
  let index = 0;
  if (
    stored &&
    typeof stored.value === "number" &&
    stored.value >= 0 &&
    stored.value < list.length
  ) {
    index = stored.value;
  }
  const nextIndex = (index + 1) % list.length;
  await safeSet(store, key, {
    value: nextIndex,
    updatedAt: Date.now()
  });
  return list[index];
};

// ---------------- FETCH ----------------
const fetchWithTimeout = async (url, options = {}, timeout = 3000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
};


// ---- retry com delay progressivo
const fetchWithRetry = async (url, options = {}, attempts = 1) => {
  for (let i = 0; i <= attempts; i++) {
    const resDelay = await fetchWithTimeout(url, options, 3000);

    if (resDelay && resDelay.status === 429 && i < attempts) {
      console.warn(`⏳ 429 - retry em ${delay}ms`);
      const wait = (i + 1) * 500;
      await sleep(wait); // curto, não bloqueia fila
      continue;
    }
    return resDelay;
  }
  return null;
};


// ------------------ sistema de prioridade de fonte automático
// ------------------ o primeiro que responder válido vence
// A ordem correta é: 1. CACHE (Blobs) - 2. BRAPI - 3. YAHOO - 4. previousData

// ---------------- BRAPI ----------------
const fetchBrapi = async (symbol, token) => {
  try {
    const urlBrapi = `https://brapi.dev/api/quote/${symbol}?range=1mo&interval=1d&token=${token}`;
    const resBrapi = await fetchWithRetry(urlBrapi);

    if (!resBrapi || !resBrapi.ok) {
      console.warn("⚠️ BRAPI status:", resBrapi.status);
      return null;
    }

    const json = await resBrapi.json();
    return json?.results?.[0] || null;

  } catch (err) {
    console.warn("⚠️ BRAPI erro:", err.message);
    return null;
  }
};

// ---------------- YAHOO FALLBACK ----------------
const fetchYahoo = async (symbol) => {
  try {
    const urlYahoo = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.SA?range=1mo&interval=1d`;
    const resYahoo = await fetchWithRetry(urlYahoo);
    if (!resYahoo.ok) return null;
    const json = await resYahoo.json();
    const meta = json?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    return {
      symbol,
      regularMarketPrice: meta.regularMarketPrice,
      source: "yahoo"
    };
  } catch {
    return null;
  }
};

// ---------------- MAIN ----------------
export default async () => {

  const API_TOKEN = process.env.BRAPI_TOKEN;
  if (!API_TOKEN) {
    return createResponse({ error: "Token ausente" }, 500);
  }
  const store = getStore({ name: STORE_NAME });
  const lock = await acquireLock(store);
  if (!lock) {
    return createResponse({ skipped: "lock" });
  }
  const MAX_EXECUTION_TIME = 7000;
  try {
    const exec = (async () => {
      if (!isMarketOpen()) {
        return createResponse({ message: "Mercado fechado" });
      }
      const tickers = [ "BBDC4", "IRFM11" ];
      const ETF_INFO = {
        AUPO11: { description: "NTN-B + Selic" },
        B5P211: { description: "NTN-B (inflação) Curto/Medio" },
        IMAB11: { description: "NTN-B (Inflação) Medio/Longo" },
        IRFM11: { description: "Pré-fixado (LTN 26/29/31) e NTN-B" },
        IVVB11: { description: "S&P 500 dos EUA" },
        NBIT11: { description: "Bitcoin Nasdaq" },
        PACB11: { description: "NTN-B (Inflação) Longo 2050/60" },
        "5PRE11": { description: "Pré-fixado" }
      };
      const symbol = await getNextTicker(store, tickers);
      if (!symbol) {
        return createResponse({ skipped: "fila" });
      }
      const cacheKey = `quote-${symbol}`;
      const cached = await safeGet(store, cacheKey);

      // ⚡(cache válido = saída imediata)
     if (
        cached &&
        typeof cached.updatedAt === "number" &&
        Date.now() - cached.updatedAt < CACHE_TTL
      ) {
        console.log("⚡ cache hit valido:", symbol);

        return createResponse({
          ok: true,
          symbol,
          source: "cache-fresh"
        });
      }

      // 🔵 BRAPI
      let data = await fetchBrapi(symbol, API_TOKEN);
      let source = "brapi";
      // 🟡 YAHOO
      if (!data) {
        data = await fetchYahoo(symbol);
        source = "yahoo";
      }

      // 🔴 FALLBACK FINAL
      if (!data && cached) {
        data = cached;
        source = "cache-old";
      }
      if (!data) {
        return createResponse({ error: "sem dados" });
      }
      const payload = {
        ...data,
        symbol,
        source,
        updatedAt: Date.now(),
        updatedLabel: getFormattedDateTime(),
        description: ETF_INFO[symbol]?.description || "Ativo Financeiro"
      };
      await safeSet(store, cacheKey, payload);
      console.log("💾 salvo:", symbol);
      return createResponse({
        ok: true,
        symbol,
        source
      });
    })();
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), MAX_EXECUTION_TIME)
    );
    return await Promise.race([exec, timeout]);
  } catch (err) {
    console.error("🔥 erro:", err.message);
    return createResponse({ error: "fail" }, 200);
  } finally {
    await releaseLock(store);
  }
};

// ---------------- CRON ----------------
// Cron: a cada 15 min,  12h-22h UTC (10h às 19h Brasília), (1-5) Seg a Sex
export const config = {
  schedule: "*/15 12-21 * * 1-5"
};
