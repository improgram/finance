// Busca no storage (Blobs) assim a API fica leve
// retorna JSON
// o que o frontend faz leitura esta aqui
// (O Distribuidor): É a API que o seu site chama.
// Ela lê todos os Blobs e entrega um JSON consolidado.


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

export default async () => {
  console.log("📥 get-quotes chamado (SEQUENCIAL / SAFE)");

  // Variável para rastrear o timestamp
  let ultimaAtualizacaoGeral = 0;

  try {
    const store = getStore({ name: "quotes-blobs" });
    // cada chave no Blobs é um ticker
    console.log("🔎 Listando tickers no Blobs...");

    const list = await store.list({ prefix: "quote-" });

    // Resumo: Se não há dados disponíveis
    if (!list.blobs || list.blobs.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "Requisiçao Ok - Mas NAO existem dados disponiveis",
          data: {
            etfs: [],
            acoes: []
                },
          meta: {
            empty: true
          }
          } , null, 2 ),

          {
            status: 200,
            headers: {
                  "Content-Type": "application/json",
                  "Access-Control-Allow-Origin": "*"
            }
          }
      );
    }


    const etfs = [];
    const acoes = [];
    console.log(`📦 Processando ${list.blobs.length} itens (sequencial)`);

    // 🔥 LEITURA SEQUENCIAL (sem Promise.all)
    for (const blob of list.blobs) {
      try {
        const raw = await store.get(blob.key);
        if (!raw) continue;

        const textBlob =  typeof raw === "string"
          ? raw
          : new TextDecoder().decode(raw);
        const item = JSON.parse(textBlob);

      // RASTREIO DA ÚLTIMA DATA e hora
      // Compara o updatedAt deste ticker com o maior encontrado até agora

      const ts = Number(item.updatedAt);
      if (!isNaN(ts) && ts > ultimaAtualizacaoGeral) {
        ultimaAtualizacaoGeral = ts;
      }

        item.collectedAtFull = !isNaN(ts)
          ? formatFullTime(ts)
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
        updatedAt: ultimaAtualizacaoGeral,
        collectedAtFull: ultimaAtualizacaoGeral > 0
          ? formatFullTime(ultimaAtualizacaoGeral) : "N/E"
      }
    } , null, 2 ), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60, stale-while-revalidate=30",
        "Access-Control-Allow-Origin": "*"
      }
    });

  } catch (err) {
    console.error("❌ Erro no get-quotes:", err);

    return new Response(
      JSON.stringify({
        data: { etfs: [], acoes: [] },
        meta: {
          error: true,
          collectedAtFull: ultimaAtualizacaoGeral > 0
            ? formatFullTime(ultimaAtualizacaoGeral) : "N/E"
        }
      } , null, 2 ), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }

  if (etfs.length === 0 && acoes.length === 0) {
    const fallback = await store.get("last-valid-snapshot");
  }


}; // final do export default async



//  Código rodará no lado do servidor ou serverless (netlify) NAO no navegador
//  Acionado apenas quando o Frontend faz o pedido
//  A chave será lida das variáveis de ambiente do Netlify

