
// pipeline principal + orchestrator + coordinator + state machine
// cache+providers+merge+fallback+cálculo+persistência+snapshot+validação

// ERA EXEC: Leitura linear:  lock - exec - timeout - race
// Era exec() deve retornar apenas dados = não usa createResponse
// services -> regras de negócio

// Como ele está dentro da pasta services/...
// ele precisa subir um nível (..)
// para sair de services e voltar para a raiz
//  para só então entrar em helpers/

import {
  MAX_ITEMS,
  COOLDOWN_429,
  ETF_INFO
} from "../helpers/constants.js";

import {
  sleep,
  getFormattedDateTime,
  getMin,
  getVariation30d,
  getDailyVariation,
  getDayRangeFromHist,
  get52WeekRangeFromHist,
  safeValue,
  safeNumber,
  filterByDays,
  getCloses,
  safeSet,
  safeGet,
  normalizeStorage,
} from "../helpers/helpers.js";

import { fetchMarketData } from "../helpers/providers.js";
import { getGlobal429 } from "../helpers/cache.js";
import { getNextTicker, validateTicker} from "../helpers/tickers.js";
import { getCacheTTL } from "../helpers/time.js";

import {
  merged,
  mergeHistoricalData
} from "../helpers/marketMerge.js";

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

  // --------- proteção global contra flood após 429 e timestamp inválido
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
      data = cached;
  }

  // ------------ Fallback final absoluto-----------------
  const normalizedPrice = safeNumber(merged.regularMarketPrice);

  if (!Number.isFinite(normalizedPrice) || normalizedPrice <= 0) {
      return { ok: false, reason: "Sem Dados" };
  }


  // depois do merge = prioridade: 1. API (Yahoo ou BRAPI) e 2. cálculo via histórico
  const mergedHist = [...candleMap.values()].sort((a,b) => a.date - b.date);

  // último candle disponível
  const latestCandle = mergedHist.length ? mergedHist[mergedHist.length - 1] : null;

  // valida sessão real de negociação
  const hasValidTradingSession = latestCandle && safeNumber(latestCandle.volume) > 0 &&
    safeNumber(latestCandle.low) > 0 && safeNumber(latestCandle.high) > 0;


  const previousCloseCalc = mergedHist.length >= 2 ? mergedHist[mergedHist.length - 2]?.close ?? null : null;
  const avgVolumeCalc = mergedHist.length ? Math.round(
        mergedHist.reduce((acc, d) => acc + (d.volume || 0), 0) / mergedHist.length ) : null;
  const min7d = mergedHist.length ? getMin(getCloses(filterByDays(mergedHist, 7))) : null;
  const min30d = mergedHist.length ? getMin(getCloses(filterByDays(mergedHist, 30))) : null;

  const price = safeNumber(merged.regularMarketPrice);
        if (!Number.isFinite(price) || price <= 0) {
          return { ok: false, reason: "invalid-price" };
        }

  const variation30d = getVariation30d(mergedHist, price);
  const calcDaily = getDailyVariation(mergedHist, price);
  const rawChange = merged?.changePercent;
  const yahooChange = rawChange === null || rawChange === undefined || rawChange === "" ? null : safeNumber(rawChange);
  const normalizedPreviousClose = safeNumber(merged.previousClose);
  const previousCloseSafe = Number.isFinite(normalizedPreviousClose) && normalizedPreviousClose > 0 ? normalizedPreviousClose
          : previousCloseCalc > 0 ? previousCloseCalc : null;
  const realCalculatedChange = previousCloseSafe && previousCloseSafe > 0
          ? ((price - previousCloseSafe) / previousCloseSafe) * 100 : null;

  const DIFF_TOLERANCE = 0.5;
  const HARD_DIFF_TOLERANCE = 1.2;
  const calculatedChange = realCalculatedChange ?? calcDaily ?? null;
  const diff = calculatedChange != null && yahooChange != null ? Math.abs(yahooChange - calculatedChange) : 0;
  const yahooBroken = yahooChange == null || !Number.isFinite(yahooChange) || Math.abs(yahooChange) > 40 ||
    ( realCalculatedChange != null && Math.abs(yahooChange - realCalculatedChange) > HARD_DIFF_TOLERANCE );
  const usingCalculated = yahooBroken || diff > DIFF_TOLERANCE;
  const finalChange = usingCalculated && Number.isFinite(calculatedChange) ? calculatedChange : yahooChange;
  const changePercent = Number.isFinite(finalChange) ? safeNumber(finalChange.toFixed(2)) : null;
  const normalizePrice = (v) => { const n = safeNumber(v); return Number.isFinite(n) && n > 0 ? n : null; };
  const dayRangeCalc = hasValidTradingSession ? getDayRangeFromHist(mergedHist) :
    {low: cached?.regularMarketDayLow ?? null, high: cached?.regularMarketDayHigh ?? null};

  const week52Calc = get52WeekRangeFromHist(mergedHist);
  const dayLow = normalizePrice(dayRangeCalc.low) ?? normalizePrice(data?.regularMarketDayLow) ?? normalizePrice(cached?.regularMarketDayLow) ?? null;
  const dayHigh = normalizePrice(dayRangeCalc.high) ?? normalizePrice(data?.regularMarketDayHigh) ?? normalizePrice(cached?.regularMarketDayHigh) ?? null;
  const fiftyTwoWeekLow = safeValue(data?.fiftyTwoWeekLow ?? week52Calc.low);
  const fiftyTwoWeekHigh = safeValue(data?.fiftyTwoWeekHigh ?? week52Calc.high);

  // 🧠 ATUALIZA SNAPSHOT CONSOLIDADO
  const SNAP_KEY = "last-valid-snapshot";
  const prev = await safeGet(store, SNAP_KEY);
  const prevArray = normalizeStorage(prev).data;

  // snapshot anterior do ticker
  const previousTickerSnapshot = prevArray.find( i => i?.symbol === symbol );
  const previousPrice = safeNumber(previousTickerSnapshot?.regularMarketPrice);
  const currentPrice = safeNumber(merged.regularMarketPrice );

  // true = preço não mudou
  const unchangedPrice = Number.isFinite(previousPrice) && Number.isFinite(currentPrice) &&
        previousPrice === currentPrice;

  // -------------------- Payload--------------
  const payload = {
    source,
    symbol,
    shortName: merged.shortName,
    longName: merged.longName,
    regularMarketPrice: safeValue(merged.regularMarketPrice),
    changePercent: changePercent,
    changeSource: usingCalculated ? "CALCULATED" : "YAHOO",
    regularMarketDayLow: dayLow,
    regularMarketDayHigh: dayHigh,
    previousClose: previousCloseSafe,
    fiftyTwoWeekLow,
    fiftyTwoWeekHigh,
    volume: safeValue(merged.volume),
    averageVolume: safeValue(merged.averageVolume) ?? safeValue(avgVolumeCalc),
    min7d,
    min30d,
    variation30d,
    unchangedPrice,
    updatedAt: Date.now(),                    // Timestamp para lógica de front-end
    updatedLabel: getFormattedDateTime(),     // String formatada DD/MM/AAAA HH:MM:SS
    description: ETF_INFO[symbol]?.description || "Ativo Financeiro",
    logourl: data?.logourl || `https://icons.brapi.dev/icons/${symbol}.svg`,
    historicalDataPrice: mergedHist.slice(-90)
  };

  // mudar cor da palavra
  const etfInfoFormatado = destacarPalavraEmTodoOObjeto(ETF_INFO, "inflação");

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

    await safeSet(
      store, SNAP_KEY,
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


// Dentro do processTickerUpdate deve ficar:
// fetch + fallback + seleção de fonte + histórico bruto
