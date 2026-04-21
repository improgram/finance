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
// com os campos updatedAt e updatedLabel.


import { getStore } from "@netlify/blobs";
import crypto from "crypto";
console.log("🚀 Iniciando update-quotes");

// -------------------- CONFIG --------------------
const STORE_NAME = "quotes-blobs";
const LOCK_KEY = "update-lock";
const LOCK_TTL = 3 * 60 * 1000; // 3 min (evitar concorrência:)
const CACHE_TTL = 5 * 60 * 1000; // 5 min
// É vital que o valor de LOCK_TTL seja maior que o tempo máximo que a função leva para rodar

// -------------------- HELPERS --------------------

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Blindagem extra do fetch - Pois pode não existir dependendo do runtime
const getFetch = () => {
  if (typeof fetch === "function") return fetch;

  try {
    return require("node-fetch"); // Node antigo
  } catch {
    throw new Error("fetch não disponível no runtime");
  }
};


// Alguns runtimes(Node antigos) não têm AbortController
const createAbortController = () => {
  if (typeof AbortController !== "undefined") {
    return new AbortController();
  }

  return {
    signal: undefined,
    abort: () => {}
  };
};

// Response não existe em Node antigo e (compatibilidade Node vs Edge)
const createResponse = (body, status = 200, headers = {}) => {
  if (typeof Response !== "undefined") {
    return createResponse(
      typeof body === "string" ? body : JSON.stringify(body),
      { status, headers }
    );
  }
  // fallback Node (Netlify older / server)
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json",
      ...headers
    },
    body: typeof body === "string" ? body : JSON.stringify(body)
  };
};

// (Netlify Blobs compatível) = store.set() = SDK antigo pode não aceitar {type: "json"}.
const safeSet = async (store, key, value, type = "json") => {
  try {
    if (type === "json") {
      return await store.set(key, value, { type: "json" });
    }
    return await store.set(key, value);
  } catch (err) {
    console.warn("⚠️ store.set fallback:", err?.message);

    // fallback para versões antigas do Blobs
    return await store.set(key, JSON.stringify(value));
  }
};
// E prevenir dados corrompidos no GET
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


// crypto.randomUUID() (compatibilidade com Node antigo)
const generateId = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // fallback Node antigo
  try {
    const { randomBytes } = require("crypto");
    return randomBytes(16).toString("hex");
  } catch {
    // fallback final (edge/browser safe)
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
};


const createLock = (executionId, now) => ({
  v: 2,
  executionId,
  timestamp: now
});


const isValidLock = (lock) =>
  lock &&
  lock.v === 2 &&
  typeof lock.executionId === "string" &&
  typeof lock.timestamp === "number";


// Timeout menor (serverless-safe)
const fetchWithTimeout = async (url, options = {}, timeout = 8000) => {
  const fetchFn = getFetch();
  const controller = createAbortController(); // runtimes(Nodes) antigos não têm AbortController
  const id = setTimeout(() => controller.abort(), timeout);
  return await fetch(url, {
    ...options,
    signal: controller.signal,
  });
};

// Retry leve (anti-timeout Netlify)
const fetchWithRetry = async (url, retries = 1) => {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetchWithTimeout(url);
      // A function fetchWithTimeout possui o AbortSignal.timeout(8000)
      if (res && res.status !== 429) return res;

      console.warn("⏳ Rate limit BRAPI...");
      await sleep(3000);
    } catch (err) {
      console.warn("⚠️ fetch erro:", err);
      if (i === retries) throw err;
    }
  }
  throw new Error("BRAPI Rate limit persistente");
};


// -------------------- LOCK DISTRIBUÍDO --------------------
// função decide se o processo tem "permissão" para rodar.
// Lock deve evitar que duas execuções entrem
// DOIS tipos de lock separados: Global e Lock da Fila
const acquireLock = async (store) => {    // Adquirir a Trava
  const now = Date.now();

  // Proteção contra lock corrompido no Blobs
  const existingLock = await safeGet(store, LOCK_KEY);
  if (existingLock  && (now - existingLock.timestamp) < LOCK_TTL) {
    console.log("🔒 Lock ativo e ocupado, abortando execução");
    return null; // Lock ocupado
  }

   // --------------- gera id único da execução
  const executionId = generateId();
  const lock = createLock(executionId, now);

  // Garantindo persistência no Netlify Blobs = Usar SEMPRE JSON nativo do Blobs:
  await safeSet(store, LOCK_KEY, lock);

  // pequena espera para consistência eventual do Blobs
  await sleep(200);

  // ------------- Revalidação (Race Condition) (evita corrida)
  const confirm = await safeGet(store, LOCK_KEY);
  if (!isValidLock(confirm)) return null;
  if (confirm.executionId !== executionId) return null;
  if (now - confirm.timestamp > LOCK_TTL) return null;
  return executionId;
};

