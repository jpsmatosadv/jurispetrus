/**
 * Razão de decidir (ratio decidendi) de um julgado.
 *
 * Primeiro tenta a estrutura de ementa da Recomendação CNJ 154/2024 (I. Caso em exame,
 * II. Questão em discussão, III. Razões de decidir, IV. Dispositivo e tese), que vários
 * tribunais já adotam. Nos precedentes qualificados, a tese firmada é a própria ratio.
 */
import type { Documento } from "./db.js";
import { cortar, lerTexto, limparHtml } from "./fontes/tipos.js";

export interface EstruturaEmenta {
  metodo: "tese_firmada" | "ementa_padrao_cnj" | "sem_estrutura";
  caso_em_exame: string | null;
  questoes_em_discussao: string | null;
  razoes_de_decidir: string | null;
  dispositivo: string | null;
  teses: string[];
  dispositivos_citados: string | null;
  jurisprudencia_citada: string | null;
}

const SECOES: { chave: keyof EstruturaEmenta; padrao: RegExp }[] = [
  { chave: "caso_em_exame", padrao: /\bI\s*[.\-–)]\s*CASO EM EXAME\b/i },
  { chave: "questoes_em_discussao", padrao: /\bII\s*[.\-–)]\s*QUEST(?:ÃO|ÕES|AO|OES) EM DISCUSS(?:ÃO|AO)\b/i },
  { chave: "razoes_de_decidir", padrao: /\bIII\s*[.\-–)]\s*RAZ(?:ÕES|OES) DE DECIDIR\b/i },
  { chave: "dispositivo", padrao: /\bIV\s*[.\-–)]\s*DISPOSITIVO(?:\s+E\s+TESES?)?\b/i },
];
const TESE = /Teses? de julgamento\s*:?/i;
const DISP_CITADOS = /Dispositivos? relevantes? citados?\s*:?/i;
const JURIS_CITADA = /Jurisprud[êe]ncia relevante citada\s*:?/i;

/** Divide as teses numeradas ("1. ... 2. ...") em itens. */
function separarTeses(texto: string): string[] {
  const itens = texto
    .split(/(?:^|\s)(?=\d{1,2}\s*[.)]\s+[A-ZÀ-Ú])/)
    .map((t) => t.replace(/^\d{1,2}\s*[.)]\s+/, "").trim().replace(/^["“]|["”]$/g, ""))
    .filter((t) => t.length > 15);
  return itens.length ? itens : [texto.trim()];
}

export function extrairEstrutura(d: Pick<Documento, "ementa" | "tese" | "tipo">): EstruturaEmenta {
  const vazio: EstruturaEmenta = {
    metodo: "sem_estrutura", caso_em_exame: null, questoes_em_discussao: null, razoes_de_decidir: null,
    dispositivo: null, teses: [], dispositivos_citados: null, jurisprudencia_citada: null,
  };
  if (d.tese && d.tipo !== "acordao") {
    return { ...vazio, metodo: "tese_firmada", teses: [d.tese], questoes_em_discussao: d.ementa };
  }
  const texto = d.ementa ?? "";
  // Marcadores na ordem em que aparecem no texto
  const marcas = [
    ...SECOES.map((s) => ({ chave: s.chave as string, m: s.padrao.exec(texto) })),
    { chave: "tese", m: TESE.exec(texto) },
    { chave: "dispositivos_citados", m: DISP_CITADOS.exec(texto) },
    { chave: "jurisprudencia_citada", m: JURIS_CITADA.exec(texto) },
  ]
    .filter((x): x is { chave: string; m: RegExpExecArray } => x.m !== null)
    .sort((a, b) => a.m.index - b.m.index);

  const temRazoes = marcas.some((x) => x.chave === "razoes_de_decidir");
  if (!temRazoes && !marcas.some((x) => x.chave === "tese")) return vazio;

  const r: EstruturaEmenta = { ...vazio, metodo: "ementa_padrao_cnj" };
  marcas.forEach((x, i) => {
    const inicio = x.m.index + x.m[0].length;
    const fim = i + 1 < marcas.length ? marcas[i + 1].m.index : texto.length;
    const trecho = texto.slice(inicio, fim).replace(/^[\s:.\-–]+/, "").trim();
    if (!trecho) return;
    if (x.chave === "tese") r.teses = separarTeses(trecho);
    else (r as any)[x.chave] = trecho;
  });
  return r;
}


/** Portais em que o link da fonte devolve o inteiro teor em HTML, sem sessão nem captcha. */
const INTEIRO_TEOR_HTML = [
  /externo_controlador\.php\?acao=jurisprudencia@jurisprudencia\/download_inteiro_teor/, // eproc
  /jurisprudenciaws\.tjba\.jus\.br\/inteiroTeor\//, // TJBA
  /jurisprudencia-backend\.tst\.jus\.br\/rest\/documentos\//, // TST
];

export function temInteiroTeorBaixavel(url: string | null): boolean {
  return !!url && INTEIRO_TEOR_HTML.some((r) => r.test(url));
}

/** Baixa o inteiro teor em HTML do portal de origem e devolve o texto limpo. */
export async function baixarInteiroTeor(url: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const r = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) return null;
  const texto = limparHtml((await lerTexto(r)).replace(/<(script|style)[\s\S]*?<\/\1>/gi, " "));
  return texto && texto.length > 500 ? cortar(texto) : null;
}
