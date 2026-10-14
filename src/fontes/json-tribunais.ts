/** Tribunais com API JSON pública: TJBA (GraphQL), TJES (Solr) e TRF5 (Júlia). */
import type { Documento } from "../db.js";
import { autoridadePorOrgao, cortar, dataIso, dataPlausivel, idEstavel, limparHtml, type FonteAoVivo } from "./tipos.js";

const cnj = (n: string | null | undefined) => {
  const d = (n ?? "").replace(/\D/g, "");
  return d.length === 20 ? `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d[13]}.${d.slice(14, 16)}.${d.slice(16)}` : n || null;
};

const autoridadeOrgao = autoridadePorOrgao;

// ---------- TJBA ----------
const GQL_TJBA = `query filter($decisaoFilter: DecisaoFilter!,$pageNumber: Int!,$itemsPerPage: Int!){filter(decisaoFilter:$decisaoFilter,pageNumber:$pageNumber,itemsPerPage:$itemsPerPage){decisoes{dataPublicacao relator{nome} orgaoJulgador{nome} classe{descricao} tipoDecisao ementa hash numeroProcesso} itemCount}}`;

export function mapearTjba(d: Record<string, any>, agora: string): Documento | null {
  const ementa = limparHtml(d.ementa);
  if (!d.hash || !ementa) return null;
  const processo = cnj(d.numeroProcesso);
  const orgao = d.orgaoJulgador?.nome ?? null;
  const classe = d.classe?.descricao ?? null;
  return {
    id: idEstavel("TJBA", d.hash), tribunal: "TJBA", tipo: "acordao", classe, numero: processo,
    registro: processo?.replace(/\D/g, "") ?? null, orgao, relator: d.relator?.nome ?? null,
    data_julgamento: null, data_publicacao: dataPlausivel(dataIso(d.dataPublicacao)), autoridade: autoridadeOrgao(orgao),
    situacao: null, titulo: `Acórdão TJBA — ${classe ?? "Processo"} ${processo ?? ""}${orgao ? ` — ${orgao}` : ""}`.trim(),
    ementa: cortar(ementa, 20_000), tese: null, inteiro_teor: null, referencias: null, assuntos: null,
    fonte: "tjba-jurisprudencia", fonte_url: `https://jurisprudenciaws.tjba.jus.br/inteiroTeor/${d.hash}`, atualizado_em: agora,
  };
}

export const fonteTjba: FonteAoVivo = {
  id: "tjba",
  nome: "TJBA — Jurisprudência (2º grau e turmas recursais)",
  tribunais: ["TJBA"],
  padrao: false,
  async pesquisar(f, ctx) {
    const r = await ctx.fetch("https://jurisprudenciaws.tjba.jus.br/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: GQL_TJBA,
        variables: {
          decisaoFilter: { assunto: f.consulta, segundoGrau: true, turmasRecursais: true, tipoAcordaos: true, tipoDecisoesMonocraticas: false, ordenadoPor: "relevancia" },
          pageNumber: 0,
          itemsPerPage: Math.min(f.limite, 20),
        },
      }),
      signal: ctx.signal,
    });
    if (!r.ok) throw new Error(`TJBA respondeu HTTP ${r.status}`);
    const j = (await r.json()) as { data?: { filter?: { decisoes?: Record<string, any>[] } }; errors?: { message: string }[] };
    if (j.errors?.length && !j.data?.filter) throw new Error(`TJBA: ${j.errors[0].message}`);
    return (j.data?.filter?.decisoes ?? []).map((d) => mapearTjba(d, ctx.agora)).filter((d): d is Documento => d !== null);
  },
};

