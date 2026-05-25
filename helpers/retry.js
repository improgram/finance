
// ---------------- FETCH RETRY ----------------
// Inicia um cronômetro de 3 segundos.
// Dispara a requisição fetch avisando que ela pode ser cancelada.
// Se o fetch for rápido: O cronômetro é desligado e você recebe os dados.
// Se o fetch demorar: O cronômetro estoura, o AbortController cancela a requisição, e você cai no erro de timeout.
// força a requisição a cancelar caso ela demore mais do que o esperado: 3s

import { sleep } from "./helpers.js";
import { setGlobal429 } from "./cache.js";



export const fetchWithTimeout = async (url, options = {}, timeout = 3000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options,
      signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      console.warn("❌ ⏱ TIMEOUT 3s ❌");
      } else {
      console.error("⚠️ erro fetch:", error);
      }
      throw new Error(error.name === "AbortError" ? `timeout: ${error.message}` : error.message );
  }
  finally {
    clearTimeout(id);
  }
};

// ---------------- RETRY WRAPPERS (YAHOO / BRAPI) ----------------
export const fetchWithRetryYahoo = async (url, store, symbol, attempts = 2) => {
  for (let i = 0; i < attempts; i++) {
    try {
      const resYahoo = await fetchWithTimeout(url, {}, 3000);
      // 1. Sucesso: Retorna a resposta imediatamente
      if (resYahoo && resYahoo.ok) {
        return resYahoo;
      }
      const status = resYahoo?.status;
      // 2. Tratamento de Rate Limit (429)
      if (status === 429) {
        await setGlobal429(store);
        console.warn(`🚨 429 Yahoo (${symbol}) - Tentativa ${i + 1} de ${attempts}`);
        await sleep((i + 1) * 1000);
        continue;
      }
      // 3. Tratamento de erros específicos (401, 404, 500)
      let errorMsg = "Erro Desconhecido";

      if (status === 401) {
        errorMsg = " ❌ Endpoint inconsistente ";
      } else if (status === 404) {
        errorMsg = " ❌Recurso não encontrado ";
      } else if (status === 500) {
        errorMsg = " ❌ Erro Interno do Servidor Yahoo ";
      }

      if (status !== 401) {
        console.error(`❌ Erro Yahoo: Status ${status} (${errorMsg}) em ${symbol}`);
      } else {
        console.warn(`⚠️ Yahoo quote bloqueado para ${symbol}`);
      }
      // Para erros fatais como 401 ou 404, geralmente não adianta tentar de novo
      if (status === 401 || status === 404) break;
    } catch (error) {
      console.error(`❌ Erro de REDE / ❌ TIMEOUT na tentativa ${i + 1}:`, error);
    }
  }
  // Se sair do loop sem retornar, significa que todas as tentativas falharam
  console.log(`💀 Falha definitiva para ${symbol} após ${attempts} tentativas.`);
  return null;
};


export const fetchWithRetryBrapi = async (url, store, symbol, attempts = 2) => {
  for (let i = 0; i < attempts; i++) {
    let resBrapi;
    try {
      resBrapi = await fetchWithTimeout(url, {}, 3000);
    } catch (error) {
      console.error(`⚠️ Erro de rede/timeout/Abort na tentativa `, error);
      continue;
    }
    if (resBrapi?.status === 429) {
      await setGlobal429(store);
      console.warn(`🚨 BRAPI com erro 429 detectado (${symbol}) tentativa ${i + 1}`);
      if (i < attempts - 1) {
        await sleep((i + 1) * 400);
        continue;
      }
    }
    if (resBrapi?.ok) return resBrapi;
  }
  return null;
};
