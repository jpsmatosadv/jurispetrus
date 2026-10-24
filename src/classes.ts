/**
 * Classes processuais do STF e do STJ e interpretação de citações por classe e número,
 * inclusive as compostas:
 *  - estilo STJ (recursos antes da classe): "AgInt nos EDcl no AREsp 1.834.945/SP"
 *  - estilo STF (recursos depois do número): "Inq 2.139 AgR", "ADI 5.022 ED-segundos", "HC 166.373 AgR"
 */

/** Classes originárias e recursais (sigla → nome). Fonte: tabelas de classes do STF e do STJ. */
export const CLASSES: Record<string, { nome: string; tribunais: ("STF" | "STJ")[] }> = {
  // controle concentrado e classes próprias do STF
  ADI: { nome: "Ação Direta de Inconstitucionalidade", tribunais: ["STF"] },
  ADC: { nome: "Ação Declaratória de Constitucionalidade", tribunais: ["STF"] },
  ADO: { nome: "Ação Direta de Inconstitucionalidade por Omissão", tribunais: ["STF"] },
  ADPF: { nome: "Arguição de Descumprimento de Preceito Fundamental", tribunais: ["STF"] },
  RE: { nome: "Recurso Extraordinário", tribunais: ["STF"] },
  ARE: { nome: "Recurso Extraordinário com Agravo", tribunais: ["STF"] },
  AI: { nome: "Agravo de Instrumento", tribunais: ["STF"] },
  AP: { nome: "Ação Penal", tribunais: ["STF"] },
  ACO: { nome: "Ação Cível Originária", tribunais: ["STF"] },
  AO: { nome: "Ação Originária", tribunais: ["STF"] },
  AOE: { nome: "Ação Originária Especial", tribunais: ["STF"] },
  PSV: { nome: "Proposta de Súmula Vinculante", tribunais: ["STF"] },
  Ext: { nome: "Extradição", tribunais: ["STF"] },
  PPE: { nome: "Prisão Preventiva para Extradição", tribunais: ["STF"] },
  STP: { nome: "Suspensão de Tutela Provisória", tribunais: ["STF"] },
  STA: { nome: "Suspensão de Tutela Antecipada", tribunais: ["STF"] },
  RvC: { nome: "Revisão Criminal", tribunais: ["STF", "STJ"] },
  RC: { nome: "Recurso Crime", tribunais: ["STF"] },
  RHD: { nome: "Recurso em Habeas Data", tribunais: ["STF"] },
  RMI: { nome: "Recurso em Mandado de Injunção", tribunais: ["STF"] },
  IF: { nome: "Intervenção Federal", tribunais: ["STF", "STJ"] },
  AImp: { nome: "Arguição de Impedimento", tribunais: ["STF"] },
  AS: { nome: "Arguição de Suspeição", tribunais: ["STF"] },
  // classes próprias do STJ
  REsp: { nome: "Recurso Especial", tribunais: ["STJ"] },
  AREsp: { nome: "Agravo em Recurso Especial", tribunais: ["STJ"] },
  Ag: { nome: "Agravo de Instrumento", tribunais: ["STJ"] },
  EREsp: { nome: "Embargos de Divergência em Recurso Especial", tribunais: ["STJ"] },
  EAREsp: { nome: "Embargos de Divergência em Agravo em Recurso Especial", tribunais: ["STJ"] },
  APn: { nome: "Ação Penal", tribunais: ["STJ"] },
  QC: { nome: "Queixa-Crime", tribunais: ["STJ"] },
  PUIL: { nome: "Pedido de Uniformização de Interpretação de Lei", tribunais: ["STJ"] },
  SLS: { nome: "Suspensão de Liminar e de Sentença", tribunais: ["STJ"] },
  CR: { nome: "Carta Rogatória", tribunais: ["STJ"] },
  HDE: { nome: "Homologação de Decisão Estrangeira", tribunais: ["STJ"] },
  SEC: { nome: "Sentença Estrangeira Contestada", tribunais: ["STJ"] },
  IDC: { nome: "Incidente de Deslocamento de Competência", tribunais: ["STJ"] },
  ProAfR: { nome: "Proposta de Afetação de Recurso", tribunais: ["STJ"] },
  ProRQF: { nome: "Proposta de Revisão de Questão Federal", tribunais: ["STJ"] },
  IUJur: { nome: "Incidente de Uniformização de Jurisprudência", tribunais: ["STJ"] },
  Sd: { nome: "Sindicância", tribunais: ["STJ"] },
  Rp: { nome: "Representação", tribunais: ["STJ"] },
  AIA: { nome: "Ação de Improbidade Administrativa", tribunais: ["STJ"] },
  ExeMS: { nome: "Execução em Mandado de Segurança", tribunais: ["STJ"] },
  // comuns aos dois tribunais
  HC: { nome: "Habeas Corpus", tribunais: ["STF", "STJ"] },
  RHC: { nome: "Recurso em Habeas Corpus", tribunais: ["STF", "STJ"] },
  MS: { nome: "Mandado de Segurança", tribunais: ["STF", "STJ"] },
  RMS: { nome: "Recurso em Mandado de Segurança", tribunais: ["STF", "STJ"] },
  MI: { nome: "Mandado de Injunção", tribunais: ["STF", "STJ"] },
  HD: { nome: "Habeas Data", tribunais: ["STF", "STJ"] },
  Rcl: { nome: "Reclamação", tribunais: ["STF", "STJ"] },
  AR: { nome: "Ação Rescisória", tribunais: ["STF", "STJ"] },
  Pet: { nome: "Petição", tribunais: ["STF", "STJ"] },
  Inq: { nome: "Inquérito", tribunais: ["STF", "STJ"] },
  CC: { nome: "Conflito de Competência", tribunais: ["STF", "STJ"] },
  CAt: { nome: "Conflito de Atribuições", tribunais: ["STF", "STJ"] },
  SS: { nome: "Suspensão de Segurança", tribunais: ["STF", "STJ"] },
  SL: { nome: "Suspensão de Liminar", tribunais: ["STF", "STJ"] },
  SIRDR: { nome: "Suspensão em Incidente de Resolução de Demandas Repetitivas", tribunais: ["STF", "STJ"] },
  EI: { nome: "Embargos Infringentes", tribunais: ["STF"] },
  EP: { nome: "Execução Penal", tribunais: ["STF"] },
};

