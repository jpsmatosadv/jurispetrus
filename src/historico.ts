/**
 * Histórico legislativo de uma norma: projeto de origem, justificação, pareceres das comissões,
 * relatórios e razões de veto, pelas APIs de dados abertos do Senado e da Câmara.
 * Serve à interpretação histórica e teleológica (a "vontade do legislador").
 */
import { textoDoDocumento } from "./fontes/documento.js";
import { buscarComRetentativa, lerTexto, limparHtml } from "./fontes/tipos.js";
import type { NormaCatalogo } from "./legislacao/catalogo.js";
import { descobrirCaminhoCamara } from "./legislacao/importar.js";

const SENADO = "https://legis.senado.leg.br/dadosabertos";
const CAMARA = "https://dadosabertos.camara.leg.br/api/v2";

export type PapelDocumento = "justificacao" | "parecer" | "relatorio" | "veto" | "quadro_comparativo" | "texto";

export interface DocumentoLegislativo {
  casa: "Senado" | "Câmara";
  processo: string;
  papel: PapelDocumento;
  descricao: string;
  data: string | null;
  orgao: string | null;
  url: string;
  trechos?: string[];
  aviso?: string;
}

export interface ProcessoLegislativo {
  casa: "Senado" | "Câmara";
  identificacao: string;
  papel: string | null;
  autoria: string | null;
  ementa: string | null;
  apresentacao: string | null;
  url: string;
}

export interface HistoricoLegislativo {
  norma: string;
  processos: ProcessoLegislativo[];
  documentos: DocumentoLegislativo[];
  outros_documentos: number;
  avisos: string[];
}

const TIPO_NORMA_SENADO: Record<string, string> = { LEI: "LEI", LCP: "LCP", EMC: "EMC", MPV: "MPV", DLG: "DLG" };

