const updateQuotes = async () => {
    try {
        document.getElementById('status').innerText = "Carregando ETFs...";
        const paramsResponse = new URLSearchParams({
            limit: 20,                  // valor limit por pagina
            page: 1,                    // página desejada
            sortBy: "stock",            // name: organiza por nome
            sortOrder: "asc",           // sortOrder (asc/desc)
            type: "etf"                 // "etf"   //dr"
        });
    // Igual const response = await fetch(`/.netlify/functions/get-quotes?tickers=${ticker}`);
const response = await fetch(`/.netlify/functions/get-quotes?${paramsResponse.toString()}`);
        if (!response.ok) throw new Error("Erro na requisição do servidor");
        const data = await response.json();

        const container = document.getElementById('quotes-container');
        container.innerHTML = '';                   // Limpa a tabela antes de atualizar

        // Verificamos se data.results existe e tem itens
     if (data.results && data.results.length > 0) {
            data.results.forEach(quote => {
                // No endpoint /list, os campos são: stock, name, close, logo
                container.innerHTML += `
                    <tr>
                        <td><strong>${quote.name || 'N/A'}</strong></td>
                        <td>${quote.stock}</td>
                        <td class="price">R$ ${quote.close ? quote.close.toFixed(2) : '0.00'}</td>
                    </tr>
                `;
            });
            document.getElementById('status').style.display = 'none';
        } else {
            document.getElementById('status').innerText = "Nenhum ETF encontrado.";
        }

    } catch (err) {
        console.error("Erro no processamento:", err);
        document.getElementById('status').innerText = "Erro ao carregar dados. Verifique o console.";
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
