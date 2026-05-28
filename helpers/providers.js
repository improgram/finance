// Ordem: 1.CACHE (Blobs) - 2.YAHOO - 3.BRAPI - 4.AlphaVantage - 5.RapidAPI: real-time - 6. previousData
// YAHOO = endpoint v8/finance/chart é focado em preço + histórico
// Ele não fornece dados fundamentais ou extremos (low/high)
// O YQL do Yahoo permite consultar dados do Yahoo! Finance.
// Os limites de uso: Sem autenticação: até 1.000 chamadas por dia ??
// Requisições GET por hora: 360 e por dia:	8000 ??

// Script para os providers
// providers -> dados crus
// chamar APIs
// retry / timeout
// parse de resposta
// normalização leve do payload
// tratamento de erro da API
// setGlobal429 / leitura de rate-limit (ok aqui também)

// NÃO deve:
// calcular indicadores
// calcular variação
// merge final complexo
// snapshot
// cache consolidado

import {
  fetchWithRetryYahoo, fetchWithRetryBrapi, fetchWithTimeout
} from "./retry.js";

import {
  setGlobal429, getGlobal429
} from "./cache.js";

import {
  COOLDOWN_429
} from "./constants.js";

// APIs financeiras frequentemente retornam:
// undefined , null , "" , "N/A"  , "-" , "null"
// safeNumber -> sanitização
import {
  safeNumber
} from "./market.js";


// fallback chain centralizado aqui
export const fetchMarketData = async (symbol, store, apiToken) => {

  // ---- Yahoo segundo após cache ---------------------
  let yahooData = null;
  let finalData = null;
  let source = null;
  try {
    yahooData = await fetchYahoo(symbol, store);
    if (yahooData) {
      finalData = yahooData;
      source = " ✅ YAHOO ✅ OK";
    }
  } catch (err) { console.warn("⚠️ Yahoo erro:", err.message); }

  // ------ Brapi: ❌ Só exigir BRAPI se faltar preço OU histórico

  let brapiData = null;

  // 🔥 avaliação de qualidade do Yahoo: não substitui o merge e ele só decide quando chamar Brapi
  const isYahooWeak =
    !yahooData ||
    yahooData.regularMarketPrice == null ||
    !Array.isArray(yahooData.historicalDataPrice) ||
    yahooData.historicalDataPrice.length < 5;

  // NÃO precisa da BRAPI às 18h.
  if (isYahooWeak) {
    try {
      brapiData = await fetchBrapi(symbol, apiToken, store);
    }
    catch (err) { console.warn("⚠️ BRAPI erro:", err.message); }
  }

  // normalização dos campos da BRAPI
  if (brapiData) {
    brapiData = {
      ...brapiData,
      regularMarketPrice: brapiData?.regularMarketPrice ?? brapiData?.close ?? null,
      previousClose: brapiData?.regularMarketPreviousClose ?? brapiData?.previousClose ?? null,
      changePercent: brapiData?.changePercent ?? brapiData?.regularMarketChangePercent ?? null
    };
  }
  if (!finalData && brapiData) {
    finalData = brapiData;
    source = " ✅✅ BRAPI OK ";
  }

  /*   ***********   TEST Alpha Vantage Temporario *********
  const FORCE_ALPHA = false;
  const FORCE_REALTIME = true;
  if (FORCE_ALPHA) {
    data = null;
    brapiData = null;
  }
  Alterar abaixo o if (!data && !brapiData) abaixo para:
  if (!FORCE_REALTIME && !data && !brapiData) { ...
  */

  // ---------- ALPHA VANTAGE (QUARTO FALLBACK) ------------
  let alphaData = null;
  const alphaKey = process.env.ALPHA_VANTAGE_API_KEY;

  if (!yahooData && !brapiData && alphaKey) {
    alphaData = await fetchAlphaVantage(symbol, alphaKey, store);
    if (alphaData) {
      finalData = alphaData;
      source = "✅✅✅ ALPHA VANTAGE ✅✅✅ OK "
    }
  }

  //------------ TEST REAL TIME Temporario-------
  /*
    if (FORCE_REALTIME) {
      data = null;
      brapiData = null;
      alphaData = null;
    }
  */

  // Real-time-finance-data (QUINTO FALLBACK: sera chamada se as 3 anteriores falharem)

  let realTime = null;
  // o process.env é um objeto que contém todas as variáveis de ambiente configuradas no painel do Netlify
  const realTimeKey = process.env.REAL_TIME_KEY;

  if (!finalData && realTimeKey) {
    realTime = await fetchRealTimeAPI(symbol, store);
    if (realTime) {
      finalData = realTime;
      source = " ✅✅✅✅ Real Time API ✅✅✅✅  OK ";
    }
  }

  // ----- Return Final

  return {
    data: finalData,          // provider principal escolhido
    source,
    sources: {
      yahoo: yahooData,
      brapi: brapiData,
      alpha: alphaData,
      realtime: realTime
    }
  };
};


export const fetchYahoo = async (symbol, store) => {
  try {
    const urlYahoo = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.SA?range=3mo&interval=1d`;
    const resYahoo = await fetchWithRetryYahoo(urlYahoo, store, symbol);  // retry leve p/ evitar timeout(1)
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
    };
    // fim do Return

  } catch (err) {
  console.warn("⚠️ fetchYahoo:", err.message);
  return null;
  } // Fim do Try
};

// ----------------3. BRAPI FALLBACK => 15.000 req por mes ----------------

export const fetchBrapi = async (symbol, token, store ) => {
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
export const fetchAlphaVantage = async (symbol, apiKey, store) => {
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
      close: safeNumber(values["4. close"]),
      low: safeNumber(values["3. low"]),
      high: safeNumber(values["2. high"]),
      volume: safeNumber(values["5. volume"])
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

// --- 5. RapidAPI: real-time-finance-data com 200 solicitações mensais gratuitas
//---- Baseado no Google Finance
export const fetchRealTimeAPI = async (symbol, store) => {
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
