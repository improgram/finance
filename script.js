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
    hamburger.addEventListener("click", (e) => {
        e.stopPropagation();
        navMenu.classList.toggle("active");

        hamburger.textContent =
        navMenu.classList.contains("active")
            ? "✕"
            : "☰";
    });
}

// dropdown projetos
const projetos = document.getElementById("menu-projetos");
const submenu = document.querySelector(".submenu");
if (projetos && submenu) {
    projetos.addEventListener("click", (e) => {
        e.preventDefault();
        submenu.classList.toggle('open');
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
        hamburger.textContent = "☰";
    }
});

// fechar submenu ao clicar no item interno
if (submenu) {
    submenu.addEventListener('click', () => {
    submenu.classList.remove('open');
    });
}

// fechar automaticamente o menu quando o usuário escolher uma opção
document.querySelectorAll("#nav-menu a").forEach(link => {
    link.addEventListener("click", () => {
        navMenu.classList.remove("active");
        // fechar hamburguer quando clicando fora
        hamburger.textContent = "☰";
    });
});


// applyFilters chama state
const etfMap = new Map();
const acoesMap = new Map();
let containerEtf;
let containerAcoes;

// 🔥 trava de concorrência
let isFetching = false;

const state = {
  lastSignature: null,
  filterTerm: '',
  etfs: [],
  acoes: [],
  lastPrices: new Map()
}


