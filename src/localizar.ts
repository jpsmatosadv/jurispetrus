/**
 * Localiza e confere um julgado do STF ou do STJ pela classe e número, nas fontes oficiais ao
 * vivo, e devolve cada divergência com o motivo identificado (relator originário × redator,
 * data de publicação × de julgamento, outra espécie de julgado do mesmo processo...).
 */
import type { Acervo } from "./db.js";
import { classeNoTribunal, interpretarProcesso, type ProcessoCitado } from "./classes.js";
import type { Documento } from "./db.js";
import { especiePorIncidentes } from "./fontes/processo-superior.js";
import { AcessoRecusado } from "./fontes/stj-processo.js";
import type { JulgadoLocalizado, ProcessoLocalizado } from "./fontes/processo-superior.js";
import { consultarProcessoStf } from "./fontes/stf-processo.js";
import { consultarProcessoStj } from "./fontes/stj-processo.js";

export type MotivoDivergencia =
  | "relator_e_redator_do_acordao"
  | "relator_do_processo_mudou"
  | "relator_diferente"
  | "relator_ausente_na_fonte"
  | "data_de_publicacao_informada"
  | "data_da_sessao_virtual"
  | "data_um_dia_de_diferenca"
  | "data_diferente"
  | "data_ausente_na_fonte"
  | "julgado_de_outra_especie"
  | "existe_nos_dois_tribunais";

export interface Divergencia {
  campo: "relator" | "data" | "julgado" | "tribunal";
  motivo: MotivoDivergencia;
  /** true quando a diferença não indica erro na citação (ex.: relator originário × redator). */
  explicavel: boolean;
  informado: string | null;
  encontrado: string | null;
  explicacao: string;
}

export interface FonteConsultada {
  fonte: string;
  status: "ok" | "erro" | "tempo_esgotado" | "nao_encontrado" | "acesso_recusado" | "pausado";
  erro?: string;
  ms: number;
}

export interface ResultadoLocalizacao {
  status: "CONFIRMADO" | "DIVERGENCIA" | "NAO_ENCONTRADO" | "INDISPONIVEL" | "NAO_RECONHECIDA";
  citacao: ProcessoCitado | null;
  /** Julgado que corresponde à forma citada (ex.: o AgRg, e não a decisão monocrática). */
  julgado_citado: JulgadoLocalizado | null;
  divergencias: Divergencia[];
  processos: ProcessoLocalizado[];
  fontes_consultadas: FonteConsultada[];
  observacao: string;
  /** Onde a conferência foi feita: na fonte oficial ao vivo ou, com o portal fora, no acervo local. */
  conferido_em?: "fonte_oficial_ao_vivo" | "acervo_local";
  /** Sem acesso ao portal e sem o julgado no acervo: outros julgados que citam este número (indício, não confirmação). */
  citado_em?: { id: string; identificacao: string; data_julgamento: string | null; trecho: string }[];
}

const CACHE_MS = 24 * 60 * 60 * 1000;
/** Processo transitado em julgado quase não muda: a consulta fica guardada por 90 dias. */
const CACHE_TRANSITADO_MS = 90 * 24 * 60 * 60 * 1000;
/** Depois de uma recusa (403/429), o portal não é consultado por este tempo (todas as cópias do servidor). */
const PAUSA_MS = 20 * 60 * 1000;
const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim();
/** Compara nomes de ministros por sobrenome/parte (ex.: "Min. Moura Ribeiro" × "MOURA RIBEIRO"). */
function mesmoMinistro(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = sem(a).replace(/^(MIN|MINISTRO|MINISTRA|REL|RELATOR|RELATORA)\s+/, "");
  const y = sem(b);
  return !!x && !!y && (y.includes(x) || x.includes(y));
}

/** Data informada pelo usuário em formatos comuns → ISO. */
export function dataInformada(s: string | undefined): string | null {
  if (!s) return null;
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})/) ?? null;
  if (m) return m[0];
  const b = s.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  return b ? `${b[3]}-${b[2].padStart(2, "0")}-${b[1].padStart(2, "0")}` : null;
}

