// Busca no storage (Blobs) assim a API fica leve
// retorna JSON

import { getStore } from "@netlify/blobs";
// Na V2, você deve usar import em vez de require
// const { getStore } = require("@netlify/blobs");

export default async (req, context) => {
  console.log("📥 get-quotes chamado (V2)");
  try {

    console.log("ID do Site existe?", !!process.env.NETLIFY_SITE_ID);
    console.log("Token existe?", !!process.env.NETLIFY_BLOBS_TOKEN);

    const store = getStore({
      name: "quotes",
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_BLOBS_TOKEN
    });

    console.log("🔎 Buscando dados no Blobs...");

    const data = await store.get("latest", { type: "json" });

    // 🔥 fallback seguro
    if (!data) {
      console.warn("⚠️ Nenhum dado encontrado no Blobs");
      return {
        statusCode: 200,
        body: JSON.stringify({
          data: { etfs: [], acoes: [] },
          meta: { empty: true, message: "Sem dados ainda" }
        }, null, 2)
      };
    }

    console.log("✅ Dados encontrados");
    const responseBody = typeof data === 'string' ? JSON.parse(data) : data;

    return new Response(JSON.stringify(data), {     // null, 2
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60, stale-while-revalidate=30",
        "Access-Control-Allow-Origin": "*", // Permite chamadas de qualquer origem
        "Access-Control-Allow-Headers": "Content-Type",
        "Content-Type": "application/json"
      }
    });

  } catch (err) {
    console.error("Erro get-quotes:", err);

    return new Response (
      JSON.stringify({
        data: { etfs: [], acoes: [] },
        meta: { error: true, message: err.message }
      }),
      {
        status: 200, // 🔥 nunca 500
        headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60, stale-while-revalidate=30",
        "Access-Control-Allow-Origin": "*", // Permite chamadas de qualquer origem
        "Access-Control-Allow-Headers": "Content-Type",
        "Content-Type": "application/json"
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