// UI STATE (estado efêmero de interface)
const uiState = {
    tooltip: {
        timer: null,
        symbol: null,
        row: null
    }
};


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
        return;             // 🚨 impede execução do app quebrado
    }
    fetchQuotes();          // 1ª execução assim que a página carrega

    // Configura att automática (2.0 minutos => mais ou menos 300.000 ms)
    // Executa logo após o intervalo de folga planejado para o backend (xx min)
    const REFRESH_INTERVAL = 2.0 * 60 * 1000;

    const scheduleNextFetch = () => {
        setTimeout(async () => {
            await fetchQuotes();
            scheduleNextFetch();
        }, REFRESH_INTERVAL);
    };

    scheduleNextFetch();
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
        <td class="volume"></td>
        <td class="avg-volume"></td>
        <td class="var30"></td>
        <td class="max"></td>
    `;
    row.cellsRef = {
        symbol: row.querySelector('.symbol'),
        description: row.querySelector('.description'),
        price: row.querySelector('.price'),
        var: row.querySelector('.var'),
        range: row.querySelector('.range'),
        min7: row.querySelector('.min7'),
        volume: row.querySelector('.volume'),
        avgVolume: row.querySelector('.avg-volume'),
        var30: row.querySelector('.var30'),
        max: row.querySelector('.max')
    };
    return row;
};

// segunda tabela = açoes
const createAcaoRow = (symbol) => {
    const row = document.createElement('tr');
    row.dataset.symbol = symbol;
    row.innerHTML = `
        <td><img class="logo"> </td>
        <td class="name"> </td>
        <td class="price"> </td>
        <td class="var"> </td>
        <td class="range"> </td>
        <td class="min7"> </td>
        <td class="min30"> </td>
        <td class="var30"> </td>
        <td class="min1y"> </td>
        <td class="max"> </td>
    `;
    row.cellsRef = {
        logo: row.querySelector('.logo'),
        name: row.querySelector('.name'),
        price: row.querySelector('.price'),
        var: row.querySelector('.var'),
        range: row.querySelector('.range'),
        min7: row.querySelector('.min7'),
        min30: row.querySelector('.min30'),
        var30: row.querySelector('.var30'),
        min1y: row.querySelector('.min1y'),
        max: row.querySelector('.max')
    };
    return row;
};


// CAMADA 3 — STATE (estado global controlado)
// state guarda dados normalizados

const normalizeState = (q) => ({
    symbol: q.symbol,
    description: q.description || '-',
    longName: q.longName || q.shortName || q.description || (q.symbol ? q.symbol : '-') ,
    regularMarketPrice: q.regularMarketPrice ?? null,
    // 🔥 fallback inteligente
    regularMarketChangePercent: q.regularMarketChangePercent ?? q.changePercent ?? null,
    min7d: q.min7d ?? null,
    min30d: q.min30d ?? null,
    variation30d: q.variation30d ?? null,
    regularMarketDayLow: q.regularMarketDayLow ?? null,
    regularMarketDayHigh: q.regularMarketDayHigh ?? null,
    volume: q.volume ?? null,
    averageVolume: q.averageVolume ?? null,
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

const getDayRange = (obj) => {
    // Inserir Range Visual => gráfico dentro da célula
    if (
        typeof obj.regularMarketDayLow !== 'number' ||
        typeof obj.regularMarketDayHigh !== 'number' ||
        typeof obj.regularMarketPrice !== 'number'
    ) return '-';
    const min = obj.regularMarketDayLow;
    const max = obj.regularMarketDayHigh;
    const price = obj.regularMarketPrice;
    const range = max - min;
    if (range <= 0) return '-';

    const rawPercent = ((price - min) / range) * 100;
    const percent = Math.min(100, Math.max(0, rawPercent));
    return `
        <div class="range-wrapper">
            <span class="range-min">${formatNumber(min)}</span>
            <div class="range-bar">
                <div class="range-fill" style="width:${percent}%"></div>
            </div>
            <span class="range-max">${formatNumber(max)}</span>
        </div>
    `;
}

const formatVolume = (value) => {
    if (typeof value !== 'number') return '---';
    if (value >= 1_000_000_000) {
        return `${(value / 1_000_000_000).toFixed(2)}B`;
    }
    if (value >= 1_000_000) {
        return `${(value / 1_000_000).toFixed(2)}M`;
    }
    if (value >= 1_000) {
        return `${(value / 1_000).toFixed(1)}K`;
    }
    return formatNumber(value);
};

// Horario da Bolsa
const isMarketOpen = () => {
    const now = new Date();

    // horário Brasil (B3 usa São Paulo)
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const time = hours * 60 + minutes;

    // B3: 10:00 - 17:55 (aproximação prática)
    const open = 10 * 60;
    const close = 17 * 60 + 55;
    const isWeekday = now.getDay() >= 1 && now.getDay() <= 5;
    return isWeekday && time >= open && time <= close;
};

// cores automáticas (verde/vermelho)
function aplicarCor(valor) {
    if (valor > 3) return "strong-positive";
    if (valor > 0) return "positive";
    if (valor < -3) return "strong-negative";
    if (valor < 0) return "negative";
    return "neutral";
}

// 1° carga = limpa o DOM  /   mesmo snap = só att valores
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

// cria tooltip DOM
// Tooltip  usa sempre os dados presentes em state.etfs e state.acoes
// qualquer campo que você queira exibir no tooltip precisa primeiro:
// Backend Enviar o Json
// function Normalize padroniza dados de um ativo
const bbTooltip = document.createElement("div");
        bbTooltip.className = "bb-tooltip hidden";
        document.body.appendChild(bbTooltip);


// CAMADA 6 - VIEW UPDATE COMPLETO (FULL SYNC) = → atualiza DOM

// duração do flash = 5 minutos
const FLASH_DURATION = 3 * 60 * 1000;

// aplica/remover efeito visual prolongado
const applyFlashEffect = (el, direction) => {
    if (!el) return;
    console.log('FLASH:', el, direction, el.className);
    const finalClass = direction === 'up' ? 'flash-up' : 'flash-down';
    // limpa classes anteriores
    el.classList.remove('flash-gold', 'flash-up', 'flash-down' );
    // força reflow
    void el.offsetWidth;
    // PASSO 1 → flash dourado curto
    el.classList.add('flash-gold');
    // limpa timeout antigo
    if (el.flashTimeout) {
        clearTimeout(el.flashTimeout);
    }
    if (el.flashRemoveTimeout) {
        clearTimeout(el.flashRemoveTimeout);
    }
    // PASSO 2 → troca para verde/vermelho
    el.flashTimeout = setTimeout(() => {
        el.classList.remove('flash-gold');
        // força repaint
        void el.offsetWidth;
        el.classList.add(finalClass);
        // PASSO 3 → remove após xx min
        el.flashRemoveTimeout = setTimeout(() => {
            el.classList.remove(
                'flash-up',
                'flash-down'
            );
        }, FLASH_DURATION);
    }, 15000); // duração do gold
};

// flash + otimização real
const updatePriceCell = (priceEl, varEl, newPriceRaw, prevPrice) => {
    if (!priceEl) return;
    const oldPrice = typeof prevPrice === 'number' ? prevPrice : NaN;
    const newPrice = typeof newPriceRaw === 'number' ? newPriceRaw : NaN;
    priceEl.dataset.value = newPrice;
    priceEl.textContent = !isNaN(newPrice) ? formatNumber(newPrice) : 'Sem histórico';
    const changed = !isNaN(oldPrice) && !isNaN(newPrice) && oldPrice !== newPrice;
    if (!changed) return;
    // alta
    if (newPrice > oldPrice) {
        applyFlashEffect(priceEl, 'up');
        if (varEl) {
            applyFlashEffect(varEl, 'up');
        }
    }
    // baixa
    else if (newPrice < oldPrice) {
        applyFlashEffect(priceEl, 'down');
        if (varEl) {
            applyFlashEffect(varEl, 'down');
        }
    }
}

// APENAS dados comuns) Responsabilidade: símbolo+ variação + preço base
const updateCommonRow = (row, data) => {
    const {
        symbol: elSymbol,
        price: elPrice,
        var: elVar,
        range: elRange,
        var30: elVar30,
    } = row.cellsRef;

    if (elSymbol) elSymbol.textContent = data.symbol;
    const variacao = getVariacao(data);
    const variacao30d = getVariacao30d(data);
    if (elVar) {
        elVar.textContent = variacao !== null ? formatPercent(variacao) : '---';
        elVar.className = `var ${aplicarCor(variacao) || ''}`;
    }
    if (elPrice) {
        updatePriceCell(elPrice, elVar, data.regularMarketPrice, data.prevPrice );
    }
    if (elRange) elRange.innerHTML = getDayRange(data);
    if (elVar30) {
        elVar30.textContent = variacao30d !== null ? formatPercent(variacao30d) : '---';
        elVar30.className = `var30 ${variacao30d !== null ? aplicarCor(variacao30d) : ''}`;
    }
};
// FiM da updateCommonRow

// function só para regras de preço
const applyPriceRules = (row, data) => {
    const {
        price: elPrice,
        min7: elMin7,
        min30: elMin30,
        min1y: elMin1y,
        max: elMax
    } = row.cellsRef;

    if (!elPrice) return;
    const norm = v => typeof v === 'number' ? Math.round(v * 100) / 100 : null;
    const priceN = norm(data.regularMarketPrice);
    if (priceN === null) return;

    const min7N = norm(data.min7d);
    const min30N = norm(data.min30d);
    const min1yN = norm(data.fiftyTwoWeekLow);
    const max1yN = norm(data.fiftyTwoWeekHigh);
    elPrice.classList.remove('danger-price-soft', 'danger-price-hard', 'danger-price-year', 'success-price-hard');
    elMin7?.classList.remove('danger-price-soft', 'danger-price-hard' );
    elMin30?.classList.remove('danger-price-soft', 'danger-price-hard' );
    elMin1y?.classList.remove( 'danger-price-year' );
    elMax?.classList.remove( 'success-price-hard' );

    const belowMin7 = min7N !== null && priceN <= min7N;
    const belowMin30 = min30N !== null && priceN <= min30N;
    const dayLowN  = norm(data.regularMarketDayLow);
    const dayHighN = norm(data.regularMarketDayHigh);
    const TOL = 0.05;
    const atMin1y = dayLowN !== null && min1yN !== null && dayLowN <= (min1yN + TOL);
    const atMax1y = dayHighN !== null && max1yN !== null && dayHighN >= (max1yN - TOL);
    if (atMax1y) {
        elMax?.classList.add('success-price-hard');
    } else if (atMin1y) {
        elMin1y?.classList.add('danger-price-year');
    } else if (belowMin30) {
        elMin30?.classList.add('danger-price-hard');
    } else if (belowMin7) {
        elMin7?.classList.add('danger-price-soft');
    }
};


// description é a coluna exclusiva da tabela ETFs
// chama updateCommonRow + updatePriceLogic (versão ETF)
// innerHTML e nao textContent para o texto aceitar mudança da cor via script
const updateEtfRow = (row, etf) => {
    updateCommonRow(row, etf);
    applyPriceRules(row, etf);

    const {
        description: elDescription,
        min7: elMin7,
        max: elMax,
        volume: elVolume,
        avgVolume: elAvgVolume
    } = row.cellsRef;

    if (elDescription) { elDescription.innerHTML = etf.description; };
    elMin7 && (elMin7.textContent = formatNumber(etf.min7d));
    elMax && (elMax.textContent = formatNumber(etf.fiftyTwoWeekHigh));
    elVolume && (elVolume.textContent = formatVolume(etf.volume));
    elAvgVolume && (elAvgVolume.textContent = formatVolume(etf.averageVolume));
};


// Logo + nome da empresa + preço minimo de 1 ano => exclusivos da tabela açoes
// chama updateCommonRow + updatePriceLogic (versão ações)
const updateAcaoRow = (row, acao) => {
    updateCommonRow(row, acao);
    applyPriceRules(row, acao);
    const {
        name: elName,
        logo: elLogo,
        min7: elMin7,
        min30: elMin30,
        min1y: elMin1y,
        max: elMax
    } = row.cellsRef;
    elName && (elName.textContent = acao.longName);
    if (elLogo) {
        elLogo.src =
            acao.logourl ||
            `https://via.placeholder.com/24?text=${acao.symbol || 'X'}`;

        elLogo.alt = acao.symbol || '';
    }

    elMin7 && (elMin7.textContent = formatNumber(acao.min7d));
    elMin30 && (elMin30.textContent = formatNumber(acao.min30d));
    elMin1y && (elMin1y.textContent = formatNumber(acao.fiftyTwoWeekLow));
    elMax && (elMax.textContent = formatNumber(acao.fiftyTwoWeekHigh));
};


