// schedule (cron)
// lógica completa
// chamada da Brapi
// processamento
// salvamento no Blobs

// import { getStore } from "@netlify/blobs";
const { getStore } = require("@netlify/blobs");
// process.env.BRAPI_TOKEN;

console.log("ID do Site existe?", !!process.env.NETLIFY_SITE_ID);
console.log("Token existe?", !!process.env.NETLIFY_BLOBS_TOKEN);
const store = getStore("quotes");
/*
const store = getStore({
  name: "quotes",
  siteID: process.env.NETLIFY_SITE_ID,
  token: process.env.NETLIFY_BLOBS_TOKEN
});
*/

export const config = {
  schedule: "*/15 * * * *" // roda a cada 15 minutos
};

// listas
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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const fetchWithRetry = async (url, retries = 2) => {
  try {
    const res = await fetch(url);

    if (res.status === 429 || res.status >= 500) {
      throw new Error("retry");
    }

    if (!res.ok) return null;

    return await res.json();

  } catch {
    if (retries === 0) return null;
    await sleep(300);
    return fetchWithRetry(url, retries - 1);
  }
};

const getValidHist = (hist) =>
  (hist || []).filter(d => d?.close > 0 && isFinite(d.close));

const getCloses = (h) => h.map(d => d.close);
const getMin = (arr) => arr.length ? Math.min(...arr) : null;
const getMax = (arr) => arr.length ? Math.max(...arr) : null;

export async function handler() {
  const API_TOKEN = process.env.BRAPI_TOKEN;
  console.log("Iniciando update-quote...");

  if (!API_TOKEN) { return { statusCode: 500, body: "Token API_TOKEN não configurado" };  }
  if () { return { statusCode: 500, body: "Token não configurado" }; }
  console.log("ID do Site existe?", !!process.env.NETLIFY_SITE_ID);
  console.log("Token existe?", !!process.env.NETLIFY_BLOBS_TOKEN);

  const ALL = [...ETF_LIST, ...tickersB3];
  const allResults = [];

  const BATCH_SIZE = 5;

  for (let i = 0; i < ALL.length; i += BATCH_SIZE) {
    const batch = ALL.slice(i, i + BATCH_SIZE);

    const promises = batch.map(symbol => {
      const url = `https://brapi.dev/api/quote/${symbol}?range=1mo&interval=1d&token=${API_TOKEN}`;

      return fetchWithRetry(url)
        .then(res => res?.results?.[0])
        .catch(() => null);
    });

    const results = await Promise.all(promises);

    allResults.push(...results.filter(Boolean));

    await sleep(200);
  }

  const processed = allResults.map(r => {
    const hist = getValidHist(r.historicalDataPrice || []);
    const closes = getCloses(hist);

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

  // 💾 salva no Netlify Blobs
  const store = getStore("quotes");
  await store.set("latest", JSON.stringify(payload));
  console.log("Salvando no Blobs...");

  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      total: processed.length
    })
  };
}
