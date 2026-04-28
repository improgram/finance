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

    // 👉 então use só para manutenção
    // no bash comando manual :
    // node tickers.js


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
  token: process.env.NETLIFY_TOKEN
});

  await updateTickersList(store, [
    "AUPO11", "BBDC4", "B5P211", "IMAB11", "IRFM11",
    "IVVB11", "NBIT11", "PACB11", "5PRE11"
  ]);
};

run().catch(console.error);
