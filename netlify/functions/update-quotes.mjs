// chamada function Netlify:  A chave será lida das variáveis de ambiente do Netlify
// processamento + salvamento no Blobs + retorna JSON + schedule (cron)
// CommonJS (require)  = (antigo) e ES Modules (import/export) = (novo)
// permite o objeto de configuração simplificado.
// Coletor Roda via CRON, busca no Yahoo + Brapi + Alpha Vantage + real-time-finance-data
// CRON funciona em: Netlify Functions (Node) e ❌ NÃO funciona em: Edge Functions
// e salva cada ticker individualmente no Blobs

// ---------------- CONFIG ----------------
import * as netlifyBlobs from "@netlify/blobs";
const getStore = netlifyBlobs?.getStore;

if (typeof getStore !== "function") {
  throw new Error("❌ Netlify Blobs SDK inválido ou incompatível");
}

import { MAX_ITEMS } from "../../helpers/constants.js";

import {
  sleep,
  getFormattedDateTime,
  getMin,
  getMax,
  getVariation30d,
  getDailyVariation,
  getDayRangeFromHist,
  get52WeekRangeFromHist,
  safeValue,
  filterByDays,
  getValidHist,
  getCloses,
  getTickers,
  safeSet,
  safeGet,
  normalizeStorage,
  formatLongName
} from "../../helpers/helpers.js";


// ---------------- GLOBAL RATE LIMIT PROTECTION (429 SAFETY) ----------------

const COOLDOWN_429 = 30 * 1000; // 30s de pausa global após 429
const RATE_LIMIT_KEY = "global-429";

console.log("🚀 Iniciando update-quotes");
const STORE_NAME = "quotes-blobs";
const LOCK_KEY = "update-lock";
const LOCK_TTL = 30 * 1000;     // 30s = evitar concorrência e não bloqueia pipeline por minutos

const getCacheTTL = () => {
  const hour = Number(
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      hour12: false
    }).format(new Date())
  );

  return hour >= 10 && hour <= 18
    ? 5 * 60 * 1000
    : 30 * 60 * 1000;
};

export const setGlobal429 = async (store) => {
  const now = Date.now();
  await safeSet(store, RATE_LIMIT_KEY, {
    timestamp: now
  });
};


// -------------------
const getGlobal429 = async (store) => {
  const data = await safeGet(store, RATE_LIMIT_KEY);
  // Evitar timestamp inválido
   if (!data || typeof data.timestamp !== "number") {
    return 0;
  }
  return data?.timestamp;
};

// ------ createResponse padrao para os Return Json
const createResponse = (body, status = 200) => {
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
// eliminar escrita concorrente do ticker-index e sem race condition real
// BUG LÓGICO (divisão por zero) corrigido
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
  // evitar crescimento inútil do índice
  const currentIndex = index % list.length;
  const nextIndex = (index + 1) % list.length;
  console.log("📍 index atual:", index, "| current:", currentIndex, "| next:", nextIndex);
  // Sequencia correta: índice está sendo persistido no Blobs e sem race condition
  // index atual: 0 | current: 0 | next: 1
  // index atual: 1 | current: 1 | next: 0
  // index atual: 0 | current: 0 | next: 1
  await safeSet(store, key, {
    value: nextIndex,
    updatedAt: Date.now()
  });
  return list[currentIndex];
};

