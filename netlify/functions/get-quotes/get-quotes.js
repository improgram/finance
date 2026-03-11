
// Código rodará no lado do servidor ou serverless (netlify) navegador NAO
// Acionado apenas quando o Frontend faz o pedido
// A chave será lida das variáveis de ambiente do Netlify
// quando adicionei ETF na const deu erro
exports.handler = async (event) => {
  const API_TOKEN = process.env.BRAPI_TOKEN;
  const tickers = event.queryStringParameters.tickers || 'PETR4,VALE3';

  try {
    const response = await fetch(
      `https://brapi.dev/api/quote/${tickers}?token=${API_TOKEN}`
    );
    const data = await response.json();

    if (!data.results) {
      return {
        statusCode: 400,
        body: JSON.stringify(
          { error: "Tickers não encontrados ou erro na API" }),
      };
    } return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" }, // Boa prática
        // O 'null, 2' adiciona espaços e quebras de linha no texto do JSON
        body: JSON.stringify (data.results, null, 2),
    };
  } catch (error) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "Falha ao buscar dados",
          details: error.message
        }),
      };
  }
};

// https://brapi.dev/docs/acoes.mdx
