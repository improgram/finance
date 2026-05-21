
export const sleep = (ms) =>
   new Promise(r => setTimeout(r, ms));


export const getFormattedDateTime = () =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "medium"
  }).format(new Date());


// Para o CRON evitar: múltiplas funções, múltiplos deploys
// limitação do Netlify, problemas de UTC
// A função deve executar 1 ticker a cada 7 minutos:
// Seg → Sex Das 10:15 até 21:00 BR A cada 7 minutos
// Cron = disparador bruto
// shouldRunNow = regra de negócio real

export const shouldRunNow = () => {
  const formatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  const parts = formatter.formatToParts(new Date());

  const get = (type) => parts.find(p => p.type === type)?.value;

  const hour = Number(get("hour"));
  const minute = Number(get("minute"));

  const weekdayMap = {
    dom: 0,
    seg: 1,
    ter: 2,
    qua: 3,
    qui: 4,
    sex: 5,
    sáb: 6
  };

  const day = weekdayMap[get("weekday")?.toLowerCase()] ?? -1;

    // segunda → sexta
    const isWeekDay = day >= 1 && day <= 5;

    // 10:15
    const afterStart = hour > 10 || (hour === 10 && minute >= 15);

    // minutos antes de 21:00
    const beforeEnd = hour < 21;

    return isWeekDay && afterStart && beforeEnd;
};
