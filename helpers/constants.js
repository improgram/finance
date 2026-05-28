
export const MAX_ITEMS = 50;
export const COOLDOWN_429 = 30 * 1000; // 30s de pausa global após 429
export const RATE_LIMIT_KEY = "global-429";
export const LOCK_KEY = "update-lock";
export const LOCK_TTL = 30 * 1000;     // 30s = evitar concorrência e não bloqueia pipeline por minutos
export const TICKER_REGEX = /^[A-Z0-9]{4,12}$/;
export const STORE_NAME = "quotes-blobs";           // STORE_NAME único


// => ETF_INFO export para processTickerUpdate
export const ETF_INFO = {
    AUPO11: { description: "Inflação 2060 (NTN-B) + LFTs 2027/28/30/31 (Selic)" },
    BOVA11: { description: "80 maiores empresas do Ibovespa" },
    B5P211: { description: "Inflação (NTN-B) Curto / Medio" },
    CHIP11: { description: "Chips Semicondutores e IA: NVIDIA, TSMC, Broadcom, ASML e Intel" },
    GOAT11: { description: "IMAB11 (80%) e S&P (19%)" },
    HASH11: { description: "Bitcoin (64,87%) e Ethereum (31,77%)"},
    IMAB11: { description: "Inflação (NTN-B) Medio / Longo" },
    IRFM11: { description: "Pré-fixado LTN 2026/29/31 e NTN-B" },
    IVVB11: { description: "S&P 500 maiores empresas dos EUA" },
    LFTB11: { description: "Tesouro Selic LFT 2027/28/29/30/2060"},
    NASD11: { description: "Apple, Amazon, Google, Meta, Microsoft, Nvidia, Testa, Netflix "},
    NBIT11: { description: "Bitcoin contratos Futuros" },
    PACB11: { description: "Inflação (NTN-B) Longo 2050 / 2060" },
    SMAL11: { description:
"TOTS3,ALOS3,LREN3,ASAI3,CSAN3,CSMG3,MULT3,SMFT3,TAEE11,BRAV3,NATU3,GOAU4,SAPR11,HYPE3,FLRY3,CYRE3,BRAP4"},
    "5PRE11": { description: "Pré-fixado NTN-F 33/35 e LTN 29/30/32" }
};

