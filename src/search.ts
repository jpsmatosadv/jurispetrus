import type { Acervo, Autoridade, Documento } from "./db.js";

export interface FiltrosPesquisa {
  consulta: string;
  tribunais?: string[];
  autoridade_minima?: Autoridade;
  orgao?: string;
  relator?: string;
  data_inicio?: string;
  data_fim?: string;
  incluir_cancelados?: boolean;
  limite?: number;
  pagina?: number;
}

export interface ResultadoPesquisa {
  id: string;
  tribunal: string;
  tipo: string;
  identificacao: string;
  orgao: string | null;
  relator: string | null;
  data_julgamento: string | null;
  autoridade: Autoridade;
  situacao: string | null;
  trecho: string;
  tese: string | null;
  fonte_url: string | null;
  pontuacao: number;
}

const PESO_AUTORIDADE: Record<Autoridade, number> = { A: 1, B: 0.85, C: 0.6, D: 0.4, E: 0.15 };
const ORDEM_AUTORIDADE: Autoridade[] = ["A", "B", "C", "D", "E"];

/** Situações que indicam que o entendimento não deve mais ser aplicado. */
const SITUACOES_SUPERADAS = /cancelad|revisad|prejudicad|superad/i;

const STOPWORDS = new Set(
  "a o e de da do das dos em no na nos nas um uma uns umas por para com sem que se ao aos as os ou sobre entre ate pelo pela pelos pelas seu sua seus suas nao and or not near".split(" "),
);

/**
 * Converte a consulta livre do usuário em expressão FTS5 segura.
 * Mantém frases entre aspas, descarta operadores e stopwords e une os termos com OR,
 * deixando a relevância (BM25) premiar documentos que contêm mais termos.
 */
export function montarConsultaFts(consulta: string): string | null {
  const partes: string[] = [];
  const frases = [...consulta.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const resto = consulta.replace(/"[^"]*"/g, " ");

  for (const frase of frases) {
    const termos = tokenizar(frase);
    if (termos.length) partes.push(`"${termos.join(" ")}"`);
  }
  for (const termo of tokenizar(resto)) {
    if (STOPWORDS.has(termo) || termo.length < 2) continue;
    // prefixo para palavras longas ("indeniza*" casa "indenização", "indenizatória")
    partes.push(termo.length >= 7 ? `${termo.slice(0, Math.max(5, Math.ceil(termo.length * 0.7)))}*` : `"${termo}"`);
  }
  const unicos = [...new Set(partes)];
  return unicos.length ? unicos.join(" OR ") : null;
}

function tokenizar(texto: string): string[] {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Converte data ISO (AAAA-MM-DD) em anos decorridos até hoje. */
function idadeEmAnos(data: string | null, hoje = new Date()): number | null {
  if (!data) return null;
  const t = Date.parse(data);
  if (Number.isNaN(t)) return null;
  return Math.max(0, (hoje.getTime() - t) / (365.25 * 24 * 3600 * 1000));
}

export function identificacao(d: Pick<Documento, "tipo" | "classe" | "numero" | "tribunal" | "titulo">): string {
  if (d.classe && d.numero) return `${d.classe} ${formatarNumero(d.numero)}/${d.tribunal}`;
  return d.titulo;
}

function formatarNumero(n: string): string {
  return /^\d{4,}$/.test(n) ? Number(n).toLocaleString("pt-BR") : n;
}

/**
 * Pesquisa com ranqueamento híbrido: relevância textual (BM25) + autoridade do precedente
 * + atualidade do julgamento. Entendimentos cancelados/revisados são penalizados.
 */
export function pesquisar(acervo: Acervo, f: FiltrosPesquisa): { total_candidatos: number; resultados: ResultadoPesquisa[] } {
  const fts = montarConsultaFts(f.consulta);
  if (!fts) return { total_candidatos: 0, resultados: [] };

  const where: string[] = ["documentos_fts MATCH ?"];
  const params: (string | number)[] = [fts];

  if (f.tribunais?.length) {
    where.push(`d.tribunal IN (${f.tribunais.map(() => "?").join(",")})`);
    params.push(...f.tribunais.map((t) => t.toUpperCase()));
  }
  if (f.autoridade_minima) {
    const permitidos = ORDEM_AUTORIDADE.slice(0, ORDEM_AUTORIDADE.indexOf(f.autoridade_minima) + 1);
    where.push(`d.autoridade IN (${permitidos.map(() => "?").join(",")})`);
    params.push(...permitidos);
  }
  if (f.orgao) {
    where.push("d.orgao LIKE ?");
    params.push(`%${f.orgao}%`);
  }
  if (f.relator) {
    where.push("d.relator LIKE ?");
    params.push(`%${f.relator}%`);
  }
  if (f.data_inicio) {
    where.push("d.data_julgamento >= ?");
    params.push(f.data_inicio);
  }
  if (f.data_fim) {
    where.push("d.data_julgamento <= ?");
    params.push(f.data_fim);
  }

  // Pesos das colunas no BM25: titulo, ementa, tese, inteiro_teor, referencias, assuntos
  const sql = `
    SELECT d.*, bm25(documentos_fts, 4.0, 3.0, 4.0, 1.0, 1.5, 2.0) AS bm25,
           snippet(documentos_fts, -1, '«', '»', ' … ', 40) AS trecho
    FROM documentos_fts JOIN documentos d ON d.rowid = documentos_fts.rowid
    WHERE ${where.join(" AND ")}
    ORDER BY bm25 LIMIT 300`;

  const linhas = acervo.db.prepare(sql).all(...params) as unknown as (Documento & { bm25: number; trecho: string })[];
  if (linhas.length === 0) return { total_candidatos: 0, resultados: [] };

  // bm25 é negativo (quanto menor, melhor); normaliza para [0,1]
  const melhor = Math.min(...linhas.map((l) => l.bm25));
  const pior = Math.max(...linhas.map((l) => l.bm25));
  const faixa = pior - melhor || 1;

  const pontuados = linhas
    .filter((l) => f.incluir_cancelados || !SITUACOES_SUPERADAS.test(l.situacao ?? ""))
    .map((l) => {
      const relevancia = 1 - (l.bm25 - melhor) / faixa;
      const autoridade = PESO_AUTORIDADE[l.autoridade];
      const idade = idadeEmAnos(l.data_julgamento);
      const atualidade = idade === null ? 0.3 : Math.exp(-idade / 8);
      let pontuacao = 0.6 * relevancia + 0.28 * autoridade + 0.12 * atualidade;
      if (SITUACOES_SUPERADAS.test(l.situacao ?? "")) pontuacao *= 0.4;
      return { l, pontuacao };
    })
    .sort((a, b) => b.pontuacao - a.pontuacao);

  const limite = Math.min(Math.max(f.limite ?? 10, 1), 30);
  const inicio = (Math.max(f.pagina ?? 1, 1) - 1) * limite;

  return {
    total_candidatos: pontuados.length,
    resultados: pontuados.slice(inicio, inicio + limite).map(({ l, pontuacao }) => ({
      id: l.id,
      tribunal: l.tribunal,
      tipo: l.tipo,
      identificacao: identificacao(l),
      orgao: l.orgao,
      relator: l.relator,
      data_julgamento: l.data_julgamento,
      autoridade: l.autoridade,
      situacao: l.situacao,
      trecho: l.trecho.replace(/\s+/g, " ").trim(),
      tese: l.tese,
      fonte_url: l.fonte_url,
      pontuacao: Math.round(pontuacao * 1000) / 1000,
    })),
  };
}
