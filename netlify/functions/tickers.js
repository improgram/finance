import * as netlifyBlobs from "@netlify/blobs";

const getStore = netlifyBlobs?.getStore;

export default async () => {
  if (typeof getStore !== "function") {
    return new Response("❌ getStore inválido");
  }

  const store = getStore({ name: "quotes-blobs" });

  await store.set("tickers-list", ["BBDC4","IRFM11","PETR4"], { type: "json" });

  return new Response("✅ tickers-list salvo com sucesso");
};
