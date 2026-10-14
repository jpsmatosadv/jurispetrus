/**
 * Ingestão do Banco Nacional de Precedentes (BNP/CNJ — Pangea):
 * súmulas vinculantes, súmulas, repercussão geral, controle concentrado, repetitivos,
 * IRDR, IAC, IRR e demais precedentes de STF, STJ, TST, TNU, TRFs, TJs e TRTs.
 * https://pangeabnp.pdpj.jus.br/
 */
import type { Acervo, Autoridade, Documento } from "../db.js";
import { limparHtml } from "../fontes/tipos.js";

const API = "https://pangeabnp.pdpj.jus.br/api/v1";
const FONTE = "cnj-bnp";

/** Rótulo, classe usada na citação e autoridade por espécie de precedente. */
interface Especie {
  rotulo: (n: string, trib: string) => string;
  classe: string;
  autoridade: (trib: string) => Autoridade;
}

const SUPERIORES = new Set(["STF", "STJ", "TST", "TSE"]);

export const ESPECIES: Record<string, Especie> = {
  SV: { rotulo: (n) => `Súmula Vinculante ${n}/STF`, classe: "SV", autoridade: () => "A" },
  SUM: {
    rotulo: (n, t) => `Súmula ${n}/${t}`,
    classe: "Súmula",
    autoridade: (t) => (SUPERIORES.has(t) ? "A" : t === "TNU" ? "B" : "C"),
  },
  ADI: { rotulo: (n) => `ADI ${n}`, classe: "ADI", autoridade: () => "A" },
  ADC: { rotulo: (n) => `ADC ${n}`, classe: "ADC", autoridade: () => "A" },
  ADO: { rotulo: (n) => `ADO ${n}`, classe: "ADO", autoridade: () => "A" },
  ADPF: { rotulo: (n) => `ADPF ${n}`, classe: "ADPF", autoridade: () => "A" },
  RG: { rotulo: (n) => `Tema ${n} da Repercussão Geral/STF`, classe: "Tema", autoridade: () => "B" },
  RR: { rotulo: (n, t) => `Tema Repetitivo ${n}/${t}`, classe: "Tema", autoridade: () => "B" },
  IRR: { rotulo: (n) => `Tema IRR ${n}/TST`, classe: "IRR", autoridade: () => "B" },
  IRDR: { rotulo: (n, t) => `IRDR ${n}/${t}`, classe: "IRDR", autoridade: () => "B" },
  SIRDR: { rotulo: (n, t) => `SIRDR ${n}/${t}`, classe: "SIRDR", autoridade: () => "B" },
  IAC: { rotulo: (n, t) => `IAC ${n}/${t}`, classe: "IAC", autoridade: () => "B" },
  PUIL: { rotulo: (n, t) => `PUIL ${n}/${t}`, classe: "PUIL", autoridade: (t) => (t === "TNU" ? "B" : "D") },
  OJ: { rotulo: (n, t) => `OJ ${n}/${t}`, classe: "OJ", autoridade: () => "C" },
  PN: { rotulo: (n, t) => `Precedente Normativo ${n}/${t}`, classe: "PN", autoridade: () => "C" },
  CT: { rotulo: (n, t) => `Controvérsia ${n}/${t}`, classe: "CT", autoridade: () => "E" },
  ENU: { rotulo: (n, t) => `Enunciado ${n}/${t}`, classe: "Enunciado", autoridade: () => "D" },
  NT: { rotulo: (n, t) => `Nota Técnica ${n}/${t}`, classe: "NT", autoridade: () => "E" },
  NTA: { rotulo: (n, t) => `Nota Técnica ${n}/${t}`, classe: "NT", autoridade: () => "E" },
};

/** Espécies do STJ que já vêm, mais completas, do Portal de Dados Abertos do STJ. */
const DUPLICADAS_STJ = new Set(["RR", "IAC", "SIRDR", "PUIL", "CT"]);

/** "TRF01" → "TRF1", "TRT02" → "TRT2"; demais siglas ficam iguais. */
export function siglaTribunal(orgao: string): string {
  if (orgao === "TJDF") return "TJDFT";
  return orgao.replace(/^(TRF|TRT)0*(\d+)$/, "$1$2").replace("_", "-");
}

const semConteudo = (s: string | null) => !s || /^(não informado|-|null)$/i.test(s.trim());

