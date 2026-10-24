/**
 * Consulta ao vivo de um processo do STJ por classe e número, na consulta processual pública
 * (processo.stj.jus.br/processo/pesquisa): relator, órgão, número único, cada acórdão (com a forma
 * completa, ex.: "AgInt nos EDcl no AREsp 1834945") e cada decisão monocrática, com datas e links.
 * A ementa vem do documento "EMENTA / ACÓRDÃO" (PDF), lido sob demanda.
 *
 * A pesquisa de jurisprudência (SCON) exige reCAPTCHA e não é usada.
 */
import { textoDoDocumento } from "./documento.js";
import { buscarComRetentativa, dataIso, lerTexto, limparHtml } from "./tipos.js";
import { especiePorIncidentes, dataPorExtenso, nomeMinistro, type JulgadoLocalizado, type ProcessoLocalizado } from "./processo-superior.js";
import { interpretarProcesso } from "../classes.js";

const BASE = "https://processo.stj.jus.br";

interface Opcoes {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** Lê a ementa de até N acórdãos (os da forma citada primeiro). Padrão: 3. */
  ementas?: number;
  /** Forma citada, ex.: "AgRg no HC 1033863", para priorizar a leitura da ementa. */
  formaCitada?: string;
}

const texto = (s: string | null | undefined) => (limparHtml(s ?? "") ?? "").replace(/\s+/g, " ").trim();

interface BlocoDecisao {
  forma: string;
  data: string | null;
  monocratica: boolean;
  ministros: string[];
  documentos: { rotulo: string; url: string }[];
}

