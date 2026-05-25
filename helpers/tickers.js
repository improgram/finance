
import { safeGet, safeSet } from "./storage.js";
import { MAX_ITEMS } from "./constants.js";


// -- LIMPEZA NO BOOT
export const sanitizeTickers = (list) => {
  if (!Array.isArray(list)) return [];
  return [...new Set(list)]
    .map(t => String(t).trim().toUpperCase())
    .filter(t => /^[A-Z0-9]+$/.test(t));
};

// ------- parser seguro = util para blindar a leitura do tickers-list
// ------- normalizar tickers SEM exceção
export const safeParseTickers = (raw) => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    return raw.split(",").map(t => t.trim()).filter(Boolean);
  }
  if (typeof raw === "object") {
    if (Array.isArray(raw.value)) return raw.value;
    if (typeof raw.value === "string") {
      return raw.value.split(",").map(t => t.trim()).filter(Boolean);
    }
  }
  return [];
};


// --- Helper para buscar tickers dinâmicos no Blobs
// já faz parse e trata fallback
export async function getTickers (store) {
  const data = await safeGet(store, "tickers-list");
  console.log("📦 tickers raw:", data);
  const raw =
    Array.isArray(data)
      ? data
      : data?.value ?? data;
  const tickers = sanitizeTickers(safeParseTickers(raw));
  // 🔥 BOOT CLEANUP (REMOVE ESTADO FANTASMA)
  if (Array.isArray(raw)) {
    const cleaned = sanitizeTickers(raw);
    // sobrescreve o storage com versão limpa automaticamente = Evitar regravar sempre no boot
    if (JSON.stringify(cleaned) !== JSON.stringify(raw)) {
      await safeSet(store, "tickers-list", cleaned);
      console.log("🧼 tickers sanitizados no boot:", cleaned);
    }
  }
  // Cria automaticamente o tickers-list se não existir
  if (!tickers.length) {
    console.warn("⚠️ tickers vazia → inicializando padrão");
    const fallback = sanitizeTickers( ["BBDC4", "IRFM11"] );
    // 🔥 bootstrap automático (uma única vez na prática)
    await safeSet(store, "tickers-list", fallback);
    return fallback.slice(0, MAX_ITEMS);
  }
  return tickers.slice(0, MAX_ITEMS);
};


//-- Evitar tickers-list vazio
export const updateTickersList = async (store, tickers) => {
  if (!Array.isArray(tickers) || tickers.length === 0) {
    throw new Error("🚨 tentativa de salvar tickers-list vazia");
  }
  const clean = [...new Set(tickers.map(t => t.trim()).filter(Boolean))];
  if (!clean.length) {
    throw new Error("🚨 tickers-list inválida após limpeza");
  }
  await safeSet(store, "tickers-list", clean);
  console.log("📦 tickers-list atualizada:", clean.length);
};


export const formatLongName = (name) => {
  if (!name) return null;
  return name
    .replace(/\bS\.A\.?\b/gi, "")
    .replace(/\bSA\b/gi, "")
    .replace(/\bS\/A\b/gi, "")        // =>  S/A
    .replace(/\bLtd\b/gi, "")
    .replace(/\bHOLDING\b/gi, "")
    .replace(/\bINVESTMENTS?\b/gi, "")
    .replace(/\bInvestimentos?\b/gi, "")
    .replace(/\bParticipações?\b/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s+\./g, "")
    .replace(/\s+e\s+/gi, " ")
    .replace(/\s+e$/i, "")
    .replace(/\b[eE]\b/g, "")
    .trim();
};

export const validateTicker = (symbol) => {
  return TICKER_REGEX.test(symbol);
};


export const getNextTicker = async (store, list) => {
  if (!Array.isArray(list) || list.length === 0) {
    console.warn("⚠️ getNextTicker recebeu lista vazia");
    return null;
  }
  const key = "ticker-index";
  const stored = await safeGet(store, key);
  // cobre erros de: objeto { value }, número puro, lixo → fallback 0 e Se stored = {} → vira NaN
  let index = Number( stored && typeof stored === "object" ? stored.value : stored );
  if (!Number.isInteger(index)) index = 0;
  // evitar crescimento inútil do índice
  const currentIndex = index % list.length;
  const nextIndex = (index + 1) % list.length;
  console.log("📍 index atual:", index, "| current:", currentIndex, "| next:", nextIndex);
  // Sequencia correta: índice está sendo persistido no Blobs e sem race condition
  // index atual: 0 | current: 0 | next: 1
  // index atual: 1 | current: 1 | next: 0
  // index atual: 0 | current: 0 | next: 1
  await safeSet(store, key, {
    value: nextIndex,
    updatedAt: Date.now()
  });
  return list[currentIndex];
};
