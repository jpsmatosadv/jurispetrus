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
    // radical + prefixo para palavras longas ("indeniz*" casa "indenização", "indenizatória", "indenizar")
    partes.push(termo.length >= 7 ? `${radical(termo)}*` : `"${termo}"`);
  }
  const unicos = [...new Set(partes)];
  return unicos.length ? unicos.join(" OR ") : null;
}

/** Sufixos (sem acento) removidos para obter o radical; os mais longos primeiro. */
const SUFIXOS = [
  "icional", "acional", "amentos", "imentos", "cional", "amento", "imento", "ional", "mente", "acoes", "icoes", "idades",
  "encias", "ancias", "acao", "icao", "coes", "soes", "idade", "encia", "ancia", "avel", "ivel", "ario", "aria", "adores",
  "ador", "adora", "ados", "adas", "idos", "idas", "ado", "ada", "ido", "ida", "ivo", "iva", "oso", "osa", "cao", "sao",
  "ar", "er", "ir", "os", "as", "es", "o", "a", "e", "s",
];

/** Radicalizador leve para português: corta um sufixo, mantendo ao menos 5 letras. */
export function radical(termo: string): string {
  for (const suf of SUFIXOS) {
    if (termo.endsWith(suf) && termo.length - suf.length >= 5) return termo.slice(0, -suf.length);
  }
  return termo;
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

const CLASSES_EXIBICAO: Record<string, string> = { SV: "Súmula Vinculante", IRR: "Tema IRR", PN: "Precedente Normativo" };

export function identificacao(d: Pick<Documento, "tipo" | "classe" | "numero" | "tribunal" | "titulo">): string {
  if (d.classe && d.numero) return `${CLASSES_EXIBICAO[d.classe] ?? d.classe} ${formatarNumero(d.numero)}/${d.tribunal}`;
  return d.titulo;
}

function formatarNumero(n: string): string {
  return /^\d{4,}$/.test(n) ? Number(n).toLocaleString("pt-BR") : n;
}

interface Candidato {
  doc: Documento;
  trecho: string | null;
  lexical: number;
  semantica: number;
}

/** Cláusulas WHERE comuns às duas vias (lexical e vetorial). */
function filtrosSql(f: FiltrosPesquisa): { where: string[]; params: (string | number)[] } {
  const where: string[] = [];
  const params: (string | number)[] = [];
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
  return { where, params };
}

const CANDIDATOS = 300;

function viaLexical(acervo: Acervo, f: FiltrosPesquisa, fts: string, filtros: ReturnType<typeof filtrosSql>, mapa: Map<number, Candidato>) {
  // Pesos das colunas no BM25: titulo, ementa, tese, inteiro_teor, referencias, assuntos
  const sql = `
    SELECT d.rowid AS _rowid, d.*, bm25(documentos_fts, 4.0, 3.0, 4.0, 1.0, 1.5, 2.0) AS _bm25,
           snippet(documentos_fts, -1, '«', '»', ' … ', 40) AS _trecho
    FROM documentos_fts JOIN documentos d ON d.rowid = documentos_fts.rowid
    WHERE ${["documentos_fts MATCH ?", ...filtros.where].join(" AND ")}
    ORDER BY _bm25 LIMIT ${CANDIDATOS}`;
  const linhas = acervo.db.prepare(sql).all(fts, ...filtros.params) as any[];
  if (!linhas.length) return;
  // bm25 é negativo (quanto menor, melhor); normaliza para [0,1]
  const melhor = Math.min(...linhas.map((l) => l._bm25));
  const pior = Math.max(...linhas.map((l) => l._bm25));
  const faixa = pior - melhor || 1;
  for (const l of linhas) {
    const { _rowid, _bm25, _trecho, ...doc } = l;
    mapa.set(_rowid, { doc, trecho: _trecho, lexical: 1 - (_bm25 - melhor) / faixa, semantica: 0 });
  }
}

function viaSemantica(acervo: Acervo, vetor: Float32Array, filtros: ReturnType<typeof filtrosSql>, mapa: Map<number, Candidato>) {
  // Busca mais vizinhos que o necessário porque os filtros são aplicados depois do KNN.
  const k = filtros.where.length ? CANDIDATOS * 4 : CANDIDATOS;
  const vizinhos = acervo.vizinhos(vetor, k);
  if (!vizinhos.length) return;
  const dist = new Map(vizinhos.map((v) => [v.rowid, v.distancia]));
  const ids = [...dist.keys()];
  const linhas = acervo.db
    .prepare(
      `SELECT d.rowid AS _rowid, d.* FROM documentos d
       WHERE d.rowid IN (${ids.map(() => "?").join(",")}) ${filtros.where.map((w) => `AND ${w}`).join(" ")}`,
    )
    .all(...ids, ...filtros.params) as any[];
  if (!linhas.length) return;
  // similaridade cosseno = 1 - distância; normaliza dentro dos candidatos
  const sims = linhas.map((l) => 1 - dist.get(l._rowid)!);
  const max = Math.max(...sims), min = Math.min(...sims);
  const faixa = max - min || 1;
  linhas.forEach((l, i) => {
    const { _rowid, ...doc } = l;
    const semantica = (sims[i] - min) / faixa;
    const atual = mapa.get(_rowid);
    if (atual) atual.semantica = semantica;
    else mapa.set(_rowid, { doc, trecho: null, lexical: 0, semantica });
  });
}

function resumoTexto(d: Documento): string {
  const t = (d.tese ?? d.ementa ?? d.titulo).replace(/\s+/g, " ").trim();
  return t.length > 320 ? `${t.slice(0, 320)} …` : t;
}

export interface OpcoesPesquisa {
  /** Vetor da consulta já calculado (busca semântica). Sem ele, a busca é só lexical. */
  vetorConsulta?: Float32Array | null;
}

/**
 * Pesquisa com ranqueamento híbrido: relevância textual (BM25) e semântica (embeddings),
 * combinadas com a autoridade do precedente e a atualidade do julgamento.
 * Entendimentos cancelados/revisados são penalizados ou omitidos.
 */
export function pesquisar(
  acervo: Acervo,
  f: FiltrosPesquisa,
  opts: OpcoesPesquisa = {},
): { total_candidatos: number; modo: "hibrido" | "lexical"; resultados: ResultadoPesquisa[] } {
  const filtros = filtrosSql(f);
  const mapa = new Map<number, Candidato>();
  const fts = montarConsultaFts(f.consulta);
  if (fts) viaLexical(acervo, f, fts, filtros, mapa);
  const hibrido = !!opts.vetorConsulta && acervo.temVetores;
  if (hibrido) viaSemantica(acervo, opts.vetorConsulta!, filtros, mapa);

  const pontuados = [...mapa.values()]
    .filter((c) => f.incluir_cancelados || !SITUACOES_SUPERADAS.test(c.doc.situacao ?? ""))
    .map((c) => {
      const relevancia = hibrido ? 0.45 * c.lexical + 0.55 * c.semantica : c.lexical;
      const autoridade = PESO_AUTORIDADE[c.doc.autoridade];
      const idade = idadeEmAnos(c.doc.data_julgamento);
      const atualidade = idade === null ? 0.3 : Math.exp(-idade / 8);
      let pontuacao = 0.6 * relevancia + 0.28 * autoridade + 0.12 * atualidade;
      if (SITUACOES_SUPERADAS.test(c.doc.situacao ?? "")) pontuacao *= 0.4;
      return { c, pontuacao };
    })
    .sort((a, b) => b.pontuacao - a.pontuacao);

  const limite = Math.min(Math.max(f.limite ?? 10, 1), 30);
  const inicio = (Math.max(f.pagina ?? 1, 1) - 1) * limite;

  return {
    total_candidatos: pontuados.length,
    modo: hibrido ? "hibrido" : "lexical",
    resultados: pontuados.slice(inicio, inicio + limite).map(({ c: { doc: l, trecho }, pontuacao }) => ({
      id: l.id,
      tribunal: l.tribunal,
      tipo: l.tipo,
      identificacao: identificacao(l),
      orgao: l.orgao,
      relator: l.relator,
      data_julgamento: l.data_julgamento,
      autoridade: l.autoridade,
      situacao: l.situacao,
      trecho: trecho ? trecho.replace(/\s+/g, " ").trim() : resumoTexto(l),
      tese: l.tese,
      fonte_url: l.fonte_url,
      pontuacao: Math.round(pontuacao * 1000) / 1000,
    })),
  };
}
