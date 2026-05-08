import * as netlifyBlobs from "@netlify/blobs";
const getStore = netlifyBlobs?.getStore;

if (typeof getStore !== "function") {
  throw new Error("❌ Netlify Blobs SDK inválido ou incompatível");
}

//------
console.log("🚀 Iniciando Update-Closes");
const STORE_NAME = "quotes-blobs";
const LOCK_KEY = "update-close-lock";
const LOCK_TTL = 90 * 1000;
// 90s = evitar concorrência e não bloqueia pipeline por minutos

// -------------------- Helpers Market --------------------

const getFormattedDateTime = () =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "medium"
  }).format(new Date());


// ---------------- HELPERS Gerais sleep, safeGet, safeSet ------------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const safeSet = async (store, key, value) => {
  try {
    const data = JSON.stringify(value ?? null);
    return await store.set(key, data);
  } catch (err) {
    console.warn("⚠️ safeSet falhou:", key, err.message);
    return null;
  }
};


async function safeGet (store, key) {
  try {
    const raw = await store.get(key);
    if (!raw) return null;
    let parsed;
    if (raw instanceof Uint8Array) {
      parsed = JSON.parse(new TextDecoder().decode(raw));
    } else if (typeof raw === "string") {
      parsed = JSON.parse(raw);
    } else if (typeof raw === "object") {
      parsed = raw; // já é objeto válido
    } else {
      return null;
    }
    return parsed; // 🔥 IMPORTANTE
  } catch (err) {
    console.warn("⚠️ JSON inválido no safeGet:", key, err.message);
    return null;
  }
};


// ------ createResponse padrao para os Return Json
const createResponse = (body, status = 200) => {
  // Se o status não for 200 ou se houver um erro/skip no corpo, usamos console.warn
  if (status !== 200 || body.error || body.skipped) {
    console.warn(`⚠️ [Response ${status}]:`, JSON.stringify(body));
  } else {
    console.log(`✅ [Response 200]: ${body.symbol || "OK"}`);
  }

  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" }
  });
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
  if (!Array.isArray(list) || list.length === 0) {
    console.warn("⚠️ getNextTicker recebeu lista vazia");
    return null;
  }
  const key = "ticker-index";
  const stored = await safeGet(store, key);
  // cobre erros de: objeto { value }, número puro, lixo → fallback 0 e Se stored = {} → vira NaN
  let index = Number( stored && typeof stored === "object" ? stored.value : stored );
  if (!Number.isInteger(index)) index = 0;
  const currentIndex = index % list.length;
  const nextIndex = (index + 1) % list.length;
  console.log("📍 index atual:", index, "| current:", currentIndex, "| next:", nextIndex);
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
    return await fetch(url, { ...options,
      signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      console.warn(" ⏱ TIMEOUT 3s ");
      } else {
      console.error("⚠️ erro fetch:", error);
      }
      throw new Error("timeout");
  }
  finally {
    clearTimeout(id);
  }
};

// ---------------- RETRY WRAPPERS (YAHOO / BRAPI) ----------------
const fetchWithRetryYahoo = async (url, store, symbol, attempts = 2) => {
  for (let i = 0; i < attempts; i++) {
    try {
      const resYahoo = await fetchWithTimeout(url, {}, 3000);
      // 1. Sucesso: Retorna a resposta imediatamente
      if (resYahoo && resYahoo.ok) {
        return resYahoo;
      }
      // 2. Somente Debug no console do Rate Limit (429)
      if (resYahoo?.status === 429) {
        console.warn(`🚨 429 Yahoo (${symbol}) - Tentativa ${i + 1} de ${attempts}`);
        // Espera antes da próxima tentativa (Backoff simples)
        await sleep((i + 1) * 1000);
        continue; // Pula para a próxima iteração do for
      }
      // 3. Outros erros (404, 500, etc)
      console.error(`❌ Erro Yahoo: Status ${resYahoo?.status} em ${symbol}`);
      // Aqui você decide se quer dar 'continue' para tentar de novo ou 'return null'
      break;
    } catch (error) {
      console.error(`⚠️ Erro de rede/timeout na tentativa ${i + 1}:`, error);
    }
  }
  // Se sair do loop sem retornar, significa que todas as tentativas falharam
  console.log(`💀 Falha definitiva para ${symbol} após ${attempts} tentativas.`);
  return null;
};

