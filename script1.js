
const SHEET_ID = '14F2zQOSElTVkS2xZnfT7CrRYB0zgaKcE92mpYzElpc4';
const SHEET_TITLE = 'Página1'; // Nome da aba na planilha
const SHEET_RANGE1 = 'A4:G13'; // Intervalo de dados

const FULL_URL1 = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?sheet=${SHEET_TITLE}&range=${SHEET_RANGE1}`;

google.charts.load('current', {packages:['corechart']});
google.charts.setOnLoadCallback(carregarETF);

function carregarETF() {
    Promise.all([ fetch(FULL_URL1).then(res => res.text()) ])
    .then(([rep1]) => {

        // Limpando o retorno da Google API
        const data1 = JSON.parse(rep1.substr(47).slice(0, -2));
        const cols = data1.table.cols;
        const rows = data1.table.rows;

                // Criar Cabeçalho
                let headerHtml = '<tr>';
                    cols.forEach(col => {
                        headerHtml += `<th>${col.label}</th>`;
                    });
                    headerHtml += '</tr>';
                document.querySelector('#tabelaTickers1 thead').innerHTML = headerHtml;

                // Criar Linhas
                let bodyHtml = '';
                    rows.forEach(row => {
                        bodyHtml += '<tr>';
                        row.c.forEach(cell => {
                            let value = cell ? (cell.v || '') : '';
                            bodyHtml += `<td>${value}</td>`;
                        });
                        bodyHtml += '</tr>';
                    });
                document.getElementById('corpoTabela1').innerHTML = bodyHtml;

                // Inicializar DataTables para permitir busca e ordenação
                $('#tabelaTickers1').DataTable({
                        language: {
                            url: 'https://cdn.datatables.net/plug-ins/1.13.4/i18n/pt-BR.json',
                            emptyTable: "Nenhum registro encontrado",
                        }
                });
    });
}


const SHEET_RANGE2 = 'A21:E31'; // Intervalo de dados
const FULL_URL2 = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?sheet=${SHEET_TITLE}&range=${SHEET_RANGE2}`;

google.charts.setOnLoadCallback(carregarGoogle);

function carregarGoogle() {
    Promise.all([ fetch(FULL_URL2).then(res => res.text() ) ])
    .then(([rep2]) => {

        // Limpando o retorno da Google API
        const data2 = JSON.parse(rep2.substr(47).slice(0, -2));
        const cols = data2.table.cols;
        const rows = data2.table.rows;

                // Criar Cabeçalho
                let headerHtml = '<tr>';
                    cols.forEach(col => {
                        headerHtml += `<th>${col.label}</th>`;
                    });
                    headerHtml += '</tr>';
                document.querySelector('#tabelaTickers2 thead').innerHTML = headerHtml;

                // Criar Linhas
                let bodyHtml = '';
                    rows.forEach(row => {
                        bodyHtml += '<tr>';
                        row.c.forEach(cell => {
                            let value = cell ? (cell.v || '') : '';
                            bodyHtml += `<td>${value}</td>`;
                        });
                        bodyHtml += '</tr>';
                    });
                document.getElementById('corpoTabela2').innerHTML = bodyHtml;

                // Inicializar DataTables para permitir busca e ordenação
                $('#tabelaTickers2').DataTable({
                        language: {
                            url: 'https://cdn.datatables.net/plug-ins/1.13.4/i18n/pt-BR.json',
                            emptyTable: "Nenhum registro encontrado",
                        }
                });
    });
}



const csvUrl = 'dados.csv';

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
