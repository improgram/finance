
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
  const data = await response.json();

  // O endpoint /list retorna 'stocks'
  // O endpoint /quote/{ticker} retorna 'results'
  const finalData = data.stocks || data.results;

    if (!finalData) {          // if (!data.results) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "Tickers não encontrados ou erro na API",
          message: data.message || "Verifique os parâmetros"
        }),
      };
    }
    return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify ({ results:finalData}, null, 2),
        // O 'null, 2' adiciona espaços e quebras de linha no texto do JSON
        //body: JSON.stringify (finalData, null, 2), // data.results, null, 2
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
