
export * from "./constants.js";
export * from "./market.js";
export * from "./storage.js";
export * from "./tickers.js";
export * from "./time.js";



// Regra mudar cor da palavra
import { ETF_INFO } from "./helpers/constants.js";
//----------   ./  => significa "partir da pasta atual"

// 1. Criamos uma função para varrer e atualizar todo o objeto ETF_INFO

export function destacarPalavraEmTodoOObjeto(objetoDados, palavraChave) {

    // Criamos uma Regex que busca a palavra sem se importar com maiúsculas/minúsculas ('i')
  // e substitui todas as ocorrências na mesma frase ('g')
  const regex = new RegExp(palavraChave, 'gi');
  const copia = structuredClone(objetoDados);

  // Loop 'for...in' para passar por cada ativo dentro do objeto ETF_INFO
  for (let ativo in copia) {
    const descricao = copia[ativo].description;

    // Se a palavra existir na descrição desse ativo, fazemos a substituição
    if (descricao && regex.test(descricao)) {
      copia[ativo].description = descricao.replace(
        regex,
        `<span style="color:#ff5722;font-weight:bold;">$&</span>`
      );
    }
  }
  
// O '$&' é um truque do JS que mantém a palavra original exatamente
// como ela estava escrita (com 'I' ou 'i')
  return copia;
}