// ---------------- FETCH ----------------
// Inicia um cronômetro de 3 segundos.
// Dispara a requisição fetch avisando que ela pode ser cancelada.
// Se o fetch for rápido: O cronômetro é desligado e você recebe os dados.
// Se o fetch demorar: O cronômetro estoura, o AbortController cancela a requisição, e você cai no erro de timeout.
// força a requisição a cancelar caso ela demore mais do que o esperado: 3s
const fetchWithTimeout = async (url, options = {}, timeout = 3000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options,
      signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      console.warn("❌ ⏱ TIMEOUT 3s ❌");
      } else {
      console.error("⚠️ erro fetch:", error);
      }
      throw new Error(`timeout: ${error.message}`);
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
      const status = resYahoo?.status;
      // 2. Tratamento de Rate Limit (429)
      if (status === 429) {
        await setGlobal429(store);
        console.warn(`🚨 429 Yahoo (${symbol}) - Tentativa ${i + 1} de ${attempts}`);
        await sleep((i + 1) * 1000);
        continue;
      }
      // 3. Tratamento de erros específicos (401, 404, 500)
      let errorMsg = "Erro Desconhecido";

      if (status === 401) {
        errorMsg = " ❌ Endpoint inconsistente ";
      } else if (status === 404) {
        errorMsg = " ❌Recurso não encontrado ";
      } else if (status === 500) {
        errorMsg = " ❌ Erro Interno do Servidor Yahoo ";
      }

      if (status !== 401) {
        console.error(`❌ Erro Yahoo: Status ${status} (${errorMsg}) em ${symbol}`);
      } else {
        console.warn(`⚠️ Yahoo quote bloqueado para ${symbol}`);
      }
      // Para erros fatais como 401 ou 404, geralmente não adianta tentar de novo
      if (status === 401 || status === 404) break;
    } catch (error) {
      console.error(`❌ Erro de REDE / ❌ TIMEOUT na tentativa ${i + 1}:`, error);
    }
  }
  // Se sair do loop sem retornar, significa que todas as tentativas falharam
  console.log(`💀 Falha definitiva para ${symbol} após ${attempts} tentativas.`);
  return null;
};


const fetchWithRetryBrapi = async (url, store, symbol, attempts = 2) => {
  for (let i = 0; i < attempts; i++) {
    let resBrapi;
    try {
      resBrapi = await fetchWithTimeout(url, {}, 3000);
    } catch (error) {
      console.error(`⚠️ Erro de rede/timeout/Abort na tentativa `, error);
      continue;
    }
    if (resBrapi?.status === 429) {
      await setGlobal429(store);
      console.warn(`🚨 BRAPI com erro 429 detectado (${symbol}) tentativa ${i + 1}`);
      if (i < attempts - 1) {
        await sleep((i + 1) * 400);
        continue;
      }
    }
    if (resBrapi?.ok) return resBrapi;
  }
  return null;
};

//--


// Ordem: 1.CACHE (Blobs) - 2.YAHOO - 3.BRAPI - 4.AlphaVantage - 5.RapidAPI: real-time - 6. previousData
// ------------ YAHOO = endpoint v8/finance/chart é focado em preço + histórico
// ------------ Ele não fornece dados fundamentais ou extremos (low/high)
// ------------ O YQL do Yahoo permite consultar dados do Yahoo! Finance.
// ------------ Os limites de uso: Sem autenticação: até 1.000 chamadas por dia ??
// ------------ Requisições GET por hora:	360 e por dia:	8000 ??

