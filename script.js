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
        : 0;

const formatPercent = (value) =>
    typeof value === "number" ? br.format(value) : '---';

const getDayRange = (obj) =>
    obj.regularMarketDayRange ||
    `${obj.regularMarketDayLow ?? '-'} - ${obj.regularMarketDayHigh ?? '-'}`;


// Primeira Tabela
const renderTable = (data) => {
    const container = document.getElementById('quotes-container');

    container.innerHTML = data.map(quote => {
        const variacao = getVariacao(quote);

        return `
            <tr>
                <td><strong>${quote.symbol || 'N/A'}</strong></td>
                <td>${quote.description}</td>
                <td class="price">R$ ${formatPrice(quote.regularMarketPrice)}</td>
                <td class="${aplicarCor(variacao)}">${formatPercent(variacao)}%</td>
                <td>${getDayRange(quote)}</td>
                <td>${formatNumber(quote.min7d)}</td>
                <td>${formatNumber(quote.min30d)}</td>
                <td>${formatNumber(quote.min90d)}</td>
                <td>${formatNumber(quote.fiftyTwoWeekLow)}</td>
                <td>${formatNumber(quote.fiftyTwoWeekHigh)}</td>
            </tr>
        `;
    }).join('');
};


// Segunda Tabela
const renderAcoes = (data) => {
    const tbody = document.getElementById('corpoTabela2');

    const getLogo = (acao) =>
        `https://icons.brapi.dev/icons/${acao.symbol.toLowerCase()}.svg`;

    tbody.innerHTML = data.map(acao => {
        const variacao = getVariacao(acao);
        const logoUrl = getLogo(acao);
        const fallbackUrl = `https://via.placeholder.com/24?text=${acao.symbol[0]}`;

        const logo = `<img src="${logoUrl}"
            loading="lazy" width="24" height="24"
            style="object-fit:contain; border-radius: 4px;"
            onerror="this.onerror=null;this.src='${fallbackUrl}';"
            alt="${acao.symbol} logo">`;

        return `
            <tr>
                <td>
                    <div style="display:flex; align-items:center; gap:8px;">
                        ${logo}
                    </div>
                </td>
                <td><strong>${acao.symbol || 'N/A'}</strong></td>
                <td>${acao.name}</td>
                <td class="price">R$ ${formatPrice(acao.regularMarketPrice)}</td>
                <td class="${aplicarCor(variacao)}">${formatPercent(variacao)}%</td>
                <td>${getDayRange(acao)}</td>
                <td>${formatNumber(acao.min7d)}</td>
                <td>${formatNumber(acao.min30d)}</td>
                <td>${formatNumber(acao.min90d)}</td>
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
        allEtfs = data.etfs || [];
        allAcoes = data.acoes || [];
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
