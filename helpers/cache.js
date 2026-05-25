// ------ GLOBAL RATE LIMIT PROTECTION (429 SAFETY) -------------

import {
  safeSet,
  safeGet
} from "./helpers.js";

import {
  RATE_LIMIT_KEY
} from "./constants.js";



export const setGlobal429 = async (store) => {
  const now = Date.now();
  await safeSet(store, RATE_LIMIT_KEY, {
    timestamp: now
  });
};


export const getGlobal429 = async (store) => {
  const data = await safeGet(store, RATE_LIMIT_KEY);
  // Evitar timestamp inválido
   if (!data || typeof data.timestamp !== "number") {
    return 0;
  }
  return data?.timestamp;
};

