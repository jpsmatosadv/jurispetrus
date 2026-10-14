/** TJPR — pesquisa pública de jurisprudência (portal.tjpr.jus.br). */
import type { Documento } from "../db.js";
import { autoridadePorOrgao, dataIso, dataPlausivel, idEstavel, lerTexto, limparHtml, type FonteAoVivo } from "./tipos.js";

const BASE = "https://portal.tjpr.jus.br";

export function lerResultadosTjpr(html: string, agora: string): Documento[] {
  const docs: Documento[] = [];
  for (const bloco of html.split(/<td valign="top" class="juris-tabela-dados">/).slice(1)) {
    const [, href, id] = bloco.match(/href="(\/jurisprudencia\/j\/(\d+)\/[^";]*)/) ?? [];
    const ementa = limparHtml(bloco.match(/<div id="ementa\d+">([\s\S]*?)<\/div>/)?.[1])?.replace(/\.\.\.$/, " …");
    if (!id || !ementa) continue;
    const props = limparHtml(bloco.match(/<div class="juris-tabela-propriedades">([\s\S]*?)<\/td>/)?.[1]) ?? "";
    const processo = props.match(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/)?.[0] ?? null;
    const tipo = props.match(/\((Acórdão|Decisão Monocrática)\)/)?.[1] ?? "Acórdão";
    const relator = props.match(/Relator(?:\(a\))?:\s*([^\n]+)/)?.[1]?.trim() ?? null;
    const orgao = props.match(/Órgão Julgador:\s*([^\n]+?)(?:\s+Data Julgamento|$)/m)?.[1]?.trim() ?? null;
    const data = dataPlausivel(dataIso(props.match(/Data Julgamento:\s*(\d{2}\/\d{2}\/\d{4})/)?.[1]));
    const monocratica = /monocr/i.test(tipo);
    docs.push({
      id: idEstavel("TJPR", id),
      tribunal: "TJPR",
      tipo: monocratica ? "decisao_monocratica" : "acordao",
      classe: ementa.match(/^([A-ZÀ-Ú ]{6,60}?)[.\-–]/)?.[1]?.trim() ?? null,
      numero: processo,
      registro: processo?.replace(/\D/g, "") ?? null,
      orgao,
      relator,
      data_julgamento: data,
      data_publicacao: null,
      autoridade: monocratica ? "E" : autoridadePorOrgao(orgao),
      situacao: null,
      titulo: `${tipo} TJPR — ${processo ?? id}${orgao ? ` — ${orgao}` : ""}`,
      ementa,
      tese: null,
      inteiro_teor: null,
      referencias: null,
      assuntos: null,
      fonte: "tjpr-jurisprudencia",
      fonte_url: `${BASE}${href}`,
      atualizado_em: agora,
    });
  }
  return docs;
}

export const fonteTjpr: FonteAoVivo = {
  id: "tjpr",
  nome: "TJPR — Pesquisa de jurisprudência",
  tribunais: ["TJPR"],
  padrao: false,
  async pesquisar(f, ctx) {
    const corpo = new URLSearchParams({
      criterioPesquisa: f.consulta,
      idLocalPesquisa: "1",
      ambito: "-1",
      idsTipoDecisaoSelecionados: "-1",
      segredoJustica: "pesquisar com",
      pageNumber: "1",
    });
    const r = await ctx.fetch(`${BASE}/jurisprudencia/publico/pesquisa.do?actionType=pesquisar`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: corpo,
      signal: ctx.signal,
    });
    if (!r.ok) throw new Error(`TJPR respondeu HTTP ${r.status}`);
    return lerResultadosTjpr(await lerTexto(r), ctx.agora).slice(0, f.limite);
  },
};
