let allEtfs = [];
const renderTable = (data) => {
    const container = document.getElementById('quotes-container');
    container.innerHTML = '';

    data.forEach(quote => {
        // A Brapi no endpoint /quote usa 'logourl' em vez de apenas 'logo'
        const logoUrl = quote.logourl || quote.logo || 'https://via.placeholder.com/30?text=$';;
        // Garante que o preço seja um número antes de usar toFixed
        const price = typeof quote.regularMarketPrice === 'number'
            ? quote.regularMarketPrice.toFixed(2).replace('.', ',')
            : '---';

        container.innerHTML += `
            <tr>
                <td style="text-align:center">
                    <img src="${logoUrl}" width="26"
                    onerror="this.src='https://icons.brapi.dev/icons/BOVA11.svg'"
                        style="border-radius: 4px;">
                </td>
                <td><strong>${quote.symbol || 'N/A'}</strong></td>
                <td class="price">R$ ${price}               </td>
                <td>${quote.fiftyTwoWeekLow}                </td>
                <td>${quote.fiftyTwoWeekHigh}               </td>
            </tr>
        `;
    });
    document.getElementById('status').style.display = 'none';
};

//<img src="${logoUrl}" width="26"
// onerror="this.src='https://via.placeholder.com/30?text=?'">

const updateQuotes = async () => {
    try {
        const statusEl = document.getElementById('status');
            statusEl.style.display = 'block';
            statusEl.innerText = "Carregando...";

        const tickers = ["BOVA11"];

        const paramsResponse = new URLSearchParams({
            tickers: tickers.join(",")
            //sortOrder: "asc",
            //limit: 99,
            //type: "fund"    //No endpoint list "etf" é fund
        });

        const response = await fetch(
            `/.netlify/functions/get-quotes?${paramsResponse.toString()}`
        );

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Erro HTTP: ${response.status}`);
        }

        const data = await response.json();

        // if (data.stocks && Array.isArray(data.stocks))
        // Pois o endpoint /quote/list retorna:   { "stocks": [...]  }

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
        (quote.name || "").toLowerCase().includes(searchTerm) ||
        (quote.stock || "").toLowerCase().includes(searchTerm)
        (quote.shortName || quote.longName || "").toLowerCase().includes(searchTerm) ||
        (quote.symbol || "").toLowerCase().includes(searchTerm)
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
