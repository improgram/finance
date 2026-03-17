
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

// calcula menor preço
const getMinPrice = (data) => {
  if (!data || !data.length) return null;

  const prices = data
    .map(item => item.close)
    .filter(v => typeof v === "number");

  return prices.length ? Math.min(...prices) : null;
};

exports.handler = async (event) => {
  const API_TOKEN = process.env.BRAPI_TOKEN;

   const now = Date.now();

  if (!API_TOKEN) {     // Se token não configurado
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Token da BRAPI não configurado"
      })
    };
  }

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
    const tickers = ETF_LIST.join(",");

    const response = await fetch(
      `https://brapi.dev/api/quote/${tickers}?range=2mo&interval=1d&modules=historicalDataPrice&token=${API_TOKEN}`
    );
    const json = await response.json();

    console.log("BRAPI RESPONSE:", json);

    if (!json || !Array.isArray(json.results)) {
      throw new Error("Resposta inválida da API");
    }

    const results = json.results.map(result => {
        if (!result) {
          return {
          symbol: "N/A",
          name: "Não encontrado",
          historicalAvailable: false
          };
        }

         // 🔹 verifica se o histórico existe
        const hist = Array.isArray(result.historicalDataPrice) ? result.historicalDataPrice : null;
        const historicalAvailable = !!hist;

        const last7 = hist?.slice(-7) || [];
        const last30 = hist?.slice(-30) || [];

        return {
          symbol: result.symbol,
          name: result.longName || result.shortName,
          logourl: result.logourl,

          regularMarketPrice: result.regularMarketPrice,
          regularMarketDayRange: result.regularMarketDayRange,
          regularMarketDayLow: result.regularMarketDayLow,
          regularMarketDayHigh: result.regularMarketDayHigh,
          fiftyTwoWeekLow: result.fiftyTwoWeekLow,
          fiftyTwoWeekHigh: result.fiftyTwoWeekHigh,

          min7d: getMinPrice(last7),
          min30d: getMinPrice(last30),
          min60d: getMinPrice(hist)

          // 🔹 flag indicando se histórico está disponível
          historicalAvailable
        };
      });

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
    console.error("ERRO:", error);
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
