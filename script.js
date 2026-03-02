const url = 'https://docs.google.com/spreadsheets/d/1Bdo-yu3y2bwJ_5ZQI4A0RJMrOVEOHUfuFbKp0L305v0/edit?usp=sharing';

async function fetchStocks() {
            const response = await fetch(url);
            const data = await response.text();
            const rows = data.split('\n').slice(1); // Remove o cabeçalho

            let html = '';
            rows.forEach(row => {
                const [ticker, preco] = row.split(',');
                if(ticker) {
                    html += `<div class="ticker-card">
                                <strong>${ticker}:</strong>
                                <span class="price">R$ ${preco}</span>
                             </div>`;
                }
            });
            document.getElementById('cotacoes').innerHTML = html;
        }

        fetchStocks();
        // Atualiza a cada 5 minutos
        setInterval(fetchStocks, 300000);

/*
Se notar que os números estão vindo com vírgula da planilha (ex: 34,50)
    e o JavaScript não está calculando,
    mude a configuração da sua planilha para Estados Unidos
    (Arquivo > Configurações > Localidade).

    Isso faz com que o Google Finance gere o CSV com pontos (34.50),
    que é o padrão que o JavaScript entende nativamente.
*/
