// schedule (cron)
// lógica completa
// chamada da Brapi
// processamento
// salvamento no Blobs

// Update é responsável por chamar a Brapi e salvar no Blobs (e rodará como um CRON)

// formato tradicional: (V1 / CommonJS) procura exports.handler.

//  No entanto, você construiu o script utilizando o padrão
//   de módulos ES (export default / Netlify Functions V2).

// mudar de CommonJS (require) para ES Modules (import/export),
//      permite o objeto de configuração simplificado.
console.log("Update-quotes CARREGADA");

// const { getStore } = require("@netlify/blobs");
// Na V2 deve usar import em vez de require

import { getStore } from "@netlify/blobs";

// Helpers de mercado
const isMarketOpen = () => {
  // Converte a hora UTC do servidor para o fuso de São Paulo
  const nowSP = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const day = nowSP.getDay();
  const hour = nowSP.getHours();
  const minute = nowSP.getMinutes();

  if (day === 0 || day === 6) return false;
  const current = hour * 60 + minute;
  const open = 10 * 60;       // 10:00
  const close = 18 * 60 + 55;  // 18:55
  return current >= open && current <= close;
};

// Helpers de processamento
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

// Handler Principal V2
export default async (req, context) => {
  console.log(" 🔄 Cron Iniciando update-quotes");
  const urlUpdate = new URL(req.url);
  const forceUpdate = urlUpdate.searchParams.get("force") === "true";

  // Validações
  try {
    const API_TOKEN = process.env.BRAPI_TOKEN;
    if (!API_TOKEN) {
      console.error("❌ Token da API ausente");
      return new Response("Token não configurado", { status: 500 });
    }
    const store = getStore({
      name: "teste18",
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_BLOBS_TOKEN
    });

    const ETF_LIST = [ "IRFM11", "IVVB11", "NBIT11", "PACB11" ];
    /* "AUPO11","BOVA11","B5P211","IMAB11",  */

    const tickersB3 = [ "ASAI3", "BBDC4", "JALL3", "RAIL3", "SIMH3" ];
    /* "ALPA4", "CAML3", "DXCO3", "GRND3", "KLBN4", "SLCE3" */

    const ETF_INFO = {
      AUPO11: { description: "NTN-B + Selic" },
      BOVA11: { description: "Ibovespa" },
      B5P211: { description: "NTN-B (inflação) Curto/Medio" },
      IMAB11: { description: "NTN-B (Inflação) Medio/Longo" },
      IRFM11: { description: "Pré-fixado" },
      IVVB11: { description: "S&P 500 dos EUA" },
      NBIT11: { description: "Bitcoin Nasdaq" },
      PACB11: { description: "NTN-B (Inflação) Longo 2050/60" },
    };

    const ALL = [...ETF_LIST, ...tickersB3];
    console.log(`📊 Total de ativos: ${ALL.length}`);

    // 1️⃣ Cache antes de bater na API
    // Na V2 podemos buscar direto como JSON
    let parsed =  null;
    console.log("RAW CACHE:", parsed);

    // limpeza manual via ?force=true
     if (forceUpdate) {
      console.log("🧹 Limpando cache manualmente...");
      await store.delete("latest");
    }

    try {
      // Se forceUpdate for true, nem tentamos ler o cache para evitar erros de parse
      if (!forceUpdate) {
        parsed = await store.get("latest", { type: "json" });
      }
    } catch (e) {
      console.warn("⚠️ Cache corrompido. Limpando");
      await store.delete("latest");
      parsed = null;
    }

    if (parsed && !forceUpdate) {
      const lastUpdate = parsed?.meta?.updatedAt || 0;
      const now = Date.now();
      const diffMinutes = (now - lastUpdate) / 60000;
      const marketOpen = isMarketOpen();
      const limit = marketOpen ? 10 : 60; // 10 min se mercado aberto, 60 min se fechado

      const isEmpty = !parsed?.data?.etfs?.length && !parsed?.data?.acoes?.length;

      if (!isEmpty && diffMinutes < limit) {
        console.log(`⏱️ Cache válido (${diffMinutes.toFixed(1)} min). Nenhuma chamada feita.`);
        const total = (parsed?.data?.etfs?.length || 0) + (parsed?.data?.acoes?.length || 0);

        return new Response(JSON.stringify({ ok: true, cached: true, total }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        });
      }
    }

    // 2️⃣ Fetch com retry inteligente e interval=1h(nao pode)
    const fetchWithRetry = async (symbol, retries = 2) => {
      const url = `https://brapi.dev/api/quote/${symbol}?range=1mo&interval=1d&token=${API_TOKEN}`;

      try {
        const res = await fetch(url);       // =>  chamada na Brapi
        if (res.status === 429) throw new Error("RATE_LIMIT");
        if (res.status >= 500) throw new Error("SERVER_ERROR 500");

        const text = await res.text(); // 👈 pega como texto primeiro

        let json;
        try {
          json = JSON.parse(text); // 👈 parse manual seguro
        } catch (e) {
          console.error(`❌ JSON inválido para ${symbol}:`, text.slice(0, 200));
          return null;
        }

        if (!res.ok) {
          console.warn(`⚠️ ${symbol}:`, json);
          return null;
        }

        return json?.results?.[0] || null;

      } catch (err) {
        if (retries === 0) {
          console.error(`❌ Falha final ${symbol}`);
          return null;
        }
        const delay = err.message === "RATE_LIMIT" ? 1000 : 400;
        console.warn(`🔁 Retry ${symbol} em ${delay}ms`);

        await new Promise(r => setTimeout(r, delay));
        return fetchWithRetry(symbol, retries - 1);
      }
    };

    // 3️⃣ Buscar tickers com sequencial e delay obrigatório:
    const results = [];
    for (const symbol of ALL) {
      const data = await fetchWithRetry(symbol);
      if (data) results.push(data);

      // 🔥 delay obrigatório pra não tomar 429 na Brapi
      await new Promise(r => setTimeout(r, 1200));
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
        description: ETF_INFO[r.symbol]?.description || "",
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
        updatedAt: Date.now(),
        total: processed.length
      }
    };

    // 6️⃣ Salvamento seguro no Blobs
    const totalValid = payload.data.etfs.length + payload.data.acoes.length;
    if (totalValid === 0) {
      console.warn("⚠️ Nenhum dado válido → cache NÃO atualizado");
      return new Response("Erro na Brapi: Nenhum dado atualizado", { status: 502 });
    }

      console.log(`💾 Salvando cache com ${totalValid} ativos...`);
      // Vantagem da V2: setJSON resolve direto o parse/stringify por baixo dos panos
      await store.setJSON("latest", payload);   // salva no Blobs
      console.log("✅ Cache salvo com sucesso!");

    return new Response (JSON.stringify({ ok: true, total: totalValid }), {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*", // Permite chamadas de qualquer origem
        "Access-Control-Allow-Headers": "Content-Type",
        "Content-Type": "application/json"
      },
    });

  } catch (err) {
      console.error("🔥 ERRO GERAL:", err);
      return new Response(JSON.stringify({ error: err.message }), {
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
