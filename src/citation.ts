import type { Acervo, Documento } from "./db.js";
import { identificacao } from "./search.js";

export interface CitacaoInterpretada {
  tipo: "tema" | "processo" | "cnj";
  classe?: string;
  numero: string;
  tribunal?: string;
}

const CNJ = /\b(\d{7})-?(\d{2})\.?(\d{4})\.?(\d)\.?(\d{2})\.?(\d{4})\b/;
const TEMA = /\btema\s*(?:repetitivo\s*)?(?:n[º°o.]*\s*)?(\d{1,5})(?:\s*\/\s*(STJ|STF|TST|TNU))?/i;
const IAC = /\b(IAC|SIRDR|PUIL)\s*(?:n[º°o.]*\s*)?(\d{1,5})/i;
// Ex.: "REsp 1.990.285/SP", "AgInt no AREsp n. 2.123.456", "EDcl no REsp 1990285"
const PROCESSO =
  /\b((?:(?:AgInt|AgRg|EDcl|EREsp|EAREsp)\s+(?:no|nos|na)\s+(?:AgInt\s+(?:no|nos)\s+)?)?(?:REsp|AREsp|RMS|HC|RHC|MS|CC|Rcl|AR|EREsp|EAREsp|AgInt|EDcl|AgRg|RE|ARE|ADI|ADC|ADPF|Pet))\s*(?:n[º°o.]*\s*)?([\d.]{1,12})(?:\s*\/\s*([A-Z]{2}))?/;

export function interpretarCitacao(texto: string): CitacaoInterpretada | null {
  const cnj = texto.match(CNJ);
  if (cnj) return { tipo: "cnj", numero: cnj.slice(1, 7).join("") };

  const tema = texto.match(TEMA);
  if (tema) return { tipo: "tema", numero: tema[1], tribunal: tema[2]?.toUpperCase() ?? "STJ", classe: "Tema" };

  const iac = texto.match(IAC);
  if (iac) return { tipo: "tema", numero: iac[2], tribunal: "STJ", classe: iac[1].toUpperCase() };

  const proc = texto.match(PROCESSO);
  if (proc) {
    return { tipo: "processo", classe: proc[1].replace(/\s+/g, " ").trim(), numero: proc[2].replace(/\D/g, "") };
  }
  return null;
}

export type StatusCitacao = "CONFIRMADO" | "DIVERGENCIA" | "NAO_ENCONTRADO" | "NAO_RECONHECIDA";

export interface ResultadoVerificacao {
  status: StatusCitacao;
  citacao: CitacaoInterpretada | null;
  encontrados: { id: string; identificacao: string; orgao: string | null; relator: string | null; data_julgamento: string | null; fonte_url: string | null }[];
  observacao: string;
}

function resumo(d: Documento) {
  return { id: d.id, identificacao: identificacao(d), orgao: d.orgao, relator: d.relator, data_julgamento: d.data_julgamento, fonte_url: d.fonte_url };
}

/** Normaliza o nome da classe para comparação (ignora caixa e espaços). */
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Verifica se uma citação existe no acervo local. Números CNJ não ficam no acervo e
 * devem ser verificados na consulta processual (DataJud) — o chamador decide.
 */
export function verificarCitacao(acervo: Acervo, texto: string, relator?: string): ResultadoVerificacao {
  const c = interpretarCitacao(texto);
  if (!c) {
    return { status: "NAO_RECONHECIDA", citacao: null, encontrados: [], observacao: "Não foi possível identificar classe e número na citação." };
  }
  if (c.tipo === "cnj") {
    return { status: "NAO_ENCONTRADO", citacao: c, encontrados: [], observacao: "Número CNJ: verificar pela consulta processual." };
  }

  let docs: Documento[];
  if (c.tipo === "tema") {
    docs = acervo.db
      .prepare("SELECT * FROM documentos WHERE tribunal = ? AND classe = ? AND numero = ?")
      .all(c.tribunal ?? "STJ", c.classe ?? "Tema", c.numero) as unknown as Documento[];
  } else {
    docs = acervo.db.prepare("SELECT * FROM documentos WHERE numero = ?").all(c.numero) as unknown as Documento[];
    const mesmaClasse = docs.filter((d) => d.classe && norm(d.classe) === norm(c.classe!));
    if (docs.length && !mesmaClasse.length) {
      return {
        status: "DIVERGENCIA",
        citacao: c,
        encontrados: docs.slice(0, 5).map(resumo),
        observacao: `Há julgados com o número ${c.numero}, mas em outra classe processual.`,
      };
    }
    docs = mesmaClasse;
  }

  if (!docs.length) {
    return {
      status: "NAO_ENCONTRADO",
      citacao: c,
      encontrados: [],
      observacao: "Não consta no acervo indexado. Isso não prova que o julgado inexiste — apenas que não está na base consultada.",
    };
  }

  if (relator) {
    const r = norm(relator).replace(/^(min(istro|istra)?\.?|des(embargador[a]?)?\.?)\s+/, "");
    const bate = docs.some((d) => d.relator && norm(d.relator).includes(r));
    if (!bate) {
      return {
        status: "DIVERGENCIA",
        citacao: c,
        encontrados: docs.slice(0, 5).map(resumo),
        observacao: `O julgado existe, mas o relator informado (${relator}) não confere com o registrado.`,
      };
    }
  }
  return { status: "CONFIRMADO", citacao: c, encontrados: docs.slice(0, 5).map(resumo), observacao: "Citação localizada no acervo." };
}
