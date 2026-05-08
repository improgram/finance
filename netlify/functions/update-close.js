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
// Utilizando Netlify Functions v2=objeto global Response espera um corpo ou uma string
const createResponse = (body, status = 200, origin = "Update-Closes") => {
// Se o status não for 200 ou se houver um erro/skip no corpo, usamos console.warn
// ------ createResponse com Identificação de Origem e Debug String

  const isError = status !== 200 || body.error || body.skipped;
  const unauthorizedMsg = body.isYahooAuthError ? " | Unauthorized : bloqueio do Yahoo" : "";
   //  string limpa para o log
  const logMessage = `[${origin}] | Status: ${status}${unauthorizedMsg} | Data: ${JSON.stringify(body)}`;

  if (isError) {
    console.warn(`⚠️Erro:  ${logMessage}`);
  } else {
    console.log(`✅Sem erro:  ${logMessage}`);
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
  await sleep(300);     // sleep é workaround de consistência eventual do blob store
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

  const defaultOptions = {
    ...options,
    signal: controller.signal,
    headers: {
      ...options.headers,
      "Accept": "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://finance.yahoo.com/",
      "Origin": "https://finance.yahoo.com",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
  };

  try {
    return await fetch(url, defaultOptions);
  } catch (error) {
    if (error.name === "AbortError") {
      console.warn(" ⏱ TIMEOUT 3s ");
      } else {
      console.error("⚠️ erro fetch:", error);
      }
      throw new Error(`timeout after ${timeout}ms`);
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
      if (resYahoo && resYahoo.ok) return resYahoo;

      // 2. Adição da verificação de 401
      if (resYahoo?.status === 401) {
        console.warn(`🚨 Unauthorized : bloqueio do Yahoo (${symbol}) - Tentativa ${i + 1}`);
        return {
          ok: false,
          status: 401,
          error: "Unauthorized : bloqueio do Yahoo",
          isYahooAuthError: true
        };
      }

      // 3. Somente Debug no console do Rate Limit (429)
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
    const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${symbol}.SA`;
    const res = await fetchWithRetryYahoo(url, store, symbol);

    // Identifica especificamente o erro de autorização para o retorno
    if (res?.status === 401) {
      return { error: "Unauthorized : bloqueio do Yahoo", isYahooAuthError: true };
    }

    if (!res?.ok) {
      return {
        ok: false,
        status: res?.status || 500,
        error: `Yahoo error ${res?.status || "unknown"}`
      };
    }

    jsonQuoteOnly = await res.json();

    const item = jsonQuoteOnly?.quoteResponse?.result?.[0];
    if (!item) {
      return {
        ok: false,
        status: 404,
        error: "Ticker sem dados"
      };
    }

    return {
      ok: true,
      data: {
        symbol,
        shortName: item.shortName ?? null,
        longName: item.longName ?? null,
        regularMarketPrice: item.regularMarketPrice ?? null,
        previousClose: item.regularMarketPreviousClose ?? item.previousClose ?? null,
        changePercent: item.regularMarketChangePercent ?? null,
        volume: item.regularMarketVolume ?? null,
        averageVolume: item.averageDailyVolume3Month ?? item.averageDailyVolume10Day ?? null
      }
    };
  } catch (err) {
    console.error("❌ fetchYahooQuoteOnly:", symbol, err);
    return {
      ok: false,
      status: 500,
      error: err.message
    };
  }
};

// --------- ----
const processTickerCloseUpdate = async ({store, tickers }) => {

  const symbol = await getNextTicker(store, tickers);
  if (!symbol) {
    return { ok: false, error: "Não foi possível obter próximo ticker da fila" };
  }
  const quote = await fetchYahooQuoteOnly(symbol, store);

  if (!quote?.ok) {
    // A função fetchYahooQuoteOnly() falhou = entao retornou false
    return {
      ok: false,
      symbol,
      error: quote?.error || "Erro desconhecido",
      isYahooAuthError: quote?.isYahooAuthError || false
    };
  }

  // pega snapshot antigo
  const old = await safeGet(store, `snapshot-${symbol}`);
  const data = quote.data;
  const payload = {
    ...old,
    regularMarketPrice: data.regularMarketPrice ?? old?.regularMarketPrice,
    changePercent: data.changePercent ?? old?.changePercent,
    volume: data.volume ?? old?.volume,
    averageVolume: data.averageVolume ?? old?.averageVolume,
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
  const origin = "Update-Closes";
  const tickersData = await safeGet(store, "tickers-list");

  const tickers = Array.isArray(tickersData) ? tickersData : tickersData?.value ?? [];
  if (!tickers.length) {
    return createResponse({
      ok: false,
      error: "tickers vazios",
      count: 0
    }, 500, origin);
  }

  const lock = await acquireLock(store);
  if (!lock) {
    return createResponse({
      ok: false,
      skipped: "lock",
      reason: "Execução já ativa ou concorrência detectada"
    }, 200, origin);
  }
  try {
    const result = await processTickerCloseUpdate({ store, tickers });
    // Se result.isYahooAuthError for true, o status 401 será passado
    const finalStatus = result.ok ? 200 : (result.isYahooAuthError ? 401 : 400);
    // Se o processTickerCloseUpdate retornar ok: false, o console.warn pegará
    return createResponse(result, finalStatus, origin);

  } catch (err) {
    return createResponse({
      ok: false,
      error: err.message,
      stack: err.stack?.split('\n')[0]
    }, 500, origin);
  } finally {
    await releaseLock(store);
  }
};


// ---- CRON ----- Netlify cron sempre usa UTC
// Cron a cada 5 min  e (Após 18h as 20:15h) e (1-5) Seg a Sex

export const config = {
   schedule: [
    "15-59/5 21 * * 1-5",  // ~18:15 até 18:55 BRT
    "*/5 22 * * 1-5",      // 19:00 até 19:55 BRT
    "0-15/5 23 * * 1-5",   // 20:00 até 20:15 BRT
    "15 23 * * 1-5"         // 20:15
  ]
};