const dias = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000);

/** Escolhe, entre os julgados do processo, o que corresponde à forma citada. */
export function julgadoCorrespondente(c: ProcessoCitado, julgados: JulgadoLocalizado[]): JulgadoLocalizado | null {
  const chave = (r: string[]) => r.map((x) => (x === "AgR" ? "AgRg" : x === "ED" ? "EDcl" : x)).join(">");
  const alvo = chave(c.recursos);
  const candidatos = julgados.filter((j) => chave(interpretarProcesso(j.forma)?.recursos ?? []) === alvo);
  if (!candidatos.length) return null;
  // sem recurso: prefere o acórdão de mérito à decisão monocrática
  const ordem = (j: JulgadoLocalizado) => (j.tipo === "acordao" ? 0 : j.tipo === "decisao_colegiada" ? 1 : 2);
  return [...candidatos].sort((a, b) => ordem(a) - ordem(b))[0];
}

function conferir(c: ProcessoCitado, p: ProcessoLocalizado, j: JulgadoLocalizado | null, relator?: string, data?: string): Divergencia[] {
  const out: Divergencia[] = [];
  if (!j) {
    const especies = [...new Set(p.julgados.map((x) => `${x.forma} (${x.tipo === "acordao" ? "acórdão" : x.tipo === "decisao_monocratica" ? "monocrática" : "decisão colegiada"}${x.data_julgamento ? `, ${x.data_julgamento}` : ""})`))];
    out.push({
      campo: "julgado",
      motivo: "julgado_de_outra_especie",
      explicavel: false,
      informado: c.forma,
      encontrado: especies.slice(0, 8).join("; ") || null,
      explicacao: especies.length
        ? `O processo existe, mas não há julgado publicado na forma citada (${c.forma}). Julgados do processo: ${especies.slice(0, 8).join("; ")}.`
        : "O processo existe, mas nenhum julgado publicado foi localizado nas fontes consultadas.",
    });
  }
  if (relator) {
    const relDoJulgado = j?.relator ?? null;
    if (j && mesmoMinistro(relator, relDoJulgado)) {
      // confere
    } else if (j?.redator_acordao && mesmoMinistro(relator, j.redator_acordao)) {
      out.push({
        campo: "relator", motivo: "relator_e_redator_do_acordao", explicavel: true, informado: relator,
        encontrado: `relator ${relDoJulgado ?? "?"}; redator do acórdão ${j.redator_acordao}`,
        explicacao: "O ministro informado é o redator do acórdão (voto vencedor), não o relator originário. Cite como “Rel. p/ acórdão”.",
      });
    } else if (mesmoMinistro(relator, p.relator) || mesmoMinistro(relator, p.redator_acordao)) {
      out.push({
        campo: "relator", motivo: "relator_do_processo_mudou", explicavel: true, informado: relator,
        encontrado: `relator do julgado ${relDoJulgado ?? "?"}; relator atual do processo ${p.relator ?? "?"}`,
        explicacao: "O ministro informado é (ou foi) relator do processo, mas o julgado citado teve outro relator (redistribuição, sucessão ou incidente).",
      });
    } else if (!relDoJulgado && !p.relator) {
      out.push({
        campo: "relator", motivo: "relator_ausente_na_fonte", explicavel: true, informado: relator, encontrado: null,
        explicacao: "A fonte não informa o relator: não é possível conferir este dado.",
      });
    } else {
      out.push({
        campo: "relator", motivo: "relator_diferente", explicavel: false, informado: relator,
        encontrado: [relDoJulgado && `relator ${relDoJulgado}`, j?.redator_acordao && `redator ${j.redator_acordao}`, p.relator && `relator atual ${p.relator}`].filter(Boolean).join("; "),
        explicacao: "O relator informado não confere com o relator do julgado, o redator do acórdão nem o relator do processo.",
      });
    }
  }
  const d = dataInformada(data);
  if (d && j) {
    const jul = j.data_julgamento;
    if (jul && jul === d) {
      // confere
    } else if (j.data_publicacao === d) {
      out.push({ campo: "data", motivo: "data_de_publicacao_informada", explicavel: true, informado: d, encontrado: `julgamento ${jul ?? "?"}; publicação ${j.data_publicacao}`,
        explicacao: "A data informada é a da publicação (DJe), não a do julgamento." });
    } else if (j.sessao_virtual && (j.sessao_virtual.fim === d || j.sessao_virtual.inicio === d)) {
      out.push({ campo: "data", motivo: "data_da_sessao_virtual", explicavel: true, informado: d, encontrado: `sessão virtual de ${j.sessao_virtual.inicio} a ${j.sessao_virtual.fim}; julgamento registrado em ${jul ?? "?"}`,
        explicacao: "A data informada é a de início ou de fim da sessão virtual; a fonte registra o julgamento em outra data." });
    } else if (jul && Math.abs(dias(jul, d)) === 1) {
      out.push({ campo: "data", motivo: "data_um_dia_de_diferenca", explicavel: true, informado: d, encontrado: jul,
        explicacao: "Um dia de diferença: em geral, fim de sessão virtual ou registro no dia seguinte." });
    } else if (!jul) {
      out.push({ campo: "data", motivo: "data_ausente_na_fonte", explicavel: true, informado: d, encontrado: j.data_publicacao ? `publicação ${j.data_publicacao}` : null,
        explicacao: "A fonte não informa a data do julgamento deste julgado." });
    } else {
      out.push({ campo: "data", motivo: "data_diferente", explicavel: false, informado: d, encontrado: `julgamento ${jul}; publicação ${j.data_publicacao ?? "?"}`,
        explicacao: "A data informada não confere com a do julgamento nem com a da publicação." });
    }
  }
  return out;
}

