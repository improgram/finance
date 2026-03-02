// https://docs.google.com/spreadsheets/d/1Bdo-yu3y2bwJ_5ZQI4A0RJMrOVEOHUfuFbKp0L305v0/edit?usp=sharing

const csvUrl = 'dados.csv';

        async function carregarCotacoes() {
            try {
                const response = await fetch(csvUrl);
                const data = await response.text();
                processarCSV(data);
            } catch (error) {
                document.getElementById('loader').innerText = 'Erro ao carregar o arquivo CSV.';
                console.error(error);
            }
        }

        function processarCSV(csvText) {
            const lines = csvText.split('\n');
            const tableBody = document.getElementById('body-table');
            const loader = document.getElementById('loader');
            const table = document.getElementById('table-cotacoes');

            // Ignora o cabeçalho (i=1) e pula linhas vazias
            for (let i = 1; i < lines.length; i++) {
                const cols = lines[i].split(',');
                if (cols.length < 3) continue;

                const ticker = cols[0].trim();
                const preco = parseFloat(cols[1].trim()).toFixed(2);
                const variacao = parseFloat(cols[2].trim()).toFixed(2);

                const cssClass = variacao >= 0 ? 'positive' : 'negative';

                const row = `<tr>
                    <td>${ticker}</td>
                    <td>${preco}</td>
                    <td class="${cssClass}">${variacao}%</td>
                </tr>`;
                tableBody.innerHTML += row;
            }

            loader.style.display = 'none';
            table.style.display = 'table';
        }

        // Inicia
        carregarCotacoes();
