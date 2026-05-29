
export const sleep = (ms) =>
   new Promise(r => setTimeout(r, ms));

export const getFormattedDateTime = () =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "medium"
  }).format(new Date());


export const getCacheTTL = () => {
  const hour = Number(
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      hour12: false
    }).format(new Date())
  );

  return hour >= 10 && hour <= 18
    ? 5 * 60 * 1000
    : 30 * 60 * 1000;
};

// Para o CRON evitar: múltiplas funções, múltiplos deploys
// limitação do Netlify, problemas de UTC
// A função deve executar 1 ticker a cada 7 minutos:
// Seg → Sex Das 10:15 até 21:00 BR A cada 7 minutos
// Cron = disparador bruto
// shouldRunNow = regra de negócio real

export const shouldRunNow = () => {

  const now = new Date();
  const saoPaulo = new Date(
    now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })
  );

  const day = saoPaulo.getDay(); // 0-6 confiável
  const hour = saoPaulo.getHours();
  const minute = saoPaulo.getMinutes();

    // segunda → sexta
    const isWeekDay = day >= 1 && day <= 5;

    // 10:15
    const afterStart = hour > 10 || (hour === 10 && minute >= 10);

    // minutos antes de 20:00
    const beforeEnd = hour < 21;
    return isWeekDay && afterStart && beforeEnd;
};
