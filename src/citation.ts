import type { Acervo, Documento } from "./db.js";
import { identificacao } from "./search.js";

export interface CitacaoInterpretada {
  tipo: "precedente" | "processo" | "cnj";
  classe?: string;
  numero: string;
  tribunal?: string;
}

const CNJ = /\b(\d{7})-?(\d{2})\.?(\d{4})\.?(\d)\.?(\d{2})\.?(\d{4})\b/;
const TRIB = String.raw`(?:\s*(?:\/|do|da|d[oa]s?)\s*(STF|STJ|TST|TSE|TNU|STM|TRF\s?\d|TRT\s?\d{1,2}|TJ[A-Z]{2}|TJDFT))?`;
const NUM = String.raw`(?:n[º°o.]*\s*)?(\d[\d.]*)`;
const SV = new RegExp(String.raw`\b(?:s[úu]mula\s+vinculante|SV)\s*${NUM}`, "i");
const SUMULA = new RegExp(String.raw`\bs[úu]mula\s*${NUM}${TRIB}`, "i");
const TEMA = new RegExp(String.raw`\btema\s*(?:repetitivo\s*|IRR\s*)?${NUM}(\s*da\s+repercuss[ãa]o\s+geral)?${TRIB}`, "i");
const RG = new RegExp(String.raw`\bRG\s*${NUM}`);
const INCIDENTE = new RegExp(String.raw`\b(IRDR|IAC|SIRDR|PUIL|IRR|OJ)\s*${NUM}${TRIB}`, "i");
const CONCENTRADO = new RegExp(String.raw`\b(ADI|ADC|ADO|ADPF)\s*${NUM}`);

const digitos = (s: string) => s.replace(/\D/g, "");
const sigla = (s?: string) => s?.toUpperCase().replace(/\s+/g, "");

// Ex.: "REsp 1.990.285/SP", "AgInt no AREsp n. 2.123.456", "EDcl no REsp 1990285"
const PROCESSO =
  /\b((?:(?:AgInt|AgRg|EDcl|EREsp|EAREsp)\s+(?:no|nos|na)\s+(?:AgInt\s+(?:no|nos)\s+)?)?(?:REsp|AREsp|RMS|HC|RHC|MS|CC|Rcl|AR|EREsp|EAREsp|AgInt|EDcl|AgRg|RE|ARE|ADI|ADC|ADPF|Pet))\s*(?:n[º°o.]*\s*)?([\d.]{1,12})(?:\s*\/\s*([A-Z]{2}))?/;

export function interpretarCitacao(texto: string): CitacaoInterpretada | null {
  const cnj = texto.match(CNJ);
  if (cnj) return { tipo: "cnj", numero: cnj.slice(1, 7).join("") };

  let m = texto.match(SV);
  if (m) return { tipo: "precedente", classe: "SV", numero: digitos(m[1]), tribunal: "STF" };

  m = texto.match(SUMULA);
  if (m) return { tipo: "precedente", classe: "Súmula", numero: digitos(m[1]), tribunal: sigla(m[2]) };

  m = texto.match(TEMA);
  if (m) {
    // "Tema repetitivo" sem tribunal: só o STJ julga recursos repetitivos com essa designação
    const tribunal = m[2] ? "STF" : (sigla(m[3]) ?? (/repetitivo/i.test(m[0]) ? "STJ" : undefined));
    const classe = /tema\s*IRR/i.test(m[0]) ? "IRR" : "Tema";
    return { tipo: "precedente", classe, numero: digitos(m[1]), tribunal: classe === "IRR" ? "TST" : tribunal };
  }

  m = texto.match(RG);
  if (m) return { tipo: "precedente", classe: "Tema", numero: digitos(m[1]), tribunal: "STF" };

  m = texto.match(INCIDENTE);
  if (m) return { tipo: "precedente", classe: m[1].toUpperCase(), numero: digitos(m[2]), tribunal: sigla(m[3]) };

  m = texto.match(CONCENTRADO);
  if (m) return { tipo: "precedente", classe: m[1], numero: digitos(m[2]), tribunal: "STF" };

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
  if (c.tipo === "precedente") {
    const sql = `SELECT * FROM documentos WHERE classe = ? AND numero = ?${c.tribunal ? " AND tribunal = ?" : ""}
                 ORDER BY CASE tribunal WHEN 'STF' THEN 0 WHEN 'STJ' THEN 1 ELSE 2 END`;
    const params = [c.classe!, c.numero, ...(c.tribunal ? [c.tribunal] : [])];
    docs = acervo.db.prepare(sql).all(...params) as unknown as Documento[];
    const tribunais = new Set(docs.map((d) => d.tribunal));
    if (!c.tribunal && tribunais.size > 1) {
      return {
        status: "DIVERGENCIA",
        citacao: c,
        encontrados: docs.slice(0, 8).map(resumo),
        observacao: `A citação não indica o tribunal e há ${c.classe} ${c.numero} em ${[...tribunais].join(", ")}. Informe o tribunal.`,
      };
    }
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
