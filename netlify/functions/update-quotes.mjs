// schedule (cron) (Pendente)
// lógica completa
// chamada da Brapi
// processamento
// salvamento no Blobs

// mudar de CommonJS (require) para ES Modules (import/export),
// permite o objeto de configuração simplificado.
// const { getStore } = require("@netlify/blobs");


console.log("Update-quotes-background CARREGADA");

import { getStore } from "@netlify/blobs";

const CACHE_VERSION = 1;

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
  const day = now.getDay(); // 0 = domingo
  const hour = now.getHours();
  const minute = now.getMinutes();

  if (day === 0 || day === 6) return false;
  const current = hour * 60 + minute;
  const open = 10 * 60;      // 10:00
  const close = 18 * 60 + 55; // 18:55
  return current >= open && current <= close;
};

// Helpers de processamento
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const getValidHist = (hist) => (hist || []).filter(d =>
  d && typeof d.date === "number" && typeof d.close === "number"
);
const getCloses = (hist) => hist.map(d => d.close);
const getMin = (arr) => arr.length ? Math.min(...arr) : null;
const filterByDays = (hist, days) => {
  const now = Math.floor(Date.now() / 1000);
  const limit = now - (days * 24 * 60 * 60);
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
  const targetTs = Math.floor(target.getTime() / 1000);
  let base = null;
  for (let i = hist.length - 1; i >= 0; i--) {
    if (hist[i].date <= targetTs) {
      base = hist[i].close;
      break;
    }
  }
  if (!base) base = hist[0].close;
  return ((currentPrice - base) / base) * 100;
};

