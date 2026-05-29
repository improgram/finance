
import {DIFF_TOLERANCE, HARD_DIFF_TOLERANCE} from "./market.js";

import {
  getMin,
  getVariation30d,
  getDailyVariation,
  getDayRangeFromHist,
  get52WeekRangeFromHist,
  safeValue,
  safeNumber,
  filterByDays,
  getCloses
} from "./helpers.js";

export function calculateMetrics({
  mergedData,
  mergedHist,
  cached,
  data
}) {


  const price = safeNumber(mergedData.regularMarketPrice);
        if (!Number.isFinite(price) || price <= 0) {
          return { ok: false, reason: "invalid-price" };
        }

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
  const variation30d = getVariation30d(mergedHist, price);
  const calcDaily = getDailyVariation(mergedHist, price);
  const rawChange = mergedData?.changePercent;
  const yahooChange = rawChange === null || rawChange === undefined || rawChange === "" ? null : safeNumber(rawChange);
  const normalizedPreviousClose = safeNumber(mergedData.previousClose); // usando objeto mergedData

  const previousCloseSafe = Number.isFinite(normalizedPreviousClose)
        && normalizedPreviousClose > 0 ? normalizedPreviousClose
          : previousCloseCalc > 0 ? previousCloseCalc : null;

  const realCalculatedChange = previousCloseSafe != null && previousCloseSafe > 0
          ? ((price - previousCloseSafe) / previousCloseSafe) * 100 : null;
  const calculatedChange = realCalculatedChange ?? calcDaily ?? null;
  const diff = calculatedChange != null && yahooChange != null ? Math.abs(yahooChange - calculatedChange) : 0;

  const yahooBroken = yahooChange == null || !Number.isFinite(yahooChange) || Math.abs(yahooChange) > 40 ||
    ( realCalculatedChange != null && Math.abs(yahooChange - realCalculatedChange) > HARD_DIFF_TOLERANCE );
  const usingCalculated = yahooBroken || diff > DIFF_TOLERANCE;
  const finalChange = usingCalculated && Number.isFinite(calculatedChange) ? calculatedChange : yahooChange;
  const changePercent = Number.isFinite(finalChange) ? safeNumber(finalChange.toFixed(2)) : null;
  const normalizePrice = (v) => {
    const n = safeNumber(v); return Number.isFinite(n) && n > 0 ? n : null;
  };

  const dayRangeCalc = getDayRangeFromHist(mergedHist) || {};

  const regularMarketDayLow =
    normalizePrice(dayRangeCalc.low)
    ?? normalizePrice(mergedData?.regularMarketDayLow)
    ?? normalizePrice(cached?.regularMarketDayLow)
    ?? normalizePrice(cached?.dayLow)
    ?? null;

  const regularMarketDayHigh =
    normalizePrice(dayRangeCalc.high)
    ?? normalizePrice(mergedData?.regularMarketDayHigh)
    ?? normalizePrice(cached?.regularMarketDayHigh)
    ?? normalizePrice(cached?.dayHIgh)
    ?? null;

  const week52Calc = get52WeekRangeFromHist(mergedHist);
  const fiftyTwoWeekLow = safeValue(data?.fiftyTwoWeekLow ?? week52Calc.low);
  const fiftyTwoWeekHigh = safeValue(data?.fiftyTwoWeekHigh ?? week52Calc.high);
  const changeSource = usingCalculated ? "CALCULATED" : "YAHOO";

  return {
    ok: true,
    metrics: {
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
    }
  };
}
