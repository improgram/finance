// schedule (cron) (Pendente)
// lógica completa
// chamada da Brapi
// processamento
// salvamento no Blobs

// mudar de CommonJS (require) para ES Modules (import/export),
// permite o objeto de configuração simplificado.
// const { getStore } = require("@netlify/blobs");
import { getStore } from "@netlify/blobs";


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
  console.log("🚀 Iniciando update-quotes");
  try {                       // Validações
    const API_TOKEN = process.env.BRAPI_TOKEN;
    if (!API_TOKEN) {
      console.error("❌ Token da API ausente");
      return new Response("Token não configurado", { status: 500 });
    }
    const store = getStore({
      name: "quotes",
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_BLOBS_TOKEN
    });

    const ETF_LIST = [
      "AUPO11"
    ];
    /*
    "BOVA11","B5P211","GOAT11","IMAB11","IRFM11",
      "IVVB11", "LFTB11","NBIT11","NDIV11", "PACB11", "SMAL11",
      "UTLL11","5PRE11"
    */
    const tickersB3 = [
      "ALPA4"
      /*,"ASAI3","BBDC4","CAML3","DXCO3","KLBN4",
      "GRND3","JALL3","RAIL3","SIMH3","SLCE3"
      */
    ];
    const ETF_INFO = {
      AUPO11: { description: "NTN-B + Selic" }
    };
/*

      BOVA11: { description: "Ibovespa" },
      B5P211: { description: "NTN-B (inflação) Curto/Medio" },
      GOAT11: { description: "Inflação + S&P" },
      IMAB11: { description: "NTN-B (Inflação) Medio/Longo" },
      IRFM11: { description: "Pré-fixado" },
      IVVB11: { description: "S&P 500 dos EUA" },
      LFTB11: { description: "Selic" },
      NBIT11: { description: "Bitcoin Nasdaq" },
      NDIV11: { description: "Dividendos" },
      PACB11: { description: "NTN-B (Inflação) Longo 2050/60" },
      SMAL11: { description: "Small caps" },
      UTLL11: { description: "Utilities" },
      "5PRE11": { description: "Pré-fixado" }
*/

    const ALL = [...ETF_LIST, ...tickersB3];
    console.log(`📊 Total de ativos: ${ALL.length}`);


    // 1️⃣ Cache antes de bater na API
    const existing = await store.get("latest");
    if (existing) {
      const parsed = JSON.parse(existing);
      const lastUpdate = parsed?.meta?.updatedAt || 0;
      const now = Date.now();
      const diffMinutes = (now - lastUpdate) / 60000;
      const marketOpen = isMarketOpen();
      const limit = marketOpen ? 10 : 60;
      if (parsed?.data?.etfs?.length && diffMinutes < limit) {
        console.log(`⏱️ Cache válido (${diffMinutes.toFixed(1)} min)`);
        return new Response(JSON.stringify({ skipped: true, reason: "cache válido" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
    }


    // --- 2️⃣ FETCH SEQUENCIAL (Plano Free: 1 por vez) ---
    const results = [];
    for (const symbol of ALL) {
      console.log(`Buscando: ${symbol}`);
      const url = `https://brapi.dev/api/quote/${symbol}?range=1mo&interval=1d&token=${API_TOKEN}`;

      try {
        const res = await fetch(url);
        if (res.status === 429) {
          console.warn(`⚠️ Erro 429 (Rate Limit) em ${symbol}: Muitas requisições. Aguardando 2s...`);
          await sleep(2000); // Espera extra se bater no limite
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
        console.error(`❌ Erro em ${symbol}:`, err.message);
      }
      await sleep(400); // Delay de segurança entre requisições
    }

    // 4️⃣ Processamento
    const processed = results.map(r => {
      const hist = getValidHist(r.historicalDataPrice || []);
      const noHist = hist.length === 0;
      const hist7 = filterByDays(hist, 7);
      const hist30 = filterByDays(hist, 30);
      const closes7 = getCloses(hist7);
      const closes30 = getCloses(hist30);
      const currentPrice = r.regularMarketPrice ?? null;

      return {
        hasHistory: !noHist,
        symbol: r.symbol,
        shortName: r.shortName,
        longName: r.longName,
        description: ETF_INFO[r.symbol.toUpperCase()]?.description || "",
        updatedAt: Date.now(),                          // Timestamp para lógica de front-end
        updatedLabel: getFormattedDateTime(),           // String formatada "DD/MM/AAAA HH:MM:SS"

        regularMarketPrice: safeValue(currentPrice),
        regularMarketChangePercent: safeValue(r.regularMarketChangePercent),
        regularMarketDayRange:
          r.regularMarketDayLow != null && r.regularMarketDayHigh != null
            ? `${r.regularMarketDayLow} - ${r.regularMarketDayHigh}`
            : null,
        min7d: noHist ? fallbackMin(r.fiftyTwoWeekLow) : safeValue(getMin(closes7)),
        min30d: noHist ? fallbackMin(r.fiftyTwoWeekLow) : safeValue(getMin(closes30)),
        variation30d: (!noHist && hasEnoughHist(hist))
          ? safeValue(getVariation30d(hist, currentPrice))
          : "N/E",
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
        updatedAt: Date.now(),                  // Timestamp para cálculos
        updatedLabel: getFormattedDateTime(),   // Ex: "09/04/2026 15:30:00"
        total: processed.length
      }
    };

    // 6️⃣ Salvamento seguro no Blobs
    if (processed.length > 0) {
      await store.set("latest", JSON.stringify(payload));   // salva no Blobs
      console.log("✅ Cache salvo com sucesso!");
    }

    return new Response(JSON.stringify({
      ok: true,
      updatedAt: payload.meta.updatedLabel,
      total: results.length
    }), {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",             // Permite chamadas de qualquer origem
        "Access-Control-Allow-Headers": "Content-Type",
        "Content-Type": "application/json"
      },
    });
    } catch (err) {
      console.error("🔥 ERRO GERAL:", err);
      return new Response(JSON.stringify({ error: "Falha no update", message: err.message }), {
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
