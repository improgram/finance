// https://docs.google.com/spreadsheets/d/1Bdo-yu3y2bwJ_5ZQI4A0RJMrOVEOHUfuFbKp0L305v0/edit?usp=sharing
// =IMPORTXML("https://www.infomoney.com.br/cotacoes/b3/etf/etf-wrld11/", "//div[@class='line-info']/div[1]/p")
// 'dados.csv';

const csvUrl = 'https://docs.google.com/spreadsheets/d/1Bdo-yu3y2bwJ_5ZQI4A0RJMrOVEOHUfuFbKp0L305v0/export?format=csv';

async function carregarCotacoes() {
            try {
                const response = await fetch(csvUrl);
                if (!response.ok) throw new Error('Falha na requisição');

                const data = await response.text();
                processarCSV(data);
            } catch (error) {
                const loader = document.getElementById('loader');
                if (loader) loader.innerText = 'Erro ao carregar os dados.';
                console.error("Erro detalhado:", error);
            }
}

function processarCSV(csvText) {
    const lines = csvText.split('\n');
    const tableBody = document.getElementById('body-table');
    const loader = document.getElementById('loader');
    const table = document.getElementById('table-cotacoes');

    let rowsHtml = ''; // Construir a string primeiro é mais performático

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Tenta separar por vírgula, se falhar, tenta ponto e vírgula
        const cols = line.includes(';') ? line.split(';') : line.split(',');

        if (cols.length < 3) continue;

        const ticker = cols[0].trim();
        // Converte vírgula decimal em ponto antes de transformar em número
        const precoNum = parseFloat(cols[1].trim().replace(',', '.'));
        const variacaoNum = parseFloat(cols[2].trim().replace(',', '.'));

        if (isNaN(precoNum) || isNaN(variacaoNum)) continue;

        const cssClass = variacaoNum >= 0 ? 'positive' : 'negative';

        rowsHtml += `<tr>
            <td>${ticker}</td>
            <td>R$ ${precoNum.toFixed(2)}</td>
            <td class="${cssClass}">${variacaoNum.toFixed(2)}%</td>
        </tr>`;
    }

    tableBody.innerHTML = rowsHtml;
    loader.style.display = 'none';
    table.style.display = 'table';
}

carregarCotacoes();
