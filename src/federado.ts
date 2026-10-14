import type { Acervo, Documento } from "./db.js";
import type { Embedder } from "./embeddings.js";
import { textoParaVetor } from "./embeddings.js";
import type { FonteAoVivo } from "./fontes/tipos.js";

export interface RelatorioFonte {
  fonte: string;
  tribunais: string[];
  status: "ok" | "erro" | "tempo_esgotado";
  documentos: number;
  erro?: string;
}

/**
 * Expande atalhos de grupo em siglas: ESTADUAIS (TJs), FEDERAIS (TRFs), SUPERIORES, TODOS.
 * Siglas comuns passam direto (em maiúsculas).
 */
export function expandirTribunais(pedidos: string[] | undefined, conhecidos: string[]): string[] | undefined {
  if (!pedidos?.length) return undefined;
  const saida = new Set<string>();
  for (const bruto of pedidos) {
    const p = bruto.toUpperCase().replace(/\s+/g, "");
    if (p === "TODOS") conhecidos.forEach((t) => saida.add(t));
    else if (p === "ESTADUAIS" || p === "TJS") conhecidos.filter((t) => /^TJ/.test(t)).forEach((t) => saida.add(t));
    else if (p === "FEDERAIS" || p === "TRFS") conhecidos.filter((t) => /^TRF/.test(t)).forEach((t) => saida.add(t));
    else if (p === "TRABALHISTAS" || p === "TRTS") conhecidos.filter((t) => /^(TRT|TST)/.test(t)).forEach((t) => saida.add(t));
    else if (p === "SUPERIORES") ["STF", "STJ", "TST", "TSE", "STM"].forEach((t) => saida.add(t));
    else saida.add(p.replace(/^(TRF|TRT)0+/, "$1"));
  }
  return [...saida];
}

/** Escolhe as fontes ao vivo pertinentes aos tribunais pedidos. */
export function selecionarFontes(fontes: FonteAoVivo[], tribunais?: string[]): { fonte: FonteAoVivo; tribunais: string[] }[] {
  if (!tribunais?.length) return fontes.filter((f) => f.padrao).map((fonte) => ({ fonte, tribunais: [] }));
  const pedidos = new Set(tribunais.map((t) => t.toUpperCase()));
  return fontes
    .map((fonte) => ({ fonte, tribunais: fonte.tribunais.filter((t) => pedidos.has(t)) }))
    .filter((s) => s.tribunais.length > 0);
}

/**
 * Consulta as fontes ao vivo em paralelo, grava o que voltar no acervo (cache verificável)
 * e vetoriza os documentos novos quando há busca semântica.
 */
export async function pesquisarAoVivo(
  acervo: Acervo,
  fontes: FonteAoVivo[],
  f: { consulta: string; tribunais?: string[]; data_inicio?: string; data_fim?: string; orgao?: string; relator?: string },
  opts: { timeoutMs: number; fetchImpl?: typeof fetch; embedder?: Embedder | null; limitePorFonte?: number },
): Promise<RelatorioFonte[]> {
  const selecionadas = selecionarFontes(fontes, f.tribunais);
  const agora = new Date().toISOString();

  const relatorios = await Promise.all(
    selecionadas.map(async ({ fonte, tribunais }): Promise<RelatorioFonte & { docs?: Documento[] }> => {
      // Timer próprio (e não AbortSignal.timeout) para não depender da fonte respeitar o sinal.
      const controle = new AbortController();
      const signal = controle.signal;
      let timer: NodeJS.Timeout | undefined;
      const prazo = new Promise<never>((_, rejeitar) => {
        timer = setTimeout(() => {
          const e = new Error("tempo esgotado");
          e.name = "TimeoutError";
          controle.abort(e);
          rejeitar(e);
        }, opts.timeoutMs);
      });
      try {
        const docs = await Promise.race([
          fonte.pesquisar({ ...f, tribunais, limite: opts.limitePorFonte ?? 20 }, { fetch: opts.fetchImpl ?? fetch, signal, agora }),
          prazo,
        ]);
        return { fonte: fonte.id, tribunais: tribunais.length ? tribunais : fonte.tribunais, status: "ok", documentos: docs.length, docs };
      } catch (e) {
        const tempo = signal.aborted || (e as Error).name === "TimeoutError";
        return {
          fonte: fonte.id,
          tribunais: tribunais.length ? tribunais : fonte.tribunais,
          status: tempo ? "tempo_esgotado" : "erro",
          documentos: 0,
          erro: tempo ? undefined : (e as Error).message.slice(0, 200),
        };
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  const novos = relatorios.flatMap((r) => r.docs ?? []);
  if (novos.length) {
    acervo.salvar(novos);
    if (opts.embedder && acervo.temVetores) {
      try {
        const rowids = acervo.rowids(novos.map((d) => d.id));
        const vetores = await opts.embedder.vetorizar(novos.map(textoParaVetor), "documento");
        acervo.salvarVetores(novos.map((d, i) => ({ rowid: rowids.get(d.id)!, vetor: vetores[i] })).filter((x) => x.rowid));
      } catch {
        // sem vetor, o documento ainda entra pela via lexical; o 'npm run vetorizar' completa depois
      }
    }
  }
  return relatorios.map(({ docs, ...r }) => r);
}
