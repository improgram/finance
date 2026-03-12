const updateQuotes = async () => {
    //const ticker = '';
    try {
        // Chama endpoint relativo do Netlify
        const paramsResponse = new URLSearchParams({
            // parâmetros de consulta
            //tickers: ticker,
            limit: 4,                   // valor limit por pagina
            page: 1,                    // página desejada
            sortBy: "name",             // organiza por nome
            sortOrder: "asc",          // sortOrder (asc/desc)
            //type: "bdr"                    // "etf"
        });
    // Igual const response = await fetch(`/.netlify/functions/get-quotes?tickers=${ticker}`);
const response = await fetch(`/.netlify/functions/get-quotes?${paramsResponse.toString()}`);
        const quotes = await response.json();
        const container = document.getElementById('quotes-container');
        container.innerHTML = '';                   // Limpa a tabela antes de atualizar

        if (Array.isArray(quotes)) {
            quotes.forEach(quote => {
                // Criamos uma linha (tr) com as células (td) correspondentes
                container.innerHTML += `
                    <tr>
                        <td>${quote.name}                   </td>
                        <td><strong>${quote.symbol}</strong></td>

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

/*
<td class="price">R$ ${Number(price).toFixed(2)}</td>
<td class="price">R$ ${quote.price?.toFixed(2)}</td>
<td>${quote.stock}                  </td>
<td>${quote.fiftyTwoWeekHigh}       </td>
<td>${quote.fiftyTwoWeekLow}        </td>
*/
