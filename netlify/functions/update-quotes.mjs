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
// Singleton de fetch (evita recriar import a cada request)
let fetchFn;
const initFetch = async () => {
  if (fetchFn) return fetchFn;
  if (typeof fetch === "function") {
    fetchFn = fetch;
    return fetchFn;
  }
  const mod = await import("node-fetch");
  fetchFn = mod.default;
  return fetchFn;
};


// Response não existe em Node antigo e (compatibilidade Node vs Edge)
const createResponse = (body, {status = 200, headers = {} } ) => {
  if (typeof Response !== "undefined") {
    return new Response(
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
    return await store.set(key, JSON.stringify(value), { type: "text" });
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
  // fallback final (edge/browser safe)
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
  const nodeFetch = await initFetch();
  const controller = new AbortController();

  const id = setTimeout(() => controller.abort(), timeout);

  try {
    return await nodeFetch(url, {
    ...options,
    signal: controller.signal
    });
  } finally {
  clearTimeout(id);
  }
};


// Retry leve = evitar o timeout de 10s do Netlify Free
const fetchWithRetry = async (url, retries = 1) => {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetchWithTimeout(url, {}, 5000);

      // A function fetchWithTimeout possui o AbortSignal.timeout(5000)
      if (res && res.ok) return res;

      if (res?.status === 429) {
        console.warn("⏳ Rate limit BRAPI...");
        if (i < retries) await sleep(1000);
      } else {
        console.warn("⚠️ HTTP erro:", res?.status);
      }

    } catch (err) {
      console.warn(`⚠️ fetch erro (tentativa ${i+1}):`, err.message);
      if (i === retries) throw err;
    }
  }
  throw new Error("BRAPI Rate limit persistente");
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

// Function de lock leve
const acquireIndexLock = async (store, key, ttl) => {
    const id = generateId();

    for (let i = 0; i < 3; i++) {
      const now = Date.now();
      const current = await safeGet(store, key);

      // lock válido ainda existe
      if (current && (now - current.timestamp) < ttl) { return null; }

      const candidate = { v: 1, executionId: id, timestamp: now };
      await safeSet(store, key, candidate);

      await sleep(25 + Math.random() * 20);

      // 🔥 DOUBLE-CHECK AFTER WRITE (anti race condition)
      const confirm = await safeGet(store, key);

      // re-leitura para validar concorrência
      // ❗ se outro worker escreveu depois de nós
      if (confirm?.executionId !== id) {
        continue; // tenta novamente
      }

      // proteção extra contra lock expirado
      if (Date.now() - confirm.timestamp >= ttl) {
        continue;
      }
      // sucesso: adquirimos o lock
      return candidate;
    }
    return null;
};
// FiM da lock leve


// releaseIndexLock usa store.delete(key) sem fallback seguro
const safeDelete = async (store, key) => {
  try {
    if (typeof store.delete === "function") {
      return await store.delete(key);
    }

    // fallback para SDKs antigos
    if (typeof store.remove === "function") {
      return await store.remove(key);
    }

    console.warn("⚠️ store.delete não disponível");
    return null;
  } catch (err) {
    console.warn("⚠️ safeDelete erro:", err?.message);
    return null;
  }
};

const releaseIndexLock = async (store, key, id) => {
    const lock = await safeGet(store, key);
    if (!lock) return;
      if (lock.executionId === id) {
          await safeDelete(store, key);
      }
};
// FiM da acquireIndexLock e releaseIndexLock


// -------------------- LOCK DISTRIBUÍDO --------------------
// função decide se o processo tem "permissão" para rodar.
// Lock deve evitar que duas execuções entrem
// duas execuções nao podem “confirmar” lock ao mesmo tempo
// DOIS tipos de lock separados: Global e Lock da Fila
const acquireLock = async (store) => {    // Adquirir a Trava
  const now = Date.now();

  // Proteção contra lock corrompido no Blobs
  const existingLock = await safeGet(store, LOCK_KEY);

  // Resolve: Lock corrompido, expirado e valido(bloqueia execuçao)
  if (existingLock) {
  if (!isValidLock(existingLock)) {
    console.warn("⚠️ Lock corrompido detectado → Removendo");
  } else {
    const age = now - existingLock.timestamp;
    if (age < LOCK_TTL) {
      console.log("🔒 Lock ativo, abortando execução");
      return null;
    }
    console.warn("⚠️ Lock expirado (fantasma) → sobrescrevendo");
    }
  }


   // --------------- gera id único da execução
  const executionId = generateId();
  const newLock = createLock(executionId, now);

  // Garantindo persistência no Netlify Blobs = Usar SEMPRE JSON nativo do Blobs:
  // Tentativa de escrita
  await safeSet(store, LOCK_KEY, newLock);


  // ----------- Revalidação (Race Condition) (evita corrida)
  // 🔥 leitura imediata para validação mínima
  const confirm = await safeGet(store, LOCK_KEY);

   if (
    !confirm ||
    confirm.executionId !== executionId
  ) {
    console.warn("⚠️ Race detectada no acquireLock");
    return null;
  }
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

      // Caso 2: lock não pertence a esta execução
      if (current.executionId !== executionId) {
        console.warn("⚠️ Lock pertence a outra execução");
        return;
      }

      // 🔐 Caso 3: lock pertence a esta execução → remove
      if (!isValidLock(current) ) {
        console.warn("⚠️ Lock inválido → removendo mesmo assim");
      }

    // 🔥 tenta delete seguro
    try {
      await safeDelete(store, LOCK_KEY);
      console.log("🔓 Lock removido com sucesso");
    } catch (err) {
      console.warn("⚠️ Falha ao deletar lock:", err?.message);

      // fallback seguro: sobrescreve lock com expiração imediata
      await safeSet(store, LOCK_KEY, {
        v: 2,
        executionId: "released",
        timestamp: Date.now() - (LOCK_TTL + 1)
      });
    }

    } catch (err) {
      console.warn("❌ releaseLock erro:", err);
    }
};

