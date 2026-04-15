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
// const { getStore } = require("@netlify/blobs");
// Na V2 deve usar import em vez de require

import { getStore } from "@netlify/blobs";

console.log("🔄 update-quotes carregado");

const VERSION = 2;

const ETF_LIST = ["IRFM11", "IVVB11", "NBIT11", "PACB11"];
const ACOES = ["ASAI3", "BBDC4", "JALL3", "RAIL3", "SIMH3"];
const ALL = [...ETF_LIST, ...ACOES];

// --- helpers ---
const safeValue = (v) => (v == null || Number.isNaN(v) ? "N/E" : v);

const processTicker = (r) => ({
  symbol: r.symbol,
  price: safeValue(r.regularMarketPrice),
  changePercent: safeValue(r.regularMarketChangePercent),
  updatedAt: Date.now()
});

// --- fetch seguro ---
const fetchWithRetry = async (symbol, token, retries = 2) => {
  const url = `https://brapi.dev/api/quote/${symbol}?range=1mo&interval=1d&token=${token}`;

  try {
    const res = await fetch(url);

    if (res.status === 429) throw new Error("RATE_LIMIT");
    if (res.status >= 500) throw new Error("SERVER");

    const text = await res.text();

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      console.error(`❌ JSON inválido: ${symbol}`);
      return null;
    }

    if (!res.ok) return null;

    return json?.results?.[0] || null;

  } catch (err) {
    if (retries === 0) {
      console.error(`❌ Falha final ${symbol}`);
      return null;
    }

    const delay = err.message === "RATE_LIMIT" ? 1000 : 400;
    console.warn(`🔁 Retry ${symbol} em ${delay}ms`);

    await new Promise(r => setTimeout(r, delay));
    return fetchWithRetry(symbol, token, retries - 1);
  }
};

// --- handler ---
export default async (req) => {
  const store = getStore({
    name: "teste20",
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_BLOBS_TOKEN
  });

  const API_TOKEN = process.env.BRAPI_TOKEN;
  if (!API_TOKEN) {
    return new Response("Token não configurado", { status: 500 });
  }

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "true";

  // 🧹 limpeza manual
  if (force) {
    console.log("🧹 Limpando cache...");
    for (const s of ALL) {
      await store.delete(`ticker:${s}`);
    }
    await store.delete("meta:cursor");
  }

  // 🔄 cursor
  let cursor = 0;
  try {
    cursor = await store.get("meta:cursor", { type: "json" }) || 0;
  } catch {}
  const symbol = ALL[cursor];
  const nextCursor = (cursor + 1) % ALL.length;
  await store.setJSON("meta:cursor", nextCursor);
  console.log(`➡️ Atualizando: ${symbol}`);
  const data = await fetchWithRetry(symbol, API_TOKEN);

  // 🛟 fallback
  if (!data) {
    const cached = await store.get(`ticker:${symbol}`, { type: "json" });
    if (cached) {
      console.log("⚠️ fallback usado");
      return Response.json({ ok: true, fallback: true, symbol });
    }
    return new Response("Erro API", { status: 502 });
  }
  const processed = processTicker(data);
  await store.setJSON(`ticker:${symbol}`, {
    version: VERSION,
    data: processed,
    updatedAt: Date.now()
  });
  console.log(`✅ ${symbol} atualizado`);
  return Response.json({ ok: true, symbol });
};


// ⏱️ cron ideal
export const config = {
  schedule: "*/2 13-22 * * 1-5"
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


/*
Test 14/04

await store.setJSON(`ticker:${symbol}`, {
      version: VERSION,
      data: processed,
      updatedAt: Date.now()
    });

      console.log(`✅ ${symbol} atualizado`);
      const hist = getValidHist(r.historicalDataPrice || []);
      const noHist = hist.length === 0;
      const hist7 = filterByDays(hist, 7);
      const hist30 = filterByDays(hist, 30);
      const closes7 = getCloses(hist7);
      const closes30 = getCloses(hist30);
      const currentPrice = r.regularMarketPrice ?? null;

      return Response.json({
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
      });

*/
