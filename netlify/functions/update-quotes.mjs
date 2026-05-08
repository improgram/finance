// lógica completa
// chamada da Brapi:  A chave será lida das variáveis de ambiente do Netlify
// processamento
// salvamento no Blobs
// retorna JSON
// schedule (cron)

// CommonJS (require)  = (antigo)
// ES Modules (import/export) = (novo)
// permite o objeto de configuração simplificado.
// Coletor Roda via CRON, busca no Yahoo + Brapi + Alpha Vantage
// CRON funciona em: Netlify Functions (Node) e ❌ NÃO funciona em: Edge Functions
// e salva cada ticker individualmente no Blobs

// ---------------- CONFIG ----------------
import * as netlifyBlobs from "@netlify/blobs";
const getStore = netlifyBlobs?.getStore;

if (typeof getStore !== "function") {
  throw new Error("❌ Netlify Blobs SDK inválido ou incompatível");
}

// ---------------- GLOBAL RATE LIMIT PROTECTION (429 SAFETY) ----------------

const COOLDOWN_429 = 30 * 1000; // 30s de pausa global após 429
const RATE_LIMIT_KEY = "global-429";

console.log("🚀 Iniciando update-quotes");
const STORE_NAME = "quotes-blobs";
const LOCK_KEY = "update-lock";
const LOCK_TTL = 30 * 1000;     // 30s = evitar concorrência e não bloqueia pipeline por minutos
const MAX_ITEMS = 50;
const hour = Number(
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    hour12: false
  }).format(new Date())
);

const CACHE_TTL =
  hour >= 10 && hour <= 18
    ? 5 * 60 * 1000   // 5 min
    : 30 * 60 * 1000; // 30 min

// -------------------- Helpers Market --------------------

const getFormattedDateTime = () =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "medium"
  }).format(new Date());

const getCloses = (hist = []) => hist.map(d => d.close);
const getMin = (arr) => arr.length ? Math.min(...arr) : null;
const hasEnoughHist = (hist) => hist.length >= 10;
const safeValue = (value) => (value == null || Number.isNaN(value)) ? null : value;
const fallbackMin = (fallback) => fallback != null ? fallback : "N/E";
const safeWithFallback = (newPreco, oldPreco) => newPreco == null ? (oldPreco ?? null) : newPreco;

const filterByDays = (hist, days) => {
  if (!Array.isArray(hist)) return [];
  const now = Math.floor(Date.now() / 1000);
  const limit = now - (days * 24 * 60 * 60);
  const normalizeTs = (t) => t > 1e12 ? Math.floor(t / 1000) : t;
  return hist.filter(d => normalizeTs(d.date) >= limit);
};

const getValidHist = (hist) => (hist || []).filter(d =>
  d &&
  typeof d.date === "number" &&
  typeof d.close === "number"
);

