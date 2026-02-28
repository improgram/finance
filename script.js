        // COLOQUE SEU LINK DO GOOGLE SHEETS (CSV) AQUI
        const csvUrl = 'SUA_URL_AQUI';

        async function atualizarCotacoes() {
            try {
                const response = await fetch(csvUrl);
                const data = await response.text();
                const rows = data.split('\n').slice(1);

                let html = '';
                rows.forEach(row => {
                    const columns = row.split(',');
                    if (columns.length >= 3) {
                        const ticker = columns[0].replace(/"/g, '').replace('BVMF:', '');
                        const preco = parseFloat(columns[1]).toFixed(2);
                        const variacao = parseFloat(columns[2].replace('%', ''));

                        const classeCor = variacao >= 0 ? 'pos' : 'neg';
                        const sinal = variacao >= 0 ? '+' : '';

                        html += `
                            <tr>
                                <td><strong>${ticker}</strong></td>
                                <td class="price">R$ ${preco}</td>
                                <td class="${classeCor}">${sinal}${variacao.toFixed(2)}%</td>
                            </tr>
                        `;
                    }
                });
                document.getElementById('corpo-tabela').innerHTML = html;
            } catch (error) {
                console.error("Erro ao carregar dados:", error);
            }
        }

        // Executa ao carregar e define intervalo de 2 minutos
        atualizarCotacoes();
        setInterval(atualizarCotacoes, 120000);


        /*
        Se notar que os números estão vindo com vírgula da planilha (ex: 34,50)
        e o JavaScript não está calculando,
        mude a configuração da sua planilha para Estados Unidos
        (Arquivo > Configurações > Localidade).

        Isso faz com que o Google Finance gere o CSV com pontos (34.50),
        que é o padrão que o JavaScript entende nativamente.

        */