const fetchYahoo = async (symbol, store) => {
  try {
    const urlYahoo = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.SA?range=3mo&interval=1d`;
    const resYahoo = await fetchWithRetryYahoo (urlYahoo, store, symbol);  // retry leve p/ evitar timeout(1)
    if (!resYahoo || !resYahoo.ok) {
      console.warn("⚠️ Yahoo status: ", resYahoo?.status ?? "no-response");
      return null;
    }
    // evita crash Se API retornar HTML + mantém fallback BRAPI
    let jsonYahoo = null;
    try {
      jsonYahoo = await resYahoo.json();
    } catch (err) {
      console.warn("⚠️ Yahoo JSON inválido");
      return null;
    }
    const resultYahoo = jsonYahoo?.chart?.result?.[0];
    const meta = resultYahoo?.meta;
    if (!meta) return null;
    const timestamps = resultYahoo?.timestamp || [];
    const closes = resultYahoo?.indicators?.quote?.[0]?.close || [];
    const lows = resultYahoo?.indicators?.quote?.[0]?.low || [];
    const highs = resultYahoo?.indicators?.quote?.[0]?.high || [];
    const volumes = resultYahoo?.indicators?.quote?.[0]?.volume || [];

    return {
      symbol,
      shortName: meta.shortName ?? null,
      longName: meta.longName ?? null,
      regularMarketPrice: meta.regularMarketPrice,
      previousClose: meta.previousClose,
      changePercent: typeof meta.regularMarketChangePercent === "number" ? meta.regularMarketChangePercent : null,
      volume: meta.regularMarketVolume ?? null,
      averageVolume: meta.averageDailyVolume3Month ?? meta.averageDailyVolume10Day ?? null,
      historicalDataPrice: timestamps
        .map((t, i) => ({
          date: t,
          close: closes[i] ?? null,
          low: lows[i] ?? null,
          high: highs[i] ?? null,
          volume: volumes[i] ?? null
        }))
        .filter(d => d.date && d.close != null),
    };    // fim do Try
  } catch (err) {
  console.warn("⚠️ fetchYahoo:", err.message);
  return null;
  }
};

// ----------------3. BRAPI FALLBACK ----------------
// 15.000 req por mes /
const fetchBrapi = async (symbol, token, store ) => {
  try {
    const urlBrapi = `https://brapi.dev/api/quote/${symbol}?range=1mo&interval=1d&token=${token}`;
    const resBrapi = await fetchWithRetryBrapi(urlBrapi, store, symbol, 2);
    if (resBrapi?.ok) {
        let jsonBrapi = null;
        try {
          jsonBrapi = await resBrapi.json();
        } catch {}
        console.log("✅ ✅ BRAPI ✅ ✅ OK");
        const resultBrapi = jsonBrapi?.results?.[0];
        if (!resultBrapi) {
          console.warn("⚠️ BRAPI sem resultado válido");
          return null;
        }
        return {
          ...resultBrapi,
          averageVolume: resultBrapi?.averageVolume ?? resultBrapi?.averageVolume2x ?? resultBrapi?.volumeAvg ?? null,
          historicalDataPrice: resultBrapi?.historicalDataPrice ?? []
        };
    }
    return null;
  } catch (err) {
    console.warn("⚠️ BRAPI erro:", err.message);
    return null;
  }
};

