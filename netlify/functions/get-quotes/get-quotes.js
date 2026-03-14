
// Código rodará no lado do servidor ou serverless (netlify) navegador NAO
// Acionado apenas quando o Frontend faz o pedido
// A chave será lida das variáveis de ambiente do Netlify

exports.handler = async (event) => {
  const API_TOKEN = process.env.BRAPI_TOKEN;
  const queryParams = event.queryStringParameters || {};

  // Constrói a URL dinamicamente com os parâmetros recebidos
  const params = new URLSearchParams(queryParams);
        params.append('token', API_TOKEN);

  //const apiUrl = `https://brapi.dev/api/quote/list?${params.toString()}`;
  const apiUrl = `https://brapi.dev/api/quote/list?${params.toString()}`;
  // O endpoint /list é o correto para filtros como 'type'
  // A brapi retorna 'stocks' no endpoint /list
  // O endpoint /quote/{ticker} retorna 'results'

  try {
  const response = await fetch(apiUrl);

    if (!response.ok) {    // Lê o corpo apenas uma vez
      const errorText = await response.text();
      return {
        statusCode: response.status,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          error: "Erro na API",
          details: errorText
        }),
      };
    }

    const data = await response.json();

    // A Brapi no endpoint /list retorna objeto com chave 'stocks'
    // Garantimos que 'results' seja sempre um array
    const results = data.stocks || data.results || [];

    return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*" // Evita problemas de CORS
        },
        body: JSON.stringify ({ results }, null, 2),
    // 'null, 2' adiciona espaços e quebras de linha no texto do JSON
    };
  } catch (error) {
      return {
        statusCode: 500,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          error: "Falha ao buscar dados",
          details: error.message
        })
      };
  }
};

// https://brapi.dev/docs/acoes.mdx

// Testar essa function no navegador:
// netlify dev
// http://localhost:8888/.netlify/functions/get-quotes?limit=10&type=etf
