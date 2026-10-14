/**
 * Ingestão do Portal de Dados Abertos do STJ (CKAN):
 *  - espelhos de acórdãos por órgão julgador (JSON mensal)
 *  - precedentes qualificados (temas repetitivos, IAC, SIRDR, PUIL)
 * https://dadosabertos.web.stj.jus.br/
 */
import type { Acervo, Autoridade, Documento } from "../db.js";
import { lerCsv } from "./csv.js";

const CKAN = "https://dadosabertos.web.stj.jus.br/api/3/action";
const FONTE_ESPELHOS = "stj-espelhos";
const FONTE_TEMAS = "stj-precedentes-qualificados";

export const PACOTES_ESPELHOS = [
  "espelhos-de-acordaos-corte-especial",
  "espelhos-de-acordaos-primeira-secao",
  "espelhos-de-acordaos-segunda-secao",
  "espelhos-de-acordaos-terceira-secao",
  "espelhos-de-acordaos-primeira-turma",
  "espelhos-de-acordaos-segunda-turma",
  "espelhos-de-acordaos-terceira-turma",
  "espelhos-de-acordaos-quarta-turma",
  "espelhos-de-acordaos-quinta-turma",
  "espelhos-de-acordaos-sexta-turma",
];

const ORGAOS: Record<string, string> = {
  CE: "CORTE ESPECIAL",
  S1: "PRIMEIRA SEÇÃO",
  S2: "SEGUNDA SEÇÃO",
  S3: "TERCEIRA SEÇÃO",
};

const vazio = (v: unknown): v is null | undefined | "" => v === null || v === undefined || String(v).trim() === "" || v === "None";
const texto = (v: unknown): string | null => (vazio(v) ? null : String(v).trim());
const juntar = (...partes: unknown[]): string | null => {
  const t = partes.map(texto).filter(Boolean).join("\n\n");
  return t || null;
};

/** "20251027" → "2025-10-27"; "DJEN DATA:30/10/2025" → "2025-10-30"; ISO passa direto. */
export function normalizarData(v: unknown): string | null {
  const s = texto(v);
  if (!s) return null;
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

export function mapearEspelho(e: Record<string, any>, agora = new Date().toISOString()): Documento | null {
  const id = texto(e.id);
  const ementa = texto(e.ementa);
  if (!id || !ementa) return null;

  const classe = texto(e.siglaClasse);
  const numero = texto(e.numeroProcesso);
  const orgao = texto(e.nomeOrgaoJulgador);
  const registro = texto(e.numeroRegistro);
  const tese = texto(e.teseJuridica);

  let autoridade: Autoridade = /CORTE ESPECIAL/i.test(orgao ?? "") ? "C" : "D";
  if (tese && !vazio(e.tema)) autoridade = "B"; // acórdão paradigma de repetitivo

  const refs = Array.isArray(e.referenciasLegislativas) ? e.referenciasLegislativas : [e.referenciasLegislativas];

  return {
    id: `STJ-ACOR-${id}`,
    tribunal: "STJ",
    tipo: "acordao",
    classe,
    numero,
    registro,
    orgao,
    relator: texto(e.ministroRelator),
    data_julgamento: normalizarData(e.dataDecisao),
    data_publicacao: normalizarData(e.dataPublicacao),
    autoridade,
    situacao: null,
    titulo: [classe && numero ? `${classe} ${numero}` : texto(e.descricaoClasse), orgao].filter(Boolean).join(" — "),
    ementa,
    tese,
    inteiro_teor: juntar(e.decisao, e.informacoesComplementares, e.notas, e.jurisprudenciaCitada),
    referencias: juntar(...refs.map((r: unknown) => texto(r)?.replace(/\s+/g, " "))),
    assuntos: juntar(e.termosAuxiliares, e.tema && `Tema ${e.tema}`),
    fonte: FONTE_ESPELHOS,
    fonte_url: registro
      ? `https://processo.stj.jus.br/processo/pesquisa/?tipoPesquisa=tipoPesquisaNumeroRegistro&termo=${registro}`
      : null,
    atualizado_em: agora,
  };
}

export function mapearTema(r: Record<string, string>, agora = new Date().toISOString()): Documento | null {
  const tipo = texto(r.tipoPrecedente);
  const numero = texto(r.numeroPrecedente);
  // "Controvérsia" é etapa preliminar (ainda não é precedente qualificado)
  if (!tipo || !numero || /controv/i.test(tipo)) return null;

  const tese = texto(r.teseFirmada);
  const questao = texto(r.questaoSubmetidaAJulgamento);
  const classe = tipo === "Tema" ? "Tema" : tipo.toUpperCase();
  const qualificado = ["Tema", "IAC", "SIRDR"].includes(classe);
  const autoridade: Autoridade = !tese ? "E" : qualificado ? "B" : "D";
  const rotulo = classe === "Tema" ? `Tema Repetitivo ${numero}/STJ` : `${classe} ${numero}/STJ`;

  return {
    id: `STJ-${classe}-${numero}`,
    tribunal: "STJ",
    tipo: "precedente_qualificado",
    classe,
    numero,
    registro: null,
    orgao: ORGAOS[r.orgaoJulgador] ?? texto(r.orgaoJulgador),
    relator: null,
    data_julgamento: normalizarData(r.dataJulgamento),
    data_publicacao: normalizarData(r.dataPublicacaoAcordao),
    autoridade,
    situacao: texto(r.situacao),
    titulo: rotulo,
    ementa: questao,
    tese,
    inteiro_teor: juntar(
      r.delimitacaoJulgado && `Delimitação do julgado: ${r.delimitacaoJulgado}`,
      r.entendimentoAnterior && `Entendimento anterior: ${r.entendimentoAnterior}`,
      r.anotacoesNUGEPNAC && `Anotações NUGEPNAC: ${r.anotacoesNUGEPNAC}`,
      r.informacoesComplementares,
      r.numeroRepercussaoGeralSTF && `Repercussão Geral STF: Tema ${r.numeroRepercussaoGeralSTF} — ${r.descricaoRepercussaoGeral ?? ""}`,
    ),
    referencias: juntar(r.referenciaLegislativa, r.referenciaSumular, r.sumulaOriginada && `Súmula originada: ${r.sumulaOriginada}`),
    assuntos: texto(r.Assuntos),
    fonte: FONTE_TEMAS,
    fonte_url:
      classe === "Tema"
        ? `https://processo.stj.jus.br/repetitivos/temas_repetitivos/pesquisa.jsp?novaConsulta=true&tipo_pesquisa=T&cod_tema_inicial=${numero}&cod_tema_final=${numero}`
        : "https://processo.stj.jus.br/repetitivos/temas_repetitivos/",
    atualizado_em: agora,
  };
}

interface RecursoCkan {
  name: string;
  url: string;
  format: string;
}

async function recursos(pacote: string): Promise<RecursoCkan[]> {
  const r = await fetch(`${CKAN}/package_show?id=${encodeURIComponent(pacote)}`, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`CKAN ${pacote}: HTTP ${r.status}`);
  const json = (await r.json()) as { result: { resources: RecursoCkan[] } };
  return json.result.resources;
}

async function baixar(url: string): Promise<string> {
  const r = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!r.ok) throw new Error(`Download ${url}: HTTP ${r.status}`);
  return r.text();
}

