//    Código rodará no lado do servidor ou serverless (netlify) navegador NAO
//    Acionado apenas quando o Frontend faz o pedido
//    A chave será lida das variáveis de ambiente do Netlify

//    O endpoint /list é o correto para filtros como 'type'
//    O endpoint /list retorna 'stocks' da brapi

//    O endpoint /quote/list retorna:   { "stocks": [...]  }
//    O endpoint /quote/{ticker} retorna objeto 'results'


const ETF_LIST = [
  "AUPO11","BOVA11","B5P211","GOAT11","IMAB11","IRFM11",
  "IVVB11","LFTB11","NBIT11","NDIV11","POSB11","SMAL11",
  "SPXB11","SPXI11","SPXR11","UTLL11","5PRE11"
];

const tickersB3 = [
  "ALPA4","ASAI3","BBDC4","CAML3","DXCO3","KLBN4",
  "GRND3","JALL3","RAIL3","SIMH3","SLCE3"
];

const ETF_INFO = {
  AUPO11: { description: "NTN-B Inflaçao 2060(9%) e LFT(Tes.Selic) 27/28/30/31" },
  BOVA11: { description: "Replica o IBOV: índice Ibovespa" },
  B5P211: { description: "NTN-B Inflaçao 2026/28/27/29/30" },
  GOAT11: { description: "IMAB11: Inflação (80%) e S&P (19%)" },
  IMAB11: { description: "NTN-Bs Inflação de media e longa duração" },
  IRFM11: { description: "Pre-Fixados: LTN 26/29/31 e NTN-B Inflaçao" },
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

// 🧠 CACHE (mais agressivo)
let cache = { data: null, timestamp: 0 };
const CACHE_TIME = 3 * 60 * 1000; // 130.000 milisegundos = 3 minutos

// ⚡ CONCORRÊNCIA CONTROLADA
const BATCH_SIZE = 2;

  // 🔁 retry
  const fetchWithRetry = async (url, retries = 2, delay = 400) => {
    try {
      const res = await fetch(url);
      const text = await res.text();

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      return JSON.parse(text);
    } catch (err) {
      if (retries === 0) throw err;
      await new Promise(r => setTimeout(r, delay));
      return fetchWithRetry(url, retries - 1, delay * 2);
    }
  };

   // 📦 batches
    const fetchInBatches = async (tickers, token) => {
      const results = [];
      for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
        const batch = tickers.slice(i, i + BATCH_SIZE);

        const responses = await Promise.allSettled(
          batch.map(symbol => {
            const url = `https://brapi.dev/api/quote/${symbol}?range=1y&interval=1d&token=${token}`;
            return fetchWithRetry(url);
          })                 
        );
        const success = responses
          .filter(r => r.status === "fulfilled")
          .map(r => r.value);
      results.push(...success);
      }
      return results;
    }; // final Batches

        // 📉 helpers seguros
    const getCloses = (hist) =>
      hist.map(d => d.close).filter(v => typeof v === "number");
    const getMin = (arr) =>
      arr.length ? Math.min(...arr) : null;
    const getMax = (arr) =>
      arr.length ? Math.max(...arr) : null;
    const getLast = (hist) => {
      const closes = getCloses(hist);
      return closes.length ? closes[closes.length - 1] : null;
    };

    const getVariation = (hist) => {
      const closes = getCloses(hist);
      if (closes.length < 2) return null;
      const last = closes[closes.length - 1];
      for (let i = closes.length - 2; i >= 0; i--) {
        if (closes[i] !== last) {
          return ((last - closes[i]) / closes[i]) * 100;
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
      body: JSON.stringify({ error: "Token não configurado" })
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
    const ALL = [...ETF_LIST, ...tickersB3];

    // ⚡ fetch otimizado (3 meses)
    const responses = await fetchInBatches(ALL, API_TOKEN);
    console.log(JSON.stringify(responses, null, 2));

    // 🔗 juntar tudo
    const allResults = responses
      .filter(item => Array.isArray(item?.results)) // Para cada item na lista, verifique se ele existe e se tem uma lista chamada results dentro dele
      .flatMap(item => item.results); // Para cada item que passou no teste anterior, pegue apenas a lista results e junte tudo em um único array final.

    const results = allResults.map(result => {
      // Validaçao
      if (!result || !result.symbol) {
          return {
            symbol: "N/A",
            logourl: null,
            regularMarketPrice: null,
            min7d: null,
            min30d: null,
            min90d: null
          };
      }
      // FiM Validaçao

      // 1. Prioridade para o logo da API
      // 2. Fallback para a URL padrão de ícones da Brapi
      // A maioria dos servidores de imagem da B3/Brapi
      // prefere o ticker em maiúsculas
      const logoAtivo = result.logourl
        ? result.logourl
        : `https://icons.brapi.dev/icons/${result.symbol.toUpperCase()}.svg`;

      // 🧠 descrição com fallback inteligente
      const description = ETF_INFO[result.symbol]?.description || "Descrição não disponível";
      const hist = Array.isArray(result.historicalDataPrice)
        ? result.historicalDataPrice
        : [];

      const closes = getCloses(hist);

      const last7 = getCloses(hist.slice(-7) );     // extrair os últimos 7 elementos do array hist
      const last30 = getCloses(hist.slice(-30) );
      const last90 = getCloses(hist.slice(-90) );
      const last365 = getCloses(hist.slice(-365) );
      const price = getLast(hist);

        return {
          logourl: logoAtivo,
          symbol: result.symbol,
          name: result.longName || result.shortName || result.symbol,
          description,

          // 🔥 preço vem do histórico (mais confiável)
          regularMarketPrice:
              getLast(hist) ?? result.regularMarketPrice ?? null,

          // 🔥 variação calculada (pegar último dia válido diferente)
          regularMarketChangePercent:
              getVariation(hist),

          // 🔥 Ranges
          regularMarketDayLow: getMin(last7),
          regularMarketDayHigh: getMax(last7),

          fiftyTwoWeekLow:
              result.fiftyTwoWeekLow ?? getMin(closes),

          fiftyTwoWeekHigh:
              result.fiftyTwoWeekHigh ?? getMax(closes),

          // 🎯 principais métricas
          min7d: getMin(last7),
          min30d: getMin(last30),
          min90d: getMin(last90),
          min365: getMin(last365),
          historicalAvailable: closes.length > 0
        };
      });
// final do MAP

    const payload = {
      data: {
        etfs: results.filter(result => ETF_LIST.includes(result.symbol)),
        acoes: results.filter(result => tickersB3.includes(result.symbol))
      },
      meta: {
        updatedAt: now,
        total: results.length
      }
    };

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
        "Cache-Control": "public, max-age=180",
        "X-Cache": "MISS"
      },
      body: JSON.stringify(payload)
    };

  } catch (error) {
    console.error("ERRO:", error);
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
