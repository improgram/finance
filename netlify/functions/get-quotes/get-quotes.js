
// Este código rodará no lado do servidor ou serverless (netlify)
// não roda no navegador.
// Ele é acionado apenas quando o Frontend faz o pedido

exports.handler = async (event) => {
  // A chave será lida das variáveis de ambiente do Netlify
  const API_TOKEN = process.env.BRAPI_TOKEN;
  // quando adicionei ETF na const deu erro
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
        body: JSON.stringify (
          { message: "Sucesso" } data.results, null, 2),
          console.log( "Sucesso na function netlify" )
    };
  } catch (error) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Falha ao buscar dados" }),
      };
  }
};
