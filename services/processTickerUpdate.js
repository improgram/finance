
// Está dentro da pasta services/ precisa subir um nível (..) no import
// para sair de services e voltar para a raiz e só depois então entrar em helpers/

// pipeline principal + orchestrator + coordinator + state machine
// cache+providers+merge+fallback+cálculo+persistência+snapshot+validação
// Dentro do processTickerUpdate fica: fetch + fallback + seleção de fonte + histórico bruto

import { MAX_ITEMS, COOLDOWN_429, ETF_INFO } from "../helpers/constants.js";
import { normalizeMarketData, mergeHistoricalData } from "../helpers/marketMerge.js";
import { fetchMarketData } from "../helpers/providers.js";
import { getGlobal429 } from "../helpers/cache.js";
import { getNextTicker, validateTicker} from "../helpers/tickers.js";
import { getCacheTTL } from "../helpers/time.js";
import { calculateMetrics } from "../helpers/calculaMetrics.js";

import {
  sleep,
  getFormattedDateTime,
  safeValue,
  safeNumber,
  filterByDays,
  getCloses,
  safeSet,
  safeGet,
  normalizeStorage,
  destacarPalavraEmTodoOObjeto
} from "../helpers/helpers.js";


//-----  ✅ cache estático (executa 1 vez no load do module)
const palavras = {
  inflação: "#ff5722",
  Pré: "#34495e",
  fixado: "#34495e",
  Selic: "#a47864",
  Curto: "#fe7c8c",
  Medio: "#a66bff",
  Longo: "#a43679",
  Bitcoin: "#f7931a"
};

const SNAP_KEY = "last-valid-snapshot";
const etfInfoFormatado = destacarPalavraEmTodoOObjeto( ETF_INFO, palavras );

