// Busca no storage (Blobs) assim a API fica leve
// retorna JSON

// import { getStore } from "@netlify/blobs";
const { getStore } = require("@netlify/blobs");

exports.handler = async function () {
  console.log("📥 get-quotes chamado");
  try {

    console.log("ID do Site existe?", !!process.env.NETLIFY_SITE_ID);
    console.log("Token existe?", !!process.env.NETLIFY_BLOBS_TOKEN);

    const store = getStore({
      name: "quotes",
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_BLOBS_TOKEN
    });

    console.log("🔎 Buscando dados no Blobs...");

    const data = await store.get("latest");

    // 🔥 fallback seguro
    if (!data) {
      console.warn("⚠️ Nenhum dado encontrado no Blobs");
      return {
        statusCode: 200,
        body: JSON.stringify({
          data: { etfs: [], acoes: [] },
          meta: { empty: true, message: "Sem dados ainda" }
        })
      };
    }

    console.log("✅ Dados encontrados");

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60"
      },
      body: data
    };

  } catch (err) {
    console.error("Erro get-quotes:", err);

    return {
      statusCode: 200, // 🔥 nunca 500
      body: JSON.stringify({
        data: { etfs: [], acoes: [] },
        meta: { error: true }
      })
    };
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