// monta o mini-card (ETF_INFO + data backend)
const renderTooltip = (symbol, data, event) => {
    const info = typeof ETF_INFO !== "undefined" ? ETF_INFO[symbol] : {};
    const price = data?.regularMarketPrice;
    const change = data?.regularMarketChangePercent ?? data?.changePercent;
    bbTooltip.innerHTML = `
        <div class="title">
            ${symbol}
        </div>
        <div class="price">
            R$ ${formatNumber(price)}
        </div>
        <div class="change" style="color:${change >= 0 ? '#00d084' : '#ff4d4d'}">
            ${formatPercent(change)}
        </div>
        <div class="desc">
            ${info.description || data.longName || "Sem descrição"}
        </div>
    `;
    bbTooltip.classList.add("show");
    bbTooltip.classList.remove("hidden");
    moveTooltip(event);
};

// Seguir Mouse (fixo estilo Bloomberg)
const moveTooltip = (event) => {
    const offset = 15;
    let x = event.clientX + offset;
    let y = event.clientY + offset;
    const rect = bbTooltip.getBoundingClientRect();
    if (x + rect.width > window.innerWidth) {
        x = event.clientX - rect.width - offset;
    }
    if (y + rect.height > window.innerHeight) {
        y = event.clientY - rect.height - offset;
    }
    bbTooltip.style.left = `${x}px`;
    bbTooltip.style.top = `${y}px`;
};

