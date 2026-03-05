// netlify/functions/get-brapi-data.js
const axios = require('axios'); //  poderia usar o fetch

exports.handler = async (event, context) => {
  const token = process.env.BRAPI_TOKEN; // O Netlify injeta isso aqui
  const symbol = event.queryStringParameters.symbol || 'PETR4';

  try {
    const response = await axios.get(`https://brapi.dev/api/quote/${symbol}?token=${token}`);

    return {
      statusCode: 200,
      body: JSON.stringify(response.data),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Falha ao buscar dados' }),
    };
  }
};
