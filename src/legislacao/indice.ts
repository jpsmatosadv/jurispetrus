/**
 * Índice de dispositivos legais (um registro por artigo, com parágrafos, incisos e alíneas),
 * no mesmo SQLite do acervo, com busca textual (FTS5) e vetorial opcional.
 */
import type { Acervo } from "../db.js";
import { montarConsultaFts } from "../search.js";
import { CATALOGO, normaPorNumero, resolverNorma, type NormaCatalogo } from "./catalogo.js";

export interface Dispositivo {
  id: string;
  norma: string;
  norma_nome: string;
  artigo: string;
  ordem: number;
  rotulo: string;
  caminho: string | null;
  texto: string;
  revogado: number;
  fonte_url: string | null;
  atualizado_em: string;
}

export const SCHEMA_LEGISLACAO = `
CREATE TABLE IF NOT EXISTS normas (
  sigla TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  urn TEXT,
  fonte TEXT NOT NULL,
  fonte_url TEXT,
  versao TEXT,
  atualizado_em TEXT NOT NULL,
  dispositivos INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS dispositivos (
  id TEXT PRIMARY KEY,
  norma TEXT NOT NULL,
  norma_nome TEXT NOT NULL,
  artigo TEXT NOT NULL,
  ordem INTEGER NOT NULL,
  rotulo TEXT NOT NULL,
  caminho TEXT,
  texto TEXT NOT NULL,
  revogado INTEGER NOT NULL DEFAULT 0,
  fonte_url TEXT,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_disp_norma ON dispositivos(norma, ordem);
CREATE VIRTUAL TABLE IF NOT EXISTS dispositivos_fts USING fts5(
  rotulo, texto, caminho, norma_nome,
  content='dispositivos', content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS dispositivos_ai AFTER INSERT ON dispositivos BEGIN
  INSERT INTO dispositivos_fts(rowid, rotulo, texto, caminho, norma_nome) VALUES (new.rowid, new.rotulo, new.texto, new.caminho, new.norma_nome);
END;
CREATE TRIGGER IF NOT EXISTS dispositivos_ad AFTER DELETE ON dispositivos BEGIN
  INSERT INTO dispositivos_fts(dispositivos_fts, rowid, rotulo, texto, caminho, norma_nome) VALUES ('delete', old.rowid, old.rotulo, old.texto, old.caminho, old.norma_nome);
END;
CREATE TRIGGER IF NOT EXISTS dispositivos_au AFTER UPDATE ON dispositivos BEGIN
  INSERT INTO dispositivos_fts(dispositivos_fts, rowid, rotulo, texto, caminho, norma_nome) VALUES ('delete', old.rowid, old.rotulo, old.texto, old.caminho, old.norma_nome);
  INSERT INTO dispositivos_fts(rowid, rotulo, texto, caminho, norma_nome) VALUES (new.rowid, new.rotulo, new.texto, new.caminho, new.norma_nome);
END;
`;

/** Normaliza o número do artigo: "5º" → "5", "1.022" → "1022", "121-A" → "121-A". */
export function normalizarArtigo(a: string): string {
  return a
    .trim()
    .replace(/\.+$/, "")
    .replace(/[º°o]\b/gi, "")
    .replace(/(\d)\.(\d)/g, "$1$2")
    .replace(/\s*-\s*/g, "-")
    .trim()
    .toUpperCase();
}