// acquireLock e releaseLock devem ficar antes de getNextTicker
// o tempo deve ser suficiente.
// Se começar a dar timeout, reduzir o retries do fetch
// Function que gerencia o índice no Blobs
// lock específico para fila
// Lock protege a execução inteira
// Lock deve garantir atomicidade na hora de incrementar
// Antes de ler/escrever o índice
// cria hash da lista atual
// evitar: NaN , negativo, lixo vindo do storage
// CAS-like (compare-and-set) - leitura com versão
// 🔥 detecta mudança na lista


// 🔒 LOCK distribuído + atualização simples = LOCK + CAS
const getNextIndex = async (store, key, list) => {
  const lockId = await acquireIndexLock(store, "ticker-index-lock", 5000);
  if (!lockId) throw new Error("Fila ocupada");
  try {
    const stored = await safeGet(store, key);
    const index = stored?.value ?? 0;
    const nextIndex = (index + 1) % list.length;
    await safeSet(store, key, {
      value: nextIndex,
      updatedAt: Date.now()
    });
    return list[index % list.length];
  } finally {
    await releaseIndexLock(store, "ticker-index-lock", lockId);
  }
};

// -------chamada de API  = 1 por vez (devido ao getNextTicker)
const getNextTicker = async (store, list) => {
  const INDEX_KEY = "ticker-index";
  const symbol = await getNextIndex(store, INDEX_KEY, list);
  console.log("➡️ Processando:", symbol);
  return symbol;
};
// Final da getNextTicker


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
        json = null;
      }

      if (json && json.results?.[0]) {
        finalData = json.results[0];
        source = "brapi";
      }
    } catch (e) { console.warn("⚠️ Brapi falhou", e.message); }
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
    if (!finalData && previousData && typeof previousData === "object" ) {
      const prevValue = previousData && typeof previousData === "object" &&
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
    const cacheResult = await safeGet(store, cacheKey);
    if (cacheResult?.symbol) {
      return { ...cacheResult, source: "cache" };
    }
    const yahooResult = await fetchYahooFallback(symbol);
    if (yahooResult) return yahooResult;

  // Isolando o prevValue para uso nos fallbacks e cálculos
  const prevValue = previousData && typeof previousData === "object" ? previousData[symbol] : null;
    return prevValue || null;
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

  // fail-safe global
    const MAX_EXECUTION_TIME = 8000; // 8s (Netlify free ~10s)
    let timedOut = false;

    const failSafe = new Promise((_, reject) => {
      setTimeout(() => {
        timedOut = true;
        reject(new Error("⏱️ Fail-safe timeout global atingido"));
      }, MAX_EXECUTION_TIME);
    });

  try {
    const mainExecution = (async () => {
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

    // ➡️ ÚNICA FONTE DE VERDADE: A Fila no Blobs
    // Esta função  decide sozinha qual é o próximo ticker
    const symbol = await getNextTicker(store, tickers);
    const cacheKey = `quote-${symbol}`;
    console.log("➡️ ticker:", symbol);
    const existing = await safeGet(store, cacheKey);   //  ----------- Cache antes de bater na API

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
      return createResponse(JSON.stringify({ message: "Resposta somente do cache" }),
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

    const prev = ensureObject( await safeGet(store, "previous-data") );
    const rawData = await resolveQuote(symbol,store,cacheKey,API_TOKEN,ETF_INFO,prev);
    const updated = {...prev, [symbol]: rawData || existing || prev[symbol] || null };
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
    return createResponse( JSON.stringify({
        ok: true,
        symbol,
        message: "Salvou no Blobs",
      } , null, 2 ), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    })();

    // 🧠 corrida entre execução e timeout
    return await Promise.race([mainExecution, failSafe]);

    } catch (err) {
      if (timedOut) {
        console.warn("⏱️ Execução abortada por timeout controlado");
        return createResponse(JSON.stringify({
          error: "timeout controlado",
        }), { status: 200 }); // importante: não quebrar cron
      }
      console.error("🔥 ERRO:", err);
      return createResponse(
        JSON.stringify({ error: "Falha no update" } , null, 2 ),
          { status: 500, headers: { "Content-Type": "application/json" } }
      );
    } finally {
      await releaseLock(store, executionId);  // 🔓 libera lock SOMENTE se for dono
    }
};
// Final do Handler

// -------------------- CRON --------------------
// Cron: a cada 15 min,  13h-22h UTC (10h às 19h Brasília), (1-5) Seg a Sex
export const config = {
  schedule: "*/15 12-21 * * 1-5"
};
