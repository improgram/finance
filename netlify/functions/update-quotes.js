// schedule (cron)
// lógica completa
// chamada da Brapi
// processamento
// salvamento no Blobs

const { getStore } = require("@netlify/blobs");

// Helper para atraso (evita 429 Too Many Requests)
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Function horario de mercado financeiro
const isMarketOpen = () => {
  const now = new Date();
  const day = now.getDay(); // 0 = domingo
  const hour = now.getHours();
  const minute = now.getMinutes();

  // fim de semana
  if (day === 0 || day === 6) return false;
  const current = hour * 60 + minute;
  const open = 10 * 60;      // 10:00
  const close = 18 * 60 + 55; // 18:55
  return current >= open && current <= close;
};

// Cache antes de bater na API
const existing = await store.get("latest");
if (existing) {
  const parsed = JSON.parse(existing);
  const lastUpdate = parsed?.meta?.updatedAt || 0;
  const now = Date.now();
  const diffMinutes = (now - lastUpdate) / 60000;
  const marketOpen = isMarketOpen();
  const limit = marketOpen ? 10 : 60; // 🔥 ajuste fino

  if (diffMinutes < limit) {
    console.log(`⏱️ Cache válido (${diffMinutes.toFixed(1)} min)`);
    return {
      statusCode: 200,
      body: JSON.stringify({
        skipped: true,
        reason: "cache válido",
        minutes: diffMinutes
      })
    };
  }
}


// Helpers
    // Calculos do historico
    const getValidHist = (hist) =>
    (hist || []).filter(d =>
        d && typeof d.date === "number" && typeof d.close === "number"
    );

    const getCloses = (hist) => hist.map(d => d.close);

    const getMin = (arr) => arr.length ? Math.min(...arr) : null;

    // filtra por dias corridos
    const filterByDays = (hist, days) => {
    const now = Math.floor(Date.now() / 1000);
    const limit = now - (days * 24 * 60 * 60);
    return hist.filter(d => d.date >= limit);
    };

    const hasEnoughHist = (hist) => hist.length >= 10; // (minimo 10 dias)

    const safeValue = (value) => {                  // Fallback "N/E"
      return (value === null || value === undefined || Number.isNaN(value))
        ? "N/E"
        : value;
    };

    const fallbackMin = (fallback) => {
      if (fallback !== null && fallback !== undefined) return fallback;
      return "N/E";
    };

    // variação 30 dias
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
// Final dos calculos


