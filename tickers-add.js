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
// netlify login
// netlify dev:exec node tickers-add.js

import * as netlifyBlobs from "@netlify/blobs";
const getStore = netlifyBlobs.getStore;

const safeSet = async (store, key, value) => {
  return await store.set(key, JSON.stringify(value));
};

const updateTickersList = async (store, tickers) => {
  if (!Array.isArray(tickers) || tickers.length === 0) {
    throw new Error("❌ Lista enviada é inválida ou vazia");
  }

  const clean = [...new Set(
    tickers.map(t => String(t).trim().toUpperCase())
  )].filter(Boolean);

  if (!clean.length) {
    throw new Error("❌ Lista vazia após a limpeza dos dados");
  }

  console.log("💾 Gravando 'tickers-list' no Netlify Blobs...");
  await safeSet(store, "tickers-list", clean);

  console.log("🔄 Resetando o 'ticker-index' para 0...");
  await safeSet(store, "ticker-index", { value: 0 });

  console.log("✅ Tickers atualizados com sucesso:", clean);
};

const run = async () => {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;

  // Diagnóstico de ambiente local
  if (!siteID) {
    console.warn("⚠️ NETLIFY_SITE_ID não encontrado no ambiente.");
  }
  if (!token) {
    console.warn("⚠️ Token do Netlify não encontrado no ambiente.");
  }

  const store = getStore({
    name: "quotes-blobs",
    siteID: siteID,
    token: token
  });

  const listaTickers = [
    "ALPA4", "ASAI3", "AUPO11", "BBDC4", "BOVA11", "B5P211",
    "CAML3", "CHIP11", "CMIN3", "DXCO3", "GRND3", "GOAT11",
    "HAPV3", "IMAB11", "IRFM11", "IVVB11", "JALL3", "KLBN4",
    "NASD11", "NBIT11", "PACB11", "RAIL3", "RAIZ4", "ROXO34",
    "SIMH3", "SLCE3", "SMAL11", "USDB11", "VIVT3", "5PRE11"
  ];

  await updateTickersList(store, listaTickers);
};

run().catch((err) => {
  console.error("❌ ERRO COMPLETO NA EXECUÇÃO:");
  console.error(err);
});

// Return esperado:
/*
⬥ AI Gateway is disabled for this account
⬥ Injected project settings env vars: ALPHA_VANTAGE_API_KEY, BRAPI_TOKEN, NETLIFY_BLOBS_TOKEN, NETLIFY_SITE_ID, REAL_TIME_KEY
✅ tickers atualizados: ...
*/
