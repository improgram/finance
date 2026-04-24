export default async () => {
  const store = getStore({ name: "quotes-blobs" });

  await store.set("tickers-list", [ "BBDC4","IRFM11" ], { type: "json" });

  //const saved = await store.get("tickers-list", { type: "json" });

  return new Response("tickers setados");
};
