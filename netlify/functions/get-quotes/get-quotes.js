
//    Código rodará no lado do servidor ou serverless (netlify) navegador NAO
//    Acionado apenas quando o Frontend faz o pedido
//    A chave será lida das variáveis de ambiente do Netlify

//    O endpoint /list é o correto para filtros como 'type'
//    O endpoint /list retorna 'stocks' da brapi

//    O endpoint /quote/list retorna:   { "stocks": [...]  }
//    O endpoint /quote/{ticker} retorna objeto 'results'

const ETF_LIST = [
  "AUPO11",
  "BOVA11",
  "B5P211",
  "GOAT11",
  "IMAB11",
  "IRFM11",
  "LFTB11",
  "NBIT11",
  "NDIV11",
  "POSB11",
  "UTLL11",
  "SMAL11",
  "5PRE11"
];

const ETF_INFO = {
  BOVA11: {
    description: "Replica o índice Ibovespa",
    totalAssets: 10
  },
  SMAL11: {
    description: "Small caps brasileiras",
    totalAssets: 5
  }
};

let cache = {
  data: null,
  timestamp: 0
};

// 🔥 cache maior (reduz chamadas na Brapi)
const CACHE_TIME = 5 * 60 * 1000; // 5 minutos

  // 🔁 retry simples
  const fetchWithRetry = async (url, retries = 2, delay = 500) => {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      if (retries === 0) throw err;
      await new Promise(r => setTimeout(r, delay));
      return fetchWithRetry(url, retries - 1, delay * 2);
    }
  };

  // 📉 menor preço
  const getMinPrice = (data) => {
    if (!Array.isArray(data) || data.length === 0) return null;
    const prices = data
      .map(item => item?.close)
      .filter(v => typeof v === "number");
    return prices.length ? Math.min(...prices) : null;
  };

exports.handler = async () => {
  const API_TOKEN = process.env.BRAPI_TOKEN;
  const now = Date.now();
  if (!API_TOKEN) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Token da BRAPI não configurado" })
    };
  }
  // 🧠 CACHE HIT
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
    // 🔥 1 request por ativo (PLANO FREE)
    const requests = ETF_LIST.map(symbol => {
    const urlBase = `https://brapi.dev/api/quote/${symbol}?range=3mo&interval=1d&token=${API_TOKEN}`;
    const urlWithModules = `${urlBase}&modules=summaryProfile,defaultKeyStatistics`;

    return fetchWithRetry(urlWithModules)
      .catch(async () => {
        console.warn("Fallback sem modules:", symbol);
        return fetchWithRetry(urlBase);
      })
      .catch(err => {
        console.error("Erro ao buscar ETF:", symbol, err.message);
        return null;
      });
  });

    const responses = await Promise.all(requests);

    // 🔗 junta tudo
    const allResults = responses
      .filter(r => r && Array.isArray(r.results))
      .flatMap(r => r.results);

    const results = allResults.map(result => {
      if (!result || !result.symbol)      // Validaçao
        {
          return
            {
            symbol: "N/A",
            name: "Não encontrado",
            regularMarketPrice: 0,
            min7d: null,
            min30d: null,
            min60d: null,
            historicalAvailable: false
            };
        }

        if (!result.summaryProfile) {
          console.warn("Sem summaryProfile:", result.symbol);
        }

        if (!result.defaultKeyStatistics) {
          console.warn("Sem defaultKeyStatistics:", result.symbol);
        }

      // 🧠 descrição com fallback inteligente
      const description =
        result.summaryProfile?.longBusinessSummary ||
        ETF_INFO[result.symbol]?.description ||
        "Descrição não disponível";

      // 🧠 patrimônio líquido com fallback em camadas
      const totalAssets =
        result.defaultKeyStatistics?.totalAssets ??   // 1️⃣ API (melhor fonte)
        result.marketCap ??                           // 2️⃣ fallback automático
        ETF_INFO[result.symbol]?.totalAssets ??       // 3️⃣ fallback manual
        null;

      const hist = Array.isArray(result.historicalDataPrice)
          ? result.historicalDataPrice
          : [];
      const historicalAvailable = hist.length > 0;
      const last7 = hist.slice(-7);
      const last30 = hist.slice(-30);

        return {
          symbol: result.symbol,
          name: result.longName || result.shortName || result.symbol,
          description,
          totalAssets,
          regularMarketPrice:
            typeof result.regularMarketPrice === "number"
              ? result.regularMarketPrice
                : 0,
          regularMarketChangePercent:
            typeof result.regularMarketChangePercent === "number"
              ? result.regularMarketChangePercent
                : null,
          regularMarketDayRange: result.regularMarketDayRange ?? null,
          regularMarketDayLow: result.regularMarketDayLow ?? null,
          regularMarketDayHigh: result.regularMarketDayHigh ?? null,
          fiftyTwoWeekLow: result.fiftyTwoWeekLow ?? null,
          fiftyTwoWeekHigh: result.fiftyTwoWeekHigh ?? null,
          min7d: historicalAvailable ? getMinPrice(last7) : null,
          min30d: historicalAvailable ? getMinPrice(last30) : null,
          min60d: historicalAvailable ? getMinPrice(hist) : null,
          historicalAvailable
        };
      });   // Map final

    const payload = { results };

    // 💾 salva cache
    cache = {
      data: payload,
      timestamp: now
    };

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
        "X-Cache": "MISS"
      },
      body: JSON.stringify(payload)
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
