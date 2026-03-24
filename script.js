let allEtfs = [];

 // cores automáticas (verde/vermelho) = detectar o valor e aplicar a classe
        function aplicarCor(valor) {
            if (valor > 0) return "positive";
            if (valor < 0) return "negative";
            return "neutral";
        }

const renderTable = (data) => {
    const container = document.getElementById('quotes-container');
    container.innerHTML = '';

    data.forEach(quote => {
        // Garante que o preço seja um número antes de usar toFixed
        const br = new Intl.NumberFormat('pt-BR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
            });

        // Para o Preço Atual
        const formattedPrice = quote.regularMarketPrice != null
            ? br.format(quote.regularMarketPrice) : '---';

        const formatNumber = (value) =>
            typeof value === 'number' ? br.format(value) : '---';

        // regularMarket Day Range nem sempre vem preenchido
        const dayRange =
            quote.regularMarketDayRange ||
            `${quote.regularMarketDayLow ?? '-'} - ${quote.regularMarketDayHigh ?? '-'}`;

        // Para 52 Semanas
        const formattedLow = typeof quote.fiftyTwoWeekLow === 'number'
            ? br.format(quote.fiftyTwoWeekLow) : '---';

        const formattedHigh = typeof quote.fiftyTwoWeekHigh === 'number'
            ? br.format(quote.fiftyTwoWeekHigh) : '---';

        const min7d = formatNumber(quote.min7d);
        // Fallback é assim: const min7d = quote.min7d ?? null;
        const min30d = formatNumber(quote.min30d);
        const min60d = formatNumber(quote.min60d);
        const histInfo = quote.historicalAvailable ? '' : '(Histórico indisponível)';
        const variacao = typeof quote.regularMarketChangePercent === "number"
        ? quote.regularMarketChangePercent
        : 0;

        const formattedPercent = br.format(variacao);

        container.innerHTML += `
            <tr>
                <td><strong>         ${quote.symbol || 'N/A'}</strong>      </td>
                <td>                 ${quote.description}                         </td>
                <td class="price">R$ ${formattedPrice}                      </td>
                <td class="${aplicarCor(variacao)}">${formattedPercent}%    </td>
                <td>                 ${dayRange}                            </td>
                <td>${formatNumber(quote.min7d)} ${!quote.historicalAvailable ? '---' : ''}  </td>
                <td>${formatNumber(quote.min30d)} ${!quote.historicalAvailable ? '---' : ''} </td>
                <td>${formatNumber(quote.min60d)} ${!quote.historicalAvailable ? '---' : ''} </td>
                <td>                ${formattedLow}                     </td>
                <td>                ${formattedHigh}                    </td>
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

        const response = await fetch("/.netlify/functions/get-quotes");

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Erro HTTP: ${response.status}`);
        }

        const data = await response.json();

        if (data.etfs && data.acoes) {
            // filtra ETFs brasileiros
            allEtfs = data.etfs;

            if (allEtfs.length === 0) {
                statusEl.innerText = "Nenhum ETF encontrado";
            } else {
                renderTable(data.etfs);
                renderAcoes(data.acoes);  // AÇÕES
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
        (quote.symbol || "").toLowerCase().includes(searchTerm) ||
        (quote.name || "").toLowerCase().includes(searchTerm)
    );

    renderTable(filteredEtfs);
});

updateQuotes();

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

const renderAcoes = (data) => {
    const tbody = document.getElementById('corpoTabela2');
    tbody.innerHTML = '';

    const br = new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });

    data.forEach(acao => {
        const preco = typeof acao.regularMarketPrice === 'number'
            ? br.format(acao.regularMarketPrice)
            : '---';

        const min12m = typeof acao.fiftyTwoWeekLow === 'number'
            ? br.format(acao.fiftyTwoWeekLow)
            : '---';

        // exemplo simples de "alvo" (pode ajustar depois)
        const alvo = typeof acao.fiftyTwoWeekHigh === 'number'
            ? br.format(acao.fiftyTwoWeekHigh)
            : '---';

        tbody.innerHTML += `
            <tr>
                <td style="display: flex; align-items: center; gap: 8px;">${acao.logo_url
? `<img src="${acao.logo_url}" width="24" height="24" style="object-fit: contain;" alt="${acao.symbol} logo">`
: ''}
                </td>
                <td>${acao.name || acao.symbol}</td>
                <td>R$ ${preco}</td>
                <td class="${aplicarCor(variacao)}">${formattedPercent}%    </td>
                <td>                 ${dayRange}                            </td>
                <td>${formatNumber(quote.min7d)} ${!quote.historicalAvailable ? '---' : ''}  </td>
                <td>${formatNumber(quote.min30d)} ${!quote.historicalAvailable ? '---' : ''} </td>
                <td>${formatNumber(quote.min60d)} ${!quote.historicalAvailable ? '---' : ''} </td>
                <td>                ${formattedLow}                     </td>
                <td>                ${formattedHigh}                    </td>
                <td>${min12m}</td>
                <td>${alvo}</td>
            </tr>
        `;
    });
};
