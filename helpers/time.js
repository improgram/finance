
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
// A função executa: Seg → Sex Das 10:15 até 22:00 BR A cada 7 minutos

export const shouldRunNow = () => {
    const nowBR = new Date(
      new Date().toLocaleString("en-US", {
        timeZone: "America/Sao_Paulo"
      })
    );

    const hour = nowBR.getHours();
    const minute = nowBR.getMinutes();
    const day = nowBR.getDay(); // 0 domingo

    // segunda → sexta
    const isWeekDay = day >= 1 && day <= 5;

    // 10:15 → 22:00
    const afterStart =
      hour > 10 || (hour === 10 && minute >= 15);

    const beforeEnd =
      hour < 22 || (hour === 22 && minute === 0);

    // Para uso do schedule
    // sem depender das limitações do CRON do Netlify
    // minutos válidos
    const validMinute = [
      0, 4, 11, 18, 25, 32, 39, 46, 53,
      15, 22, 29, 36, 43, 50, 57
    ].includes(minute);

    return (
      isWeekDay &&
      afterStart &&
      beforeEnd &&
      validMinute
    );
};
