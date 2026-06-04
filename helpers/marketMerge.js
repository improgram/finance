// Responsabilidades:
// juntar providers
// merge histórico
// normalização de estrutura

 // depois de resolvidos:
 // Yahoo +BRAPI +Alpha +Real Time +cache
 // => entra o MERGE


import { formatLongName, getValidHist } from "./helpers.js";

// Função que normaliza e padroniza dados de um ativo
export const normalizeMarketData = ({ symbol, data }) => {
    return {
        symbol,
        shortName: data?.shortName ?? symbol,
        longName: formatLongName(data?.longName ?? symbol),
        regularMarketPrice: data?.regularMarketPrice ?? null,
        previousClose: data?.previousClose ?? null,
        changePercent: data?.changePercent ?? null,
        regularMarketDayLow: data?.regularMarketDayLow ?? null,
        regularMarketDayHigh: data?.regularMarketDayHigh ?? null,
        fiftyTwoWeekLow: data?.fiftyTwoWeekLow ?? null,
        fiftyTwoWeekHigh: data?.fiftyTwoWeekHigh ?? null,
        volume: data?.volume > 0 ? data.volume : null,
        averageVolume: data?.averageVolume > 0 ? data.averageVolume : null,
        historicalDataPrice: data?.historicalDataPrice ?? []
    }
};


// Se Yahoo vier com histórico curto, nao deve ignorar BRAPI que pode ter mais
// Nao perder dados bons do outro provider e deduplicar por timestamp
// Snapshot incremental por ticker evita: race condition, overwrite, perda global
// prioridade: Yahoo (++ preciso) - BRAPI (complemento de histórico)
// merge por timestamp (sem duplicação)


// Yahoo + BRAPI = merge inteligente
// BRAPI = estrutura + cobertura histórica
// Yahoo = precisão + correção de mercado
export const mergeHistoricalData = (result) => {

    // ------ Antes do payload e Depois do merge (data + data)
    const yahooHist = getValidHist(result?.sources?.yahoo?.historicalDataPrice || []);
    const brapiHist = getValidHist(result?.sources?.brapi?.historicalDataPrice || []);

    const candleMap = new Map();

    // 1. BRAPI (base)
    // BRAPI deve entrar primeiro (base estrutural)
    // garantir que sempre tenha um “esqueleto” do candle.
    for (const d of brapiHist) {
        if (d?.date && d?.close != null) {
            candleMap.set(d.date, {
                ...d,
                source: "brapi"
            });
        }
    }

    // 2. YAHOO (override + enrich)
    // YAHOO entra depois (override + enrichment)
    // Yahoo é prioridade e sobrescreve preço (close)
    // corrige dados principais e melhora qualidade

    // YAHOO sobrescreve (prioridade)
    for (const d of yahooHist) {
        if (d?.date && d?.close != null) {
            candleMap.set(d.date, {
                ...candleMap.get(d.date),
                ...d,
                source: "yahoo"
            });
        }
    }

    return {
        mergedHist: [...candleMap.values()].sort((a, b) => a.date - b.date),
        meta: {
            yahoo: yahooHist.length,
            brapi: brapiHist.length,
            merged: candleMap.size
        }
    };
}
