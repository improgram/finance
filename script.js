const updateQuotes = async () => {
    const ticker = '';                     // nao reconheceu ETF na const

    try {
        // Chamamos o endpoint relativo do Netlify
        //const response = await fetch(`/.netlify/functions/get-quotes?tickers=${ticker}`);
        const paramsResponse = new URLSearchParams({
            tickers: ticker,
            limit: 20,    // Defina o valor desejado
            page: 2       // Defina a página desejada
        });

        //const response = await fetch(`/.netlify/functions/get-quotes?tickers=${ticker}`);
const response = await fetch(`/.netlify/functions/get-quotes?${paramsResponse.toString()}`);
        const quotes = await response.json();
        const container = document.getElementById('quotes-container');
        container.innerHTML = '';                   // Limpa a tabela antes de atualizar

        if (Array.isArray(quotes)) {
            quotes.forEach(quote => {
                // Criamos uma linha (tr) com as células (td) correspondentes
                container.innerHTML += `
                    <tr>
                        <td><strong>${quote.symbol}</strong></td>
                        <td>${quote.shortName || 'Ativo'}   </td>
                        <td class="price">R$ ${quote.regularMarketPrice?.toFixed(2)}</td>
                    </tr>
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
