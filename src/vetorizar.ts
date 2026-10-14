import type { Acervo } from "./db.js";
import { textoParaVetor, type Embedder } from "./embeddings.js";

/** Gera vetores para os documentos que ainda não têm. Retorna quantos foram vetorizados. */
export async function vetorizarPendentes(
  acervo: Acervo,
  embedder: Embedder,
  opts: { lote?: number; maximo?: number; log?: (m: string) => void } = {},
): Promise<number> {
  const lote = opts.lote ?? 64;
  const maximo = opts.maximo ?? Infinity;
  let feitos = 0;
  while (feitos < maximo) {
    const pendentes = acervo.pendentesDeVetor(Math.min(lote, maximo - feitos));
    if (!pendentes.length) break;
    const vetores = await embedder.vetorizar(pendentes.map(textoParaVetor), "documento");
    acervo.salvarVetores(pendentes.map((p, i) => ({ rowid: p.rowid, vetor: vetores[i] })));
    feitos += pendentes.length;
    opts.log?.(`vetorizados ${feitos}`);
  }
  // Dispositivos legais (mesmo modelo e mesma dimensão)
  while (feitos < maximo) {
    const pendentes = acervo.pendentesDeVetorLegislacao(Math.min(lote, maximo - feitos));
    if (!pendentes.length) break;
    const vetores = await embedder.vetorizar(pendentes.map((p) => p.texto.slice(0, 6000)), "documento");
    acervo.salvarVetoresLegislacao(pendentes.map((p, i) => ({ rowid: p.rowid, vetor: vetores[i] })));
    feitos += pendentes.length;
    opts.log?.(`vetorizados ${feitos} (com dispositivos legais)`);
  }
  return feitos;
}
