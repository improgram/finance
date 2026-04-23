// Busca no storage (Blobs) assim a API fica leve
// retorna JSON
// o que o frontend faz leitura esta aqui
// (O Distribuidor): É a API que o seu site chama.
// Ela lê todos os Blobs e entrega um JSON consolidado.


import { getStore } from "@netlify/blobs";

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

    // ⚡ TENTA SNAPSHOT PRIMEIRO = snapshot é a fonte principal

    const snapshot = await store.get("last-valid-snapshot", { type: "json" });
    const safeData = snapshot?.data?.filter(i => i?.symbol) || [];

    if ( safeData.length > 0 ) {
      console.log("⚡ Snapshot carregado");
      return new Response(JSON.stringify({
        data: {
          etfs: safeData.filter(i => i.symbol.endsWith("11")),
          acoes: safeData.filter(i => !i.symbol.endsWith("11"))
        },
        meta: {
          snapshot: true,
          total: safeData.length,
          updatedAt: snapshot?.updatedAt || 0,
          collectedAtFull: snapshot?.updatedAt
            ? formatFullTime(snapshot.updatedAt)
            : "Nao Encontrado Snapshot"
        }
        }, null, 2), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=60, stale-while-revalidate=30"
          }
        });
    }     // FiM da condiçao: snapshot?.data ....


    // cada chave no Blobs é um ticker
    console.log("🔎 Listando tickers no Blobs...");

    // store.list mantido como fallback
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
            headers:
            {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "public, max-age=60, stale-while-revalidate=30"
            }
          }
      );
    }

    const etfs = [];
    const acoes = [];
    const validBlobs = list.blobs.filter(b => !b.key.endsWith("-tmp"));
    console.log(`📦 Processando ${validBlobs.length} itens válidos`);

    // 🔥 LEITURA SEQUENCIAL (sem Promise.all)
    for (const blob of validBlobs) {

      try {
        const raw = await store.get(blob.key, { type: "json" }).catch(() => null);
        if (!raw) continue;
        let item = null;

        // 🔒 Normalização segura
        if (typeof raw === "string") {
          try {
            item = JSON.parse(raw);
          } catch {
            console.warn(`⚠️ JSON inválido em ${blob.key}`);
            continue;
          }
        } else if (typeof raw === "object") {
          item = raw;
        }

        // 🔒 Validação estrutural forte
        if (!item || typeof item !== "object") {
          console.warn(`⚠️ Item inválido (não é objeto): ${blob.key}`);
          continue;
        }

        // 🔒 Validação de symbol
        if (!item.symbol || typeof item.symbol !== "string") {
          console.warn(`⚠️ Symbol inválido: ${blob.key}`);
          continue;
        }

        // 🔒 Normalização de symbol (proteção extra)
        item.symbol = item.symbol.trim().toUpperCase();

        // 🔒 Validação de timestamp
        const timeValida = Number(item.updatedAt || 0);
        if (isNaN(timeValida) || timeValida <= 0) {
          console.warn(`⚠️ updatedAt inválido: ${blob.key}`);
          continue;
        }

        console.log("🔎 ITEM LIDO:", {
          key: blob.key,
          symbol: item.symbol,
          updatedAt: timeValida
        });

        // rastreio global
        if (timeValida > ultimaAtualizacaoGeral) {
          ultimaAtualizacaoGeral = timeValida;
        }
        item.collectedAtFull = formatFullTime(timeValida);

        // 📊 Classificação
        if (item.symbol.endsWith("11")) {
          etfs.push(item);
        } else {
          acoes.push(item);
        }

      }
    }

    // ordenação opcional
    etfs.sort((a, b) => a.symbol.localeCompare(b.symbol));
    acoes.sort((a, b) => a.symbol.localeCompare(b.symbol));

    console.log(`✅ ETFS: ${etfs.length} | Ações: ${acoes.length}`);


    // ----------------- Fallback --------------

    if (etfs.length === 0 && acoes.length === 0) {

      console.warn("⚠️ Nenhum dado válido, tentando fallback...");
      const fallback = await store.get("last-valid-snapshot", { type: "json" });
      const safeFallback = fallback?.data?.filter(i => i?.symbol) || [];

      if ( safeFallback.length > 0 ) {
        console.log("♻️ Usando snapshot fallback");
        const etfsFallback = [];
        const acoesFallback = [];

        for (const item of safeFallback) {
          if (item.symbol?.endsWith("11")) {
            etfsFallback.push(item);
          } else {
            acoesFallback.push(item);
          }
        }

        return new Response(JSON.stringify({
          data: {
            etfs: etfsFallback,
            acoes: acoesFallback
          },
          meta: {
            fallback: true,
            total: safeFallback.length,
            updatedAt: fallback?.updatedAt || 0,
            collectedAtFull: fallback?.updatedAt
              ? formatFullTime(fallback.updatedAt)
              : "Nao Encontrado Fallback"
          }
        }, null, 2), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=60, stale-while-revalidate=30"
          }
        });
      }
    }
    // Fim do Fallback


    return new Response(JSON.stringify({
      data: { etfs, acoes },
      meta: {
        total: etfs.length + acoes.length,
        updatedAt: ultimaAtualizacaoGeral,
        collectedAtFull: ultimaAtualizacaoGeral > 0
          ? formatFullTime(ultimaAtualizacaoGeral)
          : "Atualizaçao Nao Encontrada"
      }
    } , null, 2 ), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=60, stale-while-revalidate=30"
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
            ? formatFullTime(ultimaAtualizacaoGeral)
            : " Atualizaçao com erro na busca"
        }
      } , null, 2 ), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=60, stale-while-revalidate=30"
      }
    });
  }

}; // final do export default async



//  Código rodará no lado do servidor ou serverless (netlify) NAO no navegador
//  Acionado apenas quando o Frontend faz o pedido
//  A chave será lida das variáveis de ambiente do Netlify

