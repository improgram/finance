
export * from "./constants.js";
export * from "./market.js";
export * from "./storage.js";
export * from "./tickers.js";
export * from "./time.js";

// Regra mudar cor da palavra
// função para varrer e atualizar todo o objeto ETF_INFO

export function destacarPalavraEmTodoOObjeto(objetoDados, palavraChave) {

  const copia = structuredClone(objetoDados);
// Regex que busca a palavra sem se importar com maiúsculas/minúsculas ('i')
// e substitui todas as ocorrências na mesma frase ('g')
// Loop 'for...in' para passar por cada ativo dentro do objeto ETF_INFO
// Se a palavra existir na descrição desse ativo, fazemos a substituição
// O '$&' é um truque do JS que mantém a palavra original exatamente
// como ela estava escrita (com 'I' ou 'i')

  for (const ativo in copia) {
    let descricao = copia[ativo].description;
    if (!descricao) continue;
    Object.entries(palavraChave).forEach(
      ([palavra, cor]) => {
        const regex = new RegExp(palavra, 'gi');
        descricao = descricao.replace(
          regex,
          `<span style="color:${cor};font-weight:bold;">$&</span>`
        );
      }
    );
    copia[ativo].description = descricao;
  }
  return copia;
}


/*
Nao precisa desse import:
import { ETF_INFO } from "./constants.js";
//       ./  => significa "partir da pasta atual"
*/