async function json<T>(url: string, fetchImpl?: typeof fetch): Promise<T> {
  const r = await buscarComRetentativa(url, { fetchImpl, headers: { Accept: "application/json" }, signal: AbortSignal.timeout(40_000), tentativas: 3 });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${new URL(url).host}`);
  return (await r.json()) as T;
}

/** Classifica um documento do Senado pelo tipo; null = não interessa ao histórico. */
function papelSenado(siglaTipo: string, descricao: string): PapelDocumento | null {
  const s = `${siglaTipo} ${descricao}`.toUpperCase();
  if (/QUADRO_COMPARATIVO/.test(s)) return "quadro_comparativo";
  if (/MENSAGEM|OFICIO|VETO/.test(s)) return null; // só interessam no processo de veto (tratado à parte)
  if (/AUT[ÓO]GRAFO/.test(s)) return "texto";
  if (/AVULSO_PARECER|^PARECER|\bPARECER\b/.test(s)) return "parecer";
  if (/RELATORIO/.test(s)) return "relatorio";
  if (/AVULSO_INICIAL|^PROJETO_|PROPOSTA_EMENDA|^PEC|^PLS|^PLC/.test(s)) return "justificacao";
  return null;
}

/** Normaliza "art. 54-A" → "54-A" para achar menções ao dispositivo nos textos. */
function chaveDispositivo(dispositivo?: string): RegExp | null {
  const m = dispositivo?.match(/(\d[\d.]*)\s*(?:-\s*([A-Z]))?/i);
  if (!m) return null;
  const num = m[1].replace(/\./g, "");
  const comPonto = num.length > 3 ? `${num.slice(0, -3)}\\.?${num.slice(-3)}` : num;
  return new RegExp(`\\bart(?:igo)?s?\\.?\\s*${comPonto}${m[2] ? `\\s*-\\s*${m[2]}` : "(?!\\s*-\\s*[A-Z]\\b)"}\\b`, "i");
}

/** Trechos relevantes: seção de justificação/análise/razões, ou menções ao dispositivo pedido. */
export function extrairTrechos(texto: string, papel: PapelDocumento, dispositivo?: string, limite = 3500): string[] {
  const t = texto.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n");
  const marcadores: Record<PapelDocumento, RegExp | null> = {
    justificacao:
      /\bJ\s?U\s?S\s?T\s?I\s?F\s?I\s?C\s?A\s?[ÇC]\s?[ÃA]\s?O\b|\bJUSTIFICATIVA\b|\bJustificação\b|\bEXPOSI[ÇC][ÃA]O DE MOTIVOS\b|\bExposição de Motivos\b/,
    parecer: /\bII\s*[–—-]\s*AN[ÁA]LISE\b|\bAN[ÁA]LISE\b|\bVOTO DO RELATOR\b|\bII\s*[–—-]\s*VOTO\b/,
    relatorio: /\bII\s*[–—-]\s*AN[ÁA]LISE\b|\bAN[ÁA]LISE\b|\bVOTO\b/,
    veto: /\bRaz[õo]es d[oe]s? vetos?\b|\bRAZ[ÕO]ES D[OE]S? VETOS?\b|\b[Oo]uvid[oa]s?\b/,
    quadro_comparativo: null,
    texto: null,
  };
  // A argumentação vem depois do texto normativo: procura a seção (justificação, análise, razões).
  const marcador = marcadores[papel];
  const i = marcador ? t.search(marcador) : -1;
  const secao = i >= 0 ? t.slice(i) : t;

  const chave = chaveDispositivo(dispositivo);
  if (chave) {
    const trechos: string[] = [];
    const global = new RegExp(chave.source, "gi");
    let m: RegExpExecArray | null;
    let ultimoFim = -1;
    // Só menções na argumentação ("a inclusão do art. 477-A..."); na transcrição da lei o artigo
    // aparece com "Art." maiúsculo abrindo o dispositivo ("“Art. 477-A. ..."), e isso não explica nada.
    while ((m = global.exec(t)) && trechos.length < 4) {
      if (m[0].startsWith("A") && papel !== "quadro_comparativo" && papel !== "texto") continue;
      const ini = Math.max(0, m.index - 250);
      if (ini < ultimoFim) continue;
      const fim = Math.min(t.length, m.index + 1300);
      trechos.push(`… ${t.slice(ini, fim).trim()} …`);
      ultimoFim = fim;
    }
    if (trechos.length) return trechos;
  }
  return [secao.slice(0, limite).trim() + (secao.length > limite ? " …" : "")];
}

/** "Proposição Originária: PL 3515/2015" na ficha da norma na Câmara. */
async function proposicaoOriginariaCamara(n: NormaCatalogo, fetchImpl?: typeof fetch): Promise<{ sigla: string; numero: string; ano: string } | null> {
  const caminho = await descobrirCaminhoCamara(n, fetchImpl);
  const url = `https://www2.camara.leg.br/legin/fed/${caminho.replace("-normaatualizada-", "-norma-")}.html`;
  const r = await buscarComRetentativa(url, { fetchImpl, signal: AbortSignal.timeout(40_000), tentativas: 2 });
  if (!r.ok) return null;
  const texto = limparHtml(await lerTexto(r)) ?? "";
  const m = texto.match(/Proposi[çc][ãa]o Origin[áa]ria:\s*([A-Z]{2,4})\s*(\d+)\/(\d{4})/);
  return m ? { sigla: m[1], numero: m[2], ano: m[3] } : null;
}

