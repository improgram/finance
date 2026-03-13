const updateQuotes = async () => {
    try {
        const paramsResponse = new URLSearchParams({
            limit: 10,                  // valor limit por pagina
            page: 1,                    // página desejada
            sortBy: "name",             // organiza por nome
            sortOrder: "asc",           // sortOrder (asc/desc)
            type: "etf"                 // "etf"   //dr"
        });
    // Igual const response = await fetch(`/.netlify/functions/get-quotes?tickers=${ticker}`);
const response = await fetch(`/.netlify/functions/get-quotes?${paramsResponse.toString()}`);
        const data = await response.json();

        const container = document.getElementById('quotes-container');
        container.innerHTML = '';                   // Limpa a tabela antes de atualizar

        // Acessamos data.results conforme a normalização feita no backend
        if (data.results && Array.isArray(data.results)) {
            data.results.forEach(quote => {
                container.innerHTML += `
                    <tr>
                        <td><strong>${quote.name || 'N/A'}</strong></td>
                        <td>${quote.stock}</td>
                        <td class="price">R$ ${quote.close ? quote.close.toFixed(2) : '0.00'}</td>
                    </tr>
                `;
            });
        } else {
            document.getElementById('status').innerText = "Nenhum ETF encontrado.";
        }

        document.getElementById('status').style.display = 'none';
    } catch (err) {
        console.error(err);
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
<td class="price">R$ ${Number(price).toFixed(2)}</td> ERRO
<td class="price">R$ ${quote.price?.toFixed(2)}</td> undefined
<td>${quote.stock}                  </td>
<td>${quote.fiftyTwoWeekHigh}       </td>
<td>${quote.fiftyTwoWeekLow}        </td>
*/