/** Recursos e incidentes que se encadeiam sobre a classe (sigla → nome). */
export const RECURSOS: Record<string, string> = {
  AgInt: "Agravo Interno",
  AgRg: "Agravo Regimental",
  AgR: "Agravo Regimental",
  EDcl: "Embargos de Declaração",
  ED: "Embargos de Declaração",
  EDv: "Embargos de Divergência",
  EREsp: "Embargos de Divergência em Recurso Especial",
  EAREsp: "Embargos de Divergência em Agravo em Recurso Especial",
  EI: "Embargos Infringentes",
  MC: "Medida Cautelar",
  "MC-Ref": "Referendo na Medida Cautelar",
  Ref: "Referendo",
  QO: "Questão de Ordem",
  TP: "Tutela Provisória",
  TPI: "Tutela Provisória Incidental",
  TutPrv: "Tutela Provisória",
  ProAfR: "Proposta de Afetação de Recurso",
  ExeMS: "Execução em Mandado de Segurança",
  RE: "Recurso Extraordinário",
  PET: "Petição",
  Pet: "Petição",
  RG: "Repercussão Geral",
  Extn: "Extensão",
};

const SIGLAS_CLASSE = Object.keys(CLASSES).sort((a, b) => b.length - a.length);
// "RE nos EDcl no REsp": recurso extraordinário interposto no STJ; "PET na APn": petição incidental
const PREFIXOS_STJ = ["AgInt", "AgRg", "EDcl", "EREsp", "EAREsp", "EDv", "ProAfR", "QO", "MC", "TutPrv", "TP", "ExeMS", "ED", "AgR", "RE", "PET", "Pet", "IDC"];
const SUFIXOS_STF = ["MC-Ref", "AgR", "ED", "EDv", "EI", "MC", "Ref", "QO", "TPI", "TP", "RG", "Extn"];
const ORDINAIS = "segund[oa]s?|terceir[oa]s?|quart[oa]s?|quint[oa]s?";