// ----4. fetchAlphaVantage = não é boa pra histórico intraday BR e
// ---- ❌ tem rate limit MUITO agressivo (5 req/min free)
const fetchAlphaVantage = async (symbol, apiKey, store) => {
  try {
    // 🔒 respeita cooldown global
    const global429 = await getGlobal429(store);
    if (Date.now() - global429 < COOLDOWN_429) {
      console.warn("⛔ pulando Alpha (cooldown global)");
      return null;
    }
    const avSymbol = `${symbol}.SA`;
    const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${avSymbol}&outputsize=compact&apikey=${apiKey}`;
    const res = await fetchWithTimeout(url, {}, 4000);
    if (!res || !res.ok) {
      console.warn("⚠️ Alpha Vantage sem resposta");
      return null;
    }
    let json = null;
    try {
      json = await res.json();
    } catch {
      console.warn("⚠️ Alpha JSON inválido");
      return null;
    }
    if (json?.Note) {     // rate limit da Alpha
      console.warn("🚨 Alpha Vantage rate limit atingido");
      await setGlobal429(store);
      return null;
    }
    const series = json["Time Series (Daily)"];
    if (!series) return null;
    const entries = Object.entries(series)
      .sort((a, b) => new Date(b[0]) - new Date(a[0]));
    const historicalDataPrice = entries.map(([date, values]) => ({
      date: Math.floor(new Date(date).getTime() / 1000),
      close: Number(values["4. close"]),
      low: Number(values["3. low"]),
      high: Number(values["2. high"]),
      volume: Number(values["5. volume"])
    }));
    const latest = historicalDataPrice[0];
    const previous = historicalDataPrice[1];
    return {
      symbol,
      regularMarketPrice: latest?.close ?? null,
      previousClose: previous?.close ?? null,
      changePercent:
        latest && previous && previous.close
          ? ((latest.close - previous.close) / previous.close) * 100
          : null,
      regularMarketDayLow: latest?.low ?? null,
      regularMarketDayHigh: latest?.high ?? null,
      volume: latest?.volume ?? null,
      historicalDataPrice,
      source: "✅ ✅ ✅ ALPHA ✅ ✅ ✅ OK "
    };
  } catch (err) {
    console.warn("⚠️ Alpha erro:", err.message);
    return null;
  }
};

// ----- 5. RapidAPI: real-time-finance-data com 200 solicitações mensais gratuitas
//------ Baseado no Google Finance
const fetchRealTimeAPI = async (symbol, store) => {
  try {
    // 🔒 Respeita cooldown global
    const global429 = await getGlobal429(store);
    if (Date.now() - global429 < COOLDOWN_429) return null;
    // Formata para o padrão da API (Ex: PETR4 vira PETR4:BVMF)
    const rapidSymbol = `${symbol}:BVMF`;
    const url = `https://real-time-finance-data.p.rapidapi.com/stock-quote?symbol=${rapidSymbol}&language=en`;
    const options = {
      method: 'GET',
      headers: {
        'x-rapidapi-key': process.env.REAL_TIME_KEY,
        'x-rapidapi-host': 'real-time-finance-data.p.rapidapi.com'
      }
    };

    const res = await fetchWithTimeout(url, options, 4000);
    if (!res?.ok) {
        if (res?.status === 429) await setGlobal429(store);
        return null;
    }
    const json = await res.json();
    const stock = json?.data;
    if (!stock) return null;
    return {
      symbol,
      regularMarketPrice: stock.price,
      previousClose: stock.previous_close,
      changePercent: stock.change_percent,
      volume: stock.volume,
      source: " ✅✅✅✅ REAL TIME API ✅✅✅✅ OK "
    };
  } catch (err) {
    console.warn("⚠️ RapidAPI erro:", err.message);
    return null;
  }
};


