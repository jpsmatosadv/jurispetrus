import type { Documento } from "../db.js";

export interface FiltrosFonte {
  consulta: string;
  /** Siglas pedidas pelo usuário que esta fonte cobre (ex.: ['TJSP']). Vazio = todas as da fonte. */
  tribunais: string[];
  data_inicio?: string;
  data_fim?: string;
  orgao?: string;
  relator?: string;
  limite: number;
}

export interface ContextoFonte {
  fetch: typeof fetch;
  signal: AbortSignal;
  agora: string;
}

/** Conector que pesquisa uma fonte oficial em tempo real. */
export interface FonteAoVivo {
  id: string;
  nome: string;
  /** Siglas dos tribunais/órgãos cobertos. */
  tribunais: string[];
  /** Consultada quando o usuário não filtra por tribunal? Fontes lentas ficam fora. */
  padrao: boolean;
  pesquisar(f: FiltrosFonte, ctx: ContextoFonte): Promise<Documento[]>;
}

/** Remove tags HTML e normaliza espaços. */
export function limparHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  const t = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, e) => ENTIDADES[e.toLowerCase()] ?? m)
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
  return t || null;
}

const ENTIDADES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", apos: "'", ordm: "º", ordf: "ª", sect: "§", deg: "°",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", atilde: "ã", otilde: "õ",
  acirc: "â", ecirc: "ê", ocirc: "ô", ccedil: "ç", agrave: "à", uuml: "ü",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Atilde: "Ã", Otilde: "Õ",
  Acirc: "Â", Ecirc: "Ê", Ocirc: "Ô", Ccedil: "Ç", Agrave: "À", ndash: "–", mdash: "—",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", hellip: "…",
};

/** Gera um id estável e curto a partir de partes livres. */
export function idEstavel(...partes: (string | number | null | undefined)[]): string {
  return partes
    .filter((p) => p !== null && p !== undefined && p !== "")
    .map((p) => String(p).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, ""))
    .join("-");
}

/** "dd/mm/aaaa" ou ISO → "aaaa-mm-dd". */
export function dataIso(s: string | null | undefined): string | null {
  if (!s) return null;
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

/** aaaa-mm-dd → dd/mm/aaaa (formato que a maioria dos portais espera). */
export function dataBr(iso: string | undefined): string {
  if (!iso) return "";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}
