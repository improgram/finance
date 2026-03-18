let allEtfs = [];

const renderTable = (data) => {
    const container = document.getElementById('quotes-container');
    container.innerHTML = '';

    data.forEach(quote => {
        // Garante que o preço seja um número antes de usar toFixed
        const br = new Intl.NumberFormat('pt-BR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
            });

        // Para o Preço Atual
        const formattedPrice = quote.regularMarketPrice != null
            ? br.format(quote.regularMarketPrice) : '---';

        const formatNumber = (value) =>
            typeof value === 'number' ? br.format(value) : '---';

        // regularMarket Day Range nem sempre vem preenchido
        const dayRange =
            quote.regularMarketDayRange ||
            `${quote.regularMarketDayLow ?? '-'} - ${quote.regularMarketDayHigh ?? '-'}`;

        // Para 52 Semanas
        const formattedLow = typeof quote.fiftyTwoWeekLow === 'number'
            ? br.format(quote.fiftyTwoWeekLow) : '---';

        const formattedHigh = typeof quote.fiftyTwoWeekHigh === 'number'
            ? br.format(quote.fiftyTwoWeekHigh) : '---';

        const min7d = formatNumber(quote.min7d);
        // Fallback é assim: const min7d = quote.min7d ?? null;
        const min30d = formatNumber(quote.min30d);
        const min60d = formatNumber(quote.min60d);
        const histInfo = quote.historicalAvailable ? '' : '(Histórico indisponível)';

        container.innerHTML += `
            <tr>
                <td><strong>        ${quote.symbol || 'N/A'}</strong>   </td>
                <td class="price">R$ ${formattedPrice}                  </td>
                <td>                ${dayRange}                         </td>
                <td>${formatNumber(quote.min7d)} ${!quote.historicalAvailable ? '---' : ''}  </td>
                <td>${formatNumber(quote.min30d)} ${!quote.historicalAvailable ? '---' : ''} </td>
                <td>${formatNumber(quote.min60d)} ${!quote.historicalAvailable ? '---' : ''} </td>
                <td>                ${formattedLow}                     </td>
                <td>                ${formattedHigh}                    </td>
            </tr>
        `;
    });
    document.getElementById('status').style.display = 'none';
};

const updateQuotes = async () => {
    try {
        const statusEl = document.getElementById('status');
            statusEl.style.display = 'block';
            statusEl.innerText = "Carregando...";

        const response = await fetch("/.netlify/functions/get-quotes");

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Erro HTTP: ${response.status}`);
        }

        const data = await response.json();

        if (data.results && Array.isArray(data.results)) {
            // filtra ETFs brasileiros
            allEtfs = data.results;

            if (allEtfs.length === 0) {
                statusEl.innerText = "Nenhum ETF encontrado";
            } else {
                renderTable(allEtfs);
            }
        } else {
            statusEl.innerText = "Formato de dados inválido recebido.";
        }

    } catch (err) {
        console.error("Erro no Fetch:", err);
        document.getElementById('status').innerText =
            "Erro ao carregar dados: " + err.message;
    }
};

// Lógica da Barra de Busca em Tempo Real
document.getElementById('etf-search').addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();

    const filteredEtfs = allEtfs.filter(quote =>
        (quote.symbol || "").toLowerCase().includes(searchTerm) ||
        (quote.name || "").toLowerCase().includes(searchTerm)
    );

    renderTable(filteredEtfs);
});

updateQuotes();



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
