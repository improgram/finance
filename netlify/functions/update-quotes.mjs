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
const STORE_NAME = "17/04_12hs";
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

// -------------------- MARKET --------------------

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

// -------------------- FILA --------------------

const getNextTicker = async (store, list) => {
  const INDEX_KEY = "ticker-index";

  let index = Number(await store.get(INDEX_KEY)) || 0;
  const symbol = list[index % list.length];

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
    const ALL = ["IRFM11", "IVVB11", "BBDC4"];

    if (!isMarketOpen()) {
      console.log("🛑 Mercado fechado");
      return new Response(JSON.stringify({ skipped: true }), { status: 200 });
    }

    const symbol = await getNextTicker(store, ALL);
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
        const r = json.results?.[0];

        if (r) {
          data = {
            symbol: r.symbol,
            regularMarketPrice: r.regularMarketPrice ?? null,
            regularMarketChangePercent: r.regularMarketChangePercent ?? null,
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
    }), {
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



















// --- Configuração do Schedule (Cron) ---
// const { schedule } = require("@netlify/functions");
// Cron: a cada 30 min, das 13h às 22h UTC (10h às 19h Brasília), (1-5) Seg a Sex
export const config = {
  schedule: "*/30 13-22 * * 1-5"
};
console.log("CRON VERSION: 17/04-update-quotes");


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
