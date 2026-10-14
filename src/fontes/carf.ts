/** CARF — acórdãos do Conselho Administrativo de Recursos Fiscais (índice Solr público). */
import type { Documento } from "../db.js";
import { dataIso, limparHtml, type FonteAoVivo } from "./tipos.js";

const SOLR = "https://acordaos.economia.gov.br/solr/acordaos2/select";
const CAMPOS = "id,numero_decisao_s,numero_processo_s,turma_s,camara_s,secao_s,nome_relator_s,dt_sessao_tdt,dt_publicacao_tdt,ementa_s,decisao_txt,nome_arquivo_pdf_s";

/** Escapa caracteres especiais da sintaxe Lucene, preservando aspas de frase. */
export function escaparLucene(s: string): string {
  return s.replace(/([+\-!(){}[\]^~*?:\\/]|&&|\|\|)/g, "\\$1");
}

export function mapearCarf(d: Record<string, any>, agora: string): Documento | null {
  const ementa = limparHtml(d.ementa_s);
  if (!d.id || !ementa) return null;
  const csrf = /c[âa]mara superior/i.test(`${d.secao_s ?? ""} ${d.turma_s ?? ""}`);
  const decisao = Array.isArray(d.decisao_txt) ? d.decisao_txt.join("\n") : d.decisao_txt;
  const sessao = dataIso(d.dt_sessao_tdt);
  return {
    id: `CARF-${d.id}`,
    tribunal: "CARF",
    tipo: "acordao",
    classe: "Acórdão",
    numero: d.numero_decisao_s ?? null,
    registro: d.numero_processo_s ?? null,
    orgao: d.turma_s ?? d.camara_s ?? d.secao_s ?? null,
    relator: d.nome_relator_s ?? null,
    data_julgamento: sessao && sessao < "2100" ? sessao : null,
    data_publicacao: dataIso(d.dt_publicacao_tdt),
    autoridade: csrf ? "C" : "D",
    situacao: null,
    titulo: `Acórdão CARF ${d.numero_decisao_s ?? d.id} — ${d.turma_s ?? d.secao_s ?? ""}`.trim(),
    ementa,
    tese: null,
    inteiro_teor: limparHtml(decisao),
    referencias: null,
    assuntos: ementa.match(/^Assunto:\s*(.+)$/m)?.[1] ?? null,
    fonte: "carf-acordaos",
    fonte_url: d.nome_arquivo_pdf_s ? `https://acordaos.economia.gov.br/acordaos2/pdfs/processados/${d.nome_arquivo_pdf_s}` : null,
    atualizado_em: agora,
  };
}

export const fonteCarf: FonteAoVivo = {
  id: "carf",
  nome: "CARF — Acórdãos do Conselho Administrativo de Recursos Fiscais",
  tribunais: ["CARF"],
  padrao: false,
  async pesquisar(f, ctx) {
    const consultar = async (operador: "AND" | "OR") => {
      const p = new URLSearchParams({
        q: escaparLucene(f.consulta),
        defType: "edismax",
        qf: "_texto",
        "q.op": operador,
        rows: String(Math.min(f.limite, 30)),
        fl: CAMPOS,
        wt: "json",
      });
      p.append("fq", `dt_sessao_tdt:[${f.data_inicio ? `${f.data_inicio}T00:00:00Z` : "*"} TO ${f.data_fim ? `${f.data_fim}T23:59:59Z` : "NOW"}]`);
      if (f.relator) p.append("fq", `nome_relator_s:*${escaparLucene(f.relator.toUpperCase()).replace(/\s+/g, "\\ ")}*`);
      const r = await ctx.fetch(`${SOLR}?${p}`, { signal: ctx.signal });
      if (!r.ok) throw new Error(`CARF respondeu HTTP ${r.status}`);
      const j = (await r.json()) as { response: { docs: Record<string, any>[] } };
      return j.response.docs.map((d) => mapearCarf(d, ctx.agora)).filter((d): d is Documento => d !== null);
    };
    const exatos = await consultar("AND");
    return exatos.length ? exatos : consultar("OR");
  },
};
