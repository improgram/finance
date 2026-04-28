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

    if (navMenu && hamburger) {
        if (!navMenu.contains(target) && !hamburger.contains(target)) {
            navMenu.classList.remove("active");
        }
    }

    if (submenu && !submenu.contains(target)) {
        submenu.style.display = "none";
    }
});


// Ferramenta de Busca
const searchInput = document.getElementById('etf-search');
if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        const termo = e.target.value.toLowerCase();
        const etfsFiltrados = (state.etfs || []).filter(etf =>
            (etf.symbol || '').toLowerCase().includes(termo) ||
            (etf.description || '').toLowerCase().includes(termo)
        );
        const acoesFiltradas = (state.acoes || []).filter(acao =>
            (acao.symbol || '').toLowerCase().includes(termo) ||
            (acao.longName || '').toLowerCase().includes(termo)
        );
        renderOrUpdateEtfs(etfsFiltrados, containerEtf, etfMap);
        renderOrUpdateAcoes(acoesFiltradas, containerAcoes, acoesMap);
        if (!termo) {
            renderOrUpdateEtfs(state.etfs, containerEtf, etfMap);
            renderOrUpdateAcoes(state.acoes, containerAcoes, acoesMap);
        }
    });
}

const statusAtualizacaoEl = document.getElementById('status-atualizacao');
const statusLoadingEl = document.getElementById('status');          // Loading geral

// Ultima Chamada no DOM = function quando a página terminar de carregar
window.addEventListener('DOMContentLoaded', () => {
    containerEtf = document.getElementById('quotes-container');
    containerAcoes = document.getElementById('corpoTabela2');
    fetchQuotes();
});


// Primeira Tabela = ETF
const createEtfRow = (symbol) => {
    const row = document.createElement('tr');
    row.dataset.symbol = symbol;
    row.innerHTML = `
        <td><strong class="symbol"></strong></td>
        <td class="desc"></td>
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
        <td class="max1y"></td>
    `;
    return row;
};


// CAMADA 3 — STATE (estado global controlado)

const etfMap = new Map();
const acoesMap = new Map();
let containerEtf;
let containerAcoes;
const state = {
  lastSignature: null,
  etfs: [],
  acoes: []
}


// CAMADA 4 — DOMAIN HELPERS (regras puras)

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


// 🌍 FORMATADORES E HELPERS GLOBAIS

const br = new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
});
const formatNumber = (value) =>
    typeof value === 'number'
        ? br.format(value)
        : 'Sem histórico';

const formatPrice = (value) =>
    value != null ? br.format(value) : '---';

const formatPercent = (value) =>
    typeof value === "number"
        ? `${br.format(value)}%`
        : '---';

// 1° carga = limpa o DOM  /   mesmo snap=só att valores
// ticket mudou ordem = rebuild    / preço mudou = update incremental
// Se o backend mudar ordem ou snapshot resetar limpa o DOM no primeiro load
const buildSnapshotSignature = (etfs, acoes) => {
    const normalize = (arr) =>
        arr.map(x => x.symbol).filter(Boolean).join('|'); // ⚠️ sem sort

    return `${normalize(etfs)}::${normalize(acoes)}`;
};


// CAMADA 5 — VIEW (renderização DOM): renderTable e renderAcoes
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


// CAMADA 6 - UPDATE COMPLETO (FULL SYNC) = → atualiza DOM
const updateEtfRow = (row, quote) => {
    const variacao = getVariacao(quote);
    const variacao30d = getVariacao30d(quote);
    row.querySelector('.symbol').textContent = quote.symbol;
    row.querySelector('.desc').textContent = quote.description;
    updatePriceCell(row.querySelector('.price'), quote.regularMarketPrice);
    const varEl = row.querySelector('.var');
    varEl.textContent = variacao !== null ? formatPercent(variacao) + '%' : '---';
    varEl.className = `var ${variacao !== null ? aplicarCor(variacao) : ''}`;
    row.querySelector('.range').textContent = getDayRange(quote);
    row.querySelector('.min7').textContent = formatNumber(quote.min7d);
    row.querySelector('.min30').textContent = formatNumber(quote.min30d);
    const var30El = row.querySelector('.var30');
    var30El.textContent = variacao30d !== null ? formatPercent(variacao30d) + '%' : '---';
    var30El.className = `var30 ${variacao30d !== null ? aplicarCor(variacao30d) : ''}`;
    row.querySelector('.max').textContent = formatNumber(quote.fiftyTwoWeekHigh);
};