export function mapearPrecedente(p: Record<string, any>, agora = new Date().toISOString()): Documento | null {
  const especie = ESPECIES[p.tipo];
  if (!especie || !p.id || p.nr === undefined || p.nr === null) return null;
  const tribunal = siglaTribunal(String(p.orgao));
  if (tribunal === "STJ" && DUPLICADAS_STJ.has(p.tipo)) return null;

  const numero = String(p.nr).trim();
  const questao = limparHtml(p.questao);
  let tese = limparHtml(p.tese);
  if (semConteudo(tese)) tese = null;
  // Nas súmulas, o enunciado vem em 'questao' ou em 'tese', conforme o tribunal.
  const ehSumula = ["SV", "SUM", "OJ", "PN", "ENU"].includes(p.tipo);
  if (ehSumula && !tese && !semConteudo(questao)) tese = questao;

  const ementa = limparHtml(p.textoEmenta) ?? (ehSumula ? null : semConteudo(questao) ? null : questao);
  if (!tese && !ementa) return null;

  let autoridade = especie.autoridade(tribunal);
  // Tema sem tese firmada ainda não vincula: vale como consulta.
  if (!tese && ["RG", "RR", "IRR", "IRDR", "SIRDR", "IAC"].includes(p.tipo)) autoridade = "E";

  const paradigmas = ((p.processosParadigma ?? []) as { numero?: string; link?: string }[]).filter((x) => x.numero || x.link);
  const suspensoes = ((p.suspensoes ?? []) as { ativa?: boolean; descricao?: string }[])
    .filter((s) => s.ativa && s.descricao)
    .map((s) => `Suspensão ativa: ${s.descricao}`);

  return {
    id: `BNP-${String(p.id).toUpperCase()}`,
    tribunal,
    tipo: ehSumula ? "sumula" : ["ADI", "ADC", "ADO", "ADPF"].includes(p.tipo) ? "controle_concentrado" : "precedente_qualificado",
    classe: especie.classe,
    numero,
    registro: null,
    orgao: null,
    relator: null,
    data_julgamento: null, // as datas do histórico do BNP não são confiáveis
    data_publicacao: null,
    autoridade,
    situacao: limparHtml(p.situacao),
    titulo: especie.rotulo(numero, tribunal),
    ementa,
    tese,
    inteiro_teor: [
      limparHtml(p.textoDecisao) && `Decisão: ${limparHtml(p.textoDecisao)}`,
      limparHtml(p.textoAtoImpugnado) && `Ato impugnado: ${limparHtml(p.textoAtoImpugnado)}`,
      paradigmas.length && `Processos paradigma: ${paradigmas.map((x) => x.numero).filter(Boolean).join(", ")}`,
      ...suspensoes,
      limparHtml(p.alertaSituacao),
    ]
      .filter(Boolean)
      .join("\n\n") || null,
    referencias: null,
    assuntos: null,
    fonte: FONTE,
    fonte_url: p.linkDecisao ?? paradigmas.find((x) => x.link)?.link ?? "https://pangeabnp.pdpj.jus.br/",
    atualizado_em: agora,
  };
}

async function postar(corpo: unknown, signal?: AbortSignal): Promise<any> {
  for (let tentativa = 0; ; tentativa++) {
    try {
      const r = await fetch(`${API}/precedentes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
        signal: signal ?? AbortSignal.timeout(120_000),
      });
      if (r.ok) return r.json();
      if (r.status < 500 || tentativa >= 3) throw new Error(`BNP respondeu HTTP ${r.status}`);
    } catch (e) {
      if (tentativa >= 3) throw e;
    }
    await new Promise((ok) => setTimeout(ok, 2000 * 2 ** tentativa));
  }
}

export async function parametros(): Promise<{ orgaos: string[]; especies: string[] }> {
  const r = await fetch(`${API}/parametros`, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`BNP /parametros: HTTP ${r.status}`);
  const j = (await r.json()) as { orgaos: { sigla: string }[]; especies: { sigla: string }[] };
  return { orgaos: j.orgaos.map((o) => o.sigla), especies: j.especies.map((e) => e.sigla) };
}

/**
 * Importa todo o BNP, fatia por fatia (tribunal × espécie), porque a API não pagina
 * além de 10 mil resultados por consulta.
 */
export async function ingerirBnp(
  acervo: Acervo,
  opts: { orgaos?: string[]; tamanhoPagina?: number; log?: (m: string) => void } = {},
): Promise<number> {
  const log = opts.log ?? console.error;
  const tam = opts.tamanhoPagina ?? 200;
  const params = await parametros();
  const especies = params.especies.filter((e) => ESPECIES[e]);
  const orgaos = opts.orgaos?.length ? params.orgaos.filter((o) => opts.orgaos!.includes(siglaTribunal(o))) : params.orgaos;
  let total = 0;

  for (const orgao of orgaos) {
    const doOrgao = especies.filter((e) => !(siglaTribunal(orgao) === "STJ" && DUPLICADAS_STJ.has(e)));
    if (!doOrgao.length) continue;
    let docsOrgao = 0;
    for (const tipo of doOrgao) {
      for (let pagina = 1; ; pagina++) {
        const j = await postar({
          filtro: { orgaos: [orgao], tipos: [tipo], ordenacao: "Nume-Asc", cancelados: true, pagina, tamanhoPagina: tam },
        });
        const agora = new Date().toISOString();
        const docs = ((j.resultados ?? []) as Record<string, any>[])
          .map((p) => mapearPrecedente(p, agora))
          .filter((d): d is Documento => d !== null);
        acervo.salvar(docs);
        docsOrgao += docs.length;
        if ((j.resultados ?? []).length < tam || pagina * tam >= Math.min(j.total ?? 0, 10_000)) break;
      }
    }
    if (docsOrgao) {
      acervo.registrarIngestao(FONTE, `${siglaTribunal(orgao)}@${new Date().toISOString().slice(0, 10)}`, docsOrgao);
      log(`+ BNP ${siglaTribunal(orgao)}: ${docsOrgao} precedentes`);
    }
    total += docsOrgao;
  }
  return total;
}
