import * as netlifyBlobs from "@netlify/blobs";

const getStore = netlifyBlobs?.getStore;

export default async () => {
  if (typeof getStore !== "function") {
    return new Response("❌ getStore inválido");
  }

  const store = getStore({ name: "quotes-blobs" });

  await store.set("ticker-index", { value: 0 }, { type: "json" });

  const saved = await store.get("tickers-list", { type: "json" });
  return new Response(JSON.stringify(saved));
};
