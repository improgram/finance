// Busca no storage (Blobs) assim a API fica leve
// retorna JSON
// o que o frontend faz leitura esta aqui


import { getStore } from "@netlify/blobs";
// Na V2 deve usar import em vez de require
// const { getStore } = require("@netlify/blobs");

export default async (req, context) => {
  console.log("📥 get-quotes chamado (V2)");
  const url = new URL(req.url);
  const testError = url.searchParams.get("test_error");

  if (testError) {
    console.warn(`🚨 MODO DE TESTE ATIVO: Simulando erro ${testError}`);

    if (testError === "429") {
      console.log("❌ [LOG 429] Rate Limit atingido! (Too Many Requests)");
      return new Response(JSON.stringify({ error: "Rate limit excedido" }), { status: 429, headers: { "Content-Type": "application/json" } });
    }
    if (testError === "500") {
      console.log("❌ [LOG 500] Erro interno do servidor! (Falha no Blobs/Código)");
      return new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
    if (testError === "502") {
      console.log("❌ [LOG 502] Bad Gateway! (Brapi fora do ar ou Timeout)");
      return new Response(JSON.stringify({ error: "Bad Gateway" }), { status: 502, headers: { "Content-Type": "application/json" } });
    }
  }

  try {

    console.log("ID do Site existe?", !!process.env.NETLIFY_SITE_ID);
    console.log("Token existe?", !!process.env.NETLIFY_BLOBS_TOKEN);

    const store = getStore({
      name: "test12hs",
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_BLOBS_TOKEN
    });

    console.log("🔎 Buscando dados no Blobs...");

    const data = await store.get("latest-v1", { type: "json" });

    // 🔥 fallback seguro
    if (!data) {
      console.warn("⚠️ Nenhum dado encontrado no Blobs");
      return new Response(
        JSON.stringify({
          data: { etfs: [], acoes: [] },
          meta: { empty: true, message: "Sem dados ainda" }
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          }
        }
      );
    }

    console.log("✅ Dados encontrados no Blobs");
    const responseBody = typeof data === 'string' ? JSON.parse(data) : data;

    return new Response(JSON.stringify(responseBody), {     // null, 2
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60, stale-while-revalidate=30",
        "Access-Control-Allow-Origin": "*", // Permite chamadas de qualquer origem
        "Access-Control-Allow-Headers": "Content-Type",
      }
    });

  } catch (err) {
    console.error("❌ [LOG 500 REAL] Erro não mapeado em get-quotes:", err);

    return new Response (
      JSON.stringify({
        data: { etfs: [], acoes: [] },
        meta: { error: true, message: err.message }
      }),
      {
        status: 200,      // 🔥 nunca 500
        headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60, stale-while-revalidate=30",
        "Access-Control-Allow-Origin": "*", // Permite chamadas de qualquer origem
        "Access-Control-Allow-Headers": "Content-Type",
        }
      }
    );
  }
};



//  Código rodará no lado do servidor ou serverless (netlify) NAO no navegador
//  Acionado apenas quando o Frontend faz o pedido
//  A chave será lida das variáveis de ambiente do Netlify

//  O endpoint /list é o correto para filtros como 'type'
//  O endpoint /list retorna 'stocks' da brapi

//  O endpoint /quote/list retorna:   { "stocks": [...]  }
//  O endpoint /quote/{ticker} retorna objeto 'results'

// Se o mercado estiver aberto, a API Brapi atualiza o regularMarketPrice em tempo real,
// enquanto o historicalDataPrice só atualiza após o fechamento
