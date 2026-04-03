// schedule (cron)
// lógica completa
// chamada da Brapi
// processamento
// salvamento no Blobs

// import { getStore } from "@netlify/blobs";
const { getStore } = require("@netlify/blobs");
// process.env.BRAPI_TOKEN;

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
  "LFTB11","NBIT11","NDIV11","POSB11","SMAL11",
  "UTLL11","5PRE11"
];

    const tickersB3 = [
  "ALPA4","ASAI3","BBDC4","CAML3","DXCO3","KLBN4",
  "GRND3","JALL3","RAIL3","SIMH3","SLCE3"
];

    const ETF_INFO = {
  AUPO11: { description: "NTN-B + Selic" },
  BOVA11: { description: "Ibovespa" },
  B5P211: { description: "NTN-B curto" },
  GOAT11: { description: "Inflação + S&P" },
  IMAB11: { description: "NTN-B longo" },
  IRFM11: { description: "Pré-fixado" },
  LFTB11: { description: "Selic" },
  NBIT11: { description: "Bitcoin Nasdaq" },
  NDIV11: { description: "Dividendos" },
  POSB11: { description: "Selic + IPCA" },
  SMAL11: { description: "Small caps" },
  UTLL11: { description: "Utilities" },
  "5PRE11": { description: "Pré-fixado" }
};

    const ALL = [...ETF_LIST, ...tickersB3];
    console.log(`📊 Total de ativos: ${ALL.length}`);
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));


    const fetchWithRetry = async (url, symbol, retries = 2) => {
      try {
        console.log(`🌐 Buscando: ${symbol}`);

        const res = await fetch(url);

        console.log(`📡 Status ${symbol}:`, res.status);

        if (res.status === 429 || res.status >= 500) {
          throw new Error("retry");
        }

        if (!res.ok) {
          console.warn(`⚠️ Falha ${symbol}`);
          return null;
        }

        const json = await res.json();

        return json;

      } catch (err) {
        console.warn(`🔁 Retry ${symbol} (${retries})`);

        if (retries === 0) {
          console.error(`❌ Falha definitiva ${symbol}`);
          return null;
        }

        await sleep(300);
        return fetchWithRetry(url, symbol, retries - 1);
      }
    };

    const results = [];

    for (const symbol of ALL) {

      const url = `https://brapi.dev/api/quote/${symbol}?range=1mo&interval=1d&token=${API_TOKEN}`;

      const res = await fetchWithRetry(url, symbol);

      if (res?.results?.[0]) {
        console.log(`✅ OK: ${symbol}`);
        results.push(res.results[0]);
      } else {
        console.warn(`⚠️ Sem dados: ${symbol}`);
      }

      await sleep(150);
    }

    console.log(`📦 Total retornado: ${results.length}`);

    const payload = {
      data: {
        etfs: results.filter(r => ETF_LIST.includes(r.symbol)),
        acoes: results.filter(r => tickersB3.includes(r.symbol))
      },
      meta: {
        updatedAt: Date.now(),
        total: results.length
      }
    };

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