// ---------- TJES ----------
export function mapearTjes(d: Record<string, any>, core: string, agora: string): Documento | null {
  const ementa = limparHtml(d.ementa);
  const processo = cnj(d.nr_processo ?? d.numero_processo_legado);
  if (!ementa || !processo) return null;
  const orgao = d.orgao_julgador ?? d.orgao ?? null;
  const classe = d.classe_judicial ?? d.classe ?? null;
  const data = dataPlausivel(dataIso(d.data_julgamento ?? d.dt_juntada));
  return {
    id: idEstavel("TJES", core, d.id ?? processo, d.dt_juntada ?? d.data_julgamento),
    tribunal: "TJES", tipo: core.includes("mono") ? "decisao_monocratica" : "acordao", classe, numero: processo,
    registro: processo.replace(/\D/g, ""), orgao, relator: d.magistrado ?? d.nome_desembargador ?? null,
    data_julgamento: data, data_publicacao: null, autoridade: core.includes("mono") ? "E" : autoridadeOrgao(orgao),
    situacao: null, titulo: `Acórdão TJES — ${classe ?? "Processo"} ${processo}${orgao ? ` — ${orgao}` : ""}`,
    ementa: cortar(ementa, 20_000), tese: null, inteiro_teor: null, referencias: null, assuntos: null,
    fonte: "tjes-jurisprudencia", fonte_url: "https://sistemas.tjes.jus.br/consulta-jurisprudencia/", atualizado_em: agora,
  };
}

export const fonteTjes: FonteAoVivo = {
  id: "tjes",
  nome: "TJES — Consulta de jurisprudência (PJe 2º grau)",
  tribunais: ["TJES"],
  padrao: false,
  async pesquisar(f, ctx) {
    const p = new URLSearchParams({ core: "pje2g", q: f.consulta, page: "1", per_page: String(Math.min(f.limite, 20)) });
    const r = await ctx.fetch(`https://sistemas.tjes.jus.br/consulta-jurisprudencia/api/search?${p}`, { signal: ctx.signal });
    if (!r.ok) throw new Error(`TJES respondeu HTTP ${r.status}`);
    const j = (await r.json()) as { docs?: Record<string, any>[] };
    return (j.docs ?? []).map((d) => mapearTjes(d, "pje2g", ctx.agora)).filter((d): d is Documento => d !== null);
  },
};

// ---------- TRF5 ----------
export function mapearTrf5(d: Record<string, any>, agora: string): Documento | null {
  const ementa = limparHtml(d.resumo) ?? limparHtml(d.texto)?.slice(0, 3000);
  const processo = cnj(d.numeroProcesso);
  if (!ementa || !processo) return null;
  const orgao = d.orgaoJulgador ?? null;
  return {
    id: idEstavel("TRF5", d.id ?? processo, d.dataJulgamento), tribunal: "TRF5", tipo: "acordao",
    classe: d.classeJudicial ?? null, numero: processo, registro: processo.replace(/\D/g, ""), orgao,
    relator: d.relator ?? null, data_julgamento: dataPlausivel(dataIso(d.dataJulgamento)), data_publicacao: null,
    autoridade: autoridadeOrgao(orgao), situacao: null,
    titulo: `Acórdão TRF5 — ${d.classeJudicial ?? "Processo"} ${processo}${orgao ? ` — ${orgao}` : ""}`,
    ementa, tese: null, inteiro_teor: cortar(limparHtml(d.texto)), referencias: null, assuntos: null,
    fonte: "trf5-julia", fonte_url: d.url ?? "https://juliapesquisa.trf5.jus.br/julia-pesquisa/", atualizado_em: agora,
  };
}

export const fonteTrf5: FonteAoVivo = {
  id: "trf5",
  nome: "TRF5 — Júlia (pesquisa de jurisprudência)",
  tribunais: ["TRF5"],
  padrao: false,
  async pesquisar(f, ctx) {
    // a API exige todos os parâmetros, mesmo vazios
    const p = new URLSearchParams({
      draw: "1", start: "0", length: String(Math.min(f.limite, 20)), pesquisaLivre: f.consulta,
      numeroProcesso: "", orgaoJulgador: "", relator: f.relator ?? "",
      dataIni: f.data_inicio ? f.data_inicio.split("-").reverse().join("/") : "",
      dataFim: f.data_fim ? f.data_fim.split("-").reverse().join("/") : "",
    });
    const r = await ctx.fetch(`https://juliapesquisa.trf5.jus.br/julia-pesquisa/api/v1/documento:dt/G2?${p}`, { signal: ctx.signal });
    if (!r.ok) throw new Error(`TRF5 respondeu HTTP ${r.status}`);
    const j = (await r.json()) as { data?: Record<string, any>[] };
    return (j.data ?? []).map((d) => mapearTrf5(d, ctx.agora)).filter((d): d is Documento => d !== null);
  },
};
