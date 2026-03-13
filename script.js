let allEtfs = [];
const renderTable = (data) => {
    const container = document.getElementById('quotes-container');
    container.innerHTML = '';
    data.forEach(quote => {
        container.innerHTML += `
            <tr>
                <td><strong>${quote.name || 'N/A'}</strong></td>
                <td>${quote.stock}</td>
                <td class="price">R$ ${quote.close ? quote.close.toFixed(2) : '0.00'}</td>
            </tr>
        `;
    });
            // Armazena no array global
        allEtfs = data.results || [];
        renderTable(allEtfs); // Renderiza a lista completa inicialmente
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

        const container = document.getElementById('quotes-container');
        container.innerHTML = '';

        if (data.results && Array.isArray(data.results)) {
            data.results.forEach(quote => {
                // Se não houver logo, usamos um ícone genérico ou placeholder
                const logoUrl = quote.logo || 'https://via.placeholder.com/30?text=$';

                container.innerHTML += `
                    <tr>
                        <td style="text-align: center;">
                            <img src="${logoUrl}" alt="${quote.stock}" style="width: 30px; height: 30px; border-radius: 4px; vertical-align: middle;">
                        </td>
                        <td><strong>${quote.name || 'N/A'}</strong></td>
                        <td><span class="badge">${quote.stock}</span></td>
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

// Lógica da Barra de Busca em Tempo Real
document.getElementById('etf-search').addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();

    // Filtra o array global comparando com nome ou ticker (stock)
    const filteredEtfs = allEtfs.filter(quote =>
        quote.name.toLowerCase().includes(searchTerm) ||
        quote.stock.toLowerCase().includes(searchTerm)
    );

    renderTable(filteredEtfs);
});


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
