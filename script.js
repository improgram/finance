// CAMADA 1 — API (data-access)
// Responsavel por buscar dados e tratar Erros
// só busca dados
const getQuotes = async () => {
    const res = await fetch('/.netlify/functions/get-quotes');
    if (!res.ok) throw new Error('Erro HTTP');
    return res.json();
};


// -- CAMADA 2 - CRIAÇÃO (STRUCTURE) → cria DOM

// menu hamburguer
const hamburger = document.getElementById("hamburger");
const navMenu = document.getElementById("nav-menu");
if (hamburger && navMenu) {
    hamburger.addEventListener("click", () => {
        navMenu.classList.toggle("active");
    });
}

// dropdown projetos
const projetos = document.getElementById("menu-projetos");
const submenu = document.querySelector(".submenu");
if (projetos && submenu) {
    projetos.addEventListener("click", (e) => {
        e.preventDefault();
        submenu.style.display =
            submenu.style.display === "block" ? "none" : "block";
    });
}

// fechar menu ao clicar fora
// Nao deixa quebrar se DOM mudar dinamicamente
document.addEventListener("click", (e) => {
    const target = e.target;
    // Evitar quebrar se navMenu ou hamburger forem null
    if (!submenu || !navMenu || !hamburger) return;

    if (
        !submenu.contains(target) &&
        !navMenu.contains(target) &&
        !hamburger.contains(target)
    ) {
        navMenu.classList.remove("active");
    }
});


// applyFilters chama state
const etfMap = new Map();
const acoesMap = new Map();
let containerEtf;
let containerAcoes;
const state = {
  lastSignature: null,
  filterTerm: '',
  etfs: [],
  acoes: []
}


const filterRows = (data, map, termo) => {
    const normalizeTerm = termo?.trim().toLowerCase() || '';
    data.forEach(item => {
        if (!item.symbol) return;
        const row = map.get(item.symbol);
        if (!row) return;

        const match =
            !normalizeTerm ||
            item.symbol?.toLowerCase().includes(normalizeTerm) ||
            item.description?.toLowerCase().includes(normalizeTerm) ||
            item.longName?.toLowerCase().includes(normalizeTerm);
        row.style.display = match ? '' : 'none';
    });
};

// orquestrador de filtro igual fetchQuotes
// coordena(state+view) + decide quando aplicar filtro e chama funções da view(filterRows)
const applyFilters = () => {
    filterRows(state.etfs, etfMap, state.filterTerm);
    filterRows(state.acoes, acoesMap, state.filterTerm);
};

const statusAtualizacaoEl = document.getElementById('status-atualizacao');
const statusLoadingEl = document.getElementById('status');          // Loading geral


// Ultima Chamada no DOM = function quando a página terminar de carregar
// Incluido Ferramenta de Busca e Remove o render dentro do search
window.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('etf-search');

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            state.filterTerm = e.target.value.toLowerCase();
            if (state.etfs.length || state.acoes.length) {
                applyFilters();
            }
        });
    }
    containerEtf = document.getElementById('etfs-container');
    containerAcoes = document.getElementById('acoes-container');
    if (!containerEtf || !containerAcoes) {
        console.error('Containers não encontrados no DOM');
        return;     // 🚨 impede execução do app quebrado
    }
    fetchQuotes();
});


// Primeira Tabela = ETF
const createEtfRow = (symbol) => {
    const row = document.createElement('tr');
    row.dataset.symbol = symbol;
    row.innerHTML = `
        <td><strong class="symbol"></strong></td>
        <td class="description"></td>
        <td class="price"></td>
        <td class="var"></td>
        <td class="range"></td>
        <td class="min7"></td>
        <td class="min30"></td>
        <td class="var30"></td>
        <td class="max"></td>
    `;
    return row;
};

// segunda tabela = açoes
const createAcaoRow = (symbol) => {
    const row = document.createElement('tr');
    row.dataset.symbol = symbol;
    row.innerHTML = `
        <td><img class="logo" width="24" height="24"></td>
        <td class="symbol"></td>
        <td class="name"></td>
        <td class="price"></td>
        <td class="var"></td>
        <td class="range"></td>
        <td class="min7"></td>
        <td class="min30"></td>
        <td class="var30"></td>
        <td class="min1y"></td>
        <td class="max"></td>
    `;
    return row;
};


// CAMADA 3 — STATE (estado global controlado)
// state guarda dados normalizados

const normalizeState = (q) => ({
    symbol: q.symbol,
    description: q.description || '-',
    longName: q.longName || q.description || '-',
    regularMarketPrice: q.regularMarketPrice ?? null,
    // 🔥 fallback inteligente
    regularMarketChangePercent: q.regularMarketChangePercent ?? q.changePercent ?? null,
    min7d: q.min7d ?? null,
    min30d: q.min30d ?? null,
    variation30d: q.variation30d ?? null,
    regularMarketDayLow: q.regularMarketDayLow ?? null,
    regularMarketDayHigh: q.regularMarketDayHigh ?? null,
    fiftyTwoWeekHigh: q.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: q.fiftyTwoWeekLow ?? null,
    logourl: q.logourl
});


