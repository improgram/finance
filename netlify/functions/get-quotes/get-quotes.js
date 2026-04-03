// Busca no storage (Blobs) assim a API fica leve
// retorna JSON

import { getStore } from "@netlify/blobs";

export async function handler() {
  try {
    const store = getStore({
      name: "quotes",
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_BLOBS_TOKEN
    });
    const data = await store.get("latest");

    // 🔥 fallback seguro
    if (!data) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          data: { etfs: [], acoes: [] },
          meta: { empty: true, message: "Sem dados ainda" }
        })
      };
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60"
      },
      body: data
    };

  } catch (err) {
    console.error("Erro real:", err);

    return {
      statusCode: 200, // 🔥 nunca 500
      body: JSON.stringify({
        data: { etfs: [], acoes: [] },
        meta: { error: true }
      })
    };
  }
}


//  Código rodará no lado do servidor ou serverless (netlify) NAO no navegador
//  Acionado apenas quando o Frontend faz o pedido
//  A chave será lida das variáveis de ambiente do Netlify

//  O endpoint /list é o correto para filtros como 'type'
//  O endpoint /list retorna 'stocks' da brapi

//  O endpoint /quote/list retorna:   { "stocks": [...]  }
//  O endpoint /quote/{ticker} retorna objeto 'results'

// Se o mercado estiver aberto, a API Brapi atualiza o regularMarketPrice em tempo real,
// enquanto o historicalDataPrice só atualiza após o fechamento