export interface OpcoesIngestao {
  /** Quantos arquivos mensais mais recentes importar por órgão (padrão 12). */
  meses?: number;
  pacotes?: string[];
  forcar?: boolean;
  log?: (msg: string) => void;
}

export async function ingerirEspelhos(acervo: Acervo, opts: OpcoesIngestao = {}): Promise<number> {
  const log = opts.log ?? console.error;
  let total = 0;
  for (const pacote of opts.pacotes ?? PACOTES_ESPELHOS) {
    const lista = (await recursos(pacote))
      .filter((r) => /^\d{8}\.json$/i.test(r.name))
      .sort((a, b) => b.name.localeCompare(a.name))
      .slice(0, opts.meses ?? 12);
    for (const rec of lista) {
      const chave = `${pacote}/${rec.name}`;
      if (!opts.forcar && acervo.jaIngerido(FONTE_ESPELHOS, chave)) {
        log(`= ${chave} (já importado)`);
        continue;
      }
      const dados = JSON.parse(await baixar(rec.url)) as Record<string, any>[];
      const agora = new Date().toISOString();
      const docs = dados.map((e) => mapearEspelho(e, agora)).filter((d): d is Documento => d !== null);
      acervo.salvar(docs);
      acervo.registrarIngestao(FONTE_ESPELHOS, chave, docs.length);
      total += docs.length;
      log(`+ ${chave}: ${docs.length} acórdãos`);
    }
  }
  return total;
}

export async function ingerirTemas(acervo: Acervo, opts: OpcoesIngestao = {}): Promise<number> {
  const log = opts.log ?? console.error;
  const rec = (await recursos("precedentes-qualificados")).find((r) => /^temas\.csv$/i.test(r.name));
  if (!rec) throw new Error("Recurso Temas.csv não encontrado no portal do STJ.");
  const agora = new Date().toISOString();
  const docs = lerCsv(await baixar(rec.url))
    .map((r) => mapearTema(r, agora))
    .filter((d): d is Documento => d !== null);
  acervo.salvar(docs);
  acervo.registrarIngestao(FONTE_TEMAS, `Temas.csv@${agora.slice(0, 10)}`, docs.length);
  log(`+ precedentes qualificados: ${docs.length}`);
  return docs.length;
}
