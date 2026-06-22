    // Quando usar esse script:

// ✔ adicionar tickers novos rápido
// ✔ corrigir lista quebrada
// ✔ resetar fila
// ✔ manutenção manual
// ✔ testes locais

// Se você rodar esse script:
// ele NÃO passa pelo cron
// ele NÃO usa safeGet do seu app
// ele escreve direto no Blobs

// 👉 então use só para manutenção => no bash comando manual :

// node tickers-add.js
// OU
// netlify dev:exec node tickers-add.js


import * as netlifyBlobs from "@netlify/blobs";
const getStore = netlifyBlobs.getStore;

// mesma lógica do seu sistema
const safeSet = async (store, key, value) => {
  return await store.set(key, JSON.stringify(value));
};

const updateTickersList = async (store, tickers) => {
  if (!Array.isArray(tickers) || tickers.length === 0) {
    throw new Error("Lista inválida");
  }

  const clean = [...new Set(
    tickers.map(t => String(t).trim().toUpperCase())
  )].filter(Boolean);

  if (!clean.length) {
    throw new Error("Lista vazia após limpeza");
  }

  await safeSet(store, "tickers-list", clean);

  // 🔥 opcional (recomendado)
  await safeSet(store, "ticker-index", { value: 0 });

  console.log("✅ tickers atualizados:", clean);
};

// 🔥 EXECUÇÃO MANUAL
const run = async () => {
  // const store = getStore({ name: "quotes-blobs" });
  const store = getStore({
  name: "quotes-blobs",
  siteID: process.env.NETLIFY_SITE_ID,
  // Tenta pegar o token padrão ou o token injetado pela CLI do Netlify
  token: process.env.NETLIFY_TOKEN || process.env.NETLIFY_BLOBS_TOKEN
});

  await updateTickersList(store, [
    "ALPA4", "ASAI3", "AUPO11", "BBDC4", "BOVA11", "B5P211",
    "CAML3", "CHIP11", "CMIN3", "DXCO3", "GRND3", "GOAT11",
    "HAPV3", "IMAB11", "IRFM11", "IVVB11", "JALL3", "KLBN4",
    "NASD11", "NBIT11", "PACB11", "RAIL3", "RAIZ4", "ROXO34",
    "SIMH3", "SLCE3", "SMAL11", "USDB11", "VIVT3", "5PRE11"
  ]);
};

run().catch(console.error);


// Return esperado:
/*
⬥ AI Gateway is disabled for this account
⬥ Injected project settings env vars: ALPHA_VANTAGE_API_KEY, BRAPI_TOKEN, NETLIFY_BLOBS_TOKEN, NETLIFY_SITE_ID, REAL_TIME_KEY
✅ tickers atualizados: ...
*/
