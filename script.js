let allEtfs = [];
let allAcoes = [];

// Ferramenta de Busca
document.getElementById('etf-search').addEventListener('input', (e) => {
    const termo = e.target.value.toLowerCase();

    const filtrados = allEtfs.filter(etf =>
        etf.symbol.toLowerCase().includes(termo) ||
        etf.description.toLowerCase().includes(termo)
    );

    renderTable(filtrados);
});

// cores automáticas (verde/vermelho)
function aplicarCor(valor) {
    if (valor > 0) return "positive";
    if (valor < 0) return "negative";
    return "neutral";
}

// Buscar Logos fora do Map
const getLogo = (acao) => {
    if (acao.logo_url) return acao.logo_url;

    // remove números do ticker (ex: PETR4 → petr)
    const base = acao.symbol.replace(/\d/g, '').toLowerCase();

    // tenta Clearbit primeiro
    const clearbitUrl = `https://logo.clearbit.com/${base}.com`;
    return clearbitUrl;
};

// Primeira Tabela
const renderTable = (data) => {
    const container = document.getElementById('quotes-container');

    const br = new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    const formatNumber = (value) =>
        typeof value === 'number' ? br.format(value) : '---';

    container.innerHTML = data.map(quote => {

        const formattedPrice = quote.regularMarketPrice != null
            ? br.format(quote.regularMarketPrice)
            : '---';

        const dayRange = quote.regularMarketDayRange ||
            `${quote.regularMarketDayLow ?? '-'} - ${quote.regularMarketDayHigh ?? '-'}`;

        const formattedLow = typeof quote.fiftyTwoWeekLow === 'number'
            ? br.format(quote.fiftyTwoWeekLow) : '---';

        const formattedHigh = typeof quote.fiftyTwoWeekHigh === 'number'
            ? br.format(quote.fiftyTwoWeekHigh) : '---';

        const variacao = typeof quote.regularMarketChangePercent === "number"
            ? quote.regularMarketChangePercent
            : 0;

        const formattedPercent = br.format(variacao);

        return `
            <tr>
                <td><strong>${quote.symbol || 'N/A'}</strong></td>
                <td>${quote.description}</td>
                <td class="price">R$ ${formattedPrice}</td>
                <td class="${aplicarCor(variacao)}">${formattedPercent}%</td>
                <td>${dayRange}</td>
                <td>${formatNumber(quote.min7d)}</td>
                <td>${formatNumber(quote.min30d)}</td>
                <td>${formatNumber(quote.min60d)}</td>
                <td>${formattedLow}</td>
                <td>${formattedHigh}</td>
            </tr>
        `;
    }).join('');
};

// Segunda Tabela
const renderAcoes = (data) => {
    const tbody = document.getElementById('corpoTabela2');

    const br = new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });

    const formatNumber = (value) =>
        typeof value === 'number' ? br.format(value) : '---';

    // Usando map para criar todas as linhas e depois inserir de uma vez
    tbody.innerHTML = data.map(acao => {

        const logo = `<img
            src="${getLogo(acao)}"
            loading="lazy"
            width="24"
            height="24"
            style="object-fit:contain;"
            onerror="this.onerror=null;this.src='https://ui-avatars.com/api/?name=${acao.symbol}&size=24'"
            alt="${acao.symbol} logo">`;

        const preco = typeof acao.regularMarketPrice === 'number'
            ? br.format(acao.regularMarketPrice)
            : '---';

        const min12m = typeof acao.fiftyTwoWeekLow === 'number'
            ? br.format(acao.fiftyTwoWeekLow)
            : '---';

        const alvo = typeof acao.fiftyTwoWeekHigh === 'number'
            ? br.format(acao.fiftyTwoWeekHigh)
            : '---';

        const variacao = acao.regularMarketChangePercent ?? null;

        const formattedPercent = variacao !== null
            ? br.format(variacao)
            : '---';

        return `
            <tr>
                <td>
                    <div style="display:flex; align-items:center; gap:8px;">
                        ${logo}
                    </div>
                </td>
                <td><strong>${acao.symbol || 'N/A'}</strong></td>
                <td>${acao.name}</td>
                <td class="price">R$ ${preco}</td>
                <td class="${aplicarCor(variacao)}">${formattedPercent}%</td>
                <td>${formatNumber(acao.min7d)}</td>
                <td>${formatNumber(acao.min30d)}</td>
                <td>${formatNumber(acao.min60d)}</td>
                <td>${min12m}</td>
                <td>${alvo}</td>
            </tr>
        `;
    }).join('');
    // <td> ${formatNumber(acao.min7d)} ${!acao.historicalAvailable ? '---' : ''} </td>
};

const fetchQuotes = async () => {
    // Mostrar loading real
    const statusEl = document.getElementById('status');

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