const esc = (s: string) => s.replace(/[-]/g, "\\-");
const PROCESSO = new RegExp(
  String.raw`(?<![A-Za-z])((?:(?:${PREFIXOS_STJ.map(esc).join("|")})\s+(?:no|nos|na|nas|em)\s+)*)` +
    String.raw`(${SIGLAS_CLASSE.map(esc).join("|")})\s*(?:n[º°o.]*\s*)?(\d{1,3}(?:\.\d{3})+|\d{1,9})(?![\d])` +
    String.raw`((?:[\s-]+(?:${SUFIXOS_STF.map(esc).join("|")}|${ORDINAIS})(?![A-Za-z]))*)` +
    String.raw`(?:\s*\/\s*([A-Z]{2})\b)?`,
);
const TRIBUNAL_NO_TEXTO = /\b(STF|STJ|Supremo Tribunal Federal|Superior Tribunal de Justi[çc]a)\b/i;

export interface ProcessoCitado {
  /** Classe base, ex.: "AREsp", "Inq", "ADI". */
  classe: string;
  nome_classe: string;
  numero: string;
  /** Recursos/incidentes encadeados, do mais externo ao mais interno: ["AgInt", "EDcl"]. */
  recursos: string[];
  /** Como a citação deve ser escrita, ex.: "AgInt nos EDcl no AREsp 1834945". */
  forma: string;
  uf?: string;
  /** Tribunal indicado no texto ou deduzido da classe (quando ela só existe em um). */
  tribunal?: "STF" | "STJ";
  /** Tribunais possíveis quando o texto não diz e a classe existe nos dois. */
  tribunais_possiveis: ("STF" | "STJ")[];
}

export function interpretarProcesso(texto: string): ProcessoCitado | null {
  const m = texto.match(PROCESSO);
  if (!m) return null;
  const [, prefixos, classe, num, sufixos, uf] = m;
  const recursosStj = [...(prefixos ?? "").matchAll(/([A-Za-z-]+)\s+(?:no|nos|na|nas|em)\s+/g)].map((x) => x[1]);
  const recursosStf = [...(sufixos ?? "").matchAll(new RegExp(String.raw`(${SUFIXOS_STF.map(esc).join("|")}|${ORDINAIS})`, "g"))]
    .map((x) => x[1])
    .filter((x) => !new RegExp(`^(?:${ORDINAIS})$`).test(x));
  const numero = num.replace(/\D/g, "");
  const def = CLASSES[classe];
  const noTexto = texto.match(TRIBUNAL_NO_TEXTO)?.[1];
  const indicado = noTexto ? (/^(STF|Supremo)/i.test(noTexto) ? "STF" : "STJ") : undefined;
  // recurso depois do número ("HC 123 AgR") é a forma do STF; antes da classe ("AgRg no HC"), a do STJ
  const pelaForma = recursosStf.length ? "STF" : recursosStj.length ? "STJ" : undefined;
  const tribunal = indicado ?? (def.tribunais.length === 1 ? def.tribunais[0] : pelaForma);
  const forma = recursosStf.length
    ? `${classe} ${numero} ${recursosStf.join("-")}`
    : `${prefixos.replace(/\s+/g, " ")}${classe} ${numero}`.trim();
  return {
    classe,
    nome_classe: def.nome,
    numero,
    recursos: [...recursosStj, ...recursosStf.reverse()],
    forma,
    uf: uf || undefined,
    tribunal,
    tribunais_possiveis: tribunal ? [tribunal] : def.tribunais,
  };
}

/** Espécie de um julgado a partir dos recursos encadeados (para separar mérito de embargos etc.). */
export function especieDoJulgado(recursos: string[], texto = ""): "merito" | "cautelar" | "referendo" | "embargos" | "agravo" | "questao_de_ordem" | "outro" {
  const r = recursos[0] ?? "";
  if (/^(AgInt|AgRg|AgR)$/.test(r)) return "agravo";
  if (/^(EDcl|ED|EDv|EREsp|EAREsp|EI)$/.test(r)) return "embargos";
  if (r === "MC-Ref" || r === "Ref" || /referendo/i.test(texto)) return "referendo";
  if (/^(MC|TP|TPI|TutPrv)$/.test(r) || /medida cautelar|liminar/i.test(texto)) return "cautelar";
  if (r === "QO") return "questao_de_ordem";
  return recursos.length ? "outro" : "merito";
}
