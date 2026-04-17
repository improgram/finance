// schedule (cron)
// lógica completa
// chamada da Brapi
// processamento
// salvamento no Blobs

// CommonJS (require)  = (antigo)
// ES Modules (import/export) = (novo)
// permite o objeto de configuração simplificado.
// const { getStore } = require("@netlify/blobs");

import { getStore } from "@netlify/blobs";

console.log("Update-quotes CARREGADA");

// -------------------- CONFIG --------------------
const STORE_NAME = "update-Blobs";
const LOCK_KEY = "update-lock";
const LOCK_TTL = 25 * 1000; // 25s (evita concorrência)
const CACHE_TTL = 5 * 60 * 1000; // 5 min

// -------------------- HELPERS --------------------

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Timeout menor (serverless-safe)
const fetchWithTimeout = async (url, options = {}, timeout = 8000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(id);
  }
};

// Retry leve (anti-timeout Netlify)
const fetchWithRetry = async (url, retries = 1) => {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetchWithTimeout(url);

      if (res && res.status !== 429) return res;

      console.warn("⏳ Rate limit...");
      await sleep(2000);
    } catch (err) {
      console.warn("⚠️ fetch erro:", err);
      if (i === retries) throw err;
    }
  }
  throw new Error("Rate limit persistente");
};

// -------------------- LOCK DISTRIBUÍDO --------------------

const acquireLock = async (store) => {
  const now = Date.now();
  const lock = await store.get(LOCK_KEY, { type: "json" });

  if (lock && (now - lock.timestamp) < LOCK_TTL) {
    console.log("🔒 Lock ativo, abortando execução");
    return false;
  }

  await store.set(LOCK_KEY, JSON.stringify({ timestamp: now }));
  return true;
};

const releaseLock = async (store) => {
  await store.delete(LOCK_KEY);
};

// -------------------- Helpers --------------------

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
const safeValue = (value) => (value == null || Number.isNaN(value)) ? "N/E" : value;
const fallbackMin = (fallback) => fallback != null ? fallback : "N/E";

const filterByDays = (hist, days) => {
  const now = Math.floor(Date.now() / 1000);
  const limit = now - (days * 24 * 60 * 60);
  return hist.filter(d => d.date >= limit);
};

const safeWithFallback = (newPreco, oldPreco) =>
  (newPreco == null || newPreco === "N/E") ? oldPreco ?? "N/E" : newPreco;

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
  if (!base) base = hist[0].close;
  return ((currentPrice - base) / base) * 100;
};


// -------------------- FILA --------------------

const getNextTicker = async (store, list) => {

  const INDEX_KEY = "ticker-index";
  const LIST_HASH_KEY = "ticker-list-hash";

  // 🔹 cria hash da lista atual
  const hash = JSON.stringify(list);
  const prevHash = await store.get(LIST_HASH_KEY);
  let index = Number(await store.get(INDEX_KEY)) || 0;

  // 🔥 detecta mudança na lista
  if (prevHash !== hash) {
    console.log("🔄 Lista mudou, resetando índice");
    index = 0;
    await store.set(LIST_HASH_KEY, hash);
    await store.set(INDEX_KEY, "0");
  }

  // 🔹 proteção extra
  index = index % list.length;
  const symbol = list[index];
  // 🔹 incrementa fila
  await store.set(INDEX_KEY, String(index + 1));
  return symbol;
};

// -------------------- FALLBACK YAHOO --------------------

