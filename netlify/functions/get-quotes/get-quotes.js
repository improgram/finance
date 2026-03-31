//    Código rodará no lado do servidor ou serverless (netlify) navegador NAO
//    Acionado apenas quando o Frontend faz o pedido
//    A chave será lida das variáveis de ambiente do Netlify

//    O endpoint /list é o correto para filtros como 'type'
//    O endpoint /list retorna 'stocks' da brapi

//    O endpoint /quote/list retorna:   { "stocks": [...]  }
//    O endpoint /quote/{ticker} retorna objeto 'results'

const ETF_LIST = [
  "AUPO11","BOVA11","B5P211","GOAT11","IMAB11","IRFM11",
  "LFTB11","NBIT11","NDIV11","POSB11","SMAL11",
  "UTLL11","5PRE11"
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
const CACHE_TIME = 3 * 60 * 1000; // 180.000 milisegundos = 3 minutos

// Função auxiliar para criar delay
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 🔁 retry
const fetchWithRetry = async (url, retries = 2, delay = 400) => {
  try {
    const res = await fetch(url);
    const text = await res.text();

    if (!res.ok) {
      console.error("HTTP ERROR:", res.status, text);
      throw new Error(`HTTP ${res.status}`);
    }

    return JSON.parse(text);
  } catch (err) {
    if (retries === 0) throw err;
    await sleep(delay); // Aguarda antes de tentar novamente
    return fetchWithRetry(url, retries - 1, delay * 2);
  }
};

// 📉 helpers
const getCloses = (hist) => // remove zeros inválidos
  hist.filter(d => d && typeof d.close === "number" && d.close > 0 && isFinite(d.close))
      .map(d => d.close);

const getMin = (arr) => Array.isArray(arr) && arr.length ? Math.min(...arr) : null;
const getMax = (arr) => Array.isArray(arr) && arr.length ? Math.max(...arr) : null;

const getLastValid = (hist) => {
  const closes = getCloses(hist);
  if (!closes.length) return null;
  const last = closes[closes.length - 1];
  for (let i = closes.length - 2; i >= 0; i--) {
    if (closes[i] !== last) return last;
  }
  return last;
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

const getBestPrice = (hist, quotePrice) => {
      const closes = getCloses(hist);
      if (!closes.length && quotePrice > 0) return quotePrice;
      const lastHist = closes[closes.length - 1];

      if (!lastHist || lastHist <= 0) return quotePrice ?? null;
      if (!quotePrice || quotePrice <= 0) return lastHist;

      const diff = Math.abs((quotePrice - lastHist) / lastHist) * 100;

      if (diff < 2) return lastHist;
      return quotePrice;
};

const getVariationFromArray = (arr) => {
  if (!Array.isArray(arr) || arr.length < 2) return null;

  const last = arr[arr.length - 1];

  for (let i = arr.length - 2; i >= 0; i--) {
    if (arr[i] !== last) {
      return ((last - arr[i]) / arr[i]) * 100;
    }
  }
  return 0;
};


exports.handler = async (event, context) => {
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
    const ALL = ETF_LIST.concat(tickersB3);
    const allResults = [];

    // ⚡ REQUEST SEQUENCIAL CONTROLADO: 1 ativo por vez com delay
    console.log(`Buscando ${ALL.length} ativos sequencialmente...`);

    for (const symbol of ALL) {   // range=3y nao disponivel
      try {
        const url = `https://brapi.dev/api/quote/${symbol}?range=3mo&interval=1d&token=${API_TOKEN}`;
        const response = await fetchWithRetry(url);

        if (response && response.results && response.results.length > 0) {
          allResults.push(...response.results);
        } else {
          console.warn(`Sem results para ticker: ${symbol}`);
        }
      } catch (err) {
        console.error(`Falha ao buscar ticker ${symbol}:`, err.message);
      }

      // ⏱️ Pausa de 150ms entre cada requisição para evitar Erro 429 (Too Many Requests)
      await sleep(150);
    }

    if (allResults.length === 0) {
      throw new Error("Nenhum dado retornado pela API após processar os tickers.");
    }

    const results = [];
      for (let i = 0; i < allResults.length; i++) {
        const result = allResults[i];
        if (!result || !result.symbol) continue;

        const logoAtivo = result.logourl
          ? result.logourl
          : `https://icons.brapi.dev/icons/${result.symbol.toUpperCase()}.svg`;

        const description = (ETF_INFO[result.symbol] && ETF_INFO[result.symbol].description)
          ? ETF_INFO[result.symbol].description : "Descrição não disponível";

        const hist = Array.isArray(result.historicalDataPrice) ? result.historicalDataPrice : [];
        if (!hist.length) console.warn(`Sem histórico para ${result.symbol}`);

        const closes = getCloses(hist);
        const last7 = getCloses(hist.slice(-7) || [] );
        const last30 = getCloses(hist.slice(-30) || [] );
        const last90 = getCloses(hist.slice(-90) || [] );
        const last365Raw = hist.slice(-365);
        const last365 = last365Raw.length ? getCloses(last365Raw) : closes;
        const variation30d = getVariationFromArray(last30);
        const variation = getVariation(hist);

        results.push({
          logourl: logoAtivo,
          symbol: result.symbol,
          name: result.longName || result.shortName || result.symbol,
          description,
          regularMarketPrice: getBestPrice(hist,result.regularMarketPrice),
          regularMarketChangePercent: variation !== null ? variation : result.regularMarketChangePercent ?? null,
          regularMarketDayLow: result.regularMarketDayLow ?? getMin(last7) ?? null,
          regularMarketDayHigh: result.regularMarketDayHigh ?? getMax(last7) ?? null,
          fiftyTwoWeekLow: result.fiftyTwoWeekLow ?? getMin(last365) ?? null,
          fiftyTwoWeekHigh: result.fiftyTwoWeekHigh ?? getMax(last365) ?? null,
          min7d: getMin(last7) ?? null,
          min30d: getMin(last30) ?? null,
          min90d: getMin(last90) ?? null,
          min365: getMin(last365) ?? null,
          variation30d: variation30d,
          historicalAvailable: closes.length > 0
        });
    }

    const payload = {
      data: {
        etfs: results.filter(r => ETF_LIST.indexOf(r.symbol) !== -1),
        acoes: results.filter(r => tickersB3.indexOf(r.symbol) !== -1)
      },
      meta: {
        updatedAt: now,
        total: results.length
      }
    };

    // 💾 salva cache
    cache = { data: payload, timestamp: now };

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
      body: JSON.stringify({ error: "Falha ao buscar dados", details: error.message })
    };
  }
};
