import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

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

export class Acervo {
  readonly db: DatabaseSync;

  constructor(caminho: string) {
    if (caminho !== ":memory:") mkdirSync(dirname(caminho), { recursive: true });
    this.db = new DatabaseSync(caminho);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
    this.db.exec(SCHEMA);
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
    return { total, porTribunal, ultimaIngestao };
  }

  fechar(): void {
    this.db.close();
  }
}
