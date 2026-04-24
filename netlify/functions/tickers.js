import * as netlifyBlobs from "@netlify/blobs";

const getStore = netlifyBlobs.getStore;

export default async () => {
  const store = getStore({ name: "quotes-blobs" });

  const raw = await store.get("tickers-list");

  return new Response(JSON.stringify({
    raw,
    type: typeof raw
  }));
};





/*
Function anterior para limpeza dos blobs
*/
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
