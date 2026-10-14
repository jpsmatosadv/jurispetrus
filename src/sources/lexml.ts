/**
 * Pesquisa de legislação no LexML Brasil (interface SRU).
 * Documentação: https://www.lexml.gov.br/busca/SRU
 */

const BASE = "https://www.lexml.gov.br/busca/SRU";

export interface NormaLexml {
  urn: string;
  titulo: string;
  ementa: string | null;
  data: string | null;
  tipo: string | null;
  localidade: string | null;
  url: string;
}

function tag(xml: string, nome: string): string | null {
  const m = xml.match(new RegExp(`<(?:[\\w-]+:)?${nome}[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${nome}>`));
  return m ? decodificar(m[1]).trim() : null;
}

function decodificar(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}

/** Escapa aspas para uso dentro de termo CQL. */
const cql = (s: string) => s.replace(/["\\]/g, " ").trim();

export function montarCql(consulta: string, tipo?: string, ano?: number): string {
  const partes = [`(dc.title any "${cql(consulta)}" or dc.description any "${cql(consulta)}")`];
  if (tipo) partes.push(`facet-tipoDocumento any "${cql(tipo)}"`);
  if (ano) partes.push(`date any "${ano}"`);
  return partes.join(" and ");
}

export function interpretarSru(xml: string): { total: number; normas: NormaLexml[] } {
  const total = Number(tag(xml, "numberOfRecords") ?? 0);
  const registros = xml.split(/<(?:[\w-]+:)?record>/).slice(1);
  const normas = registros
    .map((r) => {
      const urn = tag(r, "urn") ?? "";
      return {
        urn,
        titulo: tag(r, "title") ?? "",
        ementa: tag(r, "description"),
        data: tag(r, "date"),
        tipo: tag(r, "tipoDocumento") ?? tag(r, "type"),
        localidade: tag(r, "localidade"),
        url: urn ? `https://www.lexml.gov.br/urn/${urn}` : "",
      };
    })
    .filter((n) => n.titulo || n.urn);
  return { total, normas };
}

export async function buscarLegislacao(
  consulta: string,
  opts: { tipo?: string; ano?: number; limite?: number; fetchImpl?: typeof fetch } = {},
): Promise<{ total: number; normas: NormaLexml[] }> {
  const params = new URLSearchParams({
    operation: "searchRetrieve",
    version: "1.1",
    query: montarCql(consulta, opts.tipo, opts.ano),
    maximumRecords: String(Math.min(opts.limite ?? 10, 30)),
  });
  const resp = await (opts.fetchImpl ?? fetch)(`${BASE}?${params}`, {
    headers: { Accept: "application/xml", "User-Agent": "jurispetrus/0.1 (+https://github.com/jpsmatosadv/jurispetrus)" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) throw new Error(`LexML respondeu HTTP ${resp.status}`);
  const xml = await resp.text();
  if (!/searchRetrieveResponse/.test(xml)) {
    throw new Error("LexML não retornou resultado em formato SRU (possível bloqueio temporário do portal).");
  }
  return interpretarSru(xml);
}
