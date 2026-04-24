// Busca no storage (Blobs) assim a API fica leve
// retorna JSON
// o que o frontend faz leitura esta aqui
// (O Distribuidor): É a API que o seu site chama.
// Ela lê todos os Blobs e entrega um JSON consolidado.
//  Código rodará no lado do servidor ou serverless (netlify) NAO no navegador
//  Acionado apenas quando o Frontend faz o pedido
//  A chave será lida das variáveis de ambiente do Netlify


import { getStore } from "@netlify/blobs";

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=60, stale-while-revalidate=30"
};

const formatFullTime = (ts) => {
  if (!ts || ts <= 0) return "Data não encontrada";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(new Date(ts));
};

const jsonResponse = (data, status = 200) =>
  new Response(JSON.stringify(data, null, 2), { status, headers: HEADERS });

// --- LÓGICA DE NORMALIZAÇÃO (Com os seus logs de aviso) ---
const normalizeItem = (raw, key) => {
  try {
    let item = typeof raw === "string" ? JSON.parse(raw) : raw;

    if (!item || typeof item !== "object") {
      console.warn(`⚠️ Item inválido (não é objeto): ${key}`);
      return null;
    }
    if (!item.symbol || typeof item.symbol !== "string") {
      console.warn(`⚠️ Symbol inválido: ${key}`);
      return null;
    }

    item.symbol = item.symbol.trim().toUpperCase();
    const timeValida = Number(item.updatedAt || 0);

    if (isNaN(timeValida) || timeValida <= 0) {
      console.warn(`⚠️ updatedAt inválido: ${key}`);
      return null;
    }

    // O Log de sucesso que você tinha no loop
    console.log("🔎 ITEM LIDO:", { key, symbol: item.symbol, updatedAt: timeValida });

    return { ...item, updatedAt: timeValida, collectedAtFull: formatFullTime(timeValida) };
  } catch (e) {
    console.warn(`⚠️ JSON inválido ou erro de processamento em ${key}`);
    return null;
  }
};

// --- FUNÇÃO PRINCIPAL ---
export default async () => {
  console.log("📥 get-quotes chamado (SEQUENCIAL / SAFE)");
  const store = getStore({ name: "quotes-blobs" });
  let ultimaAtualizacaoGeral = 0;

  try {
    // 1. TENTATIVA DE SNAPSHOT
    const snapshot = await store.get("last-valid-snapshot", { type: "json" });
    const safeData = snapshot?.data?.filter(i => i?.symbol) || [];

    if (safeData.length > 0) {
      console.log("⚡ Snapshot carregado");
      return jsonResponse({
        data: {
          etfs: safeData.filter(i => i.symbol.endsWith("11")),
          acoes: safeData.filter(i => !i.symbol.endsWith("11"))
        },
        meta: { snapshot: true, total: safeData.length, updatedAt: snapshot.updatedAt || 0, collectedAtFull: formatFullTime(snapshot.updatedAt) }
      });
    }

    // 2. LISTAGEM DOS BLOBS
    console.log("🔎 Listando tickers no Blobs...");
    const list = await store.list({ prefix: "quote-" });
    const validBlobs = list.blobs?.filter(b => !b.key.endsWith("-tmp")) || [];

    if (validBlobs.length === 0) {
      console.warn("⚠️ Nenhum blob encontrado.");
      return jsonResponse({ success: true, message: "NAO existem dados disponíveis", data: { etfs: [], acoes: [] }, meta: { empty: true } });
    }

    console.log(`📦 Processando ${validBlobs.length} itens válidos`);
    const etfs = [];
    const acoes = [];

    // 3. LOOP DE PROCESSAMENTO
    for (const blob of validBlobs) {
      const raw = await store.get("tickers-list");
      const item = normalizeItem(raw, blob.key);

      if (item) {
        if (item.updatedAt > ultimaAtualizacaoGeral) ultimaAtualizacaoGeral = item.updatedAt;
        item.symbol.endsWith("11") ? etfs.push(item) : acoes.push(item);
      }
    }

    console.log(`✅ ETFS: ${etfs.length} | Ações: ${acoes.length}`);

    // 4. FALLBACK CASO O LOOP RESULTE EM VAZIO
    if (etfs.length === 0 && acoes.length === 0) {
      console.warn("⚠️ Nenhum dado válido após processamento, tentando fallback...");
      const fallback = await store.get("last-valid-snapshot", { type: "json" });
      if (fallback?.data) {
          console.log("♻️ Usando snapshot fallback");
          // Reutiliza a lógica de separação para o fallback...
          return jsonResponse({ /* ... dados do fallback ... */ });
      }
    }

    return jsonResponse({
      data: {
        etfs: etfs.sort((a, b) => a.symbol.localeCompare(b.symbol)),
        acoes: acoes.sort((a, b) => a.symbol.localeCompare(b.symbol))
      },
      meta: { total: etfs.length + acoes.length, updatedAt: ultimaAtualizacaoGeral, collectedAtFull: formatFullTime(ultimaAtualizacaoGeral) }
    });

  } catch (err) {
    console.error("❌ Erro no get-quotes:", err);
    return jsonResponse({
      data: { etfs: [], acoes: [] },
      meta: { error: true, collectedAtFull: formatFullTime(ultimaAtualizacaoGeral) }
    }, 500);
  }
};
