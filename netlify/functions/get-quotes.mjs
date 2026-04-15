// Busca no storage (Blobs) assim a API fica leve
// retorna JSON
// o que o frontend faz leitura esta aqui

import { getStore } from "@netlify/blobs";
// Na V2 deve usar import em vez de require
// const { getStore } = require("@netlify/blobs");
const VERSION = 2;

const ETF_LIST = ["PACB11"]; /* "IRFM11", "IVVB11", "NBIT11",  */
const ACOES = ["ASAI3"];  /* , "BBDC4", "JALL3", "RAIL3", "SIMH3" */
const ALL = [...ETF_LIST, ...ACOES];

export default async (req) => {
  console.log("📥 get-quotes chamado (V2)");

  const url = new URL(req.url);
  const testError = url.searchParams.get("test_error");

  // 🧪 simulação de erro
  if (testError) {
    console.warn(`🚨 Simulando erro ${testError}`);

    const map = {
      "429": { msg: "Rate limit excedido", status: 429 },
      "500": { msg: "Internal Server Error", status: 500 },
      "502": { msg: "Bad Gateway", status: 502 }
    };

    if (map[testError]) {
      return new Response(JSON.stringify({ error: map[testError].msg }), {
        status: map[testError].status,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }
  }

  try {
    const store = getStore({
      name: "teste20",
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_BLOBS_TOKEN
    });

    const results = [];

    console.log("🔎 Lendo cache por ticker...");

    for (const symbol of ALL) {
      try {
        const cached = await store.get(`ticker:${symbol}`, { type: "json" });

        if (cached?.version === VERSION && cached?.data) {
          results.push(cached.data);
        }
      } catch (e) {
        console.warn(`⚠️ Erro lendo ${symbol}`);
      }
    }

    // 🟡 fallback vazio
    if (results.length === 0) {
      console.warn("⚠️ Nenhum cache encontrado");

      return new Response(JSON.stringify({
        data: [],
        meta: { empty: true }
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }

    console.log(`✅ Retornando ${results.length} ativos`);

    return new Response(JSON.stringify({
      data: results,
      total: results.length,
      updatedAt: Date.now()
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60, stale-while-revalidate=30",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    });

  } catch (err) {
    console.error("❌ Erro real:", err.message);

    return new Response(JSON.stringify({
      data: [],
      meta: { error: true, message: err.message }
    }), {
      status: 200, // 🔥 nunca quebra frontend
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

//  O endpoint /list é o correto para filtros como 'type'
//  O endpoint /list retorna 'stocks' da brapi

//  O endpoint /quote/list retorna:   { "stocks": [...]  }
//  O endpoint /quote/{ticker} retorna objeto 'results'

// Se o mercado estiver aberto, a API Brapi atualiza o regularMarketPrice em tempo real,
// enquanto o historicalDataPrice só atualiza após o fechamento
