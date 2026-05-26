// chamada function Netlify:  A chave será lida das variáveis de ambiente do Netlify
// processamento + salvamento no Blobs + retorna JSON + schedule (cron)
// CommonJS (require)  = (antigo) e ES Modules (import/export) = (novo)
// permite o objeto de configuração simplificado.
// Coletor Roda via CRON, busca no Yahoo + Brapi + Alpha Vantage + real-time-finance-data
// CRON funciona em: Netlify Functions (Node) e ❌ NÃO funciona em: Edge Functions
// e salva cada ticker individualmente no Blobs



// update-quotes.js => o orquestrador
// ---------------- CONFIG ----------------

import * as netlifyBlobs from "@netlify/blobs";
const getStore = netlifyBlobs?.getStore;

if (typeof getStore !== "function") {
  throw new Error("❌ Netlify Blobs SDK inválido ou incompatível");
}

import {
  STORE_NAME,
  LOCK_KEY,
  LOCK_TTL,
  MAX_ITEMS
} from "../../helpers/constants.js";
// functions/ → sobe 1 nível (../)
// depois sobe mais 1 (../../) até raiz

import {
  sleep,
  shouldRunNow,
  getTickers,
  safeSet,
  safeGet
} from "../../helpers/helpers.js";

import { processTickerUpdate } from "../../services/processTickerUpdate.js";

// ------------
const INTERNAL_TOKEN = process.env.INTERNAL_API_TOKEN;

// ------ createResponse padrao para os Return Json
const createResponse = (body, status = 200) => {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" }
  });
};

// ---------------- LOCK GLOBAL ----------------
const acquireLock = async (store) => {
  const now = Date.now();
  const existing = await safeGet(store, LOCK_KEY);
  if (existing && (now - existing.timestamp) < LOCK_TTL) {
    console.log("🔒 Execução já ativa");
    return null;
  }
  const lock = { timestamp: now };
  await safeSet(store, LOCK_KEY, lock);
  await sleep(200);
  return lock;
};

//--------- Para remover Lock imediatamente
const releaseLock = async (store) => {
  try {
    await store.delete(LOCK_KEY);
  } catch {
    await safeSet(store, LOCK_KEY, {
      timestamp: 0
    });
  }
};

// ---------------- FILA (SEM LOCK) ----------------
// eliminar escrita concorrente do ticker-index e sem race condition real
// ticker-index com lock global, execução única, sem paralelismo
// BUG LÓGICO (divisão por zero) corrigido

// --- proteger endpoint => Bearer Token simples + API Key interna + Netlify Identity + Basic Auth
const isAdmin = (request) => {
  const auth = request?.headers?.get?.("authorization") ?? null;
  const netlifyEvent = request?.headers?.get?.("x-netlify-event") ?? null;
  const isCron = netlifyEvent === "schedule" || netlifyEvent === "scheduled";
  const isInternal = auth === `Bearer ${INTERNAL_TOKEN}`;
  if (isCron) console.log("⏰ CRON detectado");
  if (isInternal) console.log("🔐 AUTH manual válida");
  return Boolean(isCron || isInternal);
};


// ---------------- MAIN => antigo handler ----------------
// considerar o Node 18+ e ambiente for ESM padrão de módulos ES (export default / Netlify Functions V2)

export default async (request, context) => {
  console.log("🚀 Iniciando update-quotes");
  const API_TOKEN = process.env.BRAPI_TOKEN;
  if (!API_TOKEN) { return createResponse({ error: "Token ausente" }, 500); }

  // CRON do Netlify NÃO envia o header
  if (!isAdmin(request)) {
    return createResponse(
      { error: "unauthorized" },
      401
    );
  }

  // log diagnóstico
  const runNow = shouldRunNow();
  const now = new Date();
  console.log("🕒 cron check:", {
    utc: now.toISOString(),
    runNow
  });

  if (!runNow) {
    return createResponse({
    skipped: "Função decidiu NÃO rodar o pipeline"
    });
  }

  const store = getStore({ name: STORE_NAME });
  const tickers = await getTickers(store);

  const lock = await acquireLock(store);
  if (!lock) { return createResponse({ skipped: "lock" }); }

  const MAX_EXECUTION_TIME = 10000;
  // 10 s = // Yahoo (3s timeout) + Brapi (3s) + Alpha (4s) + Real Time
  const timeout = (label = "exec", ms = MAX_EXECUTION_TIME) =>
    new Promise((_, reject) =>
      setTimeout(() => {
        reject(new Error(`⏱ timeout em ${label} (${ms}ms)`));
      }, ms)
  );
    try {
      console.log("🚀 Iniciando processTickerUpdate 📦 tickers:", tickers?.length);
      const result = await Promise.race([
        processTickerUpdate ({
          store,
          apiToken: API_TOKEN,
          tickers
        }),
        timeout(" processTickerUpdate ")
      ]);

      return createResponse(result ?? { ok: false, error: "empty_result" });
    } catch (err) {
      console.error("❌ ERRO FATAL no update-quotes:", err);
      return createResponse( { ok: false, error: err.message }, 500 );
    } finally { await releaseLock(store); }
};
// --------- FiM do MAIN export default async

export const config = {
  schedule: "*/2 13-23 * * 1-5"
};


// --------- CRON Netlify cron sempre usa UTC: 13:00 vira 10:00
// --------- a cada 2 min e (1-5) Seg a Sex
// https://www.netlifystatus.com/
// Cron = disparador bruto
// shouldRunNow = regra de negócio real
// O Netlify usa padrão cron de 5 campos
// Formato: minuto, hora, dia do mes, mes, dia da semana
// 13:15 = 10:15 (-3) e 22hs = 18hs
