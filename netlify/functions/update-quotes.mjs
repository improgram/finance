// schedule (cron)
// lógica completa
// chamada da Brapi
// processamento
// salvamento no Blobs

// CommonJS (require)  = (antigo)
// ES Modules (import/export) = (novo)
// permite o objeto de configuração simplificado.
// const { getStore } = require("@netlify/blobs");
// trata se do Coletor) Roda via CRON, busca na Brapi
// e salva cada ticker individualmente no Blobs
// com os campos updatedAt e updatedLabel.


import { getStore } from "@netlify/blobs";

console.log("Update-quotes CARREGADA");

// -------------------- CONFIG --------------------
const STORE_NAME = "quotes-blobs";
const LOCK_KEY = "update-lock";
const LOCK_TTL = 25 * 1000; // 25s (evita concorrência)
const CACHE_TTL = 5 * 60 * 1000; // 5 min
// É vital que o valor de LOCK_TTL seja maior que o tempo máximo que a função leva para rodar

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
      await sleep(3000);
    } catch (err) {
      console.warn("⚠️ fetch erro:", err);
      if (i === retries) throw err;
    }
  }
  throw new Error("Rate limit persistente");
};

// -------------------- LOCK DISTRIBUÍDO --------------------
// função decide se o processo tem "permissão" para rodar.
const acquireLock = async (store) => {    // Adquirir a Trava
  const now = Date.now();
  const lock = await store.get(LOCK_KEY, { type: "json" });

  if (lock && (now - lock.timestamp) < LOCK_TTL) {
    console.log("🔒 Lock ativo, abortando execução");
    return false;
  }

  // Garantindo persistência no Netlify Blobs
  await store.set(LOCK_KEY, { timestamp: now }, { type: "json" });
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

const getNextTicker = async (store, list) => {

  const INDEX_KEY = "ticker-index";
  const LIST_HASH_KEY = "ticker-list-hash";

  // 🔹 cria hash da lista atual
  const hash = JSON.stringify(list);
  const prevHash = await store.get(LIST_HASH_KEY, { type: "json" });

  // Lê como texto para garantir que o valor venha limpo
  let index = Number(await store.get(INDEX_KEY, { type: "text" })) || 0;

  // 🔥 detecta mudança na lista
  if (prevHash !== hash) {
    console.log("🔄 Lista mudou, resetando lista de Tickers");
    index = 0;
    await store.set(LIST_HASH_KEY, hash, { type: "json" });
  }

  // 🔹 proteção extra com Uso do Modulo (%) para ser circular
  if (!list.length) throw new Error("Lista de tickers vazia");
  const currentIndex = index % list.length;
  const symbol = list[currentIndex];

  // 🔹 incrementa fila e salva o próximo (também com trava de segurança)
  const nextIndex = (index + 1) % list.length;

  // Salva o próximo índice
  await store.set(INDEX_KEY, String(nextIndex));
  return symbol;
};

// -------------------- FALLBACK YAHOO --------------------

const fetchYahooFallback = async (symbol) => {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.SA?range=1mo&interval=1d`;

    // Configuração dos Headers com um User-Agent
    // Informa ao servidor da API Yahoo: eu sou um navegador Chrome rodando no Windows
    const options = {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
      }
    };
    const res = await fetchWithTimeout(url, options, 5000);
    if (!res.ok) {
      console.warn(`⚠️ Yahoo retornou status: ${res.status}`);
      return null;
    }
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


// ------------------ sistema de prioridade de fonte automático
// =----------------- o primeiro que responder válido vence
// A ordem correta  é: 1. CACHE (Blobs) - 2. BRAPI - 3. YAHOO - 4. previousData

const resolveQuote = async (symbol, store, cacheKey, previousData, API_TOKEN ) => {
  console.log("🔎 resolvendo fonte para:", symbol);

    // -------------------- 1. CACHE (PRIMEIRO) --------------------
  try {
    const cachedPrimeiro = await store.get(cacheKey, { type: "json" });

    if (cachedPrimeiro && cachedPrimeiro.symbol) {
      return {
        ...cachedPrimeiro,
        source: "cache"
      };
    }
  } catch (err) {
    console.warn("cache falhou:", err);
  }

  // -------------------- 2. BRAPI --------------------
  try {
    const url = `https://brapi.dev/api/quote/${symbol}?range=1mo&interval=1d&token=${API_TOKEN}`;

    const res = await fetchWithRetry(url);

    if (res.ok) {
      const json = await res.json();
      const r = json.results?.[0];

      if (r) {
        return {
          ...r,
          source: "brapi"
        };
      }
    }
  } catch (err) {
    console.warn("brapi falhou:", err);
  }

  // -------------------- 3. YAHOO --------------------
  try {
    const yahoo = await fetchYahooFallback(symbol);

    if (yahoo) {
      return {
        ...yahoo,
        source: "yahoo"
      };
    }
  } catch (err) {
    console.warn("yahoo falhou:", err);
  }

  // -------------------- 4. PREVIOUS DATA --------------------
  const prev = previousData?.[symbol];

  if (prev) {
    return {
      ...prev,
      source: "previousData"
    };
  }

  // -------------------- 5. FAIL TOTAL --------------------
  return null;
};
// FiM resolveQuote