// O endpoint: ... query1.finance.yahoo.com/v7/finance/quote ficou mais protegido
// Em ambientes serverless (Netlify/Vercel/AWS), o Yahoo frequentemente:
// bloqueia IPs , exige User-Agent, exige cookies, detecta tráfego automatizado
// Então o 401 NÃO é erro do código. É bloqueio do Yahoo.

// ------- fetch ultra leve = busca somente:
// ------- preço + fechamento + variação diária e ( SEM histórico.)
const fetchYahooQuoteOnly = async (symbol, store) => {
  let jsonQuoteOnly;
  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbol}.SA`;
    const res = await fetchWithRetryYahoo(url, store, symbol);
    if (!res?.ok) return null;
    jsonQuoteOnly = await res.json();
    const item = jsonQuoteOnly?.quoteResponse?.result?.[0];
    if (!item) return null;
    return {
      symbol,
      shortName: item.shortName ?? null,
      longName: item.longName ?? null,
      regularMarketPrice: item.regularMarketPrice ?? null,
      previousClose: item.regularMarketPreviousClose ?? item.previousClose ?? null,
      changePercent: item.regularMarketChangePercent ?? null,
      volume: item.regularMarketVolume ?? null,
      averageVolume: item.averageDailyVolume3Month ?? item.averageDailyVolume10Day ?? null
    };
  } catch (err) {
    console.error("❌ fetchYahooQuoteOnly:", symbol, err);
  }
};

// --------- ----
const processTickerCloseUpdate = async ({store, tickers }) => {

  const symbol = await getNextTicker(store, tickers);
  if (!symbol) {
    return { ok: false };
  }
  const quote = await fetchYahooQuoteOnly(symbol, store);
  if (!quote) {
    return { ok: false, error: `Falha ao buscar cotação para ${symbol}` };
  }

  // pega snapshot antigo
  const old = await safeGet(store, `snapshot-${symbol}`);

  const payload = {
    ...old,
    regularMarketPrice: quote.regularMarketPrice ?? old?.regularMarketPrice,
    changePercent: quote.changePercent ?? old?.changePercent,
    volume: quote.volume ?? old?.volume,
    averageVolume: quote.averageVolume ?? old?.averageVolume,
    updatedAt: Date.now(),
    updatedLabel: getFormattedDateTime(),
    source: "YAHOO CLOSE",
    updateType: "post-close"
  };

    await safeSet(store, `snapshot-${symbol}`, payload);

    const SNAP_KEY = "last-valid-snapshot";
    const prev = await safeGet(store, SNAP_KEY);
    const prevArray = Array.isArray(prev?.data) ? prev.data : [];
    const map = new Map(
    prevArray
        .filter(i => i?.symbol)
        .map(i => [i.symbol, i])
    );
    map.set(symbol, payload);
    await safeSet(store, SNAP_KEY, {
    data: Array.from(map.values()),
    updatedAt: Date.now()
    });
  return {
    ok: true,
    symbol
  };
};


 // ------
 export default async () => {
  const store = getStore({ name: STORE_NAME });
  const tickersData = await safeGet(store, "tickers-list");

  const tickers = Array.isArray(tickersData) ? tickersData : tickersData?.value ?? [];
  if (!tickers.length) {
    return createResponse({
      ok: false,
      error: "tickers vazios",
      count: 0
    }, 500);
  }

  const lock = await acquireLock(store);
  if (!lock) {
    return createResponse({
      ok: false,
      skipped: "lock",
      reason: "Execução já ativa ou concorrência detectada"
    }, 200);
  }
  try {
    const result = await processTickerCloseUpdate({
      store,
      tickers
    });
    return createResponse(result);
  } catch (err) {
    return createResponse({
      ok: false,
      error: err.message,
      stack: err.stack?.split('\n')[0]
    }, 500);
  } finally {
    await releaseLock(store);
  }
};


// ---- CRON ----- Netlify cron sempre usa UTC
// Cron a cada 2 min  e (Após 18h as 20:14h) e (1-5) Seg a Sex

export const config = {
   schedule: [
    "15-59/2 21 * * 1-5", // 18:15 até 18:59 BRT
    "*/2 22 * * 1-5",     // 19:00 até 19:58 BRT
    "0-15/2 23 * * 1-5"   // 20:00 até 20:14 BRT
  ]
};
