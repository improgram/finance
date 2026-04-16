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
import nodeFetch from "node-fetch";

const fetchFn = globalThis.fetch ?? nodeFetch;
console.log("Update-quotes CARREGADA");

if (!globalThis.fetch && !nodeFetch) {
  console.error("❌ Nenhum fetch disponível");
}

// Helper para formatar a data/hora no padrão brasileiro (Brasília)
const getFormattedDateTime = () => {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
};

// Helpers de mercado
const isMarketOpen = () => {
  const now = new Date();
  const day = now.getDay();     // 0 = domingo, 6 = sábado
  const hour = now.getHours();
  const minute = now.getMinutes();

  if (day === 0 || day === 6) return false;
  const current = hour * 60 + minute;
  const open = 10 * 60;                     // 10:00
  const close = 18 * 60 + 55;               // 18:55
  return current >= open && current <= close;
};


// Helpers do Fetch (antes de usar a API) = (antes do fetch) = são infraestrutura de rede

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fetchWithTimeout = async (url, options = {}, timeout = 25000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    return await fetchFn(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(id);
  }
};

const fetchWithRetry = async (url, retries = 2) => {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetchWithTimeout(url);
      if (res && res.status !== 429) return res;
      console.warn("⏳ Rate limit, aguardando...");
      await sleep(10000);
    } catch (err) {
      console.warn("⚠️ fetch erro:", err);
      if (i === retries) throw err;
    }
  }
  throw new Error("Rate limit persistente");
};


const getValidHist = (hist) => (hist || []).filter(d =>
  d && typeof d.date === "number" && typeof d.close === "number"
);
const getCloses = (hist) => hist.map(d => d.close);
const getMin = (arr) => arr.length ? Math.min(...arr) : null;
const filterByDays = (hist, days) => {
  const limit = Math.floor(Date.now() / 1000) - (days * 24 * 60 * 60);
  return hist.filter(d => d.date >= limit);
};
const hasEnoughHist = (hist) => hist.length >= 10;
const safeValue = (value) => (value == null || Number.isNaN(value)) ? "N/E" : value;
const fallbackMin = (fallback) => fallback != null ? fallback : "N/E";
const safeWithFallback = (newVal, oldVal) =>
  (newVal == null || newVal === "N/E") ? oldVal ?? "N/E" : newVal;


const getVariation30d = (hist, currentPrice) => {
  if (!hist.length || currentPrice == null) return null;
  const now = new Date();
        now.setHours(0,0,0,0);
  const target = new Date(now);
        target.setMonth(target.getMonth() - 1);
  const targetTs = Math.floor((Date.now() - (30 * 24 * 60 * 60 * 1000)) / 1000);
  let base = hist.find(d => d.date >= targetTs)?.close || hist[0].close;
  for (let i = hist.length - 1; i >= 0; i--) {
    if (hist[i].date <= targetTs) {
      base = hist[i].close;
      break;
    }
  }
  if (!base) base = hist[0].close;
  return ((currentPrice - base) / base) * 100;
};


  //  FILA (CRON SAFE)
const getNextTicker = async (store, list) => {
  const INDEX_KEY = "ticker-index";
  let index = Number(await store.get(INDEX_KEY)) || 0;
  const symbol = list[index % list.length];
  // incrementa fila circular
  await store.set(INDEX_KEY, String(index + 1));
  return symbol;
};


