import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";

import { SCHEMA_LEGISLACAO } from "./legislacao/indice.js";

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

-- Análises geradas por IA (ex.: razão de decidir), guardadas para não repetir o custo.
CREATE TABLE IF NOT EXISTS analises (
  doc_id TEXT NOT NULL,
  tipo TEXT NOT NULL,
  modelo TEXT NOT NULL,
  conteudo TEXT NOT NULL,
  criado_em TEXT NOT NULL,
  PRIMARY KEY (doc_id, tipo)
);

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
  /** A extensão sqlite-vec foi carregada. */
  vetoresDisponiveis = false;

  constructor(caminho: string) {
    if (caminho !== ":memory:") mkdirSync(dirname(caminho), { recursive: true });
    try {
      this.db = new DatabaseSync(caminho, { allowExtension: true });
    } catch {
      // Node anterior ao 22.13 não conhece allowExtension
      this.db = new DatabaseSync(caminho);
    }
    try {
      require("sqlite-vec").load(this.db);
      this.vetoresDisponiveis = true;
    } catch (e) {
      // Node sem loadExtension (anterior ao 22.13) ou binário ausente: segue só com a busca textual.
      console.error(`Índice vetorial indisponível (${(e as Error).message}); busca semântica desativada.`);
    }
    // Várias sessões (chat, Cowork, Claude Code) podem abrir a mesma base: espera em vez de falhar.
    this.db.exec("PRAGMA busy_timeout = 15000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
    this.db.exec(SCHEMA);
    this.db.exec(SCHEMA_LEGISLACAO);
    const meta = this.lerMeta("vetor_dimensoes");
    if (meta && this.vetoresDisponiveis) this.dimensoesVetor = Number(meta);
  }

  lerMeta(chave: string): string | null {
    const r = this.db.prepare("SELECT valor FROM meta WHERE chave = ?").get(chave) as { valor: string } | undefined;
    return r?.valor ?? null;
  }

  gravarMeta(chave: string, valor: string): void {
    this.db.prepare("INSERT INTO meta (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor").run(chave, valor);
  }

  /**
   * Cria (ou confere) o índice vetorial para o modelo informado. Trocar de modelo exige
   * recriar o índice, porque vetores de modelos diferentes não são comparáveis.
   */
  prepararVetores(modeloId: string, dimensoes: number, recriar = false): void {
    if (!this.vetoresDisponiveis) throw new Error("Busca semântica indisponível: o Node.js em uso não carrega a extensão sqlite-vec (requer 22.13+).");
    const atual = this.lerMeta("vetor_modelo");
    if (atual && atual !== modeloId && !recriar) {
      throw new Error(`O índice vetorial foi criado com '${atual}'. Rode 'npm run vetorizar -- --recriar' para trocar para '${modeloId}'.`);
    }
    if (recriar || (atual && atual !== modeloId)) {
      this.db.exec("DROP TABLE IF EXISTS documentos_vec; DROP TABLE IF EXISTS dispositivos_vec; DELETE FROM meta WHERE chave LIKE 'vetor_%';");
    }
    this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS documentos_vec USING vec0(embedding float[${dimensoes}] distance_metric=cosine)`);
    this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS dispositivos_vec USING vec0(embedding float[${dimensoes}] distance_metric=cosine)`);
    this.gravarMeta("vetor_modelo", modeloId);
    this.gravarMeta("vetor_dimensoes", String(dimensoes));
    this.dimensoesVetor = dimensoes;
  }

  /**
   * Cobertura do acervo local por tribunal e tipo: quantos documentos, de que período (data de
   * corte) e quando a base foi atualizada pela última vez. Ajuda a ler um "não encontrado".
   */
  coberturaAcervo(tribunais?: string[]): {
    atualizado_em: string | null;
    tribunais: { tribunal: string; tipo: string; documentos: number; julgados_de: string | null; julgados_ate: string | null }[];
  } {
    const filtro = tribunais?.length ? `WHERE tribunal IN (${tribunais.map(() => "?").join(",")})` : "";
    const linhas = this.db
      .prepare(
        `SELECT tribunal, tipo, COUNT(*) documentos, MIN(data_julgamento) julgados_de, MAX(data_julgamento) julgados_ate
         FROM documentos ${filtro} GROUP BY 1, 2 ORDER BY 1, 2`,
      )
      .all(...(tribunais ?? []).map((t) => t.toUpperCase())) as { tribunal: string; tipo: string; documentos: number; julgados_de: string | null; julgados_ate: string | null }[];
    const atualizado = (this.db.prepare("SELECT MAX(importado_em) t FROM ingestoes").get() as { t: string | null }).t;
    return { atualizado_em: atualizado, tribunais: linhas.map((l) => ({ ...l })) };
  }

  /** Fração (0 a 1) de documentos e de dispositivos legais que já têm vetor. */
  coberturaVetores(): { documentos: number; dispositivos: number } {
    if (!this.temVetores) return { documentos: 0, dispositivos: 0 };
    const fracao = (base: string, vec: string) => {
      const r = this.db.prepare(`SELECT (SELECT COUNT(*) FROM ${base}) t, (SELECT COUNT(*) FROM ${vec}) v`).get() as { t: number; v: number };
      return r.t ? Math.min(1, r.v / r.t) : 1;
    };
    return { documentos: fracao("documentos", "documentos_vec"), dispositivos: fracao("dispositivos", "dispositivos_vec") };
  }

  /** Modelo com que o índice vetorial foi criado (ex.: 'local:granite-...:384'), se houver. */
  get modeloVetorial(): string | null {
    return this.temVetores ? this.lerMeta("vetor_modelo") : null;
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

  get temVetoresLegislacao(): boolean {
    return this.temVetores;
  }

  /** Dispositivos legais ainda sem vetor. */
  pendentesDeVetorLegislacao(limite: number): { rowid: number; texto: string }[] {
    return this.db
      .prepare(
        `SELECT d.rowid AS rowid, d.norma_nome || ' — ' || d.rotulo || COALESCE(' (' || d.caminho || ')', '') || ': ' || d.texto AS texto
         FROM dispositivos d WHERE NOT EXISTS (SELECT 1 FROM dispositivos_vec v WHERE v.rowid = d.rowid) LIMIT ?`,
      )
      .all(limite) as { rowid: number; texto: string }[];
  }

  salvarVetoresLegislacao(itens: { rowid: number; vetor: Float32Array }[]): void {
    const del = this.db.prepare("DELETE FROM dispositivos_vec WHERE rowid = ?");
    const ins = this.db.prepare("INSERT INTO dispositivos_vec (rowid, embedding) VALUES (?, ?)");
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

  vizinhosLegislacao(vetor: Float32Array, k: number): VizinhoVetorial[] {
    if (!this.temVetores) return [];
    return this.db
      .prepare("SELECT rowid, distance AS distancia FROM dispositivos_vec WHERE embedding MATCH ? AND k = ?")
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

  lerAnalise<T>(docId: string, tipo: string): { modelo: string; conteudo: T; criado_em: string } | null {
    const r = this.db.prepare("SELECT modelo, conteudo, criado_em FROM analises WHERE doc_id = ? AND tipo = ?").get(docId, tipo) as
      | { modelo: string; conteudo: string; criado_em: string }
      | undefined;
    return r ? { ...r, conteudo: JSON.parse(r.conteudo) as T } : null;
  }

  gravarAnalise(docId: string, tipo: string, modelo: string, conteudo: unknown): void {
    this.db
      .prepare(
        `INSERT INTO analises (doc_id, tipo, modelo, conteudo, criado_em) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(doc_id, tipo) DO UPDATE SET modelo = excluded.modelo, conteudo = excluded.conteudo, criado_em = excluded.criado_em`,
      )
      .run(docId, tipo, modelo, JSON.stringify(conteudo), new Date().toISOString());
  }

  /** Atualiza só o texto integral de um documento (ex.: inteiro teor baixado depois). */
  gravarInteiroTeor(id: string, texto: string): void {
    this.db.prepare("UPDATE documentos SET inteiro_teor = ? WHERE id = ?").run(texto, id);
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
      ? {
          modelo: this.lerMeta("vetor_modelo"),
          documentos_vetorizados: this.contarVetores(),
          documentos_sem_vetor: total - this.contarVetores(),
          dispositivos_sem_vetor: (
            this.db.prepare("SELECT COUNT(*) n FROM dispositivos d WHERE NOT EXISTS (SELECT 1 FROM dispositivos_vec v WHERE v.rowid = d.rowid)").get() as { n: number }
          ).n,
        }
      : null;
    return { total, porTribunal, ultimaIngestao, busca_semantica };
  }

  fechar(): void {
    this.db.close();
  }
}
