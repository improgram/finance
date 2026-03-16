let allEtfs = [];
const renderTable = (data) => {
    const container = document.getElementById('quotes-container');
    container.innerHTML = '';

    data.forEach(quote => {
        // A Brapi no endpoint /quote usa 'logourl' em vez de apenas 'logo'
        const logoUrl =
            quote.logourl ||
            quote.logo ||
            `https://icons.brapi.dev/icons/${quote.symbol}.svg`;

        // Garante que o preço seja um número antes de usar toFixed
        const br = new Intl.NumberFormat('pt-BR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
            });

        // Para o Preço Atual
        const formattedPrice = typeof quote.regularMarketPrice === 'number'
            ? br.format(quote.regularMarketPrice) : '---';

        // regularMarket Day Range nem sempre vem preenchido
        const dayRange =
            quote.regularMarketDayRange ||
            `${quote.regularMarketDayLow ?? '-'} - ${quote.regularMarketDayHigh ?? '-'}`;

        // Para as 52 Semanas
        const formattedLow = typeof quote.fiftyTwoWeekLow === 'number'
            ? br.format(quote.fiftyTwoWeekLow) : '---';

        const formattedHigh = typeof quote.fiftyTwoWeekHigh === 'number'
            ? br.format(quote.fiftyTwoWeekHigh) : '---';

        container.innerHTML += `
            <tr>
                <td style="text-align:center">
                    <img src="${logoUrl}" width="26"
                    onerror="this.src='https://icons.brapi.dev/icons/BOVA11.svg'"
                        style="border-radius: 4px;">
                </td>
                <td><strong>        ${quote.symbol || 'N/A'}</strong>   </td>
                <td class="price">R$ ${formattedPrice}                  </td>
                <td>                ${quote.regularMarketDayRange}      </td>
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

        //const tickers = ["BOVA11"];           // 20:00 removido

        //  const paramsResponse = new URLSearchParams({    // 20:00 removido
        //  tickers: tickers.join(",")                      // 20:00 removido
        //  });                                             // 20:00 removido

/*       // 20:00 removido
        const response = await fetch(
            `/.netlify/functions/get-quotes?${paramsResponse.toString()}`
        );
*/
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
        (quote.name || "").toLowerCase().includes(searchTerm) ||
        (quote.shortName || quote.longName || "").toLowerCase().includes(searchTerm)
    );

    renderTable(filteredEtfs);
});


updateQuotes();


// Test function https://www.netlify.com/blog/intro-to-serverless-functions/
// Requisiçoes function https://etfsdobrasil.netlify.app/.netlify/functions/get-quotes


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
