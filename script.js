
const updateQuotes = async () => {
    const tickers = 'PETR4,VALE3,ITUB4';
    try {
        // Chamamos o endpoint relativo do Netlify
        const response = await fetch(`/.netlify/functions/get-quotes?tickers=${tickers}`);
        const quotes = await response.json();

        const container = document.getElementById('quotes-container');
        container.innerHTML = '';

        if (Array.isArray(quotes)) {
            quotes.forEach(quote => {
                container.innerHTML += `
                <div class="ticker-card">
                    <span>${quote.symbol}</span>
                    <span class="price">R$ ${quote.regularMarketPrice.toFixed(2)}</span>
                </div>
                `;
            });
        }
        document.getElementById('status').style.display = 'none';
        } catch (err) {
            document.getElementById('status').innerText = "Erro ao carregar dados.";
        }
};

updateQuotes();


// não será possivel ver os registros das funções netlify no console do navegador
// quando simulada no localhost http://127.0.0.1:5500
//  porque suas funções não estão sendo executadas no navegador

// Test function https://www.netlify.com/blog/intro-to-serverless-functions/
// Requisiçoes function https://etfsdobrasil.netlify.app/.netlify/functions/get-quotes


/* Codigo antigo
// Substitua pelo seu token real da brapi.dev
        const API_TOKEN = 'SEU_TOKEN_AQUI';
        const tickersDesejados = ['PETR4', 'VALE3', 'ITUB4', 'ABEV3'];

        const fetchMultipleQuotes = async (tickers) => {
            const tickersParam = tickers.join(',');
            try {
                const response = await fetch(`https://brapi.dev/api/quote/${tickersParam}?token=${API_TOKEN}`);
                const data = await response.json();
                return data.results;
            } catch (error) {
                console.error("Erro ao buscar dados:", error);
                document.getElementById('loading').innerText = "Erro ao carregar dados.";
            }
        };

        const updateTable = async () => {
            const quotes = await fetchMultipleQuotes(tickersDesejados);

            if (quotes) {
                const tableBody = document.getElementById('table-body');
                const loadingDiv = document.getElementById('loading');
                const table = document.getElementById('stock-table');

                // Limpa a tabela antes de preencher
                tableBody.innerHTML = '';

                quotes.forEach(quote => {
                    const row = `
                        <tr>
                            <td><strong>${quote.symbol}</strong></td>
                            <td>${quote.longName || 'N/A'}</td>
                            <td class="price">R$ ${quote.regularMarketPrice.toFixed(2)}</td>
                        </tr>
                    `;
                    tableBody.innerHTML += row;
                });

                loadingDiv.style.display = 'none';
                table.style.display = 'table';
            }
        };

        // Inicia a busca
        updateTable();
*/