// CAMADA 4 — HELPERS GLOBAIS

// 🌍 FORMATADORES

const numberFormatterBR = new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
});
const formatNumber = (value) =>
    typeof value === 'number'
        ? numberFormatterBR.format(value)
        : 'Sem histórico';

const formatPercent = (value) =>
    typeof value === "number"
        ? `${numberFormatterBR.format(value)}%`
        : '---';

// DOMAIN HELPERS (regras puras)

const getVariacao = (obj) =>
    typeof obj.regularMarketChangePercent === "number"
        ? obj.regularMarketChangePercent
        : null;

const getVariacao30d = (obj) =>
    typeof obj.variation30d === "number"
        ? obj.variation30d
        : null;

const getDayRange = (obj) =>
    obj.regularMarketDayLow != null && obj.regularMarketDayHigh != null
        ? `${formatNumber(obj.regularMarketDayLow)} - ${formatNumber(obj.regularMarketDayHigh)}`
        : '-';

// cores automáticas (verde/vermelho)
function aplicarCor(valor) {
    if (valor > 0) return "positive";
    if (valor < 0) return "negative";
    return "neutral";
}


// 1° carga = limpa o DOM  /   mesmo snap=só att valores
// ticket mudou ordem = rebuild    / preço mudou = update incremental
// Se o backend mudar ordem ou snapshot resetar limpa o DOM no primeiro load
const buildSnapshotSignature = (etfs, acoes) => {
    const normalize = (arr) =>
        arr.map(x => x.symbol).filter(Boolean).join('|'); // ⚠️ sem sort

    return `${normalize(etfs)}::${normalize(acoes)}`;
};


// CAMADA 5 — VIEW (renderização DOM)=(manipulação visual)=manipula DOM
// não cria DOM e não define estrutura e não é domain
// view NÃO busca dados e NÃO chama API - só recebe dados e desenha
// resetar DOM em caso de inconsistência e limpar quando dados somem
const safeClear = (el) => { if (el) el.innerHTML = ''; };

// Loading
const showLoading = () => {
    if (statusLoadingEl) {
        statusLoadingEl.style.display = 'block';
        statusLoadingEl.innerText = 'Carregando...';
    }
};

// Loading ocultar
const hideLoading = () => {
    if (statusLoadingEl) {
        statusLoadingEl.style.display = 'none';
    }
};

// Erros
const showError = () => {
    if (statusLoadingEl) {
        statusLoadingEl.style.display = 'block';
        statusLoadingEl.innerText = 'Erro ao carregar dados';
    }
};

// Timestamp
const updateTimestamp = (meta) => {
    if (!statusAtualizacaoEl) return;
    statusAtualizacaoEl.innerText =
        meta?.updatedLabel
            ? `Última atualização: ${meta.updatedLabel}`
            : `Atualizado em ${new Date().toLocaleTimeString()}`;
};

// CAMADA 6 - VIEW UPDATE COMPLETO (FULL SYNC) = → atualiza DOM

// flash + otimização real
const updatePriceCell = (priceEl, newPriceRaw) => {
    if (!priceEl) return;
    const oldPriceRaw = priceEl.dataset.value;
    const oldPrice = Number(oldPriceRaw);
    const newPrice = Number(newPriceRaw);
    if (!isNaN(oldPrice) && !isNaN(newPrice) && oldPrice !== newPrice) {
        priceEl.classList.add('flash');
        setTimeout(() => priceEl.classList.remove('flash'), 500);
    }
    priceEl.dataset.value = newPriceRaw;
    priceEl.textContent = formatNumber(newPriceRaw);
};

const updateCommonRow = (row, data) => {
    const elSymbol = row.querySelector('.symbol');
        if (elSymbol) elSymbol.textContent = data.symbol;
    const variacao = getVariacao(data);
    const variacao30d = getVariacao30d(data);
    const elPrice = row.querySelector('.price');
        if (elPrice) updatePriceCell(elPrice, data.regularMarketPrice);
    const elVar = row.querySelector('.var');
        if (elVar) {
            elVar.textContent = variacao !== null ? formatPercent(variacao) : '---';
            elVar.className = `var ${variacao !== null ? aplicarCor(variacao) : ''}`;
        }
    const elRange = row.querySelector('.range');
        if (elRange) elRange.textContent = getDayRange(data);
    const elMin7 = row.querySelector('.min7');
        if (elMin7) elMin7.textContent = formatNumber(data.min7d);
    const elMin30 = row.querySelector('.min30');
        if (elMin30) elMin30.textContent = formatNumber(data.min30d);
    const elVar30 = row.querySelector('.var30');
        if (elVar30) {
            elVar30.textContent = variacao30d !== null ? formatPercent(variacao30d) : '---';
            elVar30.className = `var30 ${variacao30d !== null ? aplicarCor(variacao30d) : ''}`;
        }
    const elMax = row.querySelector('.max');
        if(elMax) elMax.textContent = formatNumber(data.fiftyTwoWeekHigh);
};


const updateEtfRow = (row, etf) => {
    updateCommonRow(row, etf);
    const elDescription = row.querySelector('.description');
        if (elDescription) elDescription.textContent = etf.description;
};