export default async (req, context) => {
  const startTime = Date.now();    // ⏱️ Início do cronômetro
  console.log("🚀 Iniciando update-quotes");
  try {                       // Validações
    const API_TOKEN = process.env.BRAPI_TOKEN;
    if (!API_TOKEN) {
      console.error("❌ Token da API ausente");
      return new Response("Token não configurado", { status: 500 });
    }
    const store = getStore({
      name: "test11hs",
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_BLOBS_TOKEN
    });

    const STORE_KEY = `latest-v${CACHE_VERSION}`;

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

    const ALL = [...new Set(
      [...ETF_LIST, ...tickersB3]
        .filter(s => typeof s === "string" && s.trim())
    )];
    console.log(`📊 Total de ativos: ${ALL.length}`);

    // 🔥 Captura do parâmetro de URL para forçar atualização
    const urlParams = new URL(req.url);
    const forceUpdate = urlParams.searchParams.get("force") === "true";

    // 1️⃣ Cache antes de bater na API
    const existing = await store.get(STORE_KEY);

    if (!forceUpdate && existing) {
      const parsed = JSON.parse(existing);
      const lastUpdate = parsed?.meta?.updatedAt || 0;  // Quando foi a ultima Att
      const now = Date.now();                           // Que horas são agora?
      const diffMinutes = (now - lastUpdate) / 60000;   // Há quantos minutos atualizei ?
      const marketOpen = isMarketOpen();                // Mercado Fechado: Os preços não mudam
      const limit = marketOpen ? 15 : 120;               // Mercado Aberto: cache só vale por 15 minutos

      const isDifferentVersion = parsed?.meta?.version !== CACHE_VERSION;
      if (isDifferentVersion) {
        console.log("⚠️ Versão do cache mudou → forçando atualização");
      }
      const cachedAll = [
        ...(parsed?.data?.etfs || []).map(i => i.symbol),
        ...(parsed?.data?.acoes || []).map(i => i.symbol)
      ];

      const cachedSet = new Set(cachedAll);             // Usa Set (comparação correta)
      const allSet = new Set(
        ALL.filter(s => typeof s === "string" && s.trim())
      );

      const hasDifferentTickers =
        cachedSet.size !== allSet.size ||
        [...allSet].some(symbol => !cachedSet.has(symbol));

      const isPartial = parsed?.meta?.partial;
      // Detecta cache parcial
      if (!isPartial && !hasDifferentTickers && !isDifferentVersion && diffMinutes < limit) {
        console.log(`⏱️ Cache válido (${diffMinutes.toFixed(1)} min)`);
        return new Response(
          JSON.stringify(
            { skipped: true, reason: "cache válido" },
            null,
            2
          ),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        );
      }
      if (isPartial) {
        console.log("⚠️ Cache parcial → forçando atualização");
      }
      if (hasDifferentTickers) {
        console.log("🔄 Lista de ativos mudou → forçando atualização");
      }
    }

    // Parse do cache = Se cálculo falhar → usa valor antigo
    let previousData = {};
    if (existing) {
      try {
        const parsed = JSON.parse(existing);
        const allPrev = [
          ...(parsed?.data?.etfs || []),
          ...(parsed?.data?.acoes || [])
        ];
        previousData = Object.fromEntries(
          allPrev.map(item => [item.symbol, item])
        );
      } catch (e) {
        console.warn("Erro ao parsear cache anterior");
      }
    }


    // --- 2️⃣ FETCH SEQUENCIAL (Plano Free: 1 por vez) ---
    const results = [];
    for (const symbol of ALL) {
      console.log(` 🔎  Buscando: [${ symbol }]`);
      if (
        !symbol ||
        typeof symbol !== "string" ||
        !symbol.trim()
      ) {
        console.warn("⚠️ Symbol inválido, pulando...");
        continue;
      }
      const safeSymbol = encodeURIComponent(symbol);
      const url = `https://brapi.dev/api/quote/${safeSymbol}?range=1mo&interval=1d&token=${API_TOKEN}`;
      const elapsed = Date.now() - startTime;
          if (elapsed > 800000) { // 13 minutos (margem de segurança dos 15min)
              console.warn("⚠️ Tempo limite de background atingindo. Finalizando com o que temos.");
              break;
          }
          console.log(`Buscando [${symbol}]... Tempo decorrido: ${(elapsed/1000).toFixed(1)}s`);

      try {
        const res = await fetch(url, {
           signal: AbortSignal.timeout(25000),
        });

        if (res.status === 429) {
          console.warn(`⚠️ Erro 429 (Rate Limit) em ${symbol}: Muitas requisições. Aguardando 5s...`);
          await sleep(30000); // Espera 30s extra se bater no limite
          continue;
        }

        if (res.status === 502) {
          console.error(`❌ Erro 502 (Bad Gateway) em ${symbol}: O servidor da Brapi está instável ou offline.`);
          continue; // Pula para o próximo ticker
        }

        if (!res.ok) {
          console.error(`❌ Erro HTTP ${res.status} em ${symbol}: Falha inesperada.`);
          continue;
        }

        const json = await res.json();
        if (json.results?.[0]) results.push(json.results[0]);
      } catch (err) {
        if (err.name === 'AbortError') {
          console.error(`⏱️ Timeout atingido em [${symbol}]`);
        } else {
        console.error(`❌ Erro em [${symbol}]`, err);
      }
    }
    await sleep(3000); // Delay de 3s para segurança entre requisições

    // 4️⃣ Processamento
    const processed = results.map(r => {
      const hist = getValidHist(r.historicalDataPrice || []);
      const noHist = hist.length === 0;
      const hist7 = filterByDays(hist, 7);
      const hist30 = filterByDays(hist, 30);
      const closes7 = getCloses(hist7);
      const closes30 = getCloses(hist30);
      const currentPrice = r.regularMarketPrice ?? null;
      const prev = previousData[r.symbol] || {};
      const newVariation =
        (!noHist && hasEnoughHist(hist))
          ? safeValue(getVariation30d(hist, currentPrice))
          : null;

      const variation30d =
        (newVariation == null || newVariation === "N/E")
          ? prev.variation30d ?? "N/E"
          : newVariation;

      return {
        hasHistory: !noHist,
        symbol: r.symbol,
        shortName: r.shortName,
        longName: r.longName,
        description: ETF_INFO[r.symbol.toUpperCase()]?.description || "",
        updatedAt: Date.now(),                          // Timestamp para lógica de front-end
        updatedLabel: getFormattedDateTime(),           // String formatada "DD/MM/AAAA HH:MM:SS"

        regularMarketPrice: safeWithFallback(
          safeValue(currentPrice),
          prev.regularMarketPrice
        ),
        regularMarketChangePercent: safeValue(r.regularMarketChangePercent),
        regularMarketDayRange:
          r.regularMarketDayLow != null && r.regularMarketDayHigh != null
            ? `${r.regularMarketDayLow} - ${r.regularMarketDayHigh}`
            : null,
        min7d: noHist ? fallbackMin(r.fiftyTwoWeekLow) : safeValue(getMin(closes7)),
        min30d: noHist ? fallbackMin(r.fiftyTwoWeekLow) : safeValue(getMin(closes30)),
        variation30d,
        regularMarketDayLow: r.regularMarketDayLow ?? null,
        regularMarketDayHigh: r.regularMarketDayHigh ?? null,
        fiftyTwoWeekLow: r.fiftyTwoWeekLow ?? null,
        fiftyTwoWeekHigh: r.fiftyTwoWeekHigh ?? null,
        logourl: r.logourl || `https://icons.brapi.dev/icons/${r.symbol}.svg`
      };
    });

    // 5️⃣ Payload final
    const payload = {
      data: {
        etfs: processed.filter(r => ETF_LIST.includes(r.symbol)),
        acoes: processed.filter(r => tickersB3.includes(r.symbol))
      },
      meta: {
        version: CACHE_VERSION,
        updatedAt: Date.now(),                  // Timestamp para cálculos
        updatedLabel: getFormattedDateTime(),   // Ex: "09/04/2026 15:30:00"
        total: processed.length,
        partial: processed.length < ALL.length    // Indica se o dado está incompleto
      }
    };
    // Para exibir formatado no LOG:
    console.log("Resultado: ", JSON.stringify(payload, null, 2));

    // 6️⃣ Salvamento seguro no Blobs
    const MIN_VALID = Math.ceil(ALL.length * 0.7);    // 70% o total original com sucesso
    if (processed.length >= MIN_VALID) {
        await store.set(STORE_KEY, JSON.stringify(payload));
        console.log("✅ Cache salvo !");
    }

    return new Response(JSON.stringify({
      ok: true,
      updatedAt: payload.meta.updatedLabel,
      total: results.length
    } , null, 2), {   // O '2' adiciona 2 espaços de indentação na string resultante
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",             // Permite chamadas de qualquer origem
        "Access-Control-Allow-Headers": "Content-Type",
        "Content-Type": "application/json"
      },
    });
    } catch (err) {
      console.error("🔥 ERRO GERAL:", err);
      return new Response(JSON.stringify({ error: "Falha no update", err }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
    });
  }
};

// --- Configuração do Schedule (Cron) ---
// const { schedule } = require("@netlify/functions");
// Cron: a cada 30 min, das 13h às 22h UTC (10h às 19h Brasília), Seg a Sex
export const config = {
  schedule: "*/30 13-22 * * 1-5"
};


/*
helpers (fora da função)
        ↓
handler()
   ↓
fetch API (results)
   ↓
processed = map(results)
   ↓
payload usa processed
   ↓
store.set()



1. require/import
2. exports.handler = async function () {
   2.1 logs iniciais
   2.2 validações
   2.3 constantes (listas, helpers)
   2.4 FETCH ou loop ALL
   2.5 PROCESSAMENTO (map)
   2.6 salvar no cache Blobs
}
*/