/** Aba "Decisões": um bloco por acórdão (forma + data de publicação) ou decisão monocrática. */
function lerBlocos(pagina: string): BlocoDecisao[] {
  const i = pagina.indexOf('id="idDivDecisoes"');
  if (i < 0) return [];
  const area = pagina.slice(i);
  const marcas = [...area.matchAll(/class="(clsFaseDecisaoIntTeorRevistaLinhaTodosDocumentosPetClSgProc|clsDecisoesMonocraticasLinhaPetClSgProc)">([^<]*)<\/span>\s*<span class="[^"]*RegistroData">([^<]*)<\/span>/g)];
  return marcas.map((m, k) => {
    const fim = k + 1 < marcas.length ? marcas[k + 1].index! : area.length;
    const trecho = area.slice(m.index!, fim);
    return {
      forma: texto(m[2]),
      data: dataIso(m[3].match(/(\d{2}\/\d{2}\/\d{4})/)?.[1]),
      monocratica: m[1].startsWith("clsDecisoesMonocraticas"),
      ministros: [...trecho.matchAll(/MinistroNome">([^<]*)</g)].map((x) => nomeMinistro(texto(x[1]).replace(/^-\s*/, ""))!).filter(Boolean),
      documentos: [...trecho.matchAll(/abrirDocumento\('([^']+)'[^>]*>([^<]*)</g)].map((x) => ({ rotulo: texto(x[2]), url: BASE + x[1] })),
    };
  });
}

/** Fases (andamentos) como pares data + texto, nos dois formatos da página (novo e antigo). */
function lerFases(pagina: string): { data: string; texto: string }[] {
  const i = pagina.indexOf('id="idDivFases"');
  const j = pagina.indexOf('id="idDivDecisoes"');
  const plano = texto(pagina.slice(i < 0 ? 0 : i, j < 0 ? undefined : j));
  return [...plano.matchAll(/(\d{2}\/\d{2}\/\d{4})\s+(?:\d{2}:\d{2}\s+)?(.*?)(?=\s\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}\s|$)/g)].map((m) => ({
    data: dataIso(m[1])!,
    texto: m[2].trim(),
  }));
}

/** Página do documento: o PDF fica num iframe (ou no link de download). */
async function textoDoAcordao(url: string, o: Opcoes): Promise<string> {
  const r = await buscarComRetentativa(url, { fetchImpl: o.fetchImpl, signal: o.signal, tentativas: 2 });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const pagina = await lerTexto(r);
  const src = pagina.match(/<iframe[^>]+src='([^']+)'/)?.[1] ?? pagina.match(/href="([^"]+)"[^>]*>Clique aqui para fazer o/)?.[1];
  if (!src) return texto(pagina);
  // o documento só é servido a partir da página que o contém (Referer), como no navegador
  return textoDoDocumento(src.startsWith("http") ? src : BASE + src, o.fetchImpl, 40_000, { Referer: url });
}

/** Ementa e data do julgamento a partir do texto do documento "EMENTA / ACÓRDÃO". */
export function ementaDoDocumento(t: string): { ementa: string | null; data_julgamento: string | null } {
  const limpo = t.replace(/\s+/g, " ").trim();
  const ini = limpo.search(/\bEMENTA\b/i);
  const fim = limpo.search(/\bAC[ÓO]RD[ÃA]O\s+(?=Vistos|Vistos,)|\bACÓRDÃO\b(?=.{0,40}Vistos)/i);
  const ementa = ini >= 0 ? limpo.slice(ini, fim > ini ? fim : ini + 6000).trim() : limpo.slice(0, 3000);
  const dj = limpo.match(/(\d{1,2}º?\s+de\s+[a-zç]+\s+de\s+\d{4})\s*\(\s*Data do Julgamento\s*\)/i)?.[1];
  return { ementa: ementa.slice(0, 8000) || null, data_julgamento: dj ? dataPorExtenso(dj) : null };
}

/** Redator pela lista de ministros do acórdão (grafia oficial); sem menção no andamento, o último da lista. */
function redatorPadronizado(doAndamento: string | undefined, ministros: string[]): string | null {
  const sem = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
  if (doAndamento) return ministros.find((m) => sem(m) === sem(doAndamento)) ?? sem(doAndamento);
  return ministros.length > 1 ? ministros[ministros.length - 1] : null;
}

export async function consultarProcessoStj(classe: string, numero: string, o: Opcoes = {}): Promise<ProcessoLocalizado> {
  const url = `${BASE}/processo/pesquisa/?tipoPesquisa=tipoPesquisaGenerica&termo=${encodeURIComponent(`${classe} ${numero}`)}`;
  const p: ProcessoLocalizado = {
    tribunal: "STJ", encontrado: false, pesquisado: `${classe} ${numero}`, classe: null, numero_unico: null, registro: null,
    relator: null, redator_acordao: null, relator_ultimo_incidente: null, orgao_julgador: null, autuacao: null, origem: null,
    assuntos: [], transito_em_julgado: null, ultima_fase: null, julgados: [], url, falhas: [], consultado_em: new Date().toISOString(),
  };
  const r = await buscarComRetentativa(url, { fetchImpl: o.fetchImpl, signal: o.signal, tentativas: 2 });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const pagina = await lerTexto(r);
  if (/Nenhum registro encontrado/i.test(pagina) || !/classSpanDetalhesLabel/.test(pagina)) return p;

  const campos = new Map<string, string>();
  for (const m of pagina.matchAll(/classSpanDetalhesLabel">([^<]*)<\/span>\s*<span class="classSpanDetalhesTexto">([\s\S]*?)<\/span>/g)) {
    const rotulo = texto(m[1]).replace(/:$/, "");
    if (!campos.has(rotulo)) campos.set(rotulo, texto(m[2].replace(/<!--[\s\S]*?-->/g, "")));
  }
  // A página de detalhe precisa ser deste processo (a pesquisa genérica pode cair em outro)
  const blocos = lerBlocos(pagina);
  const confere = blocos.some((b) => interpretarProcesso(b.forma)?.numero === numero) || pagina.includes(`${classe} ${numero}`) || pagina.includes(`${classe}  ${numero}`);
  if (!confere && blocos.length) return p;

  const relatorCampo = campos.get("RELATOR(A)") ?? "";
  const [relatorNome, orgao] = relatorCampo.split(/\s+-\s+/);
  const relatorAtual = nomeMinistro(relatorNome);
  // "Min. PRESIDENTE DO STJ"/"VICE-PRESIDENTE": o processo saiu do relator (recurso à Presidência)
  const relatorDeCargo = /PRESIDENTE/i.test(relatorAtual ?? "");
  const fases = lerFases(pagina);
  Object.assign(p, {
    encontrado: true,
    classe: campos.get("PROCESSO") ?? null,
    numero_unico: (campos.get("NÚMERO ÚNICO") ?? "").match(/[\d.-]{20,25}/)?.[0] ?? null,
    registro: blocos[0] ? (pagina.match(/\((\d{4}\/\d{7}-\d)/)?.[1] ?? null) : null,
    relator: relatorAtual,
    orgao_julgador: orgao?.trim() || null,
    autuacao: dataIso(campos.get("AUTUAÇÃO")),
    origem: campos.get("TRIBUNAL DE ORIGEM") ?? null,
    assuntos: (campos.get("ASSUNTO(S)") ?? "").split(",").map((x) => x.trim()).filter(Boolean),
    ultima_fase: campos.get("ÚLTIMA FASE") ?? null,
  });
  const transito = fases.find((f) => /transitad[oa] em julgado/i.test(f.texto));
  p.transito_em_julgado = transito ? (dataIso(transito.texto.match(/em julgado em (\d{2}\/\d{2}\/\d{4})/i)?.[1]) ?? transito.data) : null;

  // Proclamação do julgamento de cada forma ("... Petição Nº ... - AgRg no HC 1033863") e quem lavra o acórdão
  const proclamacoes = fases.filter((f) => /proclama[çc][ãa]o final de julgamento|^julgado|resultado de julgamento final/i.test(f.texto));
  const redatorDe = (t: string) => t.match(/Ministr[oa]\s+([A-ZÁÂÃÉÊÍÓÔÕÚÇ][\wÁÂÃÉÊÍÓÔÕÚÇáâãéêíóôõúç .]+?)\s+que\s+lavrar[áa]\s+o\s+ac[óo]rd[ãa]o/i)?.[1];

  const acordaos = blocos.filter((b) => !b.monocratica);
  const citada = o.formaCitada?.replace(/\s+/g, " ").toLowerCase();
  const paraLer = [...acordaos]
    .sort((a, b) => Number(b.forma.replace(/\s+/g, " ").toLowerCase() === citada) - Number(a.forma.replace(/\s+/g, " ").toLowerCase() === citada))
    .slice(0, o.ementas ?? 3);

  const ementas = new Map<BlocoDecisao, { ementa: string | null; data_julgamento: string | null }>();
  await Promise.all(
    paraLer.map(async (b) => {
      const doc = b.documentos.find((d) => /ementa/i.test(d.rotulo)) ?? b.documentos.find((d) => /inteiro|integra/i.test(d.url));
      if (!doc) return;
      try {
        ementas.set(b, ementaDoDocumento(await textoDoAcordao(doc.url, o)));
      } catch (e) {
        p.falhas.push(`ementa de ${b.forma}: ${(e as Error).message}`);
      }
    }),
  );

  p.julgados = blocos.map((b): JulgadoLocalizado => {
    const forma = b.forma.replace(/\s+/g, " ");
    const recursos = interpretarProcesso(forma)?.recursos ?? [];
    // as fases às vezes repetem a classe ("EDcl no AgRg no HC HC 1033863")
    const proclamacao = proclamacoes.find((f) => f.texto.replace(/\s+/g, " ").replace(/\b(\w+) \1\b/g, "$1").includes(forma) && (!b.data || f.data <= b.data));
    const lidos = ementas.get(b);
    const redator = proclamacao ? redatorDe(proclamacao.texto) : undefined;
    const relatorDoJulgado = b.ministros[0] ?? (relatorDeCargo ? null : relatorAtual);
    return {
      forma,
      tipo: b.monocratica ? "decisao_monocratica" : "acordao",
      especie: b.monocratica && !recursos.length ? "principal" : especiePorIncidentes([...recursos].reverse()),
      orgao: b.monocratica ? "Monocrática" : (p.orgao_julgador ?? null),
      relator: relatorDoJulgado,
      redator_acordao: b.monocratica ? null : redatorPadronizado(redator, b.ministros),
      data_julgamento: b.monocratica ? b.data : (lidos?.data_julgamento ?? proclamacao?.data ?? null),
      sessao_virtual: null,
      // nos acórdãos, a data do bloco é a da publicação; nas monocráticas, a da decisão
      data_publicacao: b.monocratica ? null : b.data,
      ementa: lidos?.ementa ?? null,
      resumo: proclamacao ? proclamacao.texto.slice(0, 500) : null,
      inteiro_teor_url: (b.documentos.find((d) => /ementa|decis/i.test(d.rotulo)) ?? b.documentos[0])?.url ?? null,
      fonte: "STJ — consulta processual",
    };
  });
  return p;
}
