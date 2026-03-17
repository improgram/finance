
//    Código rodará no lado do servidor ou serverless (netlify) navegador NAO
//    Acionado apenas quando o Frontend faz o pedido
//    A chave será lida das variáveis de ambiente do Netlify

//    O endpoint /list é o correto para filtros como 'type'
//    O endpoint /list retorna 'stocks' da brapi

//    O endpoint /quote/list retorna:   { "stocks": [...]  }
//    O endpoint /quote/{ticker} retorna objeto 'results'

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

    const getMinPrice = (historicalData) => {
      if (!historicalData || !historicalData.length) return null;
      return Math.min(...historicalData.map(item => item.close).filter(Boolean));
    };

    const requests = ETF_LIST.map(async ticker => {
      // preço atual
      const quoteRes = await fetch(
        `https://brapi.dev/api/quote/${ticker}?token=${API_TOKEN}`
      );

      const quoteJson = await quoteRes.json();
      const quote = quoteJson.results ? quoteJson.results[0] : null;

      if (!quote) return null;

      // histórico
      const [res7d, res30d, res60d] = await Promise.all([
        fetch(`https://brapi.dev/api/quote/${ticker}?range=7d&interval=1d&token=${API_TOKEN}`),
        fetch(`https://brapi.dev/api/quote/${ticker}?range=1mo&interval=1d&token=${API_TOKEN}`),
        fetch(`https://brapi.dev/api/quote/${ticker}?range=2mo&interval=1d&token=${API_TOKEN}`)
      ]);

      const json7d = await res7d.json();
      const json30d = await res30d.json();
      const json60d = await res60d.json();

      const hist7d = json7d.results?.[0]?.historicalDataPrice || [];
      const hist30d = json30d.results?.[0]?.historicalDataPrice || [];
      const hist60d = json60d.results?.[0]?.historicalDataPrice || [];

        return {
          ...quote,
          min7d: getMinPrice(hist7d),
          min30d: getMinPrice(hist30d),
          min60d: getMinPrice(hist60d)
        };
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

  }
  catch (error) {
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
