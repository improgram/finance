let allEtfs = [];

// cores automáticas (verde/vermelho)
function aplicarCor(valor) {
    if (valor > 0) return "positive";
    if (valor < 0) return "negative";
    return "neutral";
}

const renderTable = (data) => {
    const container = document.getElementById('quotes-container');
    container.innerHTML = '';

    const br = new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });

    data.forEach(quote => {
        // Preço atual
        const formattedPrice = quote.regularMarketPrice != null
            ? br.format(quote.regularMarketPrice) : '---';

        const formatNumber = (value) =>
            typeof value === 'number' ? br.format(value) : '---';

        const dayRange = quote.regularMarketDayRange ||
            `${quote.regularMarketDayLow ?? '-'} - ${quote.regularMarketDayHigh ?? '-'}`;

        const formattedLow = typeof quote.fiftyTwoWeekLow === 'number'
            ? br.format(quote.fiftyTwoWeekLow) : '---';

        const formattedHigh = typeof quote.fiftyTwoWeekHigh === 'number'
            ? br.format(quote.fiftyTwoWeekHigh) : '---';

        const min7d = formatNumber(quote.min7d);
        const min30d = formatNumber(quote.min30d);
        const min60d = formatNumber(quote.min60d);

        const variacao = typeof quote.regularMarketChangePercent === "number"
            ? quote.regularMarketChangePercent
            : 0;

        const formattedPercent = br.format(variacao);

        container.innerHTML += `
            <tr>
                <td><strong>${quote.symbol || 'N/A'}</strong></td>
                <td>${quote.description}</td>
                <td class="price">R$ ${formattedPrice}</td>
                <td class="${aplicarCor(variacao)}">${formattedPercent}%</td>
                <td>${dayRange}</td>
                <td>${min7d} ${!quote.historicalAvailable ? '---' : ''}</td>
                <td>${min30d} ${!quote.historicalAvailable ? '---' : ''}</td>
                <td>${min60d} ${!quote.historicalAvailable ? '---' : ''}</td>
                <td>${formattedLow}</td>
                <td>${formattedHigh}</td>
            </tr>
        `;
    });

    document.getElementById('status').style.display = 'none';
};

const renderAcoes = (data) => {
    const tbody = document.getElementById('corpoTabela2');
    tbody.innerHTML = '';

    const br = new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });

    data.forEach(acao => {
        const preco = typeof acao.regularMarketPrice === 'number'
            ? br.format(acao.regularMarketPrice)
            : '---';

        const min12m = typeof acao.fiftyTwoWeekLow === 'number'
            ? br.format(acao.fiftyTwoWeekLow)
            : '---';

        const alvo = typeof acao.fiftyTwoWeekHigh === 'number'
            ? br.format(acao.fiftyTwoWeekHigh)
            : '---';

        const variacao = typeof acao.regularMarketChangePercent === "number"
            ? acao.regularMarketChangePercent
            : 0;

        const formattedPercent = br.format(variacao);

        const formatNumber = (value) =>
            typeof value === 'number' ? br.format(value) : '---';

        tbody.innerHTML += `
            <tr>
                <td style="display: flex; align-items: center; gap: 8px;">
                    ${acao.logo_url
                        ? `<img src="${acao.logo_url}" width="24" height="24" style="object-fit: contain;" alt="${acao.symbol} logo">`
                        : ''}
                </td>
                <td>${acao.name || acao.symbol}</td>
                <td>R$ ${preco}</td>
                <td class="${aplicarCor(variacao)}">${formattedPercent}%</td>
                <td>${formatNumber(acao.min7d)} ${!acao.historicalAvailable ? '---' : ''}</td>
                <td>${formatNumber(acao.min30d)} ${!acao.historicalAvailable ? '---' : ''}</td>
                <td>${formatNumber(acao.min60d)} ${!acao.historicalAvailable ? '---' : ''}</td>
                <td>${min12m}</td>
                <td>${alvo}</td>
            </tr>
        `;
    });
};

renderTable();

renderAcoes();

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
