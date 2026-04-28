// Busca no storage (Blobs) assim a API fica leve
// retorna JSON
// o que o frontend faz leitura esta aqui
// (O Distribuidor): É a API que o seu site chama.
// Ela lê todos os Blobs e entrega um JSON consolidado.
//  Código rodará no lado do servidor ou serverless (netlify) NAO no navegador
//  Acionado apenas quando o Frontend faz o pedido
//  A chave será lida das variáveis de ambiente do Netlify


import { getStore } from "@netlify/blobs";

// ---------
const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=60, stale-while-revalidate=30"
};

const formatFullTime = (ts) => {
  if (!ts || ts <= 0) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "medium"
  }).format(new Date(ts));
};

const jsonResponse = (data, status = 200) =>
  new Response(JSON.stringify(data, null, 2), { status, headers: HEADERS });



// ------------ LÓGICA DE NORMALIZAÇÃO  ---
const safeParse = (raw) => {
  if (!raw) return null;

  if (raw instanceof Uint8Array) {
    try {
      raw = new TextDecoder().decode(raw);
    } catch {
      return null;
    }
  }

   if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  // aceitar objetos e evitar lixo
  if (typeof raw === "object" && raw !== null) {
    if ("data" in raw || "updatedAt" in raw) {
      return raw;
    }
  }

  return null;
};


// --- FUNÇÃO PRINCIPAL ---

export default async () => {
  console.log("📥 get-quotes chamado");
  const store = getStore({ name: "quotes-blobs" });
  try {
    const rawSnapshot = await store.get("last-valid-snapshot");
    const snapshot = safeParse(rawSnapshot);
    const safeData = Array.isArray(snapshot?.data)
      ? snapshot.data.filter(i => typeof i?.symbol === "string")
      : [];

    if (safeData.length === 0) {
      console.warn("⚠️ Snapshot vazio ou inexistente");

      return jsonResponse({
        data: { etfs: [], acoes: [] },
        meta: { empty: true }
      });
    }

    const isETF = (s) => typeof s === "string" && s.endsWith("11");
    const safeSort = (a, b) => (a?.symbol || "").localeCompare(b?.symbol || "");

    const etfs = safeData.filter(i => isETF(i.symbol));
    const acoes = safeData.filter(i => !isETF(i.symbol));

    etfs.sort(safeSort);
    acoes.sort(safeSort);
    const updatedAt = snapshot?.updatedAt || 0;

    return jsonResponse({
      data: { etfs, acoes },
      meta: {
        total: safeData.length,
        updatedAt,       
        updatedLabel: formatFullTime(updatedAt) || "N/A"
      }
    });

  } catch (err) {
    console.error("❌ Erro no get-quotes:", err);

    return jsonResponse({
      data: { etfs: [], acoes: [] },
      meta: { error: true }
    }, 500);
  }
};