/** Substitui todos os dispositivos de uma norma (a versão nova pode ter renumerações e revogações). */
export function salvarNorma(
  acervo: Acervo,
  norma: { sigla: string; nome: string; urn?: string; fonte: string; fonte_url?: string; versao?: string },
  dispositivos: Omit<Dispositivo, "norma" | "norma_nome" | "atualizado_em" | "id">[],
): number {
  const agora = new Date().toISOString();
  const db = acervo.db;
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM dispositivos WHERE norma = ?").run(norma.sigla);
    const ins = db.prepare(
      `INSERT OR REPLACE INTO dispositivos (id, norma, norma_nome, artigo, ordem, rotulo, caminho, texto, revogado, fonte_url, atualizado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const d of dispositivos) {
      ins.run(`${norma.sigla}-art-${d.artigo}`, norma.sigla, norma.nome, d.artigo, d.ordem, d.rotulo, d.caminho, d.texto, d.revogado, d.fonte_url, agora);
    }
    db.prepare(
      `INSERT INTO normas (sigla, nome, urn, fonte, fonte_url, versao, atualizado_em, dispositivos) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(sigla) DO UPDATE SET nome=excluded.nome, urn=excluded.urn, fonte=excluded.fonte, fonte_url=excluded.fonte_url,
         versao=excluded.versao, atualizado_em=excluded.atualizado_em, dispositivos=excluded.dispositivos`,
    ).run(norma.sigla, norma.nome, norma.urn ?? null, norma.fonte, norma.fonte_url ?? null, norma.versao ?? null, agora, dispositivos.length);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return dispositivos.length;
}

export function obterDispositivo(acervo: Acervo, norma: string, artigo: string): Dispositivo | undefined {
  return acervo.db.prepare("SELECT * FROM dispositivos WHERE norma = ? AND artigo = ?").get(norma, normalizarArtigo(artigo)) as
    | Dispositivo
    | undefined;
}

export function vizinhos(acervo: Acervo, d: Dispositivo, antes = 1, depois = 1): Dispositivo[] {
  return acervo.db
    .prepare("SELECT * FROM dispositivos WHERE norma = ? AND ordem BETWEEN ? AND ? AND id <> ? ORDER BY ordem")
    .all(d.norma, d.ordem - antes, d.ordem + depois, d.id) as unknown as Dispositivo[];
}

export function normaIndexada(acervo: Acervo, sigla: string): boolean {
  return !!acervo.db.prepare("SELECT 1 FROM normas WHERE sigla = ?").get(sigla);
}

export function normasIndexadas(acervo: Acervo) {
  return acervo.db.prepare("SELECT sigla, nome, fonte, fonte_url, versao, atualizado_em, dispositivos FROM normas ORDER BY sigla").all();
}

export interface CitacaoLegal {
  norma: string;
  artigo: string;
  /** Norma fora do catálogo, identificada por tipo/número/ano (importável sob demanda). */
  avulsa?: NormaCatalogo;
}

/**
 * Reconhece "art. 186 do CC", "CDC, art. 14", "artigo 5º, X, da Constituição", "art. 1.022 do CPC",
 * "art. 927, parágrafo único, do Código Civil".
 */
export function interpretarCitacaoLegal(texto: string): CitacaoLegal | null {
  const art = texto.match(/\bart(?:igo)?s?\.?\s*(\d[\d.]*(?:\s*-\s*[A-Z])?)\s*[º°o]?/i);
  if (!art) return null;
  const artigo = normalizarArtigo(art[1]);
  // a norma pode vir antes ("CDC, art. 14") ou depois ("art. 14 do CDC")
  const depois = texto.slice((art.index ?? 0) + art[0].length);
  const antes = texto.slice(0, art.index ?? 0);
  const candidatos = [
    ...[...depois.matchAll(/\b(?:d[oa]s?|na|no|da lei)\s+([A-ZÀ-Úa-zà-ú0-9./ ]{2,60})/g)].map((m) => m[1]),
    antes,
    depois,
  ];
  const porNumero = normaPorNumero(texto);
  if (porNumero) return porNumero.apelidos.length ? { norma: porNumero.sigla, artigo } : { norma: porNumero.sigla, artigo, avulsa: porNumero };
  for (const c of candidatos) {
    const n = resolverNorma(c.replace(/[,;()]/g, " ").trim()) ?? resolverPorSigla(c);
    if (n) return { norma: n.sigla, artigo };
  }
  return null;
}

function resolverPorSigla(texto: string) {
  const siglas = texto.toUpperCase().match(/\b[A-Z]{2,6}\b/g) ?? [];
  for (const s of siglas) {
    const n = CATALOGO.find((c) => c.sigla === s || c.apelidos.includes(s));
    if (n) return n;
  }
  return undefined;
}

export interface ResultadoLegislacao {
  id: string;
  norma: string;
  norma_nome: string;
  rotulo: string;
  caminho: string | null;
  texto: string;
  revogado: boolean;
  fonte_url: string | null;
  pontuacao: number;
}

/** Busca lexical (BM25) nos dispositivos, com filtro opcional de normas. Revogados ficam por último. */
export function pesquisarDispositivos(
  acervo: Acervo,
  consulta: string,
  opts: { normas?: string[]; limite?: number; incluirRevogados?: boolean; vetor?: Float32Array | null } = {},
): ResultadoLegislacao[] {
  const limite = Math.min(Math.max(opts.limite ?? 8, 1), 30);
  const filtros: string[] = [];
  const params: (string | number)[] = [];
  if (opts.normas?.length) {
    const siglas = opts.normas.map((n) => resolverNorma(n)?.sigla ?? n.toUpperCase());
    filtros.push(`d.norma IN (${siglas.map(() => "?").join(",")})`);
    params.push(...siglas);
  }
  if (!opts.incluirRevogados) filtros.push("d.revogado = 0");

  const pontos = new Map<number, { d: Dispositivo; lex: number; sem: number }>();
  const fts = montarConsultaFts(consulta);
  if (fts) {
    const linhas = acervo.db
      .prepare(
        `SELECT d.rowid AS _rowid, d.*, bm25(dispositivos_fts, 2.0, 1.0, 1.5, 0.5) AS _bm25
         FROM dispositivos_fts JOIN dispositivos d ON d.rowid = dispositivos_fts.rowid
         WHERE ${["dispositivos_fts MATCH ?", ...filtros].join(" AND ")} ORDER BY _bm25 LIMIT 200`,
      )
      .all(fts, ...params) as any[];
    if (linhas.length) {
      const melhor = Math.min(...linhas.map((l) => l._bm25)), pior = Math.max(...linhas.map((l) => l._bm25));
      for (const l of linhas) {
        const { _rowid, _bm25, ...d } = l;
        pontos.set(_rowid, { d, lex: 1 - (_bm25 - melhor) / (pior - melhor || 1), sem: 0 });
      }
    }
  }
  if (opts.vetor && acervo.temVetoresLegislacao) {
    const viz = acervo.vizinhosLegislacao(opts.vetor, 200);
    if (viz.length) {
      const dist = new Map(viz.map((v) => [v.rowid, v.distancia]));
      const ids = [...dist.keys()];
      const linhas = acervo.db
        .prepare(`SELECT d.rowid AS _rowid, d.* FROM dispositivos d WHERE d.rowid IN (${ids.map(() => "?").join(",")}) ${filtros.map((f) => `AND ${f}`).join(" ")}`)
        .all(...ids, ...params) as any[];
      const sims = linhas.map((l) => 1 - dist.get(l._rowid)!);
      const max = Math.max(...sims), min = Math.min(...sims);
      linhas.forEach((l, i) => {
        const { _rowid, ...d } = l;
        const sem = (sims[i] - min) / (max - min || 1);
        const atual = pontos.get(_rowid);
        if (atual) atual.sem = sem;
        else pontos.set(_rowid, { d, lex: 0, sem });
      });
    }
  }
  const hibrido = !!opts.vetor && acervo.temVetoresLegislacao;
  return [...pontos.values()]
    .map(({ d, lex, sem }) => ({ d, p: (hibrido ? 0.45 * lex + 0.55 * sem : lex) * (d.revogado ? 0.3 : 1) }))
    .sort((a, b) => b.p - a.p)
    .slice(0, limite)
    .map(({ d, p }) => ({
      id: d.id,
      norma: d.norma,
      norma_nome: d.norma_nome,
      rotulo: `${d.rotulo} (${d.norma})`,
      caminho: d.caminho,
      texto: d.texto.length > 1500 ? `${d.texto.slice(0, 1500)} …` : d.texto,
      revogado: !!d.revogado,
      fonte_url: d.fonte_url,
      pontuacao: Math.round(p * 1000) / 1000,
    }));
}

/**
 * Leis citadas nas notas de redação de um dispositivo ("Artigo acrescido pela Lei nº 14.181, de 1/7/2021"),
 * da mais recente para a mais antiga.
 */
export function leisAlteradoras(texto: string): string[] {
  const notas = texto.slice(texto.indexOf("Notas:") >= 0 ? texto.indexOf("Notas:") : 0);
  const achadas = [...notas.matchAll(/pel[ao]\s+(Lei(?:\s+Complementar)?|Emenda Constitucional|Medida Provis[óo]ria)\s+n[º°o.]*\s*([\d.]+)\s*,\s*de\s*(\d{1,2})[º°o]?\/(\d{1,2})\/(\d{4})/gi)]
    .map((m) => ({ rotulo: `${m[1]} nº ${m[2]}/${m[5]}`, data: `${m[5]}-${m[4].padStart(2, "0")}-${m[3].padStart(2, "0")}` }));
  const unicas = new Map<string, string>();
  for (const a of achadas.sort((x, y) => y.data.localeCompare(x.data))) if (!unicas.has(a.rotulo)) unicas.set(a.rotulo, a.data);
  return [...unicas.keys()];
}