// pipeline principal + orchestrator + coordinator + state machine
// ----------- ERA EXEC: Leitura linear:  lock - exec - timeout - race
// ----------  Era exec() deve retornar apenas dados = não usa createResponse
const processTickerUpdate  = async ( { store, apiToken, tickers } ) => {
     if (!Array.isArray(tickers) || tickers.length === 0) {
      console.warn("⚠️ tickers inválidos ou vazios");
      return { ok: false, reason: "tickers inválidos" };
    }
    const ETF_INFO = {
        AUPO11: { description: "Inflação 2060 (NTN-B) + LFTs 2027/28/30/31 (Selic)" },
        BOVA11: { description: "80 maiores empresas do Ibovespa" },
        B5P211: { description: "Inflação (NTN-B) Curto / Medio" },
        CHIP11: { description: "Chips Semicondutores e IA: NVIDIA, TSMC, Broadcom, ASML e Intel" },
        GOAT11: { description: "IMAB11 (80%) e S&P (19%)" },
        HASH11: { description: "Bitcoin (64,87%) e Ethereum (31,77%)"},
        IMAB11: { description: "Inflação (NTN-B) Medio / Longo" },
        IRFM11: { description: "Pré-fixado (LTN 2026/29/31) e NTN-B" },
        IVVB11: { description: "S&P 500 maiores empresas dos EUA" },
        LFTB11: { description: "Tesouro Selic (LFT 2027/28/29/30/2060)"},
        NASD11: { description: "Apple, Amazon, Google, Meta, Microsoft, Nvidia, Testa, Netflix "},
        NBIT11: { description: "Bitcoin contratos Futuros" },
        PACB11: { description: "Inflação (NTN-B) Longo 2050 / 2060" },
      "5PRE11": { description: "Pré-fixado (NTN 2035 e LTN 2032)" }
    };
    const symbol = await getNextTicker(store, tickers);
    if (!symbol) {
      return { ok: false, reason: "fila vazia" };
    }
      // ----------- CACHE FIRST ------- =>⚡ cache válido (saída imediata)
      const cacheKey = `snapshot-${symbol}`;
      const cached = await safeGet(store, cacheKey);
      if ( cached && typeof cached.updatedAt === "number" &&
        Date.now() - cached.updatedAt < getCacheTTL()
      ) {
        console.log("⚡ Cache hit valido:", symbol, cached.source);
        return { ok: true, symbol, source: "✅ cache-fresh", data: cached };
      }
      // --------- proteção global contra flood após 429 e timestamp inválido
      const global429 = await getGlobal429(store);
      if (global429 > 0) {
        const elapsed = Date.now() - global429;
        if (elapsed < COOLDOWN_429) {
          console.warn("⛔ cooldown global ativo");
          if (!cached) {
            return { ok: false, reason: "rate-limited" };
          }
          return { ok: true, symbol, source: "❌ global-429", data: cached };
        }
      }
      // Só dormir se não tiver cache
      if (!cached) await sleep(300);        // ⛔ anti-burst obrigatório (BRAPI free / Yahoo)

    // ----------- Yahoo segundo -------------------------
      let data = null;
      let source = null;
      try {
        data = await fetchYahoo(symbol, store);
        if (data) {
          source = " ✅ YAHOO ✅ OK";
        }
      } catch (err) { console.warn("⚠️ Yahoo erro:", err.message); }


    // ------ Brapi terceiro: ❌ Só exigir BRAPI se faltar preço OU histórico
      let brapiData = null;
      // 🔥 avaliação de qualidade do Yahoo: não substitui o merge e ele só decide quando chamar Brapi
      const isYahooWeak =
        !data ||
        data.regularMarketPrice == null ||
        !Array.isArray(data.historicalDataPrice) ||
        data.historicalDataPrice.length < 5;
      // NÃO precisa da BRAPI às 18h.
      if (isYahooWeak) {
        try {
          brapiData = await fetchBrapi(symbol, apiToken, store);
        } catch (err) {
          console.warn("⚠️ BRAPI erro:", err.message);
        }
      }

      // merge inteligente: Yahoo → prioridade e (BRAPI complementa Yahoo)
      if (brapiData) {
          brapiData = {
            ...brapiData,
            regularMarketPrice: brapiData?.regularMarketPrice ?? brapiData?.close ?? null,
            previousClose: brapiData?.regularMarketPreviousClose ?? brapiData?.previousClose ?? null,
            changePercent: brapiData?.changePercent ?? brapiData?.regularMarketChangePercent ?? null
          };
        }
      if (data && brapiData) source = "✅ YAHOO + ✅✅ BRAPI";
      else if (data) source = "✅ YAHOO";
      else if (brapiData) source = "✅ ✅ BRAPI";


      /*                      ***********   TEST Alpha Vantage Temporario *********
      const FORCE_ALPHA = false;
      const FORCE_REALTIME = true;

      if (FORCE_ALPHA) {
        data = null;
        brapiData = null;
      }
      Alterar abaixo o if (!data && !brapiData) abaixo para:
      if (!FORCE_REALTIME && !data && !brapiData) {
      ...
      */

      // ---------------------- ALPHA VANTAGE (QUARTO FALLBACK) ----------------
      let alphaData = null;
      if (!data && !brapiData) {
        try {
          const alphaKey = process.env.ALPHA_VANTAGE_API_KEY;
          if (alphaKey) {
            alphaData = await fetchAlphaVantage(symbol, alphaKey, store);
          }
        } catch (err) {
          console.warn("⚠️ Alpha erro: ", err.message);
        }
      }
      if (alphaData) {
        data = alphaData;
        source = " ✅✅✅ ALPHA VANTAGE API ✅✅✅ OK ";
      }


      /*                    ************ TEST REAL TIME Temporario ***************
      if (FORCE_REALTIME) {
        data = null;
        brapiData = null;
        alphaData = null;
      }

      */

      // ---------------------- Real-time-finance-data (QUINTO FALLBACK) ----------------
      let realTime = null;
      // API sera chamada se as 3 anteriores falharem
      if (!data && !brapiData && !alphaData) {
        try {
          // o process.env é um objeto que contém todas as variáveis de ambiente configuradas no painel do Netlify
          const realTimeKey = process.env.REAL_TIME_KEY;
          if (realTimeKey) {
            realTime = await fetchRealTimeAPI(symbol, store);
          }
        } catch (err) {
          console.warn("⚠️ Real Time : ", err.message);
        }
      }
      if (realTime) {
        data = realTime;
        source = " ✅✅✅✅ Real Time API ✅✅✅✅  OK ";
      }

      //------------- Falback = cache antigo = Evitar side-effect silencioso
      if (!data && cached) {    // cached vem do snapshot e não da API
        source = "Cache Antigo";
        data = cached;
      }

      // depois de resolvidos: Yahoo + BRAPI + Alpha + Real Time + cache => entra o MERGE
      const merged = {
        symbol,
        shortName: data?.shortName ?? brapiData?.shortName ?? brapiData?.symbol ?? symbol,
        longName: formatLongName(data?.longName ?? brapiData?.longName ?? symbol),
        regularMarketPrice: data?.regularMarketPrice ?? brapiData?.regularMarketPrice ?? null,
        previousClose: data?.previousClose ?? brapiData?.previousClose ?? null,
        changePercent: data?.changePercent ?? brapiData?.changePercent ?? null,
        regularMarketDayLow: data?.regularMarketDayLow ?? brapiData?.regularMarketDayLow ?? null,
        regularMarketDayHigh: data?.regularMarketDayHigh ?? brapiData?.regularMarketDayHigh ?? null,
        fiftyTwoWeekLow: data?.fiftyTwoWeekLow ?? brapiData?.fiftyTwoWeekLow ?? null,
        fiftyTwoWeekHigh: data?.fiftyTwoWeekHigh ?? brapiData?.fiftyTwoWeekHigh ?? null,
        volume: data?.volume > 0 ? data.volume : brapiData?.volume > 0 ? brapiData.volume : null,
      averageVolume: data?.averageVolume > 0 ? data.averageVolume : brapiData?.averageVolume > 0 ? brapiData.averageVolume : null,
      historicalDataPrice: data?.historicalDataPrice?.length ? data.historicalDataPrice : brapiData?.historicalDataPrice ?? []
      };

      // ------------ Fallback final absoluto-----------------
      const normalizedPrice = Number(merged.regularMarketPrice);

      if (!Number.isFinite(normalizedPrice) || normalizedPrice <= 0) {
        return { ok: false, reason: "Sem Dados" };
      }


    // --------------- Antes do payload e Depois do merge (data + brapiData)
    const yahooHist = getValidHist(data?.historicalDataPrice || []);
    const brapiHist = getValidHist(brapiData?.historicalDataPrice || []);
    // Se Yahoo vier com histórico curto, nao deve ignorar BRAPI que pode ter mais
    // Nao perder dados bons do outro provider e deduplicar por timestamp
    const map = new Map();

    // Snapshot incremental por ticker
    // Isso evita: race condition, overwrite, perda global

    // Yahoo tem prioridade nos candles
    for (const d of brapiHist) {
      if (d?.date && d?.close != null) {
        map.set(d.date, d);
      }
    }

    // Yahoo sobrescreve BRAPI se existir mesmo timestamp
    for (const d of yahooHist) {
      if (d?.date && d?.close != null) {
        map.set(d.date, d);
      }
    }

    // depois do merge = prioridade: 1. API (Yahoo ou BRAPI) e 2. cálculo via histórico
    const mergedHist = [...map.values()].sort((a,b) => a.date - b.date);
    const baseHist = mergedHist;
    // último candle disponível
    const latestCandle = baseHist.length ? baseHist[baseHist.length - 1] : null;

    // valida sessão real de negociação
    const hasValidTradingSession = latestCandle && Number(latestCandle.volume) > 0 &&
          Number(latestCandle.low) > 0 && Number(latestCandle.high) > 0;

    const previousCloseCalc = baseHist.length >= 2 ? baseHist[baseHist.length - 2]?.close ?? null : null;
    const avgVolumeCalc = baseHist.length ? Math.round(
          baseHist.reduce((acc, d) => acc + (d.volume || 0), 0) / baseHist.length ) : null;
    const min7d = baseHist.length ? getMin(getCloses(filterByDays(baseHist, 7))) : null;
    const min30d = baseHist.length ? getMin(getCloses(filterByDays(baseHist, 30))) : null;
    const price = Number(merged.regularMarketPrice);
          if (!Number.isFinite(price) || price <= 0) {
            return { ok: false, reason: "invalid-price" };
          }
    const variation30d = getVariation30d(baseHist, price);
    const calcDaily = getDailyVariation(baseHist, price);

    const rawChange = merged?.changePercent;
    const yahooChange = rawChange === null || rawChange === undefined || rawChange === "" ? null : Number(rawChange);

    const normalizedPreviousClose = Number(merged.previousClose);
    const previousCloseSafe = Number.isFinite(normalizedPreviousClose) && normalizedPreviousClose > 0 ? normalizedPreviousClose
          : previousCloseCalc > 0 ? previousCloseCalc : null;
    const realCalculatedChange = previousCloseSafe && previousCloseSafe > 0
          ? ((price - previousCloseSafe) / previousCloseSafe) * 100 : null;

    const DIFF_TOLERANCE = 0.5;
    const HARD_DIFF_TOLERANCE = 1.2;
    const calculatedChange = realCalculatedChange ?? calcDaily ?? null;
    const diff = calculatedChange != null && yahooChange != null ? Math.abs(yahooChange - calculatedChange) : 0;
    const yahooBroken = yahooChange == null || !Number.isFinite(yahooChange) || Math.abs(yahooChange) > 40 ||
          ( realCalculatedChange != null && Math.abs(yahooChange - realCalculatedChange) > HARD_DIFF_TOLERANCE );

    const usingCalculated = yahooBroken || diff > DIFF_TOLERANCE;
    const finalChange = usingCalculated && Number.isFinite(calculatedChange) ? calculatedChange : yahooChange;
    const changePercent = Number.isFinite(finalChange) ? Number(finalChange.toFixed(2)) : null;

    const normalizePrice = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
    const dayRangeCalc = hasValidTradingSession ? getDayRangeFromHist(baseHist) :
        {
          low: cached?.regularMarketDayLow ?? null,
          high: cached?.regularMarketDayHigh ?? null
        };

    const week52Calc = get52WeekRangeFromHist(baseHist);
    const dayLow = normalizePrice(dayRangeCalc.low) ?? normalizePrice(data?.regularMarketDayLow) ?? normalizePrice(cached?.regularMarketDayLow) ?? null;
    const dayHigh = normalizePrice(dayRangeCalc.high) ?? normalizePrice(data?.regularMarketDayHigh) ?? normalizePrice(cached?.regularMarketDayHigh) ?? null;

    const fiftyTwoWeekLow = safeValue(data?.fiftyTwoWeekLow ?? week52Calc.low);
    const fiftyTwoWeekHigh = safeValue(data?.fiftyTwoWeekHigh ?? week52Calc.high);

    // -------------------- Payload--------------
      const payload = {
        source,
        symbol,
        shortName: merged.shortName,
        longName: merged.longName,
        regularMarketPrice: safeValue(merged.regularMarketPrice),
        changePercent: changePercent,
        changeSource: usingCalculated ? "CALCULATED" : "YAHOO",
        regularMarketDayLow: dayLow,
        regularMarketDayHigh: dayHigh,
        previousClose: previousCloseSafe,
        fiftyTwoWeekLow,
        fiftyTwoWeekHigh,
        volume: safeValue(merged.volume),
        averageVolume: safeValue(merged.averageVolume) ?? safeValue(avgVolumeCalc),
        min7d,
        min30d,
        variation30d,
        updatedAt: Date.now(),                    // Timestamp para lógica de front-end
        updatedLabel: getFormattedDateTime(),     // String formatada DD/MM/AAAA HH:MM:SS
        description: ETF_INFO[symbol]?.description || "Ativo Financeiro",
        logourl: data?.logourl || `https://icons.brapi.dev/icons/${symbol}.svg`,
        historicalDataPrice: mergedHist.slice(-90)
      };
      // ----- salva cache principal
      await safeSet(store, `snapshot-${symbol}`, payload);
      // 🧠 ATUALIZA SNAPSHOT CONSOLIDADO
      const SNAP_KEY = "last-valid-snapshot";
      try {
        const prev = await safeGet(store, SNAP_KEY);
        const prevArray = normalizeStorage(prev).data;
        let newSnapshot = [];
        if (prevArray.length) {
          const map = new Map(
            prevArray
              .filter(i => i?.symbol)
              .map(i => [i.symbol, i])
          );
          map.set(symbol, payload);
          newSnapshot = Array.from(map.values())
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
            .slice(0, MAX_ITEMS);
        } else {
          newSnapshot = [payload];
        }
        await safeSet(store, SNAP_KEY, {
          data: newSnapshot,
          updatedAt: Date.now()
        });
        console.log("🧠 snapshot atualizado:", symbol);
      } catch (err) {
        console.warn("⚠️ erro ao atualizar snapshot:", err.message);
      }
      // -------------✅ Retorno no painel Netlify ✅---------
      console.log(`💾 salvo ${symbol} → source: ${source} 💾`);
      return { ok: true, symbol, source, data: payload };
}
//  FiM da const processTickerUpdate