// HANDLER
export default async (req) => {

  console.log("🚀 Iniciando update-quotes");
  try {                       // Validações
    const API_TOKEN = process.env.BRAPI_TOKEN;
    if (!API_TOKEN) {
      console.error("❌ Token da API ausente");
      return new Response("Token não configurado", { status: 500 });
    }
    const store = getStore({
      name: "test16abr",
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_BLOBS_TOKEN
    });

    // const STORE_KEY = `latest${CACHE_VERSION}`;

    const ETF_LIST = [ "IVVB11" ];
      /* "B5P211", "IRFM11", "NBIT11", "PACB11", "5PRE11" */


    /* "AUPO11", "BOVA11", "IMAB11",  */
    const tickersB3 = [ "BBDC4", ];
      /* "ALPA4", "ASAI3", "DXCO3", "JALL3", "RAIL3", "SIMH3", "KLBN4", "GRND3", "SLCE3" */

    const ETF_INFO = {
      AUPO11: { description: "NTN-B + Selic" },
      B5P211: { description: "NTN-B (inflação) Curto/Medio" },
      IMAB11: { description: "NTN-B (Inflação) Medio/Longo" },
      IRFM11: { description: "Pré-fixado" },
      IVVB11: { description: "S&P 500 dos EUA" },
      NBIT11: { description: "Bitcoin Nasdaq" },
      NDIV11: { description: "Dividendos" },
      PACB11: { description: "NTN-B (Inflação) Longo 2050/60" },
      "5PRE11": { description: "Pré-fixado" }
    };

    const ALL = [...ETF_LIST, ...tickersB3];
    console.log(`📊 Total de ativos: ${ALL.length}`);


    // 🔥 Captura do parâmetro de URL para forçar atualização (opcional)
    let forceUpdate = false;
    try {
      const url = new URL(req.url, "https://dummy-base.local");
      const forceParam = url.searchParams.get("force");
        forceUpdate = forceParam === "true" || forceParam === "1";
    } catch (err) {
      console.warn("URL inválida, ignorando forceUpdate:", err);
    }


    // evitar atualizar fora do horário
    if (!isMarketOpen() && !forceUpdate) {
      console.log("🛑 Mercado fechado, pulando...");
      return new Response(JSON.stringify({ skipped: true }), {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",             // Permite chamadas de qualquer origem
          "Access-Control-Allow-Headers": "Content-Type",
          "Content-Type": "application/json"
        }
      });
    }


    // --- 2️⃣ Buscar tickers  (Plano Free: 1 por vez) ---
    const symbol = await getNextTicker(store, ALL);
    console.log("➡️ ticker:", symbol, forceUpdate ? "(forceUpdate)" : "");


    // -------------------- CACHE KEY --------------------

    const cacheKey = `quote-${symbol}`;

    // opcional: evitar request se quiser (desligado em force)
    if (!forceUpdate) {
      const cached = await store.get(cacheKey, { type: "json" });   // Leitura do cache
      if (cached?.updatedAt && Date.now() - cached.updatedAt < 5 * 60 * 1000) {
        console.log("⚡ cache hit:", symbol);
        return new Response(JSON.stringify({ cached: true, symbol }), {
          status: 200
        });
      }
    }


    // FETCH BRAPI = SEM loop = modo incremental = (SEM Promise.all, SEM results[] ?? )

      const safeSymbol = symbol.trim();
      const url = `https://brapi.dev/api/quote/${safeSymbol}?range=1mo&interval=1d&token=${API_TOKEN}`;

      let res;
      try {
        res = await fetchWithRetry(url);
      } catch (err) {
        console.error("❌ Erro no fetch:", err);
        return new Response(JSON.stringify({ error: "fetch failed" }), { status: 500 });
      }

      // 🔴 fallback extra - opcional
      if (res.status === 429) {
        console.warn("⚠️ Ainda em rate limit após retry");
        return new Response(JSON.stringify({ error: "rate limit" }), { status: 429 });
      }

      // 🔴 validação obrigatória
      if (!res || !res.ok) {
        throw new Error(`HTTP ${res?.status}`);
      }

      // ✅ AGORA sim pode usar o JSON
      const json = await res.json();
      const r = json.results?.[0];

      if (!r) {
        return new Response(JSON.stringify({ error: "Sem dados" }), { status: 204 });
      }

       // Helpers processamento dos dados = regra de negócio
      const hist = getValidHist(r.historicalDataPrice || []);
      const noHist = hist.length === 0;
      const hist7 = filterByDays(hist, 7);
      const hist30 = filterByDays(hist, 30);
      //const closes7 = getCloses(hist7);
      //const closes30 = getCloses(hist30);
      //const regularMarketPrice = getCloses;        // Validar
      //const regularMarketDayLow = getCloses;       // Validar
      //const regularMarketDayHigh = getCloses;      // Validar
      //const fiftyTwoWeekLow = getCloses;          // Validar
      //const logourl = null;                       // Validar
      const currentPrice = r.regularMarketPrice ?? null;
      const variation30d = (() => {
        if (noHist || !hasEnoughHist(hist)) return "N/E";
        const value30d = getVariation30d(hist, currentPrice);
        return Number.isFinite(value30d) ? value30d : "N/E";
      })();

    // 4️⃣ Processamento
      const item = {
        //hasHistory: !noHist,
        symbol: r.symbol,
        //shortName: r.shortName,
        //longName: r.longName,
        //description: ETF_INFO[r.symbol.toUpperCase()]?.description || "",
        updatedAt: Date.now(),                          // Timestamp para lógica de front-end
        updatedLabel: getFormattedDateTime(),           // String formatada "DD/MM/AAAA HH:MM:SS"

        regularMarketPrice: safeWithFallback( safeValue(currentPrice), null ),
        regularMarketChangePercent: safeValue(r.regularMarketChangePercent),
        variation30d,
       // regularMarketDayRange:
        //  r.regularMarketDayLow != null && regularMarketDayHigh != null
        //    ? `${regularMarketDayLow} - ${regularMarketDayHigh}`
        //    : null,
       // min7d: noHist ? fallbackMin(r.fiftyTwoWeekLow) : safeValue(getMin(closes7)),
       // min30d: noHist ? fallbackMin(r.fiftyTwoWeekLow) : safeValue(getMin(closes30)),
        //regularMarketDayLow: r.regularMarketDayLow ?? null,
        //regularMarketDayHigh: r.regularMarketDayHigh ?? null,
        //fiftyTwoWeekLow: r.fiftyTwoWeekLow ?? null,
        //fiftyTwoWeekHigh: r.fiftyTwoWeekHigh ?? null,
        //logourl: r.logourl || `https://icons.brapi.dev/icons/${r.symbol}.svg`
      };

    // Para exibir formatado no LOG: null, 2)


    // 6️⃣ Salvamento seguro no Blobs
    /*
    if (!item) {
      console.warn("⚠️ Nenhum dado processado");
    } else {
      const key = `quote-${item.symbol}`;
      const isValid =
        item.regularMarketPrice !== "N/E" &&
        item.regularMarketPrice != null &&
        (!isMarketOpen() || item.variation30d !== "N/E");
      if (isValid) {
        await store.set(key, JSON.stringify({
          symbol: item.symbol,
          price: item.regularMarketPrice,
          changePercent: item.regularMarketChangePercent,
          updatedAt: item.updatedAt
        }));
        console.log(`💾 Salvo: ${item.symbol}`);
      } else {
        console.warn(`⚠️ Dado inválido: ${item.symbol}`);
      }
    }
*/

     // STORE = salvando
     if (item?.symbol && item?.regularMarketPrice) {
        await store.set(cacheKey, JSON.stringify(item));
        console.log("💾 saved:", symbol);
    }


    return new Response(
      JSON.stringify({
        ok: true,
        symbol: item.symbol,
          updatedAt: item.updatedLabel,
          saved: true
        }, null, 2),
        {
          status: 200,
          headers: {
            "Access-Control-Allow-Origin": "*",             // Permite chamadas de qualquer origem
            "Access-Control-Allow-Headers": "Content-Type",
            "Content-Type": "application/json"
          },
        });
      } catch (err) {
        console.error("🔥 ERRO GERAL:", err);
        return new Response(JSON.stringify({
          error: "Falha no update"
        }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
    }
  };


// --- Configuração do Schedule (Cron) ---
// const { schedule } = require("@netlify/functions");
// Cron: a cada 30 min, das 13h às 22h UTC (10h às 19h Brasília), (1-5) Seg a Sex
export const config = {
  schedule: "*/10 13-22 * * 1-5"
};


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
CRON Netlify (a cada 10 min)
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
