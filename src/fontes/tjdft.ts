/** TJDFT — API pública de jurisprudência (jurisdf.tjdft.jus.br). */
import type { Documento } from "../db.js";
import { autoridadePorOrgao, dataIso, limparHtml, type FonteAoVivo } from "./tipos.js";

const API = "https://jurisdf.tjdft.jus.br/api/v1/pesquisa";

export function mapearTjdft(r: Record<string, any>, agora: string): Documento | null {
  const ementa = limparHtml(r.ementa);
  if (!r.uuid || !ementa) return null;
  const sumula = r.base === "sumulas";
  const orgao = r.descricaoOrgaoJulgador ?? null;
  return {
    id: `TJDFT-${r.uuid}`,
    tribunal: "TJDFT",
    tipo: sumula ? "sumula" : r.base === "decisoes" ? "decisao_monocratica" : "acordao",
    classe: sumula ? "Súmula" : r.base === "decisoes" ? "Decisão" : "Acórdão",
    numero: String(r.identificador ?? r.numero ?? ""),
    registro: r.processo ?? null,
    orgao,
    relator: r.nomeRelator ?? null,
    data_julgamento: dataIso(r.dataJulgamento),
    data_publicacao: dataIso(r.dataPublicacao),
    autoridade: sumula ? "C" : autoridadePorOrgao(orgao),
    situacao: null,
    titulo: sumula
      ? `Súmula ${r.numero ?? r.identificador}/TJDFT`
      : `Acórdão ${r.identificador} — ${r.processo ?? ""} — ${orgao ?? "TJDFT"}`,
    ementa,
    tese: sumula ? ementa : null,
    inteiro_teor: [limparHtml(r.decisao) && `Decisão: ${limparHtml(r.decisao)}`, limparHtml(r.inteiroTeorHtml) ?? r.inteiroTeor]
      .filter(Boolean)
      .join("\n\n") || null,
    referencias: limparHtml(r.legislacao),
    assuntos: null,
    fonte: "tjdft-jurisprudencia",
    fonte_url: `https://jurisdf.tjdft.jus.br/api/v1/pesquisa/download/${r.uuid}`,
    atualizado_em: agora,
  };
}

export const fonteTjdft: FonteAoVivo = {
  id: "tjdft",
  nome: "TJDFT — Pesquisa de jurisprudência",
  tribunais: ["TJDFT"],
  padrao: false,
  async pesquisar(f, ctx) {
    const termos: { campo: string; valor: string }[] = [{ campo: "base", valor: "acordaos" }];
    if (f.data_inicio || f.data_fim) {
      termos.push({ campo: "dataJulgamento", valor: `entre ${f.data_inicio ?? "1900-01-01"} e ${f.data_fim ?? "2999-12-31"}` });
    }
    if (f.relator) termos.push({ campo: "nomeRelator", valor: f.relator.toUpperCase() });
    if (f.orgao) termos.push({ campo: "descricaoOrgaoJulgador", valor: f.orgao.toUpperCase() });
    const r = await ctx.fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: f.consulta,
        pagina: 0,
        tamanho: Math.min(f.limite, 40),
        sinonimos: true,
        espelho: true,
        inteiroTeor: false,
        retornaInteiroTeor: false,
        retornaTotalizacao: false,
        termosAcessorios: termos,
      }),
      signal: ctx.signal,
    });
    if (!r.ok) throw new Error(`TJDFT respondeu HTTP ${r.status}`);
    const j = (await r.json()) as { registros?: Record<string, any>[] };
    return (j.registros ?? []).filter((x) => x.segredoJustica !== true).map((x) => mapearTjdft(x, ctx.agora)).filter((d): d is Documento => d !== null);
  },
};