const updateAcaoRow = (row, acao) => {
    const variacao = getVariacao(acao);
    const variacao30d = getVariacao30d(acao);
    row.querySelector('.symbol').textContent = acao.symbol;
    row.querySelector('.name').textContent = acao.longName;
    updatePriceCell(row.querySelector('.price'), acao.regularMarketPrice);
    const varEl = row.querySelector('.var');
    varEl.textContent = variacao !== null ? formatPercent(variacao) + '%' : '---';
    varEl.className = `var ${variacao !== null ? aplicarCor(variacao) : ''}`;
    row.querySelector('.range').textContent = getDayRange(acao);
    row.querySelector('.min7').textContent = formatNumber(acao.min7d);
    row.querySelector('.min30').textContent = formatNumber(acao.min30d);
    const var30El = row.querySelector('.var30');
    var30El.textContent = variacao30d !== null ? formatPercent(variacao30d) + '%' : '---';
    var30El.className = `var30 ${variacao30d !== null ? aplicarCor(variacao30d) : ''}`;
    row.querySelector('.min1y').textContent = formatNumber(acao.fiftyTwoWeekLow);
    row.querySelector('.max1y').textContent = formatNumber(acao.fiftyTwoWeekHigh);
    const logo = row.querySelector('.logo');
    logo.src = acao.logourl || `https://via.placeholder.com/24?text=${acao.symbol || 'X'}`;
};


// CAMADA 7 - UPDATE ULTRA LEVE (SÓ PREÇO)
// flash + otimização real
const updatePriceCell = (priceEl, newPriceRaw) => {
    const oldPriceRaw = priceEl.dataset.value;
    if (oldPriceRaw !== undefined && Number(oldPriceRaw) !== Number(newPriceRaw)) {
        priceEl.classList.add('flash');
        setTimeout(() => priceEl.classList.remove('flash'), 500);
    }
    priceEl.dataset.value = newPriceRaw;
    priceEl.textContent = formatNumber(newPriceRaw);
};


// CAMADA 8 — CONTROLLER (orquestrador) → decide criar ou atualizar
// somente Main
// fetchQuotes → delega

const fetchQuotes = async () => {
    const handleError = (err) => {
            console.error("Erro ao carregar quotes:", err);
            showError?.();
            updateTimestamp?.({ updatedLabel: "Erro na atualização" });
    };
    try {
        const json = await getQuotes();
        const etfs = json.data?.etfs || [];
        const acoes = json.data?.acoes || [];
        state.etfs = etfs;
        state.acoes = acoes;
        const signature = buildSnapshotSignature(etfs, acoes);
        const isInitialRender = !state.lastSignature;
        const shouldRebuild = isInitialRender || signature !== state.lastSignature;
        if (shouldRebuild) {
            safeClear(containerEtf);
            safeClear(containerAcoes);
            etfMap.clear();
            acoesMap.clear();
        }
        renderOrUpdateEtfs(state.etfs, containerEtf, etfMap);
        renderOrUpdateAcoes(state.acoes, containerAcoes, acoesMap);
        state.lastSignature = signature;
        // try + catch: prevenir erro de API ou rede ou erro de parsing
    } catch (err) {
        handleError(err);
    }
};
// Fim do fetchQuotes


const renderOrUpdateEtfs = (data, container, map) => {
    const fragment = document.createDocumentFragment();

    data.forEach(quote => {
        let row = map.get(quote.symbol);
        if (!row) {
            row = createEtfRow(quote.symbol);
            map.set(quote.symbol, row);
            container.appendChild(row);
        }
        updateEtfRow(row, quote);
    });
    container.appendChild(fragment);
};


const renderOrUpdateAcoes = (data, container, map) => {
    const fragment = document.createDocumentFragment();
    data.forEach(acao => {
        let row = map.get(acao.symbol);
        if (!row) {
            row = createAcaoRow(acao.symbol);
            map.set(acao.symbol, row);
            container.appendChild(row);
        }
        updateAcaoRow(row, acao);
    });
    container.appendChild(fragment);
};
