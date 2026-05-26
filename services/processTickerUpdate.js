
// pipeline principal + orchestrator + coordinator + state machine
// cache+providers+merge+fallback+cálculo+persistência+snapshot+validação

// ----------- ERA EXEC: Leitura linear:  lock - exec - timeout - race
// ----------  Era exec() deve retornar apenas dados = não usa createResponse
// services -> regras de negócio

import {
  MAX_ITEMS,
  COOLDOWN_429,
  ETF_INFO
} from "../helpers/constants.js";

import {
  sleep,
  getFormattedDateTime,
  getMin,
  getMax,
  getVariation30d,
  getDailyVariation,
  getDayRangeFromHist,
  get52WeekRangeFromHist,
  safeValue,
  safeNumber,
  filterByDays,
  getValidHist,
  getCloses,
  safeSet,
  safeGet,
  normalizeStorage,
  formatLongName
} from "../helpers/helpers.js";

import {
  fetchYahoo,
  fetchBrapi,
  fetchAlphaVantage,
  fetchRealTimeAPI
} from "../helpers/providers.js";

import { getGlobal429 } from "../helpers/cache.js";

import {
  getNextTicker,
  validateTicker
} from "../helpers/tickers.js";

import {
  getCacheTTL
} from "../helpers/time.js";


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

      // ----------- CACHE FIRST ------- =>⚡ cache válido (saída imediata)
      const cacheKey = `snapshot-${symbol}`;
      const cached = await safeGet(store, cacheKey);

      // Troubleshooting 26/mai após a divisao dos helpers
      console.log("🧠 CACHE DEBUG:", {
        symbol,
        hasCache: !!cached,
        cachedUpdatedAt: cached?.updatedAt,
        now: Date.now(),
        ttl: getCacheTTL(),
        age:
          cached?.updatedAt
            ? Date.now() - cached.updatedAt
            : null
      });


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
      if (!cached) await sleep(300);        // ⛔ anti-burst obrigatório (BRAPI free / Yahoo)

    // ----------- Yahoo segundo -------------------------
      let data = null;
      let source = null;
      try {
        data = await fetchYahoo(symbol, store);
        if (data) {
          source = " ✅ YAHOO ✅ OK";
        }
      } catch (err) { console.warn("⚠️ Yahoo erro:", err.message); }


    // ------ Brapi terceiro: ❌ Só exigir BRAPI se faltar preço OU histórico
      let brapiData = null;
      // 🔥 avaliação de qualidade do Yahoo: não substitui o merge e ele só decide quando chamar Brapi
      const isYahooWeak =
        !data ||
        data.regularMarketPrice == null ||
        !Array.isArray(data.historicalDataPrice) ||
        data.historicalDataPrice.length < 5;
      // NÃO precisa da BRAPI às 18h.
      if (isYahooWeak) {
        try {
          brapiData = await fetchBrapi(symbol, apiToken, store);
        } catch (err) {
          console.warn("⚠️ BRAPI erro:", err.message);
        }
      }

      // merge inteligente: Yahoo → prioridade e (BRAPI complementa Yahoo)
      if (brapiData) {
          brapiData = {
            ...brapiData,
            regularMarketPrice: brapiData?.regularMarketPrice ?? brapiData?.close ?? null,
            previousClose: brapiData?.regularMarketPreviousClose ?? brapiData?.previousClose ?? null,
            changePercent: brapiData?.changePercent ?? brapiData?.regularMarketChangePercent ?? null
          };
        }
      if (data && brapiData) source = "✅ YAHOO + ✅✅ BRAPI";
      else if (data) source = "✅ YAHOO";
      else if (brapiData) source = "✅ ✅ BRAPI";


      /*                   ***********   TEST Alpha Vantage Temporario *********
      const FORCE_ALPHA = false;
      const FORCE_REALTIME = true;

      if (FORCE_ALPHA) {
        data = null;
        brapiData = null;
      }
      Alterar abaixo o if (!data && !brapiData) abaixo para:
      if (!FORCE_REALTIME && !data && !brapiData) {
      ...
      */

      // ---------------------- ALPHA VANTAGE (QUARTO FALLBACK) ----------------
      let alphaData = null;
      if (!data && !brapiData) {
        try {
          const alphaKey = process.env.ALPHA_VANTAGE_API_KEY;
          if (alphaKey) {
            alphaData = await fetchAlphaVantage(symbol, alphaKey, store);
          }
        } catch (err) {
          console.warn("⚠️ Alpha erro: ", err.message);
        }
      }
      if (alphaData) {
        data = alphaData;
        source = " ✅✅✅ ALPHA VANTAGE API ✅✅✅ OK ";
      }

      //------------ TEST REAL TIME Temporario-------
      /*
      if (FORCE_REALTIME) {
        data = null;
        brapiData = null;
        alphaData = null;
      }
      */

      // ---------------------- Real-time-finance-data (QUINTO FALLBACK) ----------------
      let realTime = null;
      // API sera chamada se as 3 anteriores falharem
      if (!data && !brapiData && !alphaData) {
        try {
          // o process.env é um objeto que contém todas as variáveis de ambiente configuradas no painel do Netlify
          const realTimeKey = process.env.REAL_TIME_KEY;
          if (realTimeKey) {
            realTime = await fetchRealTimeAPI(symbol, store);
          }
        } catch (err) {
          console.warn("⚠️ Real Time : ", err.message);
        }
      }
      if (realTime) {
        data = realTime;
        source = " ✅✅✅✅ Real Time API ✅✅✅✅  OK ";
      }

      //------------- Falback = cache antigo = Evitar side-effect silencioso
      if (!data && cached) {    // cached vem do snapshot e não da API
        source = "Cache Antigo";
        data = cached;
      }

      // depois de resolvidos: Yahoo + BRAPI + Alpha + Real Time + cache => entra o MERGE
      const merged = {
        symbol,
        shortName: data?.shortName ?? brapiData?.shortName ?? brapiData?.symbol ?? symbol,
        longName: formatLongName(data?.longName ?? brapiData?.longName ?? symbol),
        regularMarketPrice: data?.regularMarketPrice ?? brapiData?.regularMarketPrice ?? null,
        previousClose: data?.previousClose ?? brapiData?.previousClose ?? null,
        changePercent: data?.changePercent ?? brapiData?.changePercent ?? null,
        regularMarketDayLow: data?.regularMarketDayLow ?? brapiData?.regularMarketDayLow ?? null,
        regularMarketDayHigh: data?.regularMarketDayHigh ?? brapiData?.regularMarketDayHigh ?? null,
        fiftyTwoWeekLow: data?.fiftyTwoWeekLow ?? brapiData?.fiftyTwoWeekLow ?? null,
        fiftyTwoWeekHigh: data?.fiftyTwoWeekHigh ?? brapiData?.fiftyTwoWeekHigh ?? null,
        volume: data?.volume > 0 ? data.volume : brapiData?.volume > 0 ? brapiData.volume : null,
      averageVolume: data?.averageVolume > 0 ? data.averageVolume : brapiData?.averageVolume > 0 ? brapiData.averageVolume : null,
      historicalDataPrice: data?.historicalDataPrice?.length ? data.historicalDataPrice : brapiData?.historicalDataPrice ?? []
      };

      // ------------ Fallback final absoluto-----------------
      const normalizedPrice = safeNumber(merged.regularMarketPrice);

      if (!Number.isFinite(normalizedPrice) || normalizedPrice <= 0) {
        return { ok: false, reason: "Sem Dados" };
      }


    // --------------- Antes do payload e Depois do merge (data + brapiData)
    const yahooHist = getValidHist(data?.historicalDataPrice || []);
    const brapiHist = getValidHist(brapiData?.historicalDataPrice || []);
    // Se Yahoo vier com histórico curto, nao deve ignorar BRAPI que pode ter mais
    // Nao perder dados bons do outro provider e deduplicar por timestamp
    const map = new Map();

    // Snapshot incremental por ticker
    // Isso evita: race condition, overwrite, perda global

    // Yahoo tem prioridade nos candles
    for (const d of brapiHist) {
      if (d?.date && d?.close != null) {
        map.set(d.date, d);
      }
    }

    // Yahoo sobrescreve BRAPI se existir mesmo timestamp
    for (const d of yahooHist) {
      if (d?.date && d?.close != null) {
        map.set(d.date, d);
      }
    }

    // depois do merge = prioridade: 1. API (Yahoo ou BRAPI) e 2. cálculo via histórico
    const mergedHist = [...map.values()].sort((a,b) => a.date - b.date);
    const baseHist = mergedHist;
    // último candle disponível
    const latestCandle = baseHist.length ? baseHist[baseHist.length - 1] : null;

    // valida sessão real de negociação
    const hasValidTradingSession = latestCandle && safeNumber(latestCandle.volume) > 0 &&
          safeNumber(latestCandle.low) > 0 && safeNumber(latestCandle.high) > 0;

    const previousCloseCalc = baseHist.length >= 2 ? baseHist[baseHist.length - 2]?.close ?? null : null;
    const avgVolumeCalc = baseHist.length ? Math.round(
          baseHist.reduce((acc, d) => acc + (d.volume || 0), 0) / baseHist.length ) : null;
    const min7d = baseHist.length ? getMin(getCloses(filterByDays(baseHist, 7))) : null;
    const min30d = baseHist.length ? getMin(getCloses(filterByDays(baseHist, 30))) : null;
    const price = safeNumber(merged.regularMarketPrice);
          if (!Number.isFinite(price) || price <= 0) {
            return { ok: false, reason: "invalid-price" };
          }
    const variation30d = getVariation30d(baseHist, price);
    const calcDaily = getDailyVariation(baseHist, price);
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
    const dayRangeCalc = hasValidTradingSession ? getDayRangeFromHist(baseHist) :
        {
          low: cached?.regularMarketDayLow ?? null,
          high: cached?.regularMarketDayHigh ?? null
        };

    const week52Calc = get52WeekRangeFromHist(baseHist);
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

      // ----- salva cache principal => safeSet do snapshot individual
      console.log("STORE WRITE (snapshot ticker):", symbol);
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

    console.log("🧠 SNAPSHOT ANTES WRITE:", {
      symbol,
      prevSize: prevArray?.length,
      newSize: newSnapshot?.length
    });

    // Troubleshooting 26/mai apos divisao dos Helpers
    const snapshotPayload = {
      data: newSnapshot,
      updatedAt: Date.now()
    };

    console.log("🧠 WRITING SNAPSHOT:", {
      key: SNAP_KEY,
      updatedAt: snapshotPayload.updatedAt,
      items: snapshotPayload.data.length
    });

    await safeSet(store, SNAP_KEY, snapshotPayload);
    // Antigo antes de 26/mai
    //await safeSet(store, SNAP_KEY, { data: newSnapshot, updatedAt: Date.now() });
    const verifySnapshot = await safeGet(store, SNAP_KEY);

    console.log("🔎 VERIFY SNAPSHOT:", {
      updatedAt: verifySnapshot?.updatedAt,
      items: verifySnapshot?.data?.length
    });

    console.log("💾 SNAPSHOT WRITE OK:", {
      symbol,
      updatedAt: Date.now(),
      finalSize: newSnapshot?.length
    });

        console.log("🧠 snapshot atualizado:", symbol);
      } catch (err) {
        console.warn("⚠️ erro ao atualizar snapshot:", err.message);
      }
      // -------------✅ Retorno no painel Netlify ✅---------
      console.log(`💾 salvo ${symbol} → source: ${source} 💾`);
      console.log("💾 SALVANDO SNAPSHOT AGORA");

      return { ok: true, symbol, source, data: payload };

};

//  FiM da const processTickerUpdate
