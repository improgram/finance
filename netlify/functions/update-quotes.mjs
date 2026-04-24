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


// ---------------- GLOBAL RATE LIMIT PROTECTION (429 SAFETY) ----------------

const COOLDOWN_429 = 30 * 1000; // 30s de pausa global após 429
const RATE_LIMIT_KEY = "global-429";

// ---------------- CONFIG ----------------
import * as netlifyBlobs from "@netlify/blobs";
const getStore = netlifyBlobs?.getStore;

if (typeof getStore !== "function") {
  throw new Error("❌ Netlify Blobs SDK inválido ou incompatível");
}

console.log("🚀 Iniciando update-quotes");
const STORE_NAME = "quotes-blobs";
const LOCK_KEY = "update-lock";
const LOCK_TTL = 30 * 1000;     // 30s = evitar concorrência e não bloqueia pipeline por minutos
const CACHE_TTL = 5 * 60 * 1000;

// ---------------- HELPERS ----------------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));


const setGlobal429 = async (store) => {
  const now = Date.now();
  await safeSet(store, RATE_LIMIT_KEY, {
    timestamp: now
  });
};

const getGlobal429 = async (store) => {
  const data = await safeGet(store, RATE_LIMIT_KEY);
  return data?.timestamp || 0;
};


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

// ------- parser seguro = util para blindar a leitura do tickers-list
const safeParseTickers = (data) => {
  if (!data) return [];

  // já veio correto
  if (Array.isArray(data)) {
    return data.filter(t => typeof t === "string");
  }

  // veio string quebrada (caso do seu erro atual)
  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch {
      // fallback ultra seguro (caso venha "BBDC4,IRFM11")
      return data.split(",").map(t => t.trim()).filter(Boolean);
    }
  }

  return [];
};


// ---------helper para buscar tickers dinâmicos
const getTickers = async (store) => {
  const data = await safeGet(store, "tickers-list");
  const tickers = safeParseTickers(data);

  if (tickers.length === 0) {
    if (data.length === 0) {
      console.warn("⚠️ tickers-list vazia");
      return ["BBDC4", "IRFM11"];   // fallback seguro
    }
  return data     // Evitar o risco de quebrar se vier lixo no storage
    .filter(t => typeof t === "string")
    .slice(0, 50);          // ✅ LIMITADOR
  }
  return ["BBDC4", "IRFM11"];
};


const createResponse = (body, status = 200) => {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" }
  });
};

// -------------------- Helpers Market --------------------

const isMarketOpen = () => {
  const now = new Date();
  const brTime = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short"
  }).formatToParts(now);

  const get = (type) => brTime.find(p => p.type === type)?.value;
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  const weekday = get("weekday"); // Mon, Tue...
  const isWeekend = weekday === "Sat" || weekday === "Sun";
  if (isWeekend) return false;
  const minutes = hour * 60 + minute;
  return minutes >= 600 && minutes <= 1135;
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

