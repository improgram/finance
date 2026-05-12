
// ---------------- HELPERS Gerais sleep, safeGet, safeSet ------------

// Padronizar 100% o storage = blobs às vezes retorna objeto direto, e às vezes string
// safeSet sempre stringify → pode gerar dupla serialização Se alguém passar string
// Se quiser aceitar string, então precisa tratar no safeGet.
// O JSON.stringify(value) Pode gerar double stringify e Pode quebrar leitura futura do timestamp

export async function safeSet (store, key, value) => {
  try {
    const data = JSON.stringify(value ?? null);
    return await store.set(key, data);
  } catch (err) {
    console.warn("⚠️ safeSet falhou:", key, err.message);
    return null;
  }
};

// -------Blindar leitura = evitar retorno do objeto invalido
// Padronização global de storage (ANTI-CRASH STRUCTURE)
export const normalizeStorage = (data) => {
  if (!data) return null;
  if (Array.isArray(data)) {
    return { data };
  }
  if (typeof data === "object") {
    if (Array.isArray(data.data)) {
      return data;
    }
    if (Array.isArray(data.value)) {
      return { data: data.value };
    }
  }
  return { data: [] };
};

export async function safeGet (store, key) {
  try {
    const raw = await store.get(key);
    if (!raw) return null;
    let parsed;
    if (raw instanceof Uint8Array) {
      parsed = JSON.parse(new TextDecoder().decode(raw));
    } else if (typeof raw === "string") {
      parsed = JSON.parse(raw);
    } else if (typeof raw === "object") {
      parsed = raw; // já é objeto válido
    } else {
      return null;
    }
    return parsed; // 🔥 IMPORTANTE
  } catch (err) {
    console.warn("⚠️ JSON inválido no safeGet:", key, err.message);
    return null;
  }
};