// FUNÇÃO PRINCIPAL (hover control)
const attachTooltip = (row, symbol, getDataFn) => {
    if (row.dataset.tooltipBound === "true") return;
        row.dataset.tooltipBound = "true";

    row.addEventListener("mouseenter", (e) => {
        // cancela qualquer tooltip anterior
        uiState.tooltip.symbol = symbol;
        uiState.tooltip.row = row;
        uiState.tooltip.timer = setTimeout(() => {
            const data = getDataFn(symbol);
            // segurança: evita tooltip “fantasma”
            if (!data || uiState.tooltip.symbol !== symbol) return;
            renderTooltip(symbol, data, e);
        }, 400); // delay Bloomberg
    });

    row.addEventListener("mouseleave", () => {
        clearTimeout(uiState.tooltip.timer);
        uiState.tooltip.timer = null;
        if (uiState.tooltip.symbol === symbol) {
            bbTooltip.classList.remove("show");
            bbTooltip.classList.add("hidden");
            bbTooltip.innerHTML = "";

            uiState.tooltip.symbol = null;
            uiState.tooltip.row = null;
        }
    });
    row.addEventListener("mousemove", (e) => {
        if (bbTooltip.classList.contains("show")) {
            moveTooltip(e);
        }
    });
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
    // 🚫 evita chamadas simultâneas
    if (isFetching) return;
    isFetching = true;

    const handleError = (err) => {
        console.error("Erro ao carregar quotes", err);
        showError();
        updateTimestamp({ updatedLabel: "Erro na atualização" });
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
        etfs.forEach(e => {
            e.prevPrice = state.lastPrices.get(e.symbol);
            state.lastPrices.set(e.symbol, e.regularMarketPrice);
        });

        acoes.forEach(a => {
            a.prevPrice = state.lastPrices.get(a.symbol);
            state.lastPrices.set(a.symbol, a.regularMarketPrice);
        });
        state.etfs = etfs;
        state.acoes = acoes;
        // Se backend mudar tickers vai acumulando para sempre => Correçao apos fetch:
        const activeSymbols = new Set([...etfs.map(e => e.symbol), ...acoes.map(a => a.symbol) ]);

        for (const key of state.lastPrices.keys()) {
            if (!activeSymbols.has(key)) { state.lastPrices.delete(key); }
        }

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
    } finally {
        isFetching = false;     // libera a trava
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
        attachTooltip(row, etf.symbol, (symbol) =>
            state.etfs.find(e => e.symbol === symbol)
        );
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
        attachTooltip(row, acao.symbol, (symbol) =>
            state.acoes.find(a => a.symbol === symbol)
        );
    });
    if (container) {
        container.appendChild(fragment);
    }
};

// google analytics
window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', 'G-SYDVYX3NVZ');



// Estado final da arquitetura => separação por camadas

// CAMADA 1 — API  → busca
// CAMADA 2 — STRUCTURE (createRow)
// CAMADA 3 — STATE centralizado (state + normalize)
    // normalize → padroniza
    // state → armazena
    // Se só guarda dados entao → STATE

// CAMADA 4 — DOMAIN (regras puras)
    // Se só transforma dados entao → DOMAIN

// CAMADA 5 — VIEW = manipula DOM
    // (renderização DOM) = (manipulação visual)

// CAMADA 6 - VIEW UPDATE COMPLETO (FULL SYNC) = → atualiza DOM
    // VIEW (render incremental + update + filterRows)
    // view → desenha
    // Se só mexe no DOM entao → VIEW
    // filter (view state) → reaplicado sempre
    // flash + otimização real
    // updatePriceCell + updateEtfRow + updateAcaoRow

// CAMADA 7 — CONTROLLER (fetch + rebuild + patch)
    // controller → decide render
    // Se chama outras funções entao é → CONTROLLER