//--------- Para remover Lock imediatamente
const releaseLock = async (store) => {
  try {
    await store.delete(LOCK_KEY);
  } catch {
    await safeSet(store, LOCK_KEY, {
      timestamp: 0
    });
  }
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
  const currentIndex = index;           // Evitar inconsistência de fila
  const nextIndex = (index + 1) % list.length;
  await safeSet(store, key, {
    value: nextIndex,
    updatedAt: Date.now()
  });
  return list[currentIndex];
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

// ---------------- RETRY WRAPPERS (YAHOO / BRAPI) ----------------

const fetchWithRetryYahoo = async (url, store, symbol, attempts = 1) => {
  for (let i = 0; i < attempts; i++) {
    const resYahoo = await fetchWithTimeout(url, {}, 3000);
    if (resYahoo?.status === 429) {
      await setGlobal429(store);
      console.warn(`🚨 429 Yahoo (${symbol}) tentativa ${i + 1}`);
      if (i < attempts) {
        await sleep((i + 1) * 500);
        continue;
      }
    }
    return resYahoo;
  }
  return null;
};


const fetchWithRetryBrapi = async (url, store, symbol, attempts = 2) => {
  for (let i = 0; i < attempts; i++) {
    const resBrapi = await fetchWithTimeout(url, {}, 3000);
    if (resBrapi?.status === 429) {
      await setGlobal429(store);
      console.warn(`🚨 BRAPI com erro 429 detectado (${symbol}) tentativa ${i + 1}`);
      if (i < attempts) {
        await sleep((i + 1) * 400);
        continue;
      }
    }
    return resBrapi;
  }
  return null;
};


// Na ordem : CACHE (Blobs) - YAHOO - BRAPI - 4. previousData

// ---------------- YAHOO  ----------------
const fetchYahoo = async (symbol, store) => {
  try {
    const urlYahoo = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.SA?range=1mo&interval=1d`;
    const resYahoo = await fetchWithRetryYahoo(urlYahoo, store, symbol, 1 );  // retry leve p/ evitar timeout(1)
    if (!resYahoo || !resYahoo.ok) {
      console.warn("⚠️ Yahoo status: ", resYahoo?.status ?? "no-response");
      return null;
    }
    const jsonYahoo = await resYahoo.json();
    const resultYahoo = jsonYahoo?.chart?.result?.[0];
    const meta = resultYahoo?.meta;
    if (!meta) return null;
    return {
      symbol,
      regularMarketPrice: meta.regularMarketPrice,
      previousClose: meta.previousClose,
      changePercent:
          meta.regularMarketChangePercent != null
          ? meta.regularMarketChangePercent * 100
          : null,
      currency: meta.currency,
      source: "yahoo"
    };
  } catch { return null; }
};

// ---------------- BRAPI FALLBACK ----------------

const fetchBrapi = async (symbol, token, store ) => {
  try {
    const urlBrapi = `https://brapi.dev/api/quote/${symbol}?range=1mo&interval=1d&token=${token}`;
    const resBrapi = await fetchWithRetryBrapi(urlBrapi, store, symbol, 2);
    if (resBrapi?.ok) {
        let jsonBrapi = null;
        try {
          jsonBrapi = await resBrapi.json();
        } catch {}
        console.warn("⚠️ BRAPI status:", resBrapi?.status);
        return jsonBrapi?.results?.[0] || null;
    }
    return null;
  } catch (err) {
    console.warn("⚠️ BRAPI erro:", err.message);
    return null;
  }
};


// ----------- EXEC: Leitura linear:  lock - exec - timeout - race
// ----------  exec() deve retornar apenas dados = não usa createResponse
// ----------- retorna objetos simples ({ ok, reason }, { ok, symbol })
const exec = async ( { store, apiToken, tickers } ) => {
    if (!isMarketOpen()) {
      return { ok: false, reason: "Mercado Fechado" };
    }
     if (!Array.isArray(tickers) || tickers.length === 0) {
      console.warn("⚠️ tickers inválidos ou vazios");
      return { ok: false, reason: "tickers inválidos" };
    }

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
    if (!symbol) { return { ok: false, reason: "fila vazia" }; }

      // ---------------- CACHE FIRST ----------------
      const cacheKey = `quote-${symbol}`;
      const cached = await safeGet(store, cacheKey);

      // ⚡ cache válido (saída imediata)
      if ( cached && typeof cached.updatedAt === "number" &&
        Date.now() - cached.updatedAt < CACHE_TTL
      ) {
        console.log("⚡ Cache hit valido:", symbol, cached.source);
        return {
          ok: true,
          symbol,
          source: "cache-fresh"
        };
      }

      // --------- proteção global contra flood após 429 e timestamp inválido
      const global429 = await getGlobal429(store);
      if (global429 > 0) {
        const elapsed = Date.now() - global429;
        if (elapsed < COOLDOWN_429) {
          console.warn("⛔ cooldown global ativo");
          return {
            ok: true,
            symbol,
            source: "cooldown"
          };
        }
      }

      // ----------- Yahoo segundo ------------
      let data = null;
      let source = null;
      try {
        data = await fetchYahoo(symbol, store);
        if (data) { source = "yahoo"; }
      } catch (err) { console.warn("⚠️ Yahoo erro:", err.message); }

      // -------------- Brapi terceiro -----------
      if (!data) {
        try {
          data = await fetchBrapi(symbol, apiToken, store);
          if (data) { source = "brapi"; }
        } catch (err) { console.warn("⚠️ BRAPI erro:", err.message); }
      }
      // -------------------Falback cache antigo
      if (!data && cached) { data = cached; source = "cache-old"; }
      // ------------ Fallback final absoluto-----------------
      if (!data) { return { ok: false, reason: "Sem Dados" }; }

      // -------------------- Payload--------------
      const payload = {
        ...data,
        source,
        symbol,
        shortName: data?.shortName,
        longName: data?.longName,
        updatedAt: Date.now(),                    // Timestamp para lógica de front-end
        updatedLabel: getFormattedDateTime(),     // String formatada DD/MM/AAAA HH:MM:SS
        description: ETF_INFO[symbol]?.description || "Ativo Financeiro",
        logourl: data?.logourl || `https://icons.brapi.dev/icons/${symbol}.svg`
      };

      // ------------- Salvamento ---------

      await safeSet(store, cacheKey, payload);
      console.log("💾 salvo:", symbol);

      // 🧠 ATUALIZA SNAPSHOT CONSOLIDADO
      // snapshot seguro = NÃO deve ler todos os blobs no cron
      // Evitar crescer linearmente no Netlify Free (timeout ~10s)
      // snapshot leve e por ticker
      try {
        await safeSet(store, `snapshot-${symbol}`, payload);
        console.log("snapshot atualizado");
      } catch (err) { console.warn("⚠️ erro ao salvar snapshot:", err.message); }
      return {
        ok: true,
        symbol,
        source
      };
}
//  FiM da const exec
//  engloba toda a lógica principal até o último return createResponse


// ---------------- MAIN ----------------

export default async () => {
  const API_TOKEN = process.env.BRAPI_TOKEN;
  if (!API_TOKEN) { return createResponse({ error: "Token ausente" }, 500); }

  // Ordem de lock correta: garante consistência da leitura + fila
  // Se alterada a ordem existe risco de janela para race condition
  const store = getStore({ name: STORE_NAME });
  const lock = await acquireLock(store);
  if (!lock) { return createResponse({ skipped: "lock" }); }
  const tickers = await getTickers(store);
  const MAX_EXECUTION_TIME = 7000;

  //   --------------             -------------
  const timeout = (label = "exec", ms = MAX_EXECUTION_TIME) =>
    new Promise((_, reject) =>
      setTimeout(() => {
        reject(new Error(`⏱ timeout em ${label} (${ms}ms)`));
      }, ms)
  );

    try { // deve conter apenas código que pode falhar
          // --------- lock sempre liberado
          // evitar travamento de pipeline e segurança em crash ou timeout
      const result = await Promise.race([
        exec({
          store,
          apiToken: API_TOKEN,
          tickers
        }),
        timeout("exec")
      ]);
      return createResponse(result ?? { ok: false, error: "empty_result" });
    } catch (err) { return createResponse( { ok: false, error: err.message }, 500 );
    } finally { await releaseLock(store); }

};
// FiM do MAIN export default async


// ---------------- CRON ----------------
// Cron: a cada 15 min,  12h-21h UTC (10h às 18h Brasília), (1-5) Seg a Sex
export const config = {
  schedule: "*/15 12-21 * * 1-5"
};
