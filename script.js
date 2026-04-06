// menu hamburguer
const hamburger = document.getElementById("hamburger");
const navMenu = document.getElementById("nav-menu");

hamburger.addEventListener("click", () => {
    navMenu.classList.toggle("active");
});

// dropdown projetos
const projetos = document.getElementById("menu-projetos");
const submenu = document.querySelector(".submenu");

projetos.addEventListener("click", (e) => {
    e.preventDefault();
    submenu.style.display =
        submenu.style.display === "block" ? "none" : "block";
});

// fechar menu ao clicar fora
document.addEventListener("click", (e) => {
    if (!navMenu.contains(e.target) && !hamburger.contains(e.target)) {
        navMenu.classList.remove("active");
        submenu.style.display = "none";
    }
});


let allEtfs = [];
let allAcoes = [];

// Ferramenta de Busca
document.getElementById('etf-search').addEventListener('input', (e) => {
    const termo = e.target.value.toLowerCase();

    // 🔎 filtra ETFs
    const etfsFiltrados = allEtfs.filter(etf =>
        (etf.symbol || '').toLowerCase().includes(termo) ||
        (etf.description || '').toLowerCase().includes(termo)
    );

    // 🔎 filtra AÇÕES
    const acoesFiltradas = allAcoes.filter(acao =>
        (acao.symbol || '').toLowerCase().includes(termo) ||
        (acao.name || '').toLowerCase().includes(termo)
    );

    // 🔄 renderiza ambos
    renderTable(etfsFiltrados);
    renderAcoes(acoesFiltradas);

    if (!termo) {       // Se o campo estiver vazio → mostrar tudo novamente:
    renderTable(allEtfs);
    renderAcoes(allAcoes);
    return;
}
});

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
    typeof value === 'number' ? br.format(value) : '---';

const formatPrice = (value) =>
    value != null ? br.format(value) : '---';

const getVariacao = (obj) =>
    typeof obj.regularMarketChangePercent === "number"
        ? obj.regularMarketChangePercent
        : null;

const formatPercent = (value) =>
    typeof value === "number" ? br.format(value) : '---';

const getDayRange = (obj) =>
    obj.regularMarketDayLow != null && obj.regularMarketDayHigh != null
        ? `${formatNumber(obj.regularMarketDayLow)} - ${formatNumber(obj.regularMarketDayHigh)}`
        : '-';

const getVariacao30d = (obj) =>
    typeof obj.variation30d === "number"
        ? obj.variation30d
        : null;


// Primeira Tabela
const renderTable = (data) => {
    const container = document.getElementById('quotes-container');
    container.innerHTML = data.map(quote => {
        const variacao = getVariacao(quote);
        const variacao30d = getVariacao30d(quote);
        return `
            <tr>
                <td><strong>${quote.symbol || 'N/A'}</strong></td>
                <td>${quote.description}</td>
                <td class="price">
                    ${quote.regularMarketPrice  != null
                        ? formatNumber(quote.regularMarketPrice ) : '---'}
                </td>
                <td class="${variacao !== null ? aplicarCor(variacao) : ''}">
                    ${variacao !== null ? formatPercent(variacao) + '%' : '---'}
                </td>
                <td>${getDayRange(quote)}</td>
                <td>${formatNumber(quote.min7d)}</td>
                <td>${formatNumber(quote.min30d)}</td>
                <td class="${variacao30d !== null ? aplicarCor(variacao30d) : ''}">
                    ${variacao30d !== null ? formatPercent(variacao30d) + '%' : '---'}
                </td>
                <td>${formatNumber(quote.fiftyTwoWeekHigh)}</td>
            </tr>
        `;
    }).join('');
};

// Segunda Tabela
const renderAcoes = (data) => {
    const tbody = document.getElementById('corpoTabela2');
    tbody.innerHTML = data.map(acao => {
        const variacao = getVariacao(acao);
        const variacao30d = getVariacao30d(acao);
        // Usar o logourl que o backend já preparou
        const logoUrl = acao.logourl;
        return `
            <tr>
                <td>
                    <img src="${logoUrl}"
                    width="26" height="26" style="object-fit:contain; border-radius: 4px;"
                    onerror="this.onerror=null;this.src='https://via.placeholder.com/24?text=${acao.symbol[0]}';"
                    alt="logo">
                </td>
                <td><strong>${acao.symbol || 'N/A'}</strong></td>
                <td>${acao.name}</td>
                <td class="price">R$ ${formatPrice(acao.regularMarketPrice)}</td>
                <td class="${variacao !== null ? aplicarCor(variacao) : ''}">
                    ${variacao !== null ? formatPercent(variacao) + '%' : '---'}
                </td>
                <td>${getDayRange(acao)}</td>
                <td>${formatNumber(acao.min7d)}</td>
                <td>${formatNumber(acao.min30d)}</td>
                <td class="${variacao30d !== null ? aplicarCor(variacao30d) : ''}">
                    ${variacao30d !== null ? formatPercent(variacao30d) + '%' : '---'}
                </td>
                <td>${formatNumber(acao.fiftyTwoWeekLow)}</td>
                <td>${formatNumber(acao.fiftyTwoWeekHigh)}</td>
            </tr>
        `;
    }).join('');
};


const fetchQuotes = async () => {
    const statusEl = document.getElementById('status');     // Mostrar loading real
    try {
        //  MOSTRA loading antes de buscar
        statusEl.style.display = 'block';
        statusEl.innerText = 'Carregando...';
        const res = await fetch('/.netlify/functions/get-quotes');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        allEtfs = data.data?.etfs || [];
        allAcoes = data.data?.acoes || [];
        renderTable(allEtfs);
        renderAcoes(allAcoes);
        // ESCONDE loading depois de renderizar
        statusEl.style.display = 'none';

    } catch (err) {
        console.error('Erro ao buscar quotes:', err);
        statusEl.style.display = 'block';
        statusEl.innerText = 'Erro ao carregar dados';
    }
};

// Chame a função quando a página carregar
window.addEventListener('DOMContentLoaded', fetchQuotes);


/*
Fluxo do sistema:
Brapi API
   ↓
Netlify Serverless Function
   ↓
retorna JSON
{
  results: []
}
   ↓
Frontend JS
   ↓
filtra ETFs brasileiros
   ↓
renderiza tabela HTML
*/
