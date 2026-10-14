/**
 * Consulta processual na API Pública do DataJud (CNJ).
 * Documentação: https://datajud-wiki.cnj.jus.br/api-publica/
 */

// Chave pública divulgada pelo CNJ na wiki do DataJud. Pode ser trocada por DATAJUD_API_KEY.
const CHAVE_PUBLICA = "cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==";
const BASE = "https://api-publica.datajud.cnj.jus.br";

const UFS = [
  "ac", "al", "ap", "am", "ba", "ce", "dft", "es", "go", "ma", "mt", "ms", "mg", "pa",
  "pb", "pr", "pe", "pi", "rj", "rn", "rs", "ro", "rr", "sc", "se", "sp", "to",
];

/**
 * Deduz o alias do índice do DataJud a partir do número CNJ (NNNNNNN-DD.AAAA.J.TR.OOOO),
 * usando o segmento de Justiça (J) e o código do tribunal (TR).
 */
export function aliasTribunal(cnj: string): string | null {
  const n = cnj.replace(/\D/g, "");
  if (n.length !== 20) return null;
  const j = n[13];
  const tr = Number(n.slice(14, 16));
  switch (j) {
    case "3":
      return "stj";
    case "4":
      return tr >= 1 && tr <= 6 ? `trf${tr}` : null;
    case "5":
      return tr === 0 ? "tst" : `trt${tr}`;
    case "6":
      if (tr === 0) return "tse";
      return UFS[tr - 1] ? `tre-${UFS[tr - 1] === "dft" ? "df" : UFS[tr - 1]}` : null;
    case "7":
      return "stm";
    case "8":
      return UFS[tr - 1] ? `tj${UFS[tr - 1]}` : null;
    case "9":
      return { 13: "tjmmg", 21: "tjmrs", 26: "tjmsp" }[tr] ?? null;
    default:
      return null;
  }
}

/** Valida os dígitos verificadores do número CNJ (módulo 97, Resolução CNJ 65/2008). */
export function cnjValido(cnj: string): boolean {
  const n = cnj.replace(/\D/g, "");
  if (n.length !== 20) return false;
  const seq = n.slice(0, 7), dv = n.slice(7, 9), resto = n.slice(9);
  const calc = 98 - Number(BigInt(seq + resto + "00") % 97n);
  return calc === Number(dv);
}

export function formatarCnj(cnj: string): string {
  const n = cnj.replace(/\D/g, "");
  return `${n.slice(0, 7)}-${n.slice(7, 9)}.${n.slice(9, 13)}.${n[13]}.${n.slice(14, 16)}.${n.slice(16)}`;
}

interface Movimento {
  nome: string;
  dataHora: string;
  complementosTabelados?: { nome: string; descricao: string }[];
}

export interface ProcessoDataJud {
  numero: string;
  tribunal: string;
  grau: string;
  classe: string | null;
  orgao_julgador: string | null;
  assuntos: string[];
  data_ajuizamento: string | null;
  ultima_atualizacao: string | null;
  sigilo: number | null;
  movimentos: { data: string; nome: string; complementos: string[] }[];
}

function dataAjuizamento(s?: string): string | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : s.slice(0, 10);
}

export async function consultarProcesso(
  cnj: string,
  opts: { chave?: string; maxMovimentos?: number; fetchImpl?: typeof fetch } = {},
): Promise<{ alias: string; processos: ProcessoDataJud[] }> {
  const numero = cnj.replace(/\D/g, "");
  const alias = aliasTribunal(numero);
  if (!alias) throw new Error("Não foi possível identificar o tribunal pelo número CNJ informado.");

  const resp = await (opts.fetchImpl ?? fetch)(`${BASE}/api_publica_${alias}/_search`, {
    method: "POST",
    headers: { Authorization: `APIKey ${opts.chave ?? CHAVE_PUBLICA}`, "Content-Type": "application/json" },
    body: JSON.stringify({ size: 10, query: { match: { numeroProcesso: numero } } }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) throw new Error(`DataJud respondeu HTTP ${resp.status}`);
  const json = (await resp.json()) as { hits?: { hits?: { _source: Record<string, any> }[] } };

  const max = opts.maxMovimentos ?? 30;
  const processos = (json.hits?.hits ?? []).map(({ _source: s }) => {
    const movs = ((s.movimentos ?? []) as Movimento[])
      .slice()
      .sort((a, b) => (b.dataHora ?? "").localeCompare(a.dataHora ?? ""))
      .slice(0, max)
      .map((m) => ({
        data: (m.dataHora ?? "").slice(0, 10),
        nome: m.nome,
        complementos: (m.complementosTabelados ?? []).map((c) => c.nome).filter(Boolean),
      }));
    return {
      numero: formatarCnj(s.numeroProcesso ?? numero),
      tribunal: s.tribunal,
      grau: s.grau,
      classe: s.classe?.nome ?? null,
      orgao_julgador: s.orgaoJulgador?.nome ?? null,
      assuntos: ((s.assuntos ?? []) as any[]).flat().map((a) => a?.nome).filter(Boolean),
      data_ajuizamento: dataAjuizamento(s.dataAjuizamento),
      ultima_atualizacao: s.dataHoraUltimaAtualizacao ?? null,
      sigilo: s.nivelSigilo ?? null,
      movimentos: movs,
    } satisfies ProcessoDataJud;
  });
  return { alias, processos };
}