// -----  Fallback (Mantém os dados do cache anterior se a Brapi falhar e não houver Yahoo)
const fetchFallbackData = async (symbol, store, cacheKey, previousData) => {
      console.log("🔁 iniciando fallback paralelo (cache + yahoo)");

      const cachePromise = (async () => {
        const cachedYahoo = await store.get(cacheKey, { type: "json" });
        if (cachedYahoo?.symbol) {
          return { ...cachedYahoo, source: "cache" };
        }
        return null;
      })();

      const yahooPromise = fetchYahooFallback(symbol);
      const [cacheData, yahooData] = await Promise.allSettled([cachePromise,yahooPromise]);
      const cacheResult = cacheData.status === "fulfilled" ? cacheData.value : null;
      const yahooResult = yahooData.status === "fulfilled" ? yahooData.value : null;

      // prioridade: cache > yahoo > previousData
      return cacheResult || yahooResult || previousData[symbol] || null;
};


// -------------------- HANDLER --------------------

export default async () => {

  console.log("🚀 Iniciando update-quotes");

  const API_TOKEN = process.env.BRAPI_TOKEN;
  if (!API_TOKEN) {
    return new Response("Token não configurado", { status: 500 });
  }

  const store = getStore({ name: STORE_NAME });

  // 🔒 Lock distribuído
  const locked = await acquireLock(store);
  if (!locked) {
    return new Response(
      JSON.stringify({
        skipped: "lock",
        message: "Função acquireLock interrompeu a permissão para rodar e retorna status 200"
      }),
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
      return new Response(
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

    const symbol = await getNextTicker(store, tickers);
    const cacheKey = `quote-${symbol}`;
    console.log("➡️ ticker:", symbol);


      //  ----------- Cache antes de bater na API
      const existing = await store.get(cacheKey, { type: "json" });

      // Parse do cache = Se cálculo falhar → usa valor antigo
      // Tenta ler o que foi gravado na última execução com sucesso.
      // previousData é o objeto vazio que servirá como um "contêiner" para o valor antigo.
      let previousData = {};

      if (existing?.symbol) {
            try {
              const parsed = existing;
              if (parsed && parsed.symbol) {
                previousData[existing.symbol] = existing;
              // Aqui cria o objeto (ticker)
              // Cache é de um único ticker (cacheKey = quote-SYMBOL),
              // o parsed já é o próprio objeto do ticker.
              // Criamos a estrutura { "IRFM11": { ... } } que o resto do código espera ler:
              }
            } catch (e) {
              console.warn("Erro ao parsear cache anterior");
            }
      }


    // Cache curto = evitar refazer a requisiçao
    // Resumo: Se existe cache e ele ainda não expirou
    // Busca no armazenamento (store)

    if (existing?.updatedAt && Date.now() - existing.updatedAt < CACHE_TTL) {
      console.log("⚡ cache curto: Se existe cache e ele ainda não expirou");
      console.log(`⚡ cache hit (${symbol})`);
       // Atualiza label mesmo sem refetch
        existing.updatedLabel = getFormattedDateTime();

      // opcional mas recomendado → persistir
      await store.set(cacheKey, existing, { type: "json" });
      return new Response(
          JSON.stringify({
            message: "Resposta somente do cache"
          }),
            {
              status: 200,
              headers: { "Content-Type": "application/json; charset=utf-8" }
            }
      );
    }

    const rawData = await resolveQuote(symbol, store, cacheKey, previousData, API_TOKEN );

    if (!rawData) {
      throw new Error("Sem dados de nenhuma fonte");
    }


    // -------------------- Salva no Blobs --------------------

    const item = {
      ...rawData,
      updatedAt: Date.now(),
      updatedLabel: getFormattedDateTime(),
      source: rawData.source
    };

    await store.set(cacheKey, item, { type: "json" });
    console.log(`💾 saved (${item?.source ?? "Desconhecido"}):`, symbol);

    return new Response(JSON.stringify({
      ok: true,
      symbol,
      message: "Salvou no Blobs",
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
// Final do Handler

// -------------------- CRON --------------------
// Cron: a cada 30 min,  13h-22h UTC (10h às 19h Brasília), (1-5) Seg a Sex
export const config = {
  schedule: "*/30 12-21 * * 1-5"
};
console.log("CRON VERSION: 18/04-update-quotes");





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
    catch (err)
      {
        console.warn("⚠️ Brapi falhou, tentando fallback...");
      }
      if (!data) {                  // Após tentativa na API Brapi tentatar fallback
        console.warn("⚠️ Brapi falhou, tentando fallback novamente ...");
        data = await fetchFallbackData(symbol, store, cacheKey, previousData);
    }

*/

/*

Ordem correta:

1. getNextTicker
2. get cache (existing)
3. montar previousData
4. checar cache curto  ← 🔥 AQUI
5. resolveQuote
6. salvar
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