const getVariation30d = (hist, currentPrice) => {
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
const getDailyVariation = (hist, currentPrice) => {
  const valid = getValidHist(hist).filter(d => d.close > 0);
  if (valid.length < 2) return null;
  const sorted = [...valid].sort((a, b) => a.date - b.date);
  const last = sorted.at(-1)?.close;
  const prev = sorted.at(-2)?.close;
  if (!last || !prev || prev === 0) return null;
  return ((last - prev) / prev) * 100;
};


// Buscar preços historicos: Yahoo = preço rápido e BRAPI = enriquecimento de dados
const getMax = (arr) => arr.length ? Math.max(...arr) : null;

const getDayRangeFromHist = (hist) => {
  if (!Array.isArray(hist) || !hist.length) {
    return { low: null, high: null };
  }
  const start = new Date();
    start.setHours(0,0,0,0);
  const dayStart = Math.floor(start.getTime() / 1000);
  const today = hist.filter(d => d.date >= dayStart);
  const lows = today.map(d => d.low ?? d.close).filter(Boolean);
  const highs = today.map(d => d.high ?? d.close).filter(Boolean);
  return {
    low: lows.length ? Math.min(...lows) : null,
    high: highs.length ? Math.max(...highs) : null
  };
};


const get52WeekRangeFromHist = (hist) => {
  if (!hist.length) return { low: null, high: null };
  const closes = hist.map(d => d.close).filter(v => v != null);
  return {
    low: getMin(closes),
    high: getMax(closes)
  };
};

const formatLongName = (name) => {
  if (!name) return null;

  return name
    .replace(/\bS\.A\.?\b/gi, "")
    .replace(/\bSA\b/gi, "")
    .replace(/\bHOLDING\b/gi, "")
    .replace(/\bINVESTMENTS?\b/gi, "")
    .replace(/\bInvestimentos?\b/gi, "")
    .replace(/\bParticipações?\b/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s+\./g, "")
    .replace(/\s+e\s+/gi, " ")
    .replace(/\s+e$/i, "")
    .replace(/\b[eE]\b/g, "")
    .trim();
};


// ---------------- HELPERS Gerais sleep, safeGet, safeSet ------------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Padronizar 100% o storage = blobs às vezes retorna objeto direto, e às vezes string
// safeSet sempre stringify → pode gerar dupla serialização Se alguém passar string
// Se quiser aceitar string, então precisa tratar no safeGet.
// O JSON.stringify(value) Pode gerar double stringify e Pode quebrar leitura futura do timestamp
const safeSet = async (store, key, value) => {
  try {
    const data = JSON.stringify(value ?? null);
    return await store.set(key, data);
  } catch (err) {
    console.warn("⚠️ safeSet falhou:", key, err.message);
    return null;
  }
};

const setGlobal429 = async (store) => {
  const now = Date.now();
  await safeSet(store, RATE_LIMIT_KEY, {
    timestamp: now
  });
};

const normalizeStorage = (data) => {
  if (!data) return null;
  if (Array.isArray(data)) {
    return { data };
  }
  if (typeof data === "object") {
    if (Array.isArray(data.data)) {
      return data;
    }
    if (Array.isArray(data.value)) {
      return { data: data.value };
    }
  }
  return { data: [] };
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

const getGlobal429 = async (store) => {
  const data = await safeGet(store, RATE_LIMIT_KEY);
  // Evitar timestamp inválido
   if (!data || typeof data.timestamp !== "number") {
    return 0;
  }
  return data?.timestamp;
};

//-- Evitar tickers-list vazio
const updateTickersList = async (store, tickers) => {
  if (!Array.isArray(tickers) || tickers.length === 0) {
    throw new Error("🚨 tentativa de salvar tickers-list vazia");
  }
  const clean = [...new Set(tickers.map(t => t.trim()).filter(Boolean))];
  if (!clean.length) {
    throw new Error("🚨 tickers-list inválida após limpeza");
  }
  await safeSet(store, "tickers-list", clean);
  console.log("📦 tickers-list atualizada:", clean.length);
};

const safeParseTickers = (raw) => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    return raw.split(",").map(t => t.trim()).filter(Boolean);
  }
  if (typeof raw === "object") {
    if (Array.isArray(raw.value)) return raw.value;
    if (typeof raw.value === "string") {
      return raw.value.split(",").map(t => t.trim()).filter(Boolean);
    }
  }
  return [];
};

// -- LIMPEZA NO BOOT
const sanitizeTickers = (list) => {
  if (!Array.isArray(list)) return [];
  return [...new Set(list)]
    .map(t => String(t).trim().toUpperCase())
    .filter(t => /^[A-Z0-9]+$/.test(t));
};

// --- Helper para buscar tickers dinâmicos no Blobs - já faz parse e trata fallback
const getTickers = async (store) => {
  const data = await safeGet(store, "tickers-list");
  console.log("📦 tickers raw:", data);
  const raw =
    Array.isArray(data)
      ? data
      : data?.value ?? data;
  const tickers = sanitizeTickers(safeParseTickers(raw));
  // 🔥 BOOT CLEANUP (REMOVE ESTADO FANTASMA)
  if (Array.isArray(raw)) {
    const cleaned = sanitizeTickers(raw);
    // sobrescreve o storage com versão limpa automaticamente = Evitar regravar sempre no boot
    if (JSON.stringify(cleaned) !== JSON.stringify(raw)) {
      await safeSet(store, "tickers-list", cleaned);
      console.log("🧼 tickers sanitizados no boot:", cleaned);
    }
  }
  // Cria automaticamente o tickers-list se não existir
  if (!tickers.length) {
    console.warn("⚠️ tickers vazia → inicializando padrão");
    const fallback = sanitizeTickers( ["BBDC4", "IRFM11"] );
    // 🔥 bootstrap automático (uma única vez na prática)
    await safeSet(store, "tickers-list", fallback);
    return fallback.slice(0, MAX_ITEMS);
  }
  return tickers.slice(0, MAX_ITEMS);
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
      // 2. Tratamento de Rate Limit (429)
      if (resYahoo?.status === 429) {
        await setGlobal429(store);
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
// Na ordem : 1.CACHE (Blobs) - 2.YAHOO - 3.BRAPI - 4. previousData
// ------------YAHOO = endpoint v8/finance/chart é focado em preço + histórico
const fetchYahoo = async (symbol, store) => {
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
    return {
      symbol,
      shortName: meta.shortName ?? null,
      longName: meta.longName ?? null,
      regularMarketPrice: meta.regularMarketPrice,
      previousClose: meta.previousClose,
      changePercent: meta.regularMarketChangePercent != null ? meta.regularMarketChangePercent ?? null : null,
      volume: meta.regularMarketVolume ?? null,
      historicalDataPrice: timestamps
        .map((t, i) => ({
          date: t,
          close: closes[i] ?? null,
          low: lows[i] ?? null,
          high: highs[i] ?? null
        }))
        .filter(d => d.date && d.close != null),
    };    // fim do Try
  } catch (err) {
  console.warn("⚠️ fetchYahoo:", err.message);
  return null;
  }
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
        console.log("✅ BRAPI Chamada OK");
        const resultBrapi = jsonBrapi?.results?.[0];
        if (!resultBrapi) {
          console.warn("⚠️ BRAPI sem resultado válido");
          return null;
        }
        return {
          ...resultBrapi,
          historicalDataPrice: resultBrapi?.historicalDataPrice ?? []
        };
    }
    return null;
  } catch (err) {
    console.warn("⚠️ BRAPI erro:", err.message);
    return null;
  }
};
// ----function fetchAlphaVantage = não é boa pra histórico intraday BR e ❌ tem rate limit MUITO agressivo (5 req/min free)
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
      close: Number(values["4. close"])
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
      historicalDataPrice,
      source: "alpha"
    };
  } catch (err) {
    console.warn("⚠️ Alpha erro:", err.message);
    return null;
  }
};

