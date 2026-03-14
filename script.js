let allEtfs = [];
const renderTable = (data) => {
    const container = document.getElementById('quotes-container');
    container.innerHTML = '';

    data.forEach(quote => {
        const logoUrl = quote.logo || 'https://via.placeholder.com/30?text=$';
        // Garante que o preço seja um número antes de usar toFixed
        const price = typeof quote.close === 'number' ? quote.close.toFixed(2) : '---';

        container.innerHTML += `
            <tr>
                <td style="text-align:center">
        <img src="${logoUrl}" width="26" onerror="this.src='https://via.placeholder.com/30?text=?'">
                </td>
                <td><strong>${quote.name || 'N/A'}</strong></td>
                <td>${quote.stock}</td>
                <td class="price">R$ ${price}</td>
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

        const paramsResponse = new URLSearchParams({
            sortBy: "stock",
            sortOrder: "asc",
            limit: 100,
            type: "fund"    //No endpoint list "etf" é fund
        });

        const response = await fetch(`/.netlify/functions/get-quotes?${paramsResponse.toString()}`);

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Erro HTTP: ${response.status}`);
        }

        const data = await response.json();

        if (data.results && Array.isArray(data.results)) {
            // filtra ETFs brasileiros
            allEtfs = data.results.filter(etf =>
                etf.stock && etf.stock.endsWith("11")
            );

            if (allEtfs.length === 0) {
                statusEl.innerText = "Nenhum ETF (final 11) encontrado na lista.";
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
