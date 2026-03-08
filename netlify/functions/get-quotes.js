
// Este código rodará no lado do servidor ou serverless
// onde o token está seguro:
// netlify/functions/get-quotes.js

exports.handler = async (event) => {
  // A chave será lida das variáveis de ambiente do Netlify
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
            body: JSON.stringify({ error: "Tickers não encontrados ou erro na API" }),
        };
    }
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" }, // Boa prática
      body: JSON.stringify(data.results),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Falha ao buscar dados" }),
    };
  }
};
