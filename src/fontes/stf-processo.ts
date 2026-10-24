/**
 * Consulta ao vivo de um processo do STF por classe e número:
 *  - portal de processos (portal.stf.jus.br/processos): relator, redator do acórdão, número único,
 *    decisões registradas (colegiadas e monocráticas) e andamentos (trânsito em julgado);
 *  - API da pesquisa de jurisprudência (jurisprudencia.stf.jus.br): cada acórdão e decisão
 *    monocrática publicada, com incidente (AgR, ED, MC, Ref...), datas, relator, redator e ementa.
 */
import { buscarComRetentativa, dataIso, lerTexto, limparHtml } from "./tipos.js";
import {
  especiePorIncidentes,
  type Especie,
  nomeMinistro,
  sessaoVirtual,
  type JulgadoLocalizado,
  type ProcessoLocalizado,
} from "./processo-superior.js";

const PORTAL = "https://portal.stf.jus.br/processos";
const API = "https://jurisprudencia.stf.jus.br/api/search/search";

interface Opcoes {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** Lê também os andamentos (trânsito em julgado); a página pode ter alguns MB. */
  andamentos?: boolean;
}

async function html(url: string, o: Opcoes): Promise<string> {
  const r = await buscarComRetentativa(url, { fetchImpl: o.fetchImpl, signal: o.signal, tentativas: 2, headers: { Referer: `${PORTAL}/` } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return lerTexto(r);
}

const texto = (s: string | null | undefined) => (limparHtml(s ?? "") ?? "").replace(/\s+/g, " ").trim();

/** Documentos da API de jurisprudência para o processo (acórdãos e decisões monocráticas). */
async function pesquisaJurisprudencia(classe: string, numero: string, o: Opcoes) {
  const r = await buscarComRetentativa(API, {
    fetchImpl: o.fetchImpl,
    signal: o.signal,
    tentativas: 2,
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      query: { bool: { filter: [{ query_string: { fields: ["processo_codigo_completo"], query: `"${classe} ${numero}"` } }] } },
      size: 100,
      sort: [{ julgamento_data: { order: "desc" } }],
      _source: [
        "base", "titulo", "processo_codigo_completo", "processo_numero", "processo_classe_processual_unificada_classe_sigla",
        "processo_classe_processual_unificada_incidente_sigla", "julgamento_data", "publicacao_data", "orgao_julgador",
        "relator_processo_nome", "relator_acordao_nome", "ementa_texto", "decisao_texto", "acordao_ata", "inteiro_teor_url",
      ],
    }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = (await r.json()) as { result?: { hits?: { hits?: { _source: Record<string, any> }[] } } };
  return (j.result?.hits?.hits ?? [])
    .map((h) => h._source)
    .filter((s) => String(s.processo_numero) === numero && String(s.processo_classe_processual_unificada_classe_sigla ?? classe) === classe);
}

interface DecisaoRegistrada {
  data: string | null;
  nome: string;
  julgador: string;
  texto: string;
}

/** Aba "Decisões" do portal: data, resultado, julgador (órgão ou ministro) e texto. */
function lerDecisoes(pagina: string): DecisaoRegistrada[] {
  return pagina
    .split(/<div class="andamento-item"/)
    .slice(1)
    .map((b) => ({
      data: dataIso(b.match(/andamento-data[^>]*>([^<]*)</)?.[1]),
      nome: texto(b.match(/andamento-nome[^>]*>([\s\S]*?)<\/h5>/)?.[1]),
      julgador: texto(b.match(/andamento-julgador[^>]*>([\s\S]*?)<\/span>/)?.[1]),
      texto: texto(b.match(/<div class="col-md-9 p-0">([\s\S]*?)<\/div>/)?.[1]),
    }));
}

/** Decisão monocrática sem incidente é do processo principal, não julgamento de mérito colegiado. */
const monocraticaPrincipal = (colegiada: boolean, e: Especie): Especie => (!colegiada && e === "merito" ? "principal" : e);

const ATO_DE_ANDAMENTO = /vista|inclu[ií]d|inclua-se|pauta|retirad|suspens|devolu|adiad|destaque|lista de julgamento|apresentado em mesa|sobrestad|pedido de/i;

export async function consultarProcessoStf(classe: string, numero: string, o: Opcoes = {}): Promise<ProcessoLocalizado> {
  const url = `${PORTAL}/listarProcessos.asp?classe=${encodeURIComponent(classe)}&numeroProcesso=${numero}`;
  const base: ProcessoLocalizado = {
    tribunal: "STF", encontrado: false, pesquisado: `${classe} ${numero}`, classe: null, numero_unico: null, registro: null,
    relator: null, redator_acordao: null, relator_ultimo_incidente: null, orgao_julgador: null, autuacao: null, origem: null,
    assuntos: [], transito_em_julgado: null, ultima_fase: null, julgados: [], url, falhas: [], consultado_em: new Date().toISOString(),
  };
  const detalhe = await html(url, o);
  const incidente = detalhe.match(/id="incidente"\s+value="(\d+)"/)?.[1];
  if (!incidente) return base;

  const dados = [...detalhe.matchAll(/processo-dados[^>]*>([\s\S]*?)<\/div>/g)].map((m) => texto(m[1]));
  const campo = (rotulo: RegExp) => dados.find((d) => rotulo.test(d))?.replace(rotulo, "").trim() || null;
  const p: ProcessoLocalizado = {
    ...base,
    encontrado: true,
    url: `${PORTAL}/detalhe.asp?incidente=${incidente}`,
    classe: texto(detalhe.match(/<div class="processo-classe[^"]*">([^<]*)<\/div>/)?.[1]) || null,
    numero_unico: detalhe.match(/N[úu]mero [ÚU]nico:\s*([\d.-]+)/)?.[1] ?? texto(detalhe).match(/Número Único:\s*([\d.-]+)/)?.[1] ?? null,
    relator: nomeMinistro(campo(/^Relator\(a\):/)),
    redator_acordao: nomeMinistro(campo(/^Redator do acórdão:/)),
    relator_ultimo_incidente: campo(/^Relator\(a\) do último incidente:/),
  };

  const [informacoes, decisoes, juris, andamentos] = await Promise.allSettled([
    html(`${PORTAL}/abaInformacoes.asp?incidente=${incidente}`, o),
    html(`${PORTAL}/abaDecisoes.asp?incidente=${incidente}`, o),
    pesquisaJurisprudencia(classe, numero, o),
    o.andamentos === false ? Promise.resolve("") : html(`${PORTAL}/abaAndamentos.asp?incidente=${incidente}&imprimir=`, o),
  ]);
  const falhou = (nome: string, r: PromiseSettledResult<unknown>) => {
    if (r.status === "rejected") p.falhas.push(`${nome}: ${(r.reason as Error)?.message ?? r.reason}`);
  };
  falhou("informações", informacoes);
  falhou("decisões", decisoes);
  falhou("jurisprudência", juris);
  falhou("andamentos", andamentos);

  if (informacoes.status === "fulfilled") {
    const t = texto(informacoes.value);
    p.assuntos = (t.match(/Assunto:\s*(.*?)\s*Data de Protocolo:/)?.[1] ?? "").split("|").map((x) => x.trim()).filter(Boolean);
    p.autuacao = dataIso(t.match(/Data de Protocolo:\s*(\d{2}\/\d{2}\/\d{4})/)?.[1]);
    p.origem = t.match(/Origem:\s*(.*?)\s*Número de Origem:/)?.[1]?.trim() || null;
  }
  if (andamentos.status === "fulfilled" && andamentos.value) {
    const itens = andamentos.value.split(/<div class="andamento-item"/).slice(1);
    const nomeDe = (b: string) => texto(b.match(/andamento-nome[^>]*>([\s\S]*?)<\/h5>/)?.[1]);
    const dataDe = (b: string) => dataIso(b.match(/andamento-data[^>]*>([^<]*)</)?.[1]);
    const transito = itens.find((b) => /transitad[oa]\(?a?\)? em julgado/i.test(nomeDe(b)));
    p.transito_em_julgado = transito ? dataDe(transito) : null;
    if (itens[0]) p.ultima_fase = `${dataDe(itens[0]) ?? ""} ${nomeDe(itens[0])}`.trim();
  }

  const registradas = decisoes.status === "fulfilled" ? lerDecisoes(decisoes.value) : [];
  const docs = juris.status === "fulfilled" ? juris.value : [];
  const julgados: JulgadoLocalizado[] = docs.map((s) => {
    const incidentes = String(s.processo_classe_processual_unificada_incidente_sigla ?? "").split("-").filter(Boolean);
    const acordao = s.base === "acordaos";
    const data = dataIso(s.julgamento_data);
    // a decisão de julgamento registrada no portal traz o período da sessão virtual
    const registro = acordao
      ? registradas.find((d) => d.data && data && Math.abs(Date.parse(d.data) - Date.parse(data)) <= 3 * 86_400_000 && sessaoVirtual(d.texto))
      : undefined;
    return {
      forma: s.titulo ?? s.processo_codigo_completo,
      tipo: acordao ? "acordao" : "decisao_monocratica",
      especie: monocraticaPrincipal(acordao, especiePorIncidentes(incidentes, s.acordao_ata ?? "")),
      orgao: s.orgao_julgador ?? (acordao ? null : "Monocrática"),
      relator: nomeMinistro(s.relator_processo_nome),
      redator_acordao: nomeMinistro(s.relator_acordao_nome),
      data_julgamento: data,
      sessao_virtual: registro ? sessaoVirtual(registro.texto) : null,
      data_publicacao: dataIso(s.publicacao_data),
      ementa: acordao ? (s.ementa_texto ?? "").replace(/\s+/g, " ").trim() || null : null,
      resumo: acordao ? (s.acordao_ata ?? "").replace(/\s+/g, " ").trim().slice(0, 600) || null : (s.decisao_texto ?? "").replace(/\s+/g, " ").trim().slice(0, 600) || null,
      inteiro_teor_url: s.inteiro_teor_url ?? null,
      fonte: "STF — pesquisa de jurisprudência",
    } satisfies JulgadoLocalizado;
  });

  // Decisões do portal ainda sem acórdão/decisão publicada na pesquisa (ex.: julgamentos recentes).
  // Ficam de fora os atos de andamento (vista, pauta, retirada de julgamento virtual...) e o que
  // já corresponde a um documento da pesquisa (até 3 dias de diferença: fim da sessão virtual).
  const perto = (d: string) => julgados.some((j) => j.data_julgamento && Math.abs(Date.parse(j.data_julgamento) - Date.parse(d)) <= 3 * 86_400_000);
  for (const d of registradas) {
    if (!d.data || perto(d.data) || ATO_DE_ANDAMENTO.test(d.nome)) continue;
    const monocratica = /^MIN\./i.test(d.julgador);
    julgados.push({
      forma: p.pesquisado,
      tipo: monocratica ? "decisao_monocratica" : "decisao_colegiada",
      especie: monocraticaPrincipal(
        !monocratica,
        especiePorIncidentes([], `${d.nome} ${d.texto}`) === "referendo" ? "referendo" : /liminar|cautelar/i.test(d.nome) ? "cautelar" : /embargos/i.test(d.nome) ? "embargos" : /agravo/i.test(d.nome) ? "agravo" : "merito",
      ),
      orgao: monocratica ? "Monocrática" : d.julgador || null,
      relator: monocratica ? nomeMinistro(d.julgador) : null,
      redator_acordao: null,
      data_julgamento: d.data,
      sessao_virtual: sessaoVirtual(d.texto),
      data_publicacao: null,
      ementa: null,
      resumo: `${d.nome}. ${d.texto}`.slice(0, 600),
      inteiro_teor_url: p.url,
      fonte: "STF — portal de processos (decisão registrada; acórdão ainda não localizado na pesquisa de jurisprudência)",
    });
  }
  p.julgados = julgados.sort((a, b) => (b.data_julgamento ?? "").localeCompare(a.data_julgamento ?? ""));
  return p;
}