export const processTickerUpdate  = async ( { store, apiToken, tickers } ) => {
  if (!Array.isArray(tickers) || tickers.length === 0) {
    console.warn("⚠️ tickers inválidos ou vazios");
    return { ok: false, reason: "tickers inválidos" };
  }

  const symbol = await getNextTicker(store, tickers);
  if (!symbol) {
    return { ok: false, reason: "fila vazia" };
  }

  if (!validateTicker(symbol)) {
    console.warn("⚠️ ticker inválido:", symbol);
    return {
      ok: false,
      reason: "invalid-symbol"
    };
  }

  // - CACHE FIRST => ⚡ cache válido (saída imediata)
  const cacheKey = `snapshot-${symbol}`;
  const cached = await safeGet(store, cacheKey);

  if ( cached && typeof cached.updatedAt === "number" &&
    Date.now() - cached.updatedAt < getCacheTTL()
  ) {
    console.log("⚡ Cache hit valido:", symbol, cached.source);
    return { ok: true, symbol, source: "✅ cache-fresh", data: cached };
    }

  // Proteção global contra flood após 429 e timestamp inválido
  // cooldown compartilhado entre Alpha e RapidAPI
  // Mas são APIs diferentes.
  // Então um 429 da Alpha bloqueia RapidAPI também
  // Necessario implementar: global429-alpha e global429-rapid

  const global429 = await getGlobal429(store);
  if (global429 > 0) {
    const elapsed = Date.now() - global429;
    if (elapsed < COOLDOWN_429) {
      console.warn("⛔ cooldown global ativo");
      if (!cached) {
        return { ok: false, reason: "rate-limited" };
      }
      return { ok: true, symbol, source: "❌ global-429", data: cached };
    }
  }

  // Só dormir se não tiver cache
  // ⛔ anti-burst obrigatório (BRAPI free / Yahoo)
  if (!cached) await sleep(300);

  // ------------- Bloco do Fetch ------------------------------
  const result = await fetchMarketData(symbol, store, apiToken);
  let data = result?.data;
  let source = result?.source;

  //------ Falback = cache antigo = Evitar side-effect silencioso
  // ----- cached vem do snapshot e não da API
  if (!data && cached) {
      source = "Cache Antigo";
      data = cached.data ?? cached;
  }

  //---------- 🧠 ATUALIZA SNAPSHOT CONSOLIDADO
  const prev = await safeGet(store, SNAP_KEY);
  const prevArray = normalizeStorage(prev).data;

  // snapshot anterior do ticker
  const previousTickerSnapshot = prevArray.find( i => i?.symbol === symbol );
  const previousPrice = safeNumber(previousTickerSnapshot?.regularMarketPrice);

  // ---------------------
  const mergedData = normalizeMarketData({ symbol, data });
  const normalizedPrice = safeNumber(mergedData.regularMarketPrice);

  if (!Number.isFinite(normalizedPrice) || normalizedPrice <= 0) {
      return { ok: false, reason: "Sem Dados" };
  }

  // depois do merge = prioridade: 1. API (Yahoo ou BRAPI) e 2. cálculo via histórico
  const mergedHist = mergeHistoricalData(result)?.mergedHist ?? [];
  const currentPrice = safeNumber(mergedData.regularMarketPrice );

  // true = preço não mudou
  const unchangedPrice = Number.isFinite(previousPrice) && Number.isFinite(currentPrice)
      && Math.abs(previousPrice - currentPrice) < 0.0001;

  // ------ Utiliza o return do calculaMetrics -----------------------------------
  const calcResult = calculateMetrics({
    mergedData,
    mergedHist,
    cached,
    data
  });

  if (!calcResult.ok) {
    return calcResult;
  }

const {
  price,
  avgVolumeCalc,
  min7d,
  min30d,
  variation30d,
  previousCloseSafe,
  changePercent,
  regularMarketDayLow,
  regularMarketDayHigh,
  fiftyTwoWeekLow,
  fiftyTwoWeekHigh,
  usingCalculated,
  changeSource
} = calcResult.metrics;


  // ------ Payload --------------
  const payload = {
    source,
    symbol,
    shortName: mergedData.shortName,
    longName: mergedData.longName,
    regularMarketPrice: price,
    changePercent,
    volume: safeValue(mergedData.volume),
    averageVolume: avgVolumeCalc,
    min7d,
    min30d,
    variation30d,
    regularMarketDayLow,
    regularMarketDayHigh,
    fiftyTwoWeekLow,
    fiftyTwoWeekHigh,
    previousClose: previousCloseSafe,
    unchangedPrice,
    changeSource,
    updatedAt: Date.now(),
    updatedLabel: getFormattedDateTime(),
    description: etfInfoFormatado[symbol]?.description || "Ativo Financeiro",
    logourl: data?.logourl || `https://icons.brapi.dev/icons/${symbol}.svg`,
    historicalDataPrice: mergedHist.slice(-90)
  };

  // ----- salva cache principal => safeSet do snapshot individual
  await safeSet(store, `snapshot-${symbol}`, payload);

  try {
    let newSnapshot = [];
    if (prevArray.length) {
      const map = new Map(
        prevArray
        .filter(i => i?.symbol)
        .map(i => [i.symbol, i])
      );
        map.set(symbol, payload);
        newSnapshot = Array.from(map.values())
          .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
          .slice(0, MAX_ITEMS);
      } else {
        newSnapshot = [payload];
      }
    await safeSet(store, SNAP_KEY,
        {
          data: newSnapshot,
          updatedAt: Date.now()
        }
    );
    console.log("💾 SNAPSHOT WRITE OK:", {
      symbol,
      updatedAt: Date.now(),
      finalSize: newSnapshot?.length
    });
  } catch (err) {
    console.warn("⚠️ erro ao atualizar snapshot:", err.message);
  }

  // -------------✅ Retorno no painel Netlify ✅---------
  console.log(`💾 SALVANDO ${symbol} → source: ${source} 💾`);

  return { ok: true,
    symbol,
    source,
    data: payload,
    meta: {
      updatedAt: Date.now(),
      updatedLabel: getFormattedDateTime(),
      etfInfo: etfInfoFormatado
    }
  };
};

// Fim do processTickerUpdate