const fetchYahooFallback = async (symbol) => {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.SA?range=1mo&interval=1d`;

    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const json = await res.json();
    const result = json.chart?.result?.[0];
    if (!result) return null;
    const meta = result.meta;

    return {
      symbol,
      regularMarketPrice: meta?.regularMarketPrice ?? null,
      regularMarketChangePercent: meta?.regularMarketChangePercent ?? null,
      source: "yahoo"
    };

  } catch (err) {
    console.warn("⚠️ Yahoo fallback erro:", err);
    return null;
  }
};

// -------------------- HANDLER --------------------

export default async (req) => {

  console.log("🚀 Iniciando update-quotes");

  const API_TOKEN = process.env.BRAPI_TOKEN;
  if (!API_TOKEN) {
    return new Response("Token não configurado", { status: 500 });
  }

  const store = getStore({ name: STORE_NAME });

  // 🔒 Lock distribuído
  const locked = await acquireLock(store);
  if (!locked) {
    return new Response(JSON.stringify({ skipped: "lock" }), { status: 200 });
  }

  try {

    // Lista
    const tickers = [ "IRFM11", "IVVB11", "BBDC4", "PACB11" ];
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


    if (!isMarketOpen()) {
      console.log("🛑 Mercado fechado");
      return new Response(JSON.stringify({ skipped: true }), { status: 200 });
    }

    const symbol = await getNextTicker(store, tickers);
    const cacheKey = `quote-${symbol}`;

    console.log("➡️ ticker:", symbol);

    // Cache curto
    const cached = await store.get(cacheKey, { type: "json" });
    if (cached?.updatedAt && Date.now() - cached.updatedAt < CACHE_TTL) {
      console.log("⚡ cache hit");
      return new Response(JSON.stringify({ cached: true }), { status: 200 });
    }

    // -------------------- BRAPI --------------------

    let data = null;

    try {
      const url = `https://brapi.dev/api/quote/${symbol}?range=1mo&interval=1d&token=${API_TOKEN}`;

      const res = await fetchWithRetry(url);

      if (res.ok) {
        const json = await res.json();
        const resBrapi = json.results?.[0];

        if (resBrapi) {
          data = {
            symbol: resBrapi.symbol,
            shortName: resBrapi.shortName,
            longName: resBrapi.longName,
            description: ETF_INFO[resBrapi.symbol.toUpperCase()]?.description || "",
            updatedAt: Date.now(),                          // Timestamp para lógica de front-end
            regularMarketPrice: resBrapi.regularMarketPrice ?? null,
            regularMarketChangePercent: resBrapi.regularMarketChangePercent ?? null,

            regularMarketDayLow: resBrapi.regularMarketDayLow ?? null,
            regularMarketDayHigh: resBrapi.regularMarketDayHigh ?? null,
            regularMarketDayRange:
              resBrapi.regularMarketDayLow != null && r.regularMarketDayHigh != null
              ? `${r.regularMarketDayLow} - ${r.regularMarketDayHigh}`
              : null,

            fiftyTwoWeekLow: resBrapi.fiftyTwoWeekLow ?? null,
            fiftyTwoWeekHigh: resBrapi.fiftyTwoWeekHigh ?? null,
            logourl: resBrapi.logourl || `https://icons.brapi.dev/icons/${resBrapi.symbol}.svg`,
            source: "brapi"
          };
        }
      }

    } catch (err) {
      console.warn("⚠️ Brapi falhou, tentando fallback...");
    }

    // -------------------- FALLBACK --------------------

    if (!data) {
      data = await fetchYahooFallback(symbol);
    }

    if (!data) {
      throw new Error("Sem dados em nenhuma fonte");
    }

    // -------------------- PROCESS --------------------

    const item = {
      ...data,
      updatedAt: Date.now(),
      updatedLabel: getFormattedDateTime()
    };

    // -------------------- STORE --------------------

    await store.set(cacheKey, JSON.stringify(item));

    console.log(`💾 saved (${item.source}):`, symbol);

    return new Response(JSON.stringify({
      ok: true,
      symbol,
      source: item.source
    } , null, 2 ), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {

    console.error("🔥 ERRO:", err);

    return new Response(JSON.stringify({
      error: "Falha no update"
    }), { status: 500 });

  } finally {
    // 🔓 sempre libera lock
    await releaseLock(store);
  }
};

// -------------------- CRON --------------------
// Cron: a cada 30 min,  13h-22h UTC (10h às 19h Brasília), (1-5) Seg a Sex
export const config = {
  schedule: "*/30 12-21 * * 1-5"
};
console.log("CRON VERSION: 17/04-update-quotes");


















// --- Configuração do Schedule (Cron) ---
// const { schedule } = require("@netlify/functions");
// Cron: a cada 30 min, das 13h às 22h UTC (10h às 19h Brasília), (1-5) Seg a Sex

/*
fetch → validar → tratar erro → parse JSON → usar dados
*/

/*
helpers (fora da função)
handler()
fetch API (results)
processed = map(results)
payload usa processed
store.set()
*/


/*
Dentro do handler:
1. definir helpers (fetchWithTimeout / fetchWithRetry)
2. montar URL
3. fazer request (res)
4. tratar 429
5. validar resposta
6. extrair JSON (json / r)
7. processar dados
*/


/*
CRON Netlify (a cada 30 min)
pega próximo ticker (Blobs index)
fetch BRAPI (1 ticker)
transforma dados
store.set("quote-SYMBOL")
atualiza índice (fila circular)
fim (rápido < 10s)
*/


/*
implementando um padrão chamado: ETL incremental com cache distribuído
Extract: Brapi
Transform: backend Netlify
Load: Blobs
Serve: get-quotes
Esse padrão é exatamente o que evita rate limit em APIs gratuitas.
*/

/*
getNextTicker
fetch Brapi (1 ticker)
process data
store.set("quote-SYMBOL")
return
*/





/*
1. require/import
2. handler async function () {
   2.1 logs iniciais
   2.2 validações
   2.3 constantes (listas, helpers)
   2.4 FETCH ou loop ALL com 1 ticker por execuçao
   2.5 PROCESSAMENTO (map)
   2.6 salvar no cache Blobs
}
*/

//  O endpoint /list é o correto para filtros como 'type'
//  O endpoint /list retorna 'stocks' da brapi
//  O endpoint /quote/list retorna:   { "stocks": [...]  }
//  O endpoint /quote/{ticker} retorna objeto 'results'

// Se o mercado estiver aberto, a API Brapi atualiza o regularMarketPrice em tempo real,
// enquanto o historicalDataPrice só atualiza após o fechamento