exports.handler = async function () {
    console.log("🚀 Iniciando update-quotes");

  try {
    // 🔐 valida variáveis
    console.log("🔑 BRAPI_TOKEN existe?", !!process.env.BRAPI_TOKEN);
    console.log("🔑 SITE_ID existe?", !!process.env.NETLIFY_SITE_ID);
    console.log("🔑 BLOBS_TOKEN existe?", !!process.env.NETLIFY_BLOBS_TOKEN);

    const store = getStore({
      name: "quotes",
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_BLOBS_TOKEN
    });

    const API_TOKEN = process.env.BRAPI_TOKEN;

    if (!API_TOKEN) {
      console.error("❌ Token da API ausente");
      return { statusCode: 500, body: "Token não configurado" };
    }

    const ETF_LIST = [
        "AUPO11","BOVA11","B5P211","GOAT11","IMAB11","IRFM11",
        "IVVB11", "LFTB11","NBIT11","NDIV11", "PACB11", "SMAL11",
        "UTLL11","5PRE11"
    ];

    const tickersB3 = [
        "ALPA4","ASAI3","BBDC4","CAML3","DXCO3","KLBN4",
        "GRND3","JALL3","RAIL3","SIMH3","SLCE3"
    ];

    const ETF_INFO = {
        AUPO11: { description: "NTN-B + Selic" },
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
    };
    const ALL = [...ETF_LIST, ...tickersB3];
    console.log(`📊 Total de ativos: ${ALL.length}`);


    // Plano gratuito tem limite de requisições
    // requisição em lote nao é aceita pela API brapi
    // Não pode ser feito loop for pesado sequencial

        const fetchWithRetry = async (symbol, retries = 2) => {
          const url = `https://brapi.dev/api/quote/${symbol}?range=1mo&interval=1d&token=${API_TOKEN}`;
          try {
            const res = await fetch(url);
            if (res.status === 429) {
              throw new Error("RATE_LIMIT");
            }
            if (res.status >= 500) {
              throw new Error("SERVER_ERROR");
            }
            if (!res.ok) {
              const text = await res.text();
              console.warn(`⚠️ ${symbol}:`, text);
              return null;
            }
            const json = await res.json();
            return json?.results?.[0] || null;
          } catch (err) {
            if (retries === 0) {
              console.error(`❌ Falha final ${symbol}`);
              return null;
            }
            const delay =
              err.message === "RATE_LIMIT"
                ? 1000   // espera maior
                : 400;
            console.warn(`🔁 Retry ${symbol} em ${delay}ms`);
            await new Promise(r => setTimeout(r, delay));
            return fetchWithRetry(symbol, retries - 1);
          }
          console.log(`📦 Total Recebidos: ${results.length}`);
        };


    // Final do Retry


    // Concorrencia controlada
    const CONCURRENCY = 3;
    const results = [];

    for (let i = 0; i < ALL.length; i += CONCURRENCY) {
      const slice = ALL.slice(i, i + CONCURRENCY);

      const batch = await Promise.all(
        slice.map(symbol => fetchWithRetry(symbol))
      );

      results.push(...batch.filter(Boolean));
    }


    // Processamento e filtros dos dados
    const processed = results.map(r => {

      const hist = getValidHist(r.historicalDataPrice || []);
      const noHist = hist.length === 0;
      if (noHist) {
        console.warn(`📭 Sem histórico: ${r.symbol}`);
      }
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
            (r.regularMarketDayLow != null && r.regularMarketDayHigh != null)
              ? `${r.regularMarketDayLow} - ${r.regularMarketDayHigh}`
              : null,
          min7d: noHist
              ? fallbackMin(r.fiftyTwoWeekLow)
              : safeValue(getMin(closes7)),
          min30d:
            noHist ? fallbackMin(r.fiftyTwoWeekLow)
            : safeValue(getMin(getCloses(hist30))),
          variation30d: (!noHist && hasEnoughHist(hist))
            ? safeValue(getVariation30d(hist, currentPrice))
            : "N/E",

          // compatibilidade com frontend
          regularMarketDayLow: r.regularMarketDayLow ?? null,
          regularMarketDayHigh: r.regularMarketDayHigh ?? null,
          fiftyTwoWeekLow: r.fiftyTwoWeekLow ?? null,
          fiftyTwoWeekHigh: r.fiftyTwoWeekHigh ?? null,

          logourl: r.logourl || `https://icons.brapi.dev/icons/${r.symbol}.svg`
          };
      });
  // Final do processamento


  // Payload
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


     // 💾 CACHE
    console.log("💾 Salvando no Blobs...");
    await store.set("latest", JSON.stringify(payload));
    console.log("✅ Salvo com sucesso!");

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, total: results.length })
    };

  } catch (err) {
    console.error("🔥 ERRO GERAL:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Falha no update",
        message: err.message
      })
    };
  }
};


/*
    return {
      symbol: r.symbol,
      name: r.longName || r.shortName || r.symbol,
      description: ETF_INFO[r.symbol]?.description || "",
      regularMarketPrice: r.regularMarketPrice ?? null,
      regularMarketChangePercent: r.regularMarketChangePercent ?? null,
      min7d: getMin(closes),
      max30d: getMax(closes),
      logourl: r.logourl || `https://icons.brapi.dev/icons/${r.symbol}.svg`
    };
  });
*/


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
   2.4 FETCH (loop ALL)
   2.5 PROCESSAMENTO (map)
   2.6 salvar no cache Blobs
}
*/
