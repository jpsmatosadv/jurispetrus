/**
 * TST — pesquisa textual de jurisprudência (backend público do portal jurisprudencia.tst.jus.br).
 * Acórdãos, súmulas, orientações jurisprudenciais e precedentes normativos.
 */
import type { Autoridade, Documento } from "../db.js";
import { autoridadePorOrgao, limparHtml, type FonteAoVivo } from "./tipos.js";

const API = "https://jurisprudencia-backend.tst.jus.br/rest";

const ESPECIES: Record<string, { rotulo: string; classe: string; autoridade: Autoridade }> = {
  SUM: { rotulo: "Súmula", classe: "Súmula", autoridade: "A" },
  OJ: { rotulo: "OJ", classe: "OJ", autoridade: "C" },
  OJT: { rotulo: "OJ Transitória", classe: "OJ", autoridade: "C" },
  PN: { rotulo: "Precedente Normativo", classe: "PN", autoridade: "C" },
};

const capitalizar = (s: string) => s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, e, l) => e + l.toUpperCase());

export function mapearRegistroTst(r: Record<string, any>, agora: string): Documento | null {
  const tipo = r.tipo?.codigoTipoJurisprudencia as string | undefined;
  if (!r.id || !tipo) return null;

  const especie = ESPECIES[tipo];
  if (especie) {
    const tese = limparHtml(r.tese);
    if (!tese) return null;
    const situacao = r.situacao?.descricao ?? null;
    // As OJs têm séries próprias (SDI-1, SDI-2, SDC...) que repetem a numeração.
    const serie = tipo === "OJ" || tipo === "OJT" ? (r.orgaoJudicante?.sigla as string | undefined)?.replace(/^SDI(\d)$/, "SDI-$1") : undefined;
    const rotulo = serie ? `${especie.rotulo} ${r.numero} da ${serie}` : `${especie.rotulo} ${r.numero}`;
    return {
      id: ["TST", tipo, serie?.replace("-", ""), r.numero].filter(Boolean).join("-"),
      tribunal: "TST",
      tipo: "sumula",
      classe: especie.classe,
      numero: String(r.numero),
      registro: null,
      orgao: r.orgaoJudicante?.descricao ?? (tipo === "SUM" ? "Tribunal Pleno" : null),
      relator: null,
      data_julgamento: null,
      data_publicacao: r.dtaPublicacao?.slice(0, 10) ?? null,
      autoridade: especie.autoridade,
      situacao: [situacao, limparHtml(r.observacao)].filter(Boolean).join(" — ") || null,
      titulo: `${rotulo}/TST — ${limparHtml(r.titulo) ?? ""}`.trim(),
      ementa: limparHtml(r.titulo),
      tese,
      inteiro_teor: limparHtml(r.historico),
      referencias: null,
      assuntos: null,
      fonte: "tst-jurisprudencia",
      fonte_url: "https://jurisprudencia.tst.jus.br/",
      atualizado_em: agora,
    };
  }

  if (tipo !== "ACORDAO") return null;
  const ementa = limparHtml(r.ementa);
  if (!ementa) return null;
  const [classe, numero] = String(r.numFormatado ?? "").split(" - ").map((s) => s.trim());
  const orgao = r.orgaoJudicante?.descricao ?? null;
  const pdf =
    Number(r.anoProcInt) > 0 && r.dtaPublicacao
      ? `https://consultadocumento.tst.jus.br/consultaDocumento/acordao.do?anoProcInt=${r.anoProcInt}&numProcInt=${r.numProcInt}` +
        `&dtaPublicacaoStr=${r.dtaPublicacao.slice(8, 10)}/${r.dtaPublicacao.slice(5, 7)}/${r.dtaPublicacao.slice(0, 4)}%2007:00:00&nia=${r.numInterno}`
      : `${API}/documentos/${r.id}`;
  return {
    id: `TST-ACOR-${r.id}`,
    tribunal: "TST",
    tipo: "acordao",
    classe: classe || r.codFase || null,
    numero: numero || r.numero || null,
    registro: r.numero ?? null,
    orgao,
    relator: r.nomRelator ? capitalizar(r.nomRelator).toUpperCase() : null,
    data_julgamento: r.dtaJulgamento?.slice(0, 10) ?? null,
    data_publicacao: r.dtaPublicacao?.slice(0, 10) ?? null,
    autoridade: autoridadePorOrgao(orgao),
    situacao: null,
    titulo: `${r.numFormatado ?? "Acórdão"} — ${orgao ?? "TST"}`,
    ementa,
    tese: null,
    inteiro_teor: [limparHtml(r.dispositivo) && `Dispositivo: ${limparHtml(r.dispositivo)}`, limparHtml(r.inteiroTeorHtml)]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 200_000) || null,
    referencias: null,
    assuntos: Array.isArray(r.temaProcs) ? r.temaProcs.map((t: any) => t.desTemaProc).filter(Boolean).join("; ") || null : null,
    fonte: "tst-jurisprudencia",
    fonte_url: pdf,
    atualizado_em: agora,
  };
}

export const fonteTst: FonteAoVivo = {
  id: "tst",
  nome: "TST — Jurisprudência (acórdãos, súmulas, OJs e precedentes normativos)",
  tribunais: ["TST"],
  padrao: false,
  async pesquisar(f, ctx) {
    const consultar = async (tipos: string[], tamanho: number) => {
      const corpo: Record<string, unknown> = { e: f.consulta, tipos, ordenacao: "relevancia" };
      if (f.data_inicio) corpo.julgamentoInicial = f.data_inicio;
      if (f.data_fim) corpo.julgamentoFinal = f.data_fim;
      if (!tipos.includes("ACORDAO")) corpo.orgao = "TST";
      const r = await ctx.fetch(`${API}/pesquisa-textual/1/${tamanho}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
        signal: ctx.signal,
      });
      if (!r.ok) throw new Error(`TST respondeu HTTP ${r.status}`);
      const j = (await r.json()) as { registros?: { registro: Record<string, any> }[] };
      return (j.registros ?? []).map((x) => mapearRegistroTst(x.registro, ctx.agora)).filter((d): d is Documento => d !== null);
    };
    // Página pequena: cada acórdão vem com o inteiro teor em HTML.
    const [enunciados, acordaos] = await Promise.all([
      consultar(["SUM", "OJ", "PN"], 5),
      consultar(["ACORDAO"], Math.min(f.limite, 15)),
    ]);
    return [...enunciados, ...acordaos];
  },
};
