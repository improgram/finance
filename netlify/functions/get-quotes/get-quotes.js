//    Código rodará no lado do servidor ou serverless (netlify) navegador NAO
//    Acionado apenas quando o Frontend faz o pedido
//    A chave será lida das variáveis de ambiente do Netlify

//    O endpoint /list é o correto para filtros como 'type'
//    O endpoint /list retorna 'stocks' da brapi

//    O endpoint /quote/list retorna:   { "stocks": [...]  }
//    O endpoint /quote/{ticker} retorna objeto 'results'

const ETF_LIST = [
  "AUPO11", "BOVA11", "B5P211", "GOAT11", "IMAB11", "IRFM11",
  "IVVB11", "LFTB11", "NBIT11", "NDIV11", "POSB11", "SMAL11",
  "SPXB11", "SPXI11", "SPXR11", "UTLL11", "5PRE11"
];

const tickersB3 = [ "ALPA4", "ASAI3", "BBDC4", "CAML3", "DXCO3", "KLBN4",
                    "GRND3", "JALL3", "RAIL3", "SIMH3", "SLCE3" ];

const ETF_INFO = {
  AUPO11: { description: "NTN-B Inflaçao 2060(9%) e LFT(Tes.Selic) 27/28/30/31" },
  BOVA11: { description: "Replica o índice Ibovespa" },
  B5P211: { description: "NTN-B Inflaçao 2026/28/27/29/30" },
  GOAT11: { description: "IMAB11: Inflação(80%) e S&P (500 Maiores dos EUA) (19%)" },
  IMAB11: { description: "Inflação (NTN-Bs) media e longa" },
  IRFM11: { description: "Pre-Fixados (LTN 26/29/31) e NTN-B Inflaçao" },
  IVVB11: { description: "S&P 500 (500 Maiores dos EUA)" },
  LFTB11: { description: "Tesouro Selic (LFT 27/28/29/30/2060)" },
  NBIT11: { description: "Futuros Nu Nasdaq Brazil Bitcoin" },
  NDIV11: { description: "Dividendos de grandes empresas" },
  POSB11: { description: "Tesouro Selic (LFT) (91%) e IPCA longo(9%)" },
  SMAL11: { description: "Small caps brasileiras" },
  SPXB11: { description: "S&P 500 (500 Maiores dos EUA)" },
  SPXI11: { description: "S&P 500 (500 Maiores dos EUA)" },
  SPXR11: { description: "Tesouro Selic (LFT) 2026/27/28/29" },
  UTLL11: { description: "Sabesp Axia, Equatorial, Copel, Eneva, Cemig, Engie, Sanepar" },
"5PRE11": { description: "Pre-Fixados: NTN-F(49%) e Pre-Fix:LTN 2029 (51%)" }
};

let cache = { data: null, timestamp: 0 };

// 🔥 cache maior (reduz chamadas na Brapi)
const CACHE_TIME = 2 * 60 * 1000; // 120.000 milisegundos =  2 minutos

  // 🔁 retry simples
  const fetchWithRetry = async (url, retries = 2, delay = 500) => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
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

  // 📈 último preço válido
  const getLastPrice = (data) => {
    if (!Array.isArray(data) || data.length === 0) return null;
    const last = data[data.length - 1];
    return typeof last?.close === "number" ? last.close : null;
  };

  // 📊 variação (%)
  const getDailyVariation = (hist) => {
  if (!Array.isArray(hist) || hist.length < 2) return null;

  const last = hist[hist.length - 1]?.close;

  // procura o último preço diferente
  for (let i = hist.length - 2; i >= 0; i--) {
    const prev = hist[i]?.close;
    if (typeof prev === "number" && prev !== last) {
      return ((last - prev) / prev) * 100;
    }
  }

  return 0;
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
    const ALL_TICKERS = [...ETF_LIST, ...tickersB3];
    const requests = ALL_TICKERS.map(symbol => {
      const urlBase = `https://brapi.dev/api/quote/${symbol}?range=3mo&interval=1d&token=${API_TOKEN}`;
      return fetchWithRetry(urlBase);
    });

    const responses = await Promise.all(requests);
    console.log(JSON.stringify(responses, null, 2));

    // 🔗 junta tudo
    const allResults = responses
      .filter(item => item && Array.isArray(item.results)) // Para cada item (r) na lista, verifique se ele existe e se tem uma lista chamada results dentro dele
      .flatMap(item => item.results); // Para cada item que passou no teste anterior, pegue apenas a lista results e junte tudo em um único array final.

    const results = allResults.map(result => {
      if (!result || !result.symbol) {          // Validaçao
          return {
            symbol: "N/A",
            regularMarketPrice: null,
            min7d: null,
            min30d: null,
            min90d: null
          };
      }

      // 🧠 descrição com fallback inteligente
      const description = ETF_INFO[result.symbol]?.description || "Descrição não disponível";
      const hist = Array.isArray(result.historicalDataPrice) ? result.historicalDataPrice : [];
      const last7 = hist.slice(-7);
      const last30 = hist.slice(-30);
      const last90 = hist.slice(-90);
      const price = getLastPrice(hist);

        return {
          logourl: `https://icons.brapi.dev/icons/${result.symbol.toLowerCase()}.svg`,
          symbol: result.symbol,
          name: result.longName || result.shortName || result.symbol,
          description,

          // 🔥 preço vem do histórico (mais confiável)
          regularMarketPrice: price ?? result.regularMarketPrice ?? 0,

          // 🔥 variação calculada (pegar último dia válido diferente)
          regularMarketChangePercent: getDailyVariation(hist)
          ?? result.regularMarketChangePercent ?? null,

          // 🔥 ranges
          regularMarketDayLow: last7.length ? getMinPrice(last7) : null,
          regularMarketDayHigh: last7.length
            ? Math.max(...last7.map(d => d.close || 0))
            : null,

          fiftyTwoWeekLow: getMinPrice(hist),
          fiftyTwoWeekHigh: hist.length
            ? Math.max(...hist.map(d => d.close || 0))
            : null,

          // 🎯 principais métricas
          min7d: getMinPrice(last7),
          min30d: getMinPrice(last30),
          min90d: getMinPrice(last90),

          historicalAvailable: hist.length > 0

        };
      });
// final do MAP

    const etfs = results.filter(r => ETF_LIST.includes(r.symbol));
    const acoes = results.filter(r => tickersB3.includes(r.symbol));

    const payload = { etfs, acoes };

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