// Release Lock deve ficar fora do escopo da acquireLock
  // Remove Lock somente se for dono
  // Não apaga lock de outra execução
  const releaseLock = async (store, executionId) => {
    try {
      const current = await safeGet(store, LOCK_KEY);
      // 🔍 Caso 1: não existe lock
      if (!current) {
        console.log("⚠️ Nenhum lock encontrado para liberar");
        return;
      }

      // 🔐 Caso 2: lock pertence a esta execução → remove
      if (isValidLock(current) && current.executionId === executionId) {
        await store.delete(LOCK_KEY);
        console.log("🔓 Lock removido com sucesso");
      } else {
        // 🚨 Caso 3: lock existe mas NÃO é seu → NÃO REMOVE
        console.warn("Lock já expirou ou foi substituído", {
          currentLockId: current.executionId,
        });
        return;
      }
    } catch (err) {
      console.warn("❌ Erro ao liberar lock:", err);
    }
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


// -------------------- FILA --------------------
// chamada de API  =1 por vez (devido ao getNextTicker)
// o tempo deve ser suficiente.
// Se começar a dar timeout, reduzir o retries do fetch

const getNextTicker = async (store, list) => {
  // Function que gerencia o índice no Blobs
  // lock específico para fila
  // Lock protege a execução inteira
  // Lock deve garantir atomicidade na hora de incrementar
  // Antes de ler/escrever o índice:
  const INDEX_LOCK_KEY = "ticker-index-lock";
  const INDEX_LOCK_TTL = 5000; // 5s (rápido)
  const INDEX_KEY = "ticker-index";
  const LIST_HASH_KEY = "ticker-list-hash";

  // 🔒 LOCK DA FILA
  const indexLockId = await acquireIndexLock(store, INDEX_LOCK_KEY, INDEX_LOCK_TTL);
  if (!indexLockId) {
    throw new Error("Fila ocupada (index lock)");
  }

  try {
    // 🔹 cria hash da lista atual
    const prevHash = await store.get(LIST_HASH_KEY, { type: "text" });
    const hash = JSON.stringify(list);


    // evitar: NaN , negativo, lixo vindo do storage


    // CAS-like (compare-and-set) - leitura com versão
    const stored = await safeGet(store, INDEX_KEY);
    let index = 0;
    let version = 0;
    if (stored && typeof stored === "object") {
      index = Number.isFinite(Number(stored.value)) ? Number(stored.value) : 0;
      version = Number.isFinite(Number(stored.version)) ? Number(stored.version) : 0;
    }

    // 🔥 detecta mudança na lista
    if (prevHash !== hash) {
      console.log("🔄 Lista mudou, resetando lista de Tickers");
      await store.set(LIST_HASH_KEY, hash, { type: "text" });
      index = 0; // importante resetar índice
    }

    // 🔹---- proteção  lista vazia com Uso do Modulo (%) para Gerenciar Fila Circular
    if (!list.length) throw new Error("Lista de tickers vazia");

    // 🔹 calcula ticker atual
    const symbol = list[index % list.length];

    // 🔹------Próximo índice: incrementa fila e salva o próximo (trava de segurança)
    const nextIndex = (index + 1) % list.length;

    // 🔹 tentativa de escrita com versão nova
    const newData = {
      value: nextIndex,
      version: Date.now()
    };

    // 🔹 revalida antes de escrever (CAS-like)
    const confirm = await safeGet(store, INDEX_KEY);

    const confirmVersion =
      confirm && typeof confirm === "object"
        ? Number(confirm.version) || 0
        : 0;

    // ❗ se alguém mudou antes → aborta
    if (confirmVersion !== version) {
      throw new Error("Race condition detectada (CAS falhou)");
    }

    // ✅ grava com nova versão
    await safeSet(store, INDEX_KEY, newData);

    console.log(`➡️ Processando: ${symbol}`);
    return symbol;
  } finally {
    await releaseIndexLock(store, INDEX_LOCK_KEY, indexLockId, INDEX_LOCK_TTL);
  }
};    // Final da getNextTicker

// Function de lock leve
  const acquireIndexLock = async (store, key, ttl) => {
    const now = Date.now();
    const lock = await safeGet(store, key);
    if (lock && (now - lock.timestamp) < ttl) {
      console.log("🔎 Tentando adquirir INDEX LOCK", {
        now,
        existingLock: lock,
        ageMs: now - lock.timestamp,
        ttl: INDEX_LOCK_TTL,
        executionId: lock.executionId,
        remainingMs: INDEX_LOCK_TTL - (now - lock.timestamp)
      });
      return null;
    }

    const id = generateId();
    await safeSet(store, key, {
      v: 1,
      executionId: id,
      timestamp: now
    });

    const confirm = await safeGet(store, key);
    const valid = confirm &&
      typeof confirm.executionId === "string" &&
      typeof confirm.timestamp === "number";
    const match = valid && confirm.executionId === id;
    if (!match) {
      console.warn("⚠️ Falha na validação do INDEX LOCK", {
        valid,
        confirm,
        expectedId: id
      });
    }
    return confirm?.executionId === id ? id : null;
  };
// FiM da lock leve


  const releaseIndexLock = async (store, key, id, ttl) => {
    const lock = await safeGet(store, key);
      if (lock?.executionId === id &&
      Date.now() - lock.timestamp < ttl) {
          await store.delete(key);
      }
  };


// -------------------- FALLBACK YAHOO --------------------

const fetchYahooFallback = async (symbol) => {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.SA?range=1mo&interval=1d`;

    // Configuração dos Headers com um User-Agent
    // Informa ao servidor da API Yahoo: eu sou um navegador Chrome rodando no Windows
    const optionsFetch = {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
      }
    };
    const resYahoo = await fetchWithTimeout( url, optionsFetch );
    if (!resYahoo.ok) {
      console.warn(`⚠️ Yahoo retornou status: ${resYahoo.status}`);
      return null;
    }
    const json = await resYahoo.json();
    const resultYahoo = json.chart?.result?.[0];
    if (!resultYahoo) return null;

    return {
      symbol,
      regularMarketPrice: resultYahoo.meta?.regularMarketPrice ?? null,
      regularMarketChangePercent: resultYahoo.meta?.regularMarketChangePercent ?? null,
      source: "yahoo"
    };
  } catch (err) {
    console.warn("⚠️ Yahoo fallback erro:", err);
    return null;
  }
};


// ------------------ sistema de prioridade de fonte automático
// ------------------ o primeiro que responder válido vence
// A ordem correta  é: 1. CACHE (Blobs) - 2. BRAPI - 3. YAHOO - 4. previousData

const resolveQuote = async (symbol, store, cacheKey, API_TOKEN, ETF_INFO, previousData ) => {
  console.log("🔎 resolvendo fonte para:", symbol);
  let finalData = null;
  let source = "none";

  // -------------------- 1. CACHE (PRIMEIRO) --------------------
  const cached = await safeGet(store, cacheKey);

  if (cached && cached.updatedAt && (Date.now() - cached.updatedAt < CACHE_TTL)) {
    finalData = cached;
    source = "cache";
  }

  // -------------------- 2. BRAPI --------------------

  if (!finalData) {
    try {
      const url = `https://brapi.dev/api/quote/${symbol}?range=1mo&interval=1d&token=${API_TOKEN}`;
      const resBrapi = await fetchWithRetry(url);

      // Para pegar exatamente quando a API retorna HTML / erro / rate limit
      const textBrapi = await resBrapi.text();
      let json;
      try {
        json = JSON.parse(textBrapi);
      } catch (err) {
        console.error("💥 JSON inválido da BRAPI", err);
        return null;
      }
      if (json.results?.[0]) {
        finalData = json.results[0];
        source = "brapi";
      }

    } // Fim do Try
    catch (e) { console.warn("Brapi falhou"); }
  }   // FiM do iF (!finalData)


  // -------------------- 3. YAHOO --------------------
  if (!finalData) {
    const yahoo = await fetchYahooFallback(symbol);
    if (yahoo) {
      finalData = yahoo;
      source = "yahoo";
    } else {
      console.warn("⚠️ Yahoo também falhou");
    }
  }


  // -------------------- 4. PREVIOUS DATA --------------------
    if (
      !finalData &&
      previousData &&
      typeof previousData === "object"
    ) {
      const prevValue =
        previousData &&
        typeof previousData === "object" &&
        typeof previousData[symbol] === "object"
          ? previousData[symbol]
          : null;

      if (prevValue) {
        finalData = prevValue;
        source = "previousData";
      }
    }


  //------------ 5. Preparar Payload Final
  const payload = {
      ...(finalData || {}),
      description: ETF_INFO[symbol]?.description || "Ativo Financeiro",
      updatedAt: Date.now(),
      updatedLabel: getFormattedDateTime(),
      symbol: symbol,       // Garante que o ticker não se perca
      source: source
  };


  // --------- 6. Salvar no Blobs
  // Após ser montado, o payload é transformado em json
  // É esse objeto que o outro script (get-quote.js) vai ler para exibir no site.
  await safeSet(store, cacheKey, payload);
  console.log(`💾 Salvo no Blobs via ${source}: ${symbol}`);
  return payload;
};
// FiM resolveQuote