export async function historicoLegislativo(
  n: NormaCatalogo,
  opts: { dispositivo?: string; incluirTextos?: boolean; maxDocumentos?: number; fetchImpl?: typeof fetch } = {},
): Promise<HistoricoLegislativo> {
  const incluirTextos = opts.incluirTextos ?? true;
  const max = opts.maxDocumentos ?? 6;
  const avisos: string[] = [];
  const processos: ProcessoLegislativo[] = [];
  const candidatos: (DocumentoLegislativo & { prioridade: number })[] = [];

  const tipoSenado = TIPO_NORMA_SENADO[n.tipo];
  if (!tipoSenado) {
    avisos.push(`${n.nome}: decretos-leis e normas anteriores ao processo legislativo atual não têm tramitação nas bases do Congresso.`);
    return { norma: n.nome, processos, documentos: [], outros_documentos: 0, avisos };
  }

  // ---------- Senado: processos que geraram a norma e seus documentos ----------
  const tarefaSenado = (async () => {
    const lista = await json<Record<string, any>[]>(
      `${SENADO}/processo?tipoNorma=${tipoSenado}&numeroNorma=${n.numero}&anoNorma=${n.ano}`,
      opts.fetchImpl,
    );
    for (const p of lista) {
      processos.push({
        casa: "Senado",
        identificacao: p.identificacao,
        papel: p.objetivo ?? (String(p.identificacao).startsWith("VET") ? "Veto" : null),
        autoria: p.autoria ?? null,
        ementa: p.ementa ?? null,
        apresentacao: p.dataApresentacao ?? null,
        url: `https://www25.senado.leg.br/web/atividade/materias/-/materia/${p.codigoMateria ?? ""}`,
      });
      const docs = await json<Record<string, any>[]>(`${SENADO}/processo/documento?idProcesso=${p.id}`, opts.fetchImpl).catch(() => []);
      const veto = String(p.identificacao).startsWith("VET");
      for (const d of docs) {
        const descricao = d.descricaoTipo ?? d.identificacao ?? "";
        const papel = veto
          ? /MENSAGEM|AVULSO_INICIAL/.test(d.siglaTipo ?? "") ? "veto" : null
          : papelSenado(d.siglaTipo ?? "", `${descricao} ${d.identificacao ?? ""}`);
        if (!papel || !d.urlDocumento) continue;
        const iniciadora = p.objetivo === "Iniciadora";
        const avulsoInicial = /AVULSO_INICIAL/.test(d.siglaTipo ?? "");
        const prioridade =
          papel === "justificacao"
            ? (iniciadora ? 100 : 60) + (avulsoInicial ? 5 : 0)
            : papel === "veto" ? 90 : papel === "parecer" ? 80 : papel === "relatorio" ? 50 : 10;
        candidatos.push({
          casa: "Senado",
          processo: p.identificacao,
          papel,
          descricao: [descricao, d.identificacao && d.identificacao !== descricao ? d.identificacao : null, d.siglaColegiadoRecebedor].filter(Boolean).join(" — "),
          data: d.dataDocumento ?? d.dataRecebimento ?? null,
          orgao: d.siglaColegiadoRecebedor ?? d.siglaEnteRecebedor ?? null,
          url: String(d.urlDocumento).replace(/^http:/, "https:"),
          prioridade,
        });
      }
    }
  })().catch((e) => avisos.push(`Senado indisponível: ${(e as Error).message}`));

  // ---------- Câmara: proposição originária, apresentação e pareceres de comissão ----------
  const tarefaCamara = (async () => {
    const origem = await proposicaoOriginariaCamara(n, opts.fetchImpl);
    if (!origem) return;
    const achadas = await json<{ dados: Record<string, any>[] }>(
      `${CAMARA}/proposicoes?siglaTipo=${origem.sigla}&numero=${origem.numero}&ano=${origem.ano}`,
      opts.fetchImpl,
    );
    const resumo = achadas.dados[0];
    if (!resumo) return;
    const prop = (await json<{ dados: Record<string, any> }>(`${CAMARA}/proposicoes/${resumo.id}`, opts.fetchImpl)).dados;
    const rotulo = `${origem.sigla} ${origem.numero}/${origem.ano} (Câmara)`;
    processos.push({
      casa: "Câmara",
      identificacao: rotulo,
      papel: "Proposição originária na Câmara",
      autoria: null,
      ementa: prop.ementa ?? null,
      apresentacao: prop.dataApresentacao ?? null,
      url: `https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=${prop.id}`,
    });
    if (prop.urlInteiroTeor) {
      // texto original apresentado: traz a justificação ou a exposição de motivos do Executivo
      candidatos.push({
        casa: "Câmara",
        processo: rotulo,
        papel: "justificacao",
        descricao: "Inteiro teor da proposição originária",
        data: prop.dataApresentacao?.slice(0, 10) ?? null,
        orgao: null,
        url: prop.urlInteiroTeor,
        prioridade: 70,
      });
    }
    const { dados: tram } = await json<{ dados: Record<string, any>[] }>(`${CAMARA}/proposicoes/${prop.id}/tramitacoes`, opts.fetchImpl);
    // último parecer de cada comissão (versões anteriores do mesmo relator ficam de fora)
    const pareceres = new Map<string, Record<string, any>>();
    for (const t of tram) {
      if (!t.url) continue;
      const texto = `${t.descricaoTramitacao ?? ""} ${t.despacho ?? ""}`;
      if (/Parecer/.test(texto) && !/Requerimento|Declara[çc][ãa]o de voto/i.test(texto)) {
        pareceres.set(t.siglaOrgao ?? texto, t);
      }
    }
    for (const t of pareceres.values()) {
      candidatos.push({
        casa: "Câmara",
        processo: rotulo,
        papel: "parecer",
        descricao: (t.despacho ?? t.descricaoTramitacao ?? "Parecer").slice(0, 200),
        data: t.dataHora?.slice(0, 10) ?? null,
        orgao: t.siglaOrgao ?? null,
        url: t.url,
        prioridade: /PLEN/.test(t.siglaOrgao ?? "") ? 85 : 75,
      });
    }
  })().catch((e) => avisos.push(`Câmara indisponível: ${(e as Error).message}`));

  await Promise.all([tarefaSenado, tarefaCamara]);

  // Projeto nascido na Câmara: a justificação de origem está lá e vem primeiro.
  if (!processos.some((p) => p.casa === "Senado" && p.papel === "Iniciadora")) {
    for (const c of candidatos) if (c.casa === "Câmara" && c.papel === "justificacao") c.prioridade = 98;
  }

  // Seleciona os documentos mais úteis: justificação inicial, razões do veto, pareceres.
  const vistos = new Set<string>();
  const ordenados = candidatos
    .sort((a, b) => b.prioridade - a.prioridade || String(b.data ?? "").localeCompare(String(a.data ?? "")))
    .filter((d) => (vistos.has(d.url) ? false : (vistos.add(d.url), true)));
  const lista = ordenados.map(({ prioridade, ...d }) => d as DocumentoLegislativo);
  let escolhidos = lista.slice(0, max);

  if (incluirTextos) {
    // Lê na ordem de prioridade até reunir 'max' documentos com texto (digitalizados são pulados),
    // sem passar de 2×max tentativas.
    const lidos: DocumentoLegislativo[] = [];
    const tentativas = lista.slice(0, max * 2);
    const resultados = await Promise.all(
      tentativas.map(async (d) => {
        try {
          const texto = await textoDoDocumento(d.url, opts.fetchImpl);
          if (texto.trim().length > 200) d.trechos = extrairTrechos(texto, d.papel, opts.dispositivo);
          else d.aviso = "Documento sem texto extraível (provavelmente digitalizado).";
        } catch (e) {
          d.aviso = `Não foi possível ler o documento: ${(e as Error).message}`;
        }
        return d;
      }),
    );
    for (const d of resultados) if (d.trechos && lidos.length < max) lidos.push(d);
    escolhidos = lidos.length ? lidos : resultados.slice(0, max);
  }

  if (!processos.length) avisos.push("Nenhum processo legislativo encontrado para esta norma nas bases do Senado e da Câmara.");
  return { norma: n.nome, processos, documentos: escolhidos, outros_documentos: Math.max(0, ordenados.length - escolhidos.length), avisos };
}
