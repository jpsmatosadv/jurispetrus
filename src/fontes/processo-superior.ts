/** Tipos comuns à consulta ao vivo de processos no STF e no STJ, por classe e número. */

/** "merito": julgamento colegiado do processo principal; "principal": decisão monocrática nele. */
export type Especie = "merito" | "principal" | "cautelar" | "referendo" | "embargos" | "agravo" | "questao_de_ordem" | "recurso_extraordinario" | "outro";

export interface JulgadoLocalizado {
  /** Como o julgado se identifica na fonte, ex.: "ADI 5022 AgR", "AgInt nos EDcl no AREsp 1834945". */
  forma: string;
  tipo: "acordao" | "decisao_monocratica" | "decisao_colegiada";
  especie: Especie;
  orgao: string | null;
  /** Relator do processo (ou do recurso) e redator do acórdão, quando outro ministro redigiu. */
  relator: string | null;
  redator_acordao: string | null;
  data_julgamento: string | null;
  /** Período da sessão virtual, quando o julgamento foi virtual (fim = data em que se encerrou). */
  sessao_virtual: { inicio: string; fim: string } | null;
  data_publicacao: string | null;
  ementa: string | null;
  /** Trecho da decisão (monocráticas e decisões de julgamento). */
  resumo: string | null;
  inteiro_teor_url: string | null;
  fonte: string;
}

export interface ProcessoLocalizado {
  tribunal: "STF" | "STJ";
  encontrado: boolean;
  pesquisado: string;
  classe: string | null;
  numero_unico: string | null;
  registro: string | null;
  relator: string | null;
  redator_acordao: string | null;
  relator_ultimo_incidente: string | null;
  orgao_julgador: string | null;
  autuacao: string | null;
  origem: string | null;
  assuntos: string[];
  transito_em_julgado: string | null;
  ultima_fase: string | null;
  julgados: JulgadoLocalizado[];
  url: string;
  /** Partes da consulta que falharam (a resposta pode estar incompleta). */
  falhas: string[];
  consultado_em: string;
}

/** Espécie pelo incidente mais externo: no STF o último da cadeia ("ED-AgR" = agravo nos embargos). */
export function especiePorIncidentes(incidentes: string[], texto = ""): Especie {
  // ordinais soltos ("ED-segundos") ou colados à sigla ("Refsegundo") não mudam a espécie
  const r = incidentes.map((x) => x.replace(/(segund|terceir|quart|quint|sext)[oa]s?$/i, "")).filter(Boolean);
  const ultimo = r[r.length - 1] ?? "";
  if (/^(AgInt|AgRg|AgR)$/i.test(ultimo)) return "agravo";
  if (/^(EDcl|ED|EDv|EREsp|EAREsp|EI|EDv-AgR)$/i.test(ultimo)) return "embargos";
  if (/^Ref$/i.test(ultimo) || /referend/i.test(texto)) return "referendo";
  if (/^(MC|TP|TPI|TutPrv)$/i.test(ultimo)) return "cautelar";
  if (/^QO$/i.test(ultimo)) return "questao_de_ordem";
  if (/^RE$/.test(ultimo)) return "recurso_extraordinario";
  return r.length ? "outro" : "merito";
}

const MESES: Record<string, string> = {
  janeiro: "01", fevereiro: "02", marco: "03", março: "03", abril: "04", maio: "05", junho: "06",
  julho: "07", agosto: "08", setembro: "09", outubro: "10", novembro: "11", dezembro: "12",
};

/** "18 de outubro de 2007" → "2007-10-18". */
export function dataPorExtenso(s: string): string | null {
  const m = s.match(/(\d{1,2})º?\s+de\s+([a-zç]+)\s+de\s+(\d{4})/i);
  const mes = m && MESES[m[2].toLowerCase()];
  return m && mes ? `${m[3]}-${mes}-${m[1].padStart(2, "0")}` : null;
}

/** "24.10.2025" ou "24/10/2025" → "2025-10-24". */
export function dataPontuada(s: string): string | null {
  const m = s.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}

/** "Sessão Virtual de 24.10.2025 a 4.11.2025" no texto da decisão. */
export function sessaoVirtual(texto: string): { inicio: string; fim: string } | null {
  const m = texto.match(/sess[ãa]o\s+virtual\s+de\s+(\d{1,2}[./]\d{1,2}[./]\d{4})\s+a\s+(\d{1,2}[./]\d{1,2}[./]\d{4})/i);
  return m ? { inicio: dataPontuada(m[1])!, fim: dataPontuada(m[2])! } : null;
}

/** Nome do ministro sem o tratamento ("MIN. EDSON FACHIN" → "EDSON FACHIN"). */
export function nomeMinistro(s: string | null | undefined): string | null {
  const n = (s ?? "").replace(/^\s*(?:-\s*)?(?:Min(?:istr[oa])?\.?|MIN\.?)\s+/i, "").replace(/\s+/g, " ").trim();
  return n || null;
}