// ---------------- MAIN ----------------
export default async () => {
  const API_TOKEN = process.env.BRAPI_TOKEN;
  if (!API_TOKEN) { return createResponse({ error: "Token ausente" }, 500); }
  const store = getStore({ name: STORE_NAME });
  const tickers = await getTickers(store);
  const lock = await acquireLock(store);
  if (!lock) { return createResponse({ skipped: "lock" }); }
  const MAX_EXECUTION_TIME = 10000;   // 10 s = // Yahoo (3s timeout) + Brapi (3s) + Alpha (4s) + Real Time
  const timeout = (label = "exec", ms = MAX_EXECUTION_TIME) =>
    new Promise((_, reject) =>
      setTimeout(() => {
        reject(new Error(`⏱ timeout em ${label} (${ms}ms)`));
      }, ms)
  );
    try {
      const result = await Promise.race([
        processTickerUpdate ({
          store,
          apiToken: API_TOKEN,
          tickers
        }),
        timeout(" processTickerUpdate ")
      ]);
      return createResponse(result ?? { ok: false, error: "empty_result" });
    } catch (err) { return createResponse( { ok: false, error: err.message }, 500 );
    } finally { await releaseLock(store); }
};

// --------- FiM do MAIN export default async
// --------- CRON Netlify cron sempre usa UTC: 13:00 vira 10:00
// --------- a cada 6 min e (1-5) Seg a Sex

export const config = {
  "*/6 13-23 * * 1-5",    // Seg a Sex: das 10:00 às 20:54 (Horário BR)
    "*/6 0-2 * * 2-6"    // Ter a Sáb (UTC): que equivale a Seg a Sex das 21:00 às 23:54 (Horário BR)
};