async function consultar(
  acervo: Acervo | null,
  tribunal: "STF" | "STJ",
  c: ProcessoCitado,
  o: { fetchImpl?: typeof fetch; prazoMs: number; ementas: number; atualizar?: boolean },
): Promise<{ p: ProcessoLocalizado | null; fonte: FonteConsultada }> {
  const chave = `processo:${tribunal}:${classeNoTribunal(c.classe, tribunal)}:${c.numero}`;
  const guardado = !o.atualizar ? acervo?.lerAnalise<ProcessoLocalizado>(chave, "localizacao") : null;
  const validade = guardado?.conteudo.transito_em_julgado ? CACHE_TRANSITADO_MS : CACHE_MS;
  if (guardado && Date.now() - Date.parse(guardado.criado_em) < validade) {
    return {
      p: guardado.conteudo,
      fonte: { fonte: `${tribunal} (consulta oficial de ${guardado.criado_em.slice(0, 10)}, guardada)`, status: guardado.conteudo.encontrado ? "ok" : "nao_encontrado", ms: 0 },
    };
  }
  const nome = tribunal === "STF" ? "STF — portal de processos e pesquisa de jurisprudência" : "STJ — consulta processual";
  const pausaAte = acervo?.lerMeta(`pausa_portal_${tribunal}`);
  if (pausaAte && Date.parse(pausaAte) > Date.now()) {
    return { p: null, fonte: { fonte: nome, status: "pausado", erro: `o portal recusou acesso; nova tentativa após ${pausaAte.slice(0, 16).replace("T", " ")} (UTC)`, ms: 0 } };
  }
  const inicio = Date.now();
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(new Error("tempo esgotado")), o.prazoMs);
  try {
    const p =
      tribunal === "STF"
        ? await consultarProcessoStf(classeNoTribunal(c.classe, "STF"), c.numero, { fetchImpl: o.fetchImpl, signal: controle.signal })
        : await consultarProcessoStj(classeNoTribunal(c.classe, "STJ"), c.numero, { fetchImpl: o.fetchImpl, signal: controle.signal, ementas: o.ementas, formaCitada: c.forma });
    if (!p.falhas.length) acervo?.gravarAnalise(chave, "localizacao", "fonte-oficial", p);
    return { p, fonte: { fonte: nome, status: p.encontrado ? "ok" : "nao_encontrado", ms: Date.now() - inicio, erro: p.falhas.length ? p.falhas.join("; ") : undefined } };
  } catch (e) {
    if (e instanceof AcessoRecusado) {
      // pausa compartilhada pela base: as outras cópias do servidor também esperam
      // recusa duradoura (portal passou a exigir CAPTCHA): só tenta de novo no dia seguinte
      acervo?.gravarMeta(`pausa_portal_${tribunal}`, new Date(Date.now() + (e.duradouro ? 24 * 60 * 60 * 1000 : PAUSA_MS)).toISOString());
      return { p: null, fonte: { fonte: nome, status: "acesso_recusado", erro: (e as Error).message, ms: Date.now() - inicio } };
    }
    const tempo = controle.signal.aborted;
    return { p: null, fonte: { fonte: nome, status: tempo ? "tempo_esgotado" : "erro", erro: tempo ? undefined : (e as Error).message, ms: Date.now() - inicio } };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * O processo no acervo local (espelhos de acórdãos do STJ dos Dados Abertos, acórdãos do STF),
 * usado quando o portal oficial não responde ou recusa o acesso.
 */
export function processoNoAcervo(acervo: Acervo, tribunal: "STF" | "STJ", c: ProcessoCitado): ProcessoLocalizado | null {
  const classe = classeNoTribunal(c.classe, tribunal);
  const doAcervo = acervo.db
    .prepare("SELECT * FROM documentos WHERE tribunal = ? AND (numero = ? OR numero LIKE ?)")
    .all(tribunal, c.numero, `${c.numero} %`) as unknown as Documento[];
  // índice leve das Turmas do STJ (baixado sob demanda): mesmos campos de conferência
  const ids = new Set(doAcervo.map((d) => d.id));
  const doIndice =
    tribunal === "STJ"
      ? (acervo.db.prepare("SELECT * FROM processos_stj WHERE numero = ?").all(c.numero) as any[])
          .filter((r) => !ids.has(r.id))
          .map((r) => ({ ...r, tribunal: "STJ", tipo: "acordao", tese: null, fonte: "stj-indice-turmas" }) as unknown as Documento)
      : [];
  const docs = [...doAcervo, ...doIndice].filter((d) => {
    const p = interpretarProcesso(`${d.classe ?? ""} ${d.numero}`);
    return p && classeNoTribunal(p.classe, tribunal) === classe && p.numero === c.numero;
  });
  if (!docs.length) return null;
  const julgados: JulgadoLocalizado[] = docs.map((d) => {
    const forma = `${d.classe} ${d.numero}`.replace(/\s+/g, " ");
    const recursos = interpretarProcesso(forma)?.recursos ?? [];
    return {
      forma,
      tipo: d.tipo === "decisao_monocratica" ? "decisao_monocratica" : "acordao",
      especie: especiePorIncidentes(tribunal === "STJ" ? [...recursos].reverse() : recursos),
      orgao: d.orgao,
      relator: d.relator,
      redator_acordao: null,
      data_julgamento: d.data_julgamento,
      sessao_virtual: null,
      data_publicacao: d.data_publicacao,
      ementa: d.ementa ? d.ementa.slice(0, 4000) : null,
      resumo: d.tese ?? null,
      inteiro_teor_url: d.fonte_url,
      fonte: tribunal === "STJ" ? "acervo local — espelhos de acórdãos do STJ (Dados Abertos)" : "acervo local — acórdãos do STF",
    };
  });
  const principal = julgados.find((j) => !interpretarProcesso(j.forma)?.recursos.length) ?? julgados[0];
  return {
    tribunal, encontrado: true, pesquisado: `${classe} ${c.numero}`, classe: null, numero_unico: null, registro: null,
    relator: principal.relator, redator_acordao: null, relator_ultimo_incidente: null, orgao_julgador: principal.orgao,
    autuacao: null, origem: null, assuntos: [], transito_em_julgado: null, ultima_fase: null,
    julgados: julgados.sort((a, b) => (b.data_julgamento ?? "").localeCompare(a.data_julgamento ?? "")),
    url: principal.inteiro_teor_url ?? "", falhas: [], consultado_em: new Date().toISOString(),
  };
}

/** Outros julgados do acervo que citam a forma (ex.: "REsp 1.864.620"): indício de existência, não confirmação. */
export function citadoNoAcervo(acervo: Acervo, c: ProcessoCitado, limite = 5): NonNullable<ResultadoLocalizacao["citado_em"]> {
  const classe = c.classe.toLowerCase();
  const comPontos = c.numero.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const fts = `"${classe} ${c.numero}" OR "${classe} ${comPontos}"`;
  try {
    return (acervo.db
      .prepare(
        `SELECT d.id, d.classe, d.numero, d.tribunal, d.titulo, d.data_julgamento,
                snippet(documentos_fts, -1, '«', '»', ' … ', 24) AS trecho
         FROM documentos_fts JOIN documentos d ON d.rowid = documentos_fts.rowid
         WHERE documentos_fts MATCH ? LIMIT ?`,
      )
      .all(fts, limite * 3) as any[])
      // o próprio processo (e seus recursos) não conta como citação
      .filter((r) => interpretarProcesso(`${r.classe ?? ""} ${r.numero ?? ""}`)?.numero !== c.numero)
      .slice(0, limite)
      .map((r) => ({
      id: r.id,
      identificacao: `${r.classe ?? ""} ${r.numero ?? ""}/${r.tribunal}`.trim(),
      data_julgamento: r.data_julgamento,
      trecho: String(r.trecho ?? "").replace(/\s+/g, " ").trim(),
    }));
  } catch {
    return [];
  }
}

export async function localizarJulgado(
  acervo: Acervo | null,
  citacao: string | ProcessoCitado,
  o: { relator?: string; data?: string; fetchImpl?: typeof fetch; prazoMs?: number; ementas?: number; atualizar?: boolean } = {},
): Promise<ResultadoLocalizacao> {
  const c = typeof citacao === "string" ? interpretarProcesso(citacao) : citacao;
  if (!c) {
    return { status: "NAO_RECONHECIDA", citacao: null, julgado_citado: null, divergencias: [], processos: [], fontes_consultadas: [],
      observacao: "Não foi possível identificar classe e número de processo do STF ou do STJ na citação." };
  }
  const tribunais = c.tribunal ? [c.tribunal] : c.tribunais_possiveis;
  const opcoes = { fetchImpl: o.fetchImpl, prazoMs: o.prazoMs ?? 40_000, ementas: o.ementas ?? 3, atualizar: o.atualizar };
  const consultas = await Promise.all(tribunais.map((t) => consultar(acervo, t, c, opcoes)));
  const fontes = consultas.map((x) => x.fonte);
  let achados = consultas.map((x) => x.p).filter((p): p is ProcessoLocalizado => !!p?.encontrado);
  const semPortal = tribunais.filter((_, i) => ["erro", "tempo_esgotado", "acesso_recusado", "pausado"].includes(consultas[i].fonte.status));
  let conferidoEm: ResultadoLocalizacao["conferido_em"] = "fonte_oficial_ao_vivo";

  // Portal fora ou recusando: confere no acervo local (dados oficiais, mas não ao vivo)
  if (!achados.length && semPortal.length && acervo) {
    const locais = semPortal.map((t) => processoNoAcervo(acervo, t, c)).filter((p): p is ProcessoLocalizado => !!p);
    fontes.push({ fonte: "acervo local (Dados Abertos do STJ / pesquisa de jurisprudência do STF)", status: locais.length ? "ok" : "nao_encontrado", ms: 0 });
    if (locais.length) {
      achados = locais;
      conferidoEm = "acervo_local";
    }
  }

  if (!achados.length) {
    const falhou = semPortal.length > 0;
    const citado = falhou && acervo ? citadoNoAcervo(acervo, c) : [];
    return {
      status: falhou ? "INDISPONIVEL" : "NAO_ENCONTRADO",
      citacao: c, julgado_citado: null, divergencias: [], processos: [], fontes_consultadas: fontes,
      citado_em: citado.length ? citado : undefined,
      observacao: falhou
        ? "O portal oficial não respondeu ou recusou o acesso, e o julgado não está no acervo local: não afirme que o processo não existe." +
          (citado.length ? " Há outros julgados que o citam (citado_em): indício de existência, não confirmação dos dados." : "")
        : `Não há ${c.classe} ${c.numero} em ${tribunais.join(" nem no ")}, segundo a consulta processual oficial (que cobre todo o acervo do tribunal, não só os julgados indexados).`,
    };
  }

  const divergencias: Divergencia[] = [];
  // Mesma classe e número nos dois tribunais: o relator informado, se só conferir em um, resolve.
  if (achados.length > 1 && o.relator) {
    const bate = achados.filter((p) => {
      const j = julgadoCorrespondente(c, p.julgados);
      return [j?.relator, j?.redator_acordao, p.relator, p.redator_acordao].some((n) => mesmoMinistro(o.relator, n));
    });
    if (bate.length === 1) {
      const outro = achados.find((p) => p !== bate[0])!;
      divergencias.push({
        campo: "tribunal", motivo: "existe_nos_dois_tribunais", explicavel: true, informado: c.forma, encontrado: `${bate[0].tribunal} (pelo relator); também há ${c.classe} ${c.numero} no ${outro.tribunal}`,
        explicacao: `Há ${c.classe} ${c.numero} no STF e no STJ; o relator informado confere com o do ${bate[0].tribunal}. Indique o tribunal na citação.`,
      });
      achados.splice(0, achados.length, bate[0]);
    }
  }
  if (achados.length > 1) {
    divergencias.push({
      campo: "tribunal", motivo: "existe_nos_dois_tribunais", explicavel: false, informado: c.forma,
      encontrado: achados.map((p) => `${p.tribunal}: ${p.classe ?? ""} (${p.relator ?? "relator ?"})`).join("; "),
      explicacao: "Há processo com esta classe e número no STF e no STJ. Indique o tribunal na citação.",
    });
  }
  // com o tribunal ambíguo, confere no que tiver o julgado na forma citada
  const comJulgado = achados.map((p) => ({ p, j: julgadoCorrespondente(c, p.julgados) }));
  const escolhido = comJulgado.find((x) => x.j) ?? comJulgado[0];
  divergencias.push(...conferir(c, escolhido.p, escolhido.j, o.relator, o.data));

  const graves = divergencias.filter((d) => !d.explicavel);
  return {
    status: graves.length ? "DIVERGENCIA" : "CONFIRMADO",
    citacao: { ...c, tribunal: c.tribunal ?? (achados.length === 1 ? achados[0].tribunal : undefined) },
    julgado_citado: escolhido.j,
    divergencias,
    processos: achados,
    fontes_consultadas: fontes,
    conferido_em: conferidoEm,
    observacao: (conferidoEm === "acervo_local"
      ? "Conferido no acervo local (dados oficiais dos Dados Abertos do STJ / da pesquisa de jurisprudência do STF), porque o portal não respondeu ou recusou o acesso agora. "
      : "") + (graves.length
      ? "Há divergência que pede revisão da citação (veja 'divergencias')."
      : divergencias.length
        ? "Confirmado. As diferenças apontadas têm explicação e não indicam erro (ex.: redator do acórdão, data de publicação)."
        : conferidoEm === "acervo_local" ? "Confirmado." : "Confirmado na fonte oficial."),
  };
}
