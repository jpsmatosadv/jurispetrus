/**
 * STF — pesquisa textual ao vivo na API da pesquisa de jurisprudência (jurisprudencia.stf.jus.br):
 * acórdãos de Plenário e de Turma de todas as classes (HC, RHC, RE, ARE, AR, Inq...), não só o
 * controle concentrado e a repercussão geral que estão no acervo local.
 */
import type { Autoridade, Documento } from "../db.js";
import { autoridadePorOrgao, buscarComRetentativa, dataIso, type FonteAoVivo } from "./tipos.js";

const API = "https://jurisprudencia.stf.jus.br/api/search/search";

export function mapearAcordaoStf(s: Record<string, any>, agora: string): Documento | null {
  const ementa = String(s.ementa_texto ?? "").replace(/\s+/g, " ").trim();
  if (!s.id || !ementa) return null;
  const classe = s.processo_classe_processual_unificada_classe_sigla ?? String(s.titulo ?? "").split(" ")[0];
  const incidente = s.processo_classe_processual_unificada_incidente_sigla ?? null;
  // mérito de controle concentrado vincula (A); demais, pela composição do órgão
  const autoridade: Autoridade = /^(ADI|ADC|ADO|ADPF)$/.test(classe) && !incidente ? "A" : autoridadePorOrgao(s.orgao_julgador);
  const relator = s.relator_acordao_nome && s.relator_acordao_nome !== s.relator_processo_nome
    ? `${s.relator_processo_nome} (redator do acórdão: ${s.relator_acordao_nome})`
    : (s.relator_processo_nome ?? null);
  return {
    id: `STF-JURIS-${s.id}`,
    tribunal: "STF",
    tipo: "acordao",
    classe,
    // o incidente vai junto do número, como o STF cita: "HC 214876 AgR"
    numero: incidente ? `${s.processo_numero} ${incidente}` : String(s.processo_numero ?? ""),
    registro: null,
    orgao: s.orgao_julgador ?? null,
    relator,
    data_julgamento: dataIso(s.julgamento_data),
    data_publicacao: dataIso(s.publicacao_data),
    autoridade,
    situacao: null,
    titulo: `${s.titulo ?? `${classe} ${s.processo_numero}`} — ${s.orgao_julgador ?? "STF"}`,
    ementa: ementa.slice(0, 20_000),
    tese: null,
    inteiro_teor: null,
    referencias: Array.isArray(s.documental_legislacao_citada_texto) ? s.documental_legislacao_citada_texto.join("\n").slice(0, 4000) : null,
    assuntos: null,
    fonte: "stf-jurisprudencia",
    fonte_url: s.inteiro_teor_url ?? `https://jurisprudencia.stf.jus.br/pages/search/${s.id}/false`,
    atualizado_em: agora,
  };
}

export const fonteStf: FonteAoVivo = {
  id: "stf-jurisprudencia",
  nome: "STF — pesquisa de jurisprudência (acórdãos de Plenário e Turmas)",
  tribunais: ["STF"],
  padrao: false,
  async pesquisar(f, ctx) {
    const filtros: unknown[] = [{ term: { base: "acordaos" } }];
    if (f.data_inicio || f.data_fim) filtros.push({ range: { julgamento_data: { gte: f.data_inicio, lte: f.data_fim } } });
    if (f.relator) filtros.push({ match: { relator_processo_nome: f.relator } });
    if (f.orgao) filtros.push({ match: { orgao_julgador: f.orgao } });
    const r = await buscarComRetentativa(API, {
      fetchImpl: ctx.fetch,
      signal: ctx.signal,
      tentativas: 2,
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        query: {
          bool: {
            filter: filtros,
            must: [
              {
                simple_query_string: {
                  query: f.consulta,
                  fields: ["ementa_texto^3", "documental_indexacao_texto", "acordao_ata"],
                  default_operator: "or",
                  minimum_should_match: "60%",
                },
              },
            ],
          },
        },
        size: f.limite,
        _source: [
          "id", "titulo", "processo_numero", "processo_classe_processual_unificada_classe_sigla",
          "processo_classe_processual_unificada_incidente_sigla", "julgamento_data", "publicacao_data", "orgao_julgador",
          "relator_processo_nome", "relator_acordao_nome", "ementa_texto", "inteiro_teor_url", "documental_legislacao_citada_texto",
        ],
      }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = (await r.json()) as { result?: { hits?: { hits?: { _source: Record<string, any> }[] } } };
    return (j.result?.hits?.hits ?? []).map((h) => mapearAcordaoStf(h._source, ctx.agora)).filter((d): d is Documento => d !== null);
  },
};
