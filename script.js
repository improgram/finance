let allEtfs = [];
const renderTable = (data) => {
    const container = document.getElementById('quotes-container');
    container.innerHTML = '';

    data.forEach(quote => {
        const logoUrl = quote.logo || 'https://via.placeholder.com/30?text=$';

        container.innerHTML += `
            <tr>
                <td style="text-align:center">
                    <img src="${logoUrl}" width="30">
                </td>
                <td><strong>${quote.name || 'N/A'}</strong></td>
                <td>${quote.stock}</td>
                <td class="price">R$ ${quote.close ? quote.close.toFixed(2) : '0.00'}</td>
            </tr>
        `;
    });

    document.getElementById('status').style.display = 'none';
};

const updateQuotes = async () => {
    try {
        const paramsResponse = new URLSearchParams({
            //sortBy: "stock",
            //sortOrder: "asc",
            limit: 10,
            type: "etf"
        });

        const response = await fetch(`/.netlify/functions/get-quotes?${paramsResponse.toString()}`);
        const data = await response.json();

        if (data.results && Array.isArray(data.results)) {
            // filtra ETFs brasileiros
            allEtfs = data.results.filter(etf =>
                etf.stock && etf.stock.endsWith("11")
            );

            renderTable(allEtfs);

        } else {
            document.getElementById('status').innerText = "Nenhum ETF encontrado.";
        }
        } catch (err) {
        console.error(err);
        document.getElementById('status').innerText = "Erro ao carregar dados.";
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
