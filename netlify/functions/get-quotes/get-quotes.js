
//    Código rodará no lado do servidor ou serverless (netlify) navegador NAO
//    Acionado apenas quando o Frontend faz o pedido
//    A chave será lida das variáveis de ambiente do Netlify

//    O endpoint /list é o correto para filtros como 'type'
//    A brapi retorna 'stocks' no endpoint /list

//    if (data.stocks && Array.isArray(data.stocks))
//    O endpoint /quote/list retorna:   { "stocks": [...]  }
//    O endpoint /quote/{ticker} retorna 'results'


let cache = {
  data: null,
  timestamp: 0
};

const CACHE_TIME = 60 * 1000; // 60 segundos

exports.handler = async (event) => {
  const API_TOKEN = process.env.BRAPI_TOKEN;
  const tickers = event.queryStringParameters?.tickers;

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

  // Validaçao se existe ticker
  if (!tickers) {
    return {
      statusCode: 400,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({
        error: "Parâmetro 'tickers' é obrigatório."
      })
    };
  }

  try {

    const tickerList = tickers.split(",");

    const requests = tickerList.map(ticker =>
       fetch(`https://brapi.dev/api/quote/${ticker}?token=${API_TOKEN}`)
        .then(res => res.json())
    );

    const responses = await Promise.all(requests);
    const results = responses.flatMap(r => r.results || []);

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
          "Access-Control-Allow-Origin": "*" // Evita problemas de CORS
        },
        body: JSON.stringify ({ payload }, null, 2),
    };

  } catch (error) {
      return {
        statusCode: 500,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          error: "Falha ao buscar dados",
          details: error.message
        })
      };
  }
};

// https://brapi.dev/docs/acoes.mdx

// Testar essa function no navegador:
// netlify dev
// http://localhost:8888/.netlify/functions/get-quotes?limit=10&type=etf
