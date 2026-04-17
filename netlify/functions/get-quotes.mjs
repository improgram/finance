// Busca no storage (Blobs) assim a API fica leve
// retorna JSON
// o que o frontend faz leitura esta aqui


import { getStore } from "@netlify/blobs";
// Na V2 deve usar import em vez de require
// const { getStore } = require("@netlify/blobs");


const formatFullTime = (timestamp) => {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));
};

export default async (req) => {
  console.log("📥 get-quotes chamado (SEQUENCIAL / SAFE)");

  try {
    const store = getStore({ name: "17/04_13hs" });

    console.log("🔎 Listando tickers no Blobs...");

    const list = await store.list({ prefix: "quote-" });

    if (!list.blobs || list.blobs.length === 0) {
      return new Response(JSON.stringify({
        data: { etfs: [], acoes: [] },
        meta: { empty: true }
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }

    const etfs = [];
    const acoes = [];

    console.log(`📦 Processando ${list.blobs.length} itens (sequencial)`);

    // 🔥 LEITURA SEQUENCIAL (sem Promise.all)
    for (const blob of list.blobs) {
      try {
        const raw = await store.get(blob.key);
        if (!raw) continue;

        const textBlob = typeof raw === "string" ? raw : raw.toString();
        const item = JSON.parse(textBlob);

        // adiciona hora formatada da coleta
        item.collectedAtFull = item.updatedAt
          ? formatFullTime(item.updatedAt)
          : null;

        if (!item?.symbol) continue;

        // separação simples (pode evoluir depois)
        if (item.symbol.endsWith("11")) {
          etfs.push(item);
        } else {
          acoes.push(item);
        }

      } catch (err) {
        console.warn(`⚠️ Erro ao processar ${blob.key}`);
      }
    }

    // ordenação opcional
    etfs.sort((a, b) => a.symbol.localeCompare(b.symbol));
    acoes.sort((a, b) => a.symbol.localeCompare(b.symbol));

    console.log(`✅ ETFS: ${etfs.length} | Ações: ${acoes.length}`);

    return new Response(JSON.stringify({
      data: { etfs, acoes },
      meta: {
        total: etfs.length + acoes.length,
        updatedAt: Date.now(),
        collectedAtFull: formatFullTime(Date.now())
      }
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60, stale-while-revalidate=30",
        "Access-Control-Allow-Origin": "*"
      }
    });

  } catch (err) {
    console.error("❌ Erro no get-quotes:", err);

    return new Response(JSON.stringify({
      data: { etfs: [], acoes: [] },
      meta: { error: true },
      collectedAtFull: formatFullTime(Date.now())
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
};


//  Código rodará no lado do servidor ou serverless (netlify) NAO no navegador
//  Acionado apenas quando o Frontend faz o pedido
//  A chave será lida das variáveis de ambiente do Netlify

