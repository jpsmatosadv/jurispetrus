/**
 * TCU — pesquisa pública (pesquisa.apps.tcu.gov.br): jurisprudência selecionada,
 * súmulas e acórdãos.
 */
import type { Documento } from "../db.js";
import { dataIso, limparHtml, type FonteAoVivo } from "./tipos.js";

const API = "https://pesquisa.apps.tcu.gov.br/rest/publico/base";
// O WAF do TCU recusa o User-Agent padrão do curl; um UA identificado passa.
const CABECALHOS = { "User-Agent": "jurispetrus/0.1 (+https://github.com/jpsmatosadv/jurispetrus)", Accept: "application/json" };

const linkPesquisa = (base: string, key: string) =>
  `https://pesquisa.apps.tcu.gov.br/documento/${base}/*/KEY:${encodeURIComponent(`"${key}"`)}/score%20desc/0`;

export function mapearTcu(base: string, r: Record<string, any>, agora: string): Documento | null {
  if (!r.KEY) return null;
  const colegiado = r.COLEGIADO ?? null;
  if (base === "sumula") {
    const enunciado = limparHtml(r.CABECALHO) ?? limparHtml(r.ENUNCIADO)?.replace(/^SÚMULA TCU \d+:\s*/i, "");
    if (!enunciado) return null;
    return {
      id: `TCU-${r.KEY}`, tribunal: "TCU", tipo: "sumula", classe: "Súmula", numero: String(r.NUMERO),
      registro: null, orgao: colegiado, relator: r.AUTORTESE ?? null, data_julgamento: null, data_publicacao: null,
      autoridade: "C", situacao: r.VIGENTE === "false" || r.VIGENTE === false ? "Cancelada (não vigente)" : "Vigente",
      titulo: `Súmula TCU ${r.NUMERO}`, ementa: [limparHtml(r.AREA), r.TEMA, r.SUBTEMA].filter(Boolean).join(" — ") || null,
      tese: enunciado, inteiro_teor: limparHtml(r.EXCERTO), referencias: null, assuntos: limparHtml(r.INDEXACAO),
      fonte: "tcu-pesquisa", fonte_url: linkPesquisa(base, r.KEY), atualizado_em: agora,
    };
  }
  const numero = r.NUMACORDAO && r.ANOACORDAO ? `${r.NUMACORDAO}/${r.ANOACORDAO}` : null;
  const rotulo = numero ? `Acórdão ${numero}-TCU-${colegiado ?? ""}`.replace(/-$/, "") : limparHtml(r.TITULO) ?? r.KEY;
  if (base === "jurisprudencia-selecionada") {
    const enunciado = limparHtml(r.ENUNCIADO);
    if (!enunciado) return null;
    return {
      id: `TCU-${r.KEY}`, tribunal: "TCU", tipo: "enunciado", classe: "Acórdão", numero, registro: null,
      orgao: colegiado, relator: r.AUTORTESE ?? null, data_julgamento: dataIso(r.DATASESSAOFORMATADA), data_publicacao: null,
      autoridade: "D", situacao: null, titulo: `${rotulo} (jurisprudência selecionada)`,
      ementa: [limparHtml(r.AREA), r.TEMA, r.SUBTEMA].filter(Boolean).join(" — ") || null, tese: enunciado,
      inteiro_teor: limparHtml(r.EXCERTO), referencias: limparHtml(r.REFERENCIALEGAL), assuntos: limparHtml(r.INDEXACAO),
      fonte: "tcu-pesquisa", fonte_url: linkPesquisa(base, r.KEY), atualizado_em: agora,
    };
  }
  const sumario = limparHtml(r.SUMARIO);
  if (!sumario) return null;
  return {
    id: `TCU-${r.KEY}`, tribunal: "TCU", tipo: "acordao", classe: "Acórdão", numero, registro: r.PROC ?? null,
    orgao: colegiado, relator: r.RELATOR ?? null, data_julgamento: dataIso(r.DATASESSAO), data_publicacao: null,
    autoridade: "E", situacao: r.SITUACAO ?? null, titulo: rotulo, ementa: sumario, tese: null,
    inteiro_teor: [limparHtml(r.FRAGMENTO1), limparHtml(r.FRAGMENTO2)].filter(Boolean).join("\n") || null,
    referencias: null, assuntos: null, fonte: "tcu-pesquisa",
    fonte_url: r.URLARQUIVOPDF ?? linkPesquisa(base, r.KEY), atualizado_em: agora,
  };
}

export const fonteTcu: FonteAoVivo = {
  id: "tcu",
  nome: "TCU — Jurisprudência selecionada, súmulas e acórdãos",
  tribunais: ["TCU"],
  padrao: false,
  async pesquisar(f, ctx) {
    const filtros: string[] = [];
    if (f.data_inicio || f.data_fim) {
      const ini = Number((f.data_inicio ?? "1990").slice(0, 4)), fim = Number((f.data_fim ?? "2100").slice(0, 4));
      if (fim - ini < 15) filtros.push(`ANOACORDAO:(${Array.from({ length: fim - ini + 1 }, (_, i) => ini + i).join(" OR ")})`);
    }
    const consultar = async (base: string, quantidade: number, comFiltro: boolean) => {
      const p = new URLSearchParams({ termo: f.consulta, quantidade: String(quantidade), inicio: "0" });
      if (comFiltro && filtros.length) p.set("filtro", filtros.join(" "));
      const r = await ctx.fetch(`${API}/${base}/documentosResumidos?${p}`, { headers: CABECALHOS, signal: ctx.signal });
      if (!r.ok) throw new Error(`TCU (${base}) respondeu HTTP ${r.status}`);
      if (!/json/.test(r.headers.get("content-type") ?? "")) throw new Error("TCU recusou a requisição (bloqueio do portal).");
      const j = (await r.json()) as { documentos?: Record<string, any>[] };
      return (j.documentos ?? []).map((d) => mapearTcu(base, d, ctx.agora)).filter((d): d is Documento => d !== null);
    };
    const n = Math.max(3, Math.ceil(f.limite / 2));
    const partes = await Promise.all([
      consultar("sumula", 3, false),
      consultar("jurisprudencia-selecionada", n, true),
      consultar("acordao-completo", n, true),
    ]);
    return partes.flat();
  },
};