const updateAcaoRow = (row, acao) => {
    updateCommonRow(row, acao);
    const elName = row.querySelector('.name');
        if (elName) elName.textContent = acao.longName;
    const elMin1y = row.querySelector('.min1y');    // Minima do ultimo ano somente
        if (elMin1y) elMin1y.textContent = formatNumber(acao.fiftyTwoWeekLow);
    const logo = row.querySelector('.logo');
        if (logo) {logo.src = acao.logourl || `https://via.placeholder.com/24?text=${acao.symbol || 'X'}`;}
};


// CAMADA 7 — CONTROLLER (orquestradores) → DECIDE criar ou atualizar
// somente Main
// decidem quando limpar, reaproveitar e chamar a view
// não criam DOM (view), Nao sao: dados(state), Nao são regras puras (domain)
const rebuildTables = (etfs, acoes) => {
            safeClear(containerEtf);
            safeClear(containerAcoes);
            etfMap.clear();
            acoesMap.clear();
            renderOrUpdateEtfs(etfs, containerEtf, etfMap);
            renderOrUpdateAcoes(acoes, containerAcoes, acoesMap);
};

const patchTables = (etfs, acoes) => {
            renderOrUpdateEtfs(etfs, containerEtf, etfMap);
            renderOrUpdateAcoes(acoes, containerAcoes, acoesMap);
};


// fetchQuotes → delega
// validação + loading + chamada API + normalização + decisão de render
// atualização de state + timestamp + erro

const fetchQuotes = async () => {
    const handleError = (err) => {
        console.error("Erro ao carregar quotes", err);
        showError?.();
        updateTimestamp?.({ updatedLabel: "Erro na atualização" });
        hideLoading();
    };
    try {
        // Validar antes do DOM e impedir chamadas desnecessárias da API
        if (!containerEtf || !containerAcoes) {
            throw new Error('Containers não inicializados');
        }
        showLoading();
        const json = await getQuotes();
        const etfs = (json.data?.etfs || []).map(normalizeState);
        const acoes = (json.data?.acoes || []).map(normalizeState);
        state.etfs = etfs;
        state.acoes = acoes;
        const signature = buildSnapshotSignature(etfs, acoes);
        const isInitialRender = !state.lastSignature;
        const shouldRebuild = isInitialRender || signature !== state.lastSignature;
        // Separar decisão de render
        if (shouldRebuild) {
            rebuildTables(etfs, acoes);
        } else {
            patchTables(etfs, acoes);
        }
        state.lastSignature = signature;

        updateTimestamp(json.meta); // ✅ DEPOIS do render
        hideLoading();              // ✅ FINAL

        // ✔️ garantir DOM pronto antes do filtro = 🔥 reaplica filtro após render
        // garante execução após microtasks do render e setTimeout(browser antigo)
        if (typeof queueMicrotask === 'function') {
            queueMicrotask(applyFilters);
        } else {
            setTimeout(applyFilters, 0);
        }
        //FiM do try e inicio do catch: prevenir erro de API ou rede ou erro de parsing
    } catch (err) {
        handleError(err);
    }
};
// Fim do fetchQuotes


const renderOrUpdateEtfs = (data, container, map) => {
    const fragment = document.createDocumentFragment();
    data.forEach(etf => {
        if (!etf.symbol) return;
        let row = map.get(etf.symbol);
        if (!row) {
            row = createEtfRow(etf.symbol);
            map.set(etf.symbol, row);
            fragment.appendChild(row);
        }
        updateEtfRow(row, etf);
    });
    if (container) {
        container.appendChild(fragment);
    }
};


const renderOrUpdateAcoes = (data, container, map) => {
    const fragment = document.createDocumentFragment();
    data.forEach(acao => {
        if (!acao.symbol) return;
        let row = map.get(acao.symbol);
        if (!row) {
            row = createAcaoRow(acao.symbol);
            map.set(acao.symbol, row);
            fragment.appendChild(row);
        }
        updateAcaoRow(row, acao);
    });
    if (container) {
        container.appendChild(fragment);
    }
};


// Estado final da arquitetura

// CAMADA 1 — API  → busca
// CAMADA 2 — STRUCTURE (createRow)
// CAMADA 3 — STATE (state + normalize)
    // normalize → padroniza
    // state → armazena
    // Se só guarda dados entao → STATE

// CAMADA 4 — DOMAIN (regras puras)
    // Se só transforma dados entao → DOMAIN

// CAMADA 5 — VIEW = manipula DOM
    // (renderização DOM) = (manipulação visual)

// CAMADA 6 - VIEW UPDATE COMPLETO (FULL SYNC) = → atualiza DOM
    // VIEW (render + update + filterRows)
    // view → desenha
    // Se só mexe no DOM entao → VIEW
    // filter (view state) → reaplicado sempre
    // flash + otimização real
    // updatePriceCell + updateEtfRow + updateAcaoRow

// CAMADA 7 — CONTROLLER (fetch + rebuild + patch)
    // controller → decide render
    // Se chama outras funções entao é → CONTROLLER
