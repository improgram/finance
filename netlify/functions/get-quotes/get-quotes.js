
//    Código rodará no lado do servidor ou serverless (netlify) navegador NAO
//    Acionado apenas quando o Frontend faz o pedido
//    A chave será lida das variáveis de ambiente do Netlify

//    O endpoint /list é o correto para filtros como 'type'
//    O endpoint /list retorna 'stocks' da brapi

//    O endpoint /quote/list retorna:   { "stocks": [...]  }
//    O endpoint /quote/{ticker} retorna 'results'

const ETF_LIST = [
"B5P211",
"GOAT11",
"IMAB11",
"IRFM11",
"5PRE11"
];

let cache = {
  data: null,
  timestamp: 0
};

const CACHE_TIME = 60 * 1000; // 60 segundos

exports.handler = async (event) => {
  const API_TOKEN = process.env.BRAPI_TOKEN;
  const now = Date.now();

    // se cache ainda válido retorna
  if (cache.data && (now - cache.timestamp < CACHE_TIME)) {
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "X-Cache": "HIT"
      },
      body: JSON.stringify(cache.data)
    };
  }

  try {
    const requests = ETF_LIST.map(async ticker => {
      const res = await fetch(
        `https://brapi.dev/api/quote/${ticker}?token=${API_TOKEN}`
      );
      const json = await res.json();
      return json.results ? json.results[0] : null;
    });

    const results = (await Promise.all(requests)).filter(Boolean);

    const payload = { results };

    // salva no cache
    cache = {
      data: payload,
      timestamp: now
    };

    return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=60",
          "X-Cache": "MISS"
        },
        body: JSON.stringify( payload )
        // Nao funciona { payload }, null, 2
    };

  } catch (error) {
      return {
        statusCode: 500,
        headers: {
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({
          error: "Falha ao buscar dados",
          details: error.message
        })
      };
  }
};