// -------fetch ultra leve = busca somente: preço  + variação diária e ( SEM histórico.)
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
  } catch {
    return null;
  }
};
// pipeline principal + orchestrator + coordinator + state machine
const processTickerUpdate  = async ( { store, apiToken, tickers } ) => {
     if (!Array.isArray(tickers) || tickers.length === 0) {
      console.warn("⚠️ tickers inválidos ou vazios");
      return { ok: false, reason: "tickers inválidos" };
    }
    const ETF_INFO = {
        AUPO11: { description: "NTN-B + Selic" },
        B5P211: { description: "NTN-B (inflação) Curto/Medio" },
        GOAT11: { description: "IMAB11(80%) e S&P(19%)" },
        IMAB11: { description: "NTN-B (Inflação) Medio/Longo" },
        IRFM11: { description: "Pré-fixado (LTN 26/29/31) e NTN-B" },
        IVVB11: { description: "S&P 500 dos EUA" },
        NBIT11: { description: "Bitcoin Nasdaq" },
        PACB11: { description: "NTN-B (Inflação) Longo 2050/60" },
        "5PRE11": { description: "Pré-fixado" }
    };
    const symbol = await getNextTicker(store, tickers);
    if (!symbol) {
      return { ok: false, reason: "fila vazia" };
    }
      // ---------------- CACHE FIRST -------// ⚡ cache válido (saída imediata)
      const cacheKey = `snapshot-${symbol}`;
      const cached = await safeGet(store, cacheKey);
      if ( cached && typeof cached.updatedAt === "number" &&
        Date.now() - cached.updatedAt < CACHE_TTL
      ) {
        console.log("⚡ Cache hit valido:", symbol, cached.source);
        return { ok: true, symbol, source: "cache-fresh", data: cached };
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
          return { ok: true, symbol, source: "global-429", data: cached };
        }
      }                               // Só dormir se não tiver cache:
      if (!cached) await sleep(300); // ⛔ anti-burst obrigatório (BRAPI free / Yahoo)
    // ----------- Yahoo segundo -------------------------
      let data = null;
      let source = null;
      let historicalDataPrice = [];
      try {
        data = await fetchYahoo(symbol, store);
        if (data) {
          source = "YAHOO";
          historicalDataPrice = data?.historicalDataPrice || [];
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
      if (brapiData) {            // merge inteligente: Yahoo → prioridade e (BRAPI complementa Yahoo)
          brapiData = {
            ...brapiData,
            regularMarketPrice: brapiData?.regularMarketPrice ?? brapiData?.close ?? null,
            previousClose: brapiData?.regularMarketPreviousClose ?? brapiData?.previousClose ?? null,
            changePercent: brapiData?.changePercent ?? brapiData?.regularMarketChangePercent ?? null
          };
        }
      if (data && brapiData) source = "YAHOO + BRAPI";
      else if (data) source = "YAHOO";
      else if (brapiData) source = "BRAPI";
      // ---------------------- ALPHA VANTAGE (ÚLTIMO FALLBACK) ----------------
      let alphaData = null;
      if (!data && !brapiData) {
        try {
          const alphaKey = process.env.ALPHA_VANTAGE_API_KEY;
          if (alphaKey) {
            alphaData = await fetchAlphaVantage(symbol, alphaKey, store);
          }
        } catch (err) {
          console.warn("⚠️ Alpha erro:", err.message);
        }
      }
      if (alphaData) {
        data = alphaData;
        historicalDataPrice = alphaData.historicalDataPrice || [];
        source = "ALPHA VANTAGE";
      }
      // Falback = cache antigo = Evitar side-effect silencioso
      if (!data && cached) {    // cached vem do snapshot e não da API
        source = "Cache Antigo";
        data = cached;
        historicalDataPrice = cached?.historicalDataPrice ?? cached?.data?.historicalDataPrice ?? [];
      }
      // depois de Yahoo + BRAPI + Alpha + cache resolvidos: entra o MERGE
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
        volume: data?.volume ?? brapiData?.regularMarketVolume ?? null,
        averageVolume: data?.averageVolume ?? null,
  historicalDataPrice:
  data?.historicalDataPrice?.length
    ? data.historicalDataPrice
    : brapiData?.historicalDataPrice ?? []

      };
      // ------------ Fallback final absoluto-----------------
      if (!data) { return { ok: false, reason: "Sem Dados" }; }
    // --------------- Antes do payload e Depois do merge (data + brapiData)
    const rawHist = merged?.historicalDataPrice ?? cached?.historicalDataPrice ?? [];
    const hist = getValidHist(rawHist);
    const yahooHist = getValidHist(data?.historicalDataPrice || []);
    const brapiHist = getValidHist(brapiData?.historicalDataPrice || []);
    // Se Yahoo vier com histórico curto, nao deve ignorar BRAPI que pode ter mais
    // Nao perder dados bons do outro provider e deduplicar por timestamp
    const map = new Map();
    // Snapshot incremental por ticker
    // Isso evita: race condition, overwrite, perda global
      for (const d of [...yahooHist, ...brapiHist]) {
        if (d?.date && d?.close != null) map.set(d.date, d);
      } // depois do merge = prioridade: 1. API (Yahoo ou BRAPI) e 2. cálculo via histórico
    const mergedHist = [...map.values()].sort((a,b) => a.date - b.date);
    const baseHist = mergedHist;
    const min7d = baseHist.length ? getMin(getCloses(filterByDays(baseHist, 7))) : null;
    const min30d = baseHist.length ? getMin(getCloses(filterByDays(baseHist, 30))) : null;
    const price = merged.regularMarketPrice;
    const variation30d = getVariation30d(baseHist, price);
    const calcDaily = getDailyVariation(baseHist, price);
    const changePercent = Number.isFinite(merged?.changePercent) ? merged.changePercent : calcDaily ?? null;
    const dayRangeCalc = getDayRangeFromHist(baseHist);
    const week52Calc = get52WeekRangeFromHist(baseHist);
    const dayLow = safeValue(dayRangeCalc.low ?? data?.regularMarketDayLow);
    const dayHigh = safeValue(dayRangeCalc.high ?? data?.regularMarketDayHigh);
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
        regularMarketDayLow: dayLow,
        regularMarketDayHigh: dayHigh,
        previousClose: merged.previousClose ?? null,
        fiftyTwoWeekLow,
        fiftyTwoWeekHigh,
        volume: safeValue(merged.volume),
        averageVolume: safeValue(merged.averageVolume),
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
      } // ------------- Retorno  ---------
      console.log(`💾 salvo ${symbol} → source: ${source}`);
      return { ok: true, symbol, source, data: payload };
}   //  FiM da const processTickerUpdate

// ---------------- MAIN ----------------
export default async () => {
  const API_TOKEN = process.env.BRAPI_TOKEN;
  if (!API_TOKEN) { return createResponse({ error: "Token ausente" }, 500); }
  const store = getStore({ name: STORE_NAME });
  const tickers = await getTickers(store);
  const lock = await acquireLock(store);
  if (!lock) { return createResponse({ skipped: "lock" }); }
  const MAX_EXECUTION_TIME = 10000;   // 10 s = // Yahoo (3s timeout) + Brapi (3s) + Alpha (4s)
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
};    // FiM do MAIN export default async

// --------- CRON ------- Netlify cron sempre usa UTC que significa -3
// Cron a cada 15 min  e   (10h as 18h)  e (1-5) Seg a Sex

export const config = {
  schedule: "*/15 13-21 * * 1-5"
};
