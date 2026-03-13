
// Código rodará no lado do servidor ou serverless (netlify) navegador NAO
// Acionado apenas quando o Frontend faz o pedido
// A chave será lida das variáveis de ambiente do Netlify
// quando adicionei ETF na const deu erro
exports.handler = async (event) => {
  const API_TOKEN = process.env.BRAPI_TOKEN;
  // const tickers = event.queryStringParameters.tickers || 'VALE3,PETR4';
  const queryParams = event.queryStringParameters;

  // Constrói a URL dinamicamente com os parâmetros recebidos
  const params = new URLSearchParams(queryParams);
        params.append('token', API_TOKEN);

  try {
    // Usamos o endpoint /list conforme sua necessidade de filtros
    //  const response = await fetch(
    //      `https://brapi.dev/api/quote/${tickers}?token=${API_TOKEN}`);
    // 12/03 => retirei o endpoint de listagem (list) deu erro 500
  const response = await fetch(`https://brapi.dev/api/quote/list?${params.toString()}`);
  const apiUrl = `https://brapi.dev/api/quote/list?${params.toString()}`;

  const response = await fetch(apiUrl);
  // O endpoint /list é o correto para filtros como 'type'
  // O endpoint /quote/{ticker} retorna 'results'
  const finalData = data.stocks || data.results;

    if (!response.ok) {
      const errorText = await response.text();
      return {
        statusCode: response.status,
        body: JSON.stringify({
          error: "Tickers não encontrados ou erro na API",
          details: errorText,
          message: data.message || "Verifique os parâmetros"
        }),
      };
    }

    const data = await response.json();

    // A brapi retorna 'stocks' no endpoint /list
    // Garantimos que 'results' seja sempre um array
    const results = data.stocks || data.results || [];

    return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json"
          "Access-Control-Allow-Origin": "*" // Evita problemas de CORS
        },
        body: JSON.stringify ({ results: results }, null, 2),
        // O 'null, 2' adiciona espaços e quebras de linha no texto do JSON
    };
  } catch (error) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Falha ao buscar dados",
          details: error.message
        }),
      };
  }
};

// https://brapi.dev/docs/acoes.mdx
