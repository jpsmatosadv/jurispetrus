import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/**
 * Níveis de autoridade do precedente, do mais forte ao mais fraco.
 *   A = vinculante forte (Súmula Vinculante, controle concentrado, súmulas dos tribunais superiores)
 *   B = precedente qualificado (repetitivo, repercussão geral, IRDR/IAC)
 *   C = observância qualificada (órgão de cúpula: Plenário, Corte Especial, Órgão Especial)
 *   D = orientativo (acórdãos de turmas/câmaras, enunciados)
 *   E = consulta (informativos, controvérsias, material de apoio)
 */
export type Autoridade = "A" | "B" | "C" | "D" | "E";

export interface Documento {
  id: string;
  tribunal: string;
  tipo: string;
  classe: string | null;
  numero: string | null;
  registro: string | null;
  orgao: string | null;
  relator: string | null;
  data_julgamento: string | null;
  data_publicacao: string | null;
  autoridade: Autoridade;
  situacao: string | null;
  titulo: string;
  ementa: string | null;
  tese: string | null;
  inteiro_teor: string | null;
  referencias: string | null;
  assuntos: string | null;
  fonte: string;
  fonte_url: string | null;
  atualizado_em: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS documentos (
  id TEXT PRIMARY KEY,
  tribunal TEXT NOT NULL,
  tipo TEXT NOT NULL,
  classe TEXT,
  numero TEXT,
  registro TEXT,
  orgao TEXT,
  relator TEXT,
  data_julgamento TEXT,
  data_publicacao TEXT,
  autoridade TEXT NOT NULL CHECK (autoridade IN ('A','B','C','D','E')),
  situacao TEXT,
  titulo TEXT NOT NULL,
  ementa TEXT,
  tese TEXT,
  inteiro_teor TEXT,
  referencias TEXT,
  assuntos TEXT,
  fonte TEXT NOT NULL,
  fonte_url TEXT,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_doc_tribunal ON documentos(tribunal);
CREATE INDEX IF NOT EXISTS idx_doc_numero ON documentos(numero);
CREATE INDEX IF NOT EXISTS idx_doc_classe_numero ON documentos(classe, numero);

CREATE VIRTUAL TABLE IF NOT EXISTS documentos_fts USING fts5(
  titulo, ementa, tese, inteiro_teor, referencias, assuntos,
  content='documentos', content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS documentos_ai AFTER INSERT ON documentos BEGIN
  INSERT INTO documentos_fts(rowid, titulo, ementa, tese, inteiro_teor, referencias, assuntos)
  VALUES (new.rowid, new.titulo, new.ementa, new.tese, new.inteiro_teor, new.referencias, new.assuntos);
END;
CREATE TRIGGER IF NOT EXISTS documentos_ad AFTER DELETE ON documentos BEGIN
  INSERT INTO documentos_fts(documentos_fts, rowid, titulo, ementa, tese, inteiro_teor, referencias, assuntos)
  VALUES ('delete', old.rowid, old.titulo, old.ementa, old.tese, old.inteiro_teor, old.referencias, old.assuntos);
END;
CREATE TRIGGER IF NOT EXISTS documentos_au AFTER UPDATE ON documentos BEGIN
  INSERT INTO documentos_fts(documentos_fts, rowid, titulo, ementa, tese, inteiro_teor, referencias, assuntos)
  VALUES ('delete', old.rowid, old.titulo, old.ementa, old.tese, old.inteiro_teor, old.referencias, old.assuntos);
  INSERT INTO documentos_fts(rowid, titulo, ementa, tese, inteiro_teor, referencias, assuntos)
  VALUES (new.rowid, new.titulo, new.ementa, new.tese, new.inteiro_teor, new.referencias, new.assuntos);
END;

CREATE TABLE IF NOT EXISTS meta (chave TEXT PRIMARY KEY, valor TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS ingestoes (
  fonte TEXT NOT NULL,
  recurso TEXT NOT NULL,
  importado_em TEXT NOT NULL,
  documentos INTEGER NOT NULL,
  PRIMARY KEY (fonte, recurso)
);
`;

const COLUNAS = [
  "id", "tribunal", "tipo", "classe", "numero", "registro", "orgao", "relator",
  "data_julgamento", "data_publicacao", "autoridade", "situacao", "titulo", "ementa",
  "tese", "inteiro_teor", "referencias", "assuntos", "fonte", "fonte_url", "atualizado_em",
] as const;

export interface VizinhoVetorial {
  rowid: number;
  distancia: number;
}

export class Acervo {
  readonly db: DatabaseSync;
  /** Dimensão do índice vetorial, quando existe. */
  private dimensoesVetor: number | null = null;

  constructor(caminho: string) {
    if (caminho !== ":memory:") mkdirSync(dirname(caminho), { recursive: true });
    this.db = new DatabaseSync(caminho, { allowExtension: true });
    require("sqlite-vec").load(this.db);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
    this.db.exec(SCHEMA);
    const meta = this.lerMeta("vetor_dimensoes");
    if (meta) this.dimensoesVetor = Number(meta);
  }

  lerMeta(chave: string): string | null {
    const r = this.db.prepare("SELECT valor FROM meta WHERE chave = ?").get(chave) as { valor: string } | undefined;
    return r?.valor ?? null;
  }

  private gravarMeta(chave: string, valor: string): void {
    this.db.prepare("INSERT INTO meta (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor").run(chave, valor);
  }

  /**
   * Cria (ou confere) o índice vetorial para o modelo informado. Trocar de modelo exige
   * recriar o índice, porque vetores de modelos diferentes não são comparáveis.
   */
  prepararVetores(modeloId: string, dimensoes: number, recriar = false): void {
    const atual = this.lerMeta("vetor_modelo");
    if (atual && atual !== modeloId && !recriar) {
      throw new Error(`O índice vetorial foi criado com '${atual}'. Rode 'npm run vetorizar -- --recriar' para trocar para '${modeloId}'.`);
    }
    if (recriar || (atual && atual !== modeloId)) {
      this.db.exec("DROP TABLE IF EXISTS documentos_vec; DELETE FROM meta WHERE chave LIKE 'vetor_%';");
    }
    this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS documentos_vec USING vec0(embedding float[${dimensoes}] distance_metric=cosine)`);
    this.gravarMeta("vetor_modelo", modeloId);
    this.gravarMeta("vetor_dimensoes", String(dimensoes));
    this.dimensoesVetor = dimensoes;
  }

  get temVetores(): boolean {
    return this.dimensoesVetor !== null;
  }

  /** Documentos ainda sem vetor, em lotes. */
  pendentesDeVetor(limite: number): (Pick<Documento, "titulo" | "ementa" | "tese" | "assuntos"> & { rowid: number })[] {
    return this.db
      .prepare(
        `SELECT d.rowid AS rowid, d.titulo, d.ementa, d.tese, d.assuntos FROM documentos d
         WHERE NOT EXISTS (SELECT 1 FROM documentos_vec v WHERE v.rowid = d.rowid) LIMIT ?`,
      )
      .all(limite) as any;
  }

  salvarVetores(itens: { rowid: number; vetor: Float32Array }[]): void {
    const del = this.db.prepare("DELETE FROM documentos_vec WHERE rowid = ?");
    const ins = this.db.prepare("INSERT INTO documentos_vec (rowid, embedding) VALUES (?, ?)");
    this.db.exec("BEGIN");
    try {
      for (const { rowid, vetor } of itens) {
        del.run(BigInt(rowid));
        ins.run(BigInt(rowid), vetor);
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  vizinhos(vetor: Float32Array, k: number): VizinhoVetorial[] {
    if (!this.temVetores) return [];
    return this.db
      .prepare("SELECT rowid, distance AS distancia FROM documentos_vec WHERE embedding MATCH ? AND k = ?")
      .all(vetor, k) as unknown as VizinhoVetorial[];
  }

  contarVetores(): number {
    if (!this.temVetores) return 0;
    return (this.db.prepare("SELECT COUNT(*) n FROM documentos_vec").get() as { n: number }).n;
  }

  /** Insere ou atualiza documentos em uma única transação. */
  salvar(docs: Documento[]): number {
    if (docs.length === 0) return 0;
    const sql = `INSERT INTO documentos (${COLUNAS.join(",")}) VALUES (${COLUNAS.map(() => "?").join(",")})
      ON CONFLICT(id) DO UPDATE SET ${COLUNAS.filter((c) => c !== "id").map((c) => `${c}=excluded.${c}`).join(",")}`;
    const stmt = this.db.prepare(sql);
    this.db.exec("BEGIN");
    try {
      for (const d of docs) stmt.run(...COLUNAS.map((c) => d[c] ?? null));
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return docs.length;
  }

  /** Mapeia ids de documentos para o rowid interno (usado pelo índice vetorial). */
  rowids(ids: string[]): Map<string, number> {
    const stmt = this.db.prepare("SELECT rowid FROM documentos WHERE id = ?");
    const m = new Map<string, number>();
    for (const id of ids) {
      const r = stmt.get(id) as { rowid: number } | undefined;
      if (r) m.set(id, r.rowid);
    }
    return m;
  }

  obter(id: string): Documento | undefined {
    return this.db.prepare("SELECT * FROM documentos WHERE id = ?").get(id) as Documento | undefined;
  }

  registrarIngestao(fonte: string, recurso: string, documentos: number): void {
    this.db
      .prepare(
        `INSERT INTO ingestoes (fonte, recurso, importado_em, documentos) VALUES (?, ?, ?, ?)
         ON CONFLICT(fonte, recurso) DO UPDATE SET importado_em=excluded.importado_em, documentos=excluded.documentos`,
      )
      .run(fonte, recurso, new Date().toISOString(), documentos);
  }

  jaIngerido(fonte: string, recurso: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM ingestoes WHERE fonte = ? AND recurso = ?").get(fonte, recurso);
  }

  estatisticas() {
    const total = (this.db.prepare("SELECT COUNT(*) n FROM documentos").get() as { n: number }).n;
    const porTribunal = this.db
      .prepare("SELECT tribunal, tipo, autoridade, COUNT(*) n, MIN(data_julgamento) desde, MAX(data_julgamento) ate FROM documentos GROUP BY 1,2,3 ORDER BY 1,3,2")
      .all();
    const ultimaIngestao = (this.db.prepare("SELECT MAX(importado_em) t FROM ingestoes").get() as { t: string | null }).t;
    const busca_semantica = this.temVetores
      ? { modelo: this.lerMeta("vetor_modelo"), documentos_vetorizados: this.contarVetores() }
      : null;
    return { total, porTribunal, ultimaIngestao, busca_semantica };
  }

  fechar(): void {
    this.db.close();
  }
}