// -----  Fallback (Mantém os dados do cache anterior se a Brapi falhar e não houver Yahoo)
const fetchFallbackData = async (symbol, store, cacheKey, previousData) => {
      console.log("🔁 iniciando fallback paralelo (cache + yahoo)");

      const cachePromise = (async () => {
        const cachedYahoo = await safeGet(store, cacheKey);
        if (cachedYahoo?.symbol) {
          return { ...cachedYahoo, source: "cache" };
        }
        return null;
      })();

      const yahooPromise = fetchYahooFallback(symbol);
      const [cacheData, yahooData] = await Promise.allSettled([cachePromise,yahooPromise]);
      const cacheResult = cacheData.status === "fulfilled" ? cacheData.value : null;
      const yahooResult = yahooData.status === "fulfilled" ? yahooData.value : null;

      // ✅ extraindo o prevValue com segurança
      const prevValue = previousData && typeof previousData === "object" ? previousData[symbol] : null;

      // prioridade: cache > yahoo > previousData
      return cacheResult || yahooResult || prevValue || null;
};


// -------------------- HANDLER --------------------

export default async () => {

  const API_TOKEN = process.env.BRAPI_TOKEN;
  if (!API_TOKEN) {
    return createResponse("Token não configurado", { status: 500 });
  }

  const store = getStore({ name: STORE_NAME });

  // 🔒 Lock distribuído
  const executionId = await acquireLock(store);
  if (!executionId) {
    return createResponse(
      JSON.stringify({
        skipped: "lock",
        message: "Outra execução já está ativa",
        detail: "Função acquireLock interrompeu a permissão para rodar e retorna status 200"
      } , null, 2 ),
       {
        status: 200
       }
    );
  }

  try {

    // Lista
    const tickers = [ "IRFM11", "IVVB11", "NBIT11", "BBDC4", "PACB11" ];
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

    // SE o mercado NÃO estiver aberto
    // evitar chamadas desnecessarias na API (Brapi)
    if (!isMarketOpen()) {
      console.log("🛑 Mercado fechado");
      return createResponse(
        JSON.stringify(
          {
          skipped: true,
          message: "🛑 Mercado fechado",
          },
          null, 2
        ),  {
            status: 200,
            headers: {
                  "Content-Type": "application/json",
                  "Access-Control-Allow-Origin": "*"
            }
          }
        );
    }

    // // ➡️ ÚNICA FONTE DE VERDADE: A Fila no Blobs
    // Esta função  decide sozinha qual é o próximo ticker
    const symbol = await getNextTicker(store, tickers);
    const cacheKey = `quote-${symbol}`;
    console.log("➡️ ticker:", symbol);


      //  ----------- Cache antes de bater na API
      const existing = await safeGet(store, cacheKey);

      // Parse do cache = Se cálculo falhar → usa valor antigo
      // Tenta ler o que foi gravado na última execução com sucesso.
      // Criamos a estrutura { "Ticker": { ... } } que o resto do código espera ler

      // criar o objeto (ticker)
      // Cache é de um único ticker (cacheKey = quote-SYMBOL),
      // o parsed já é o próprio objeto do ticker.


    // Cache curto = evitar refazer a requisiçao
    // Resumo: Se existe cache e ele ainda não expirou
    // Busca no armazenamento (store)
    // usar cache pra decidir se vai chamar API:
    if (existing?.updatedAt && Date.now() - existing.updatedAt < CACHE_TTL) {
      console.log("⚡ cache curto: Se existe cache e ele ainda não expirou");
      console.log(`⚡ cache hit (${symbol})`);
       // Atualiza label mesmo sem refetch
       existing.updatedAt = Date.now();
       existing.updatedLabel = getFormattedDateTime();

      // opcional mas recomendado → persistir
      await safeSet(store, cacheKey, existing);
      return createResponse(
          JSON.stringify({
            message: "Resposta somente do cache"
          }),
            {
              status: 200,
              headers: { "Content-Type": "application/json; charset=utf-8" }
            }
      );
    }

    // depois do existing carregado e antes de chamar o resolveQuote
    // blindada contra corrupção estrutural = garantir que prev seja um objeto válido
    const ensureObject = (value) =>
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
        ? value
        : {};

    const prev = ensureObject(
      await safeGet(store, "previous-data")
    );

    const rawData = await resolveQuote(
      symbol,
      store,
      cacheKey,
      API_TOKEN,
      ETF_INFO,
      prev
    );

    const updated = {
        ...prev,
        [symbol]: rawData || existing || prev[symbol] || null
    };
    await safeSet(store, "previous-data", updated);


    // Garantir que novo ticker entra com fallback inicial
    if (!rawData && existing) {
      return createResponse(JSON.stringify(existing), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    if (!rawData && !existing) {
      const fallback = await fetchYahooFallback(symbol);
        return createResponse(JSON.stringify(fallback), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
    }


    // -------------------- Salva no Blobs --------------------

    console.log(`💾 saved:`, symbol);

    return createResponse(
      JSON.stringify({
        ok: true,
        symbol,
        message: "Salvou no Blobs",
      } , null, 2 ), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });

    } catch (err) {
      console.error("🔥 ERRO:", err);
      return createResponse(
        JSON.stringify({
          error: "Falha no update"
        } , null, 2 ), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        }
      );
    } finally {
      // 🔓 libera lock SOMENTE se for dono
      await releaseLock(store, executionId);
    }
};
// Final do Handler

// -------------------- CRON --------------------
// Cron: a cada 15 min,  13h-22h UTC (10h às 19h Brasília), (1-5) Seg a Sex
export const config = {
  schedule: "*/15 12-21 * * 1-5"
};






/*

// Codigo retirado em 18/04
    // -------------- BRAPI sequencial e controlada pela fila-------------

    try {
      const url = `https://brapi.dev/api/quote/${symbol}?range=1mo&interval=1d&token=${API_TOKEN}`;

      const res = await fetchWithRetry(url);

      if (res.ok) {
        const json = await res.json();
        const resBrapi = json.results?.[0];

        if (resBrapi) {
          const hist = getValidHist(resBrapi.historicalDataPrice || []);
          const noHist = hist.length === 0;
          const hist7 = filterByDays(hist, 7);
          const hist30 = filterByDays(hist, 30);
          const closes7 = getCloses(hist7);
          const closes30 = getCloses(hist30);
          const currentPrice = resBrapi.regularMarketPrice ?? null;
          const prev = previousData[resBrapi.symbol] || {};
          const newVariation =
              (!noHist && hasEnoughHist(hist))
              ? safeValue(getVariation30d(hist, currentPrice))
              : null;
          const variation30d =
              (newVariation == null)
              ? prev.variation30d ?? null
              : newVariation;


          // Montar o objeto final
          data = {
            hasHistory: !noHist,
            symbol: resBrapi.symbol,
            shortName: resBrapi.shortName,
            longName: resBrapi.longName,
            description: ETF_INFO[resBrapi.symbol.toUpperCase()]?.description || "",
            updatedAt: Date.now(),                          // Timestamp para lógica de front-end
            updatedLabel: getFormattedDateTime(),           // String formatada "DD/MM/AAAA HH:MM:SS"

            regularMarketPrice: safeWithFallback(
              safeValue(currentPrice),
              prev.regularMarketPrice
            ),
            regularMarketChangePercent: safeValue(resBrapi.regularMarketChangePercent),

            regularMarketDayLow: resBrapi.regularMarketDayLow ?? null,
            regularMarketDayHigh: resBrapi.regularMarketDayHigh ?? null,
            regularMarketDayRange:
              resBrapi.regularMarketDayLow != null && resBrapi.regularMarketDayHigh != null
              ? `${resBrapi.regularMarketDayLow} - ${resBrapi.regularMarketDayHigh}`
              : null,

            min7d: noHist ? fallbackMin(resBrapi.fiftyTwoWeekLow) : safeValue(getMin(closes7)),
            min30d: noHist ? fallbackMin(resBrapi.fiftyTwoWeekLow) : safeValue(getMin(closes30)),
            variation30d,

            fiftyTwoWeekLow: resBrapi.fiftyTwoWeekLow ?? null,
            fiftyTwoWeekHigh: resBrapi.fiftyTwoWeekHigh ?? null,
            logourl: resBrapi.logourl || `https://icons.brapi.dev/icons/${resBrapi.symbol}.svg`,
            source: "brapi"
          };
        }
      }
    }

*/

/*

Ordem correta:

1. getNextTicker
2. get cache (existing)
3. checar cache curto
4. carregar previousData
5. resolveQuote
6. salvar previousData atualizado
7. respostas / fallback
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
