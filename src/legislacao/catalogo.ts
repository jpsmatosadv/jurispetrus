/** Normas federais mais citadas, com siglas e apelidos usados em peças e decisões. */
/** Caminhos fixos na Câmara para as normas que a busca por número não alcança. */
export const CAMINHOS_CAMARA: Record<string, string> = {
  CF: "consti/1988/constituicao-1988-5-outubro-1988-322142-normaatualizada-pl",
  ADCT: "conadc/1988/constituicao.adct-1988-5-outubro-1988-322234-normaatualizada-pl",
};

export interface NormaCatalogo {
  sigla: string;
  nome: string;
  apelidos: string[];
  /** URN LexML da norma (identificador estável). */
  urn: string;
  tipo: string;
  numero: string;
  ano: number;
}

export const CATALOGO: NormaCatalogo[] = [
  { sigla: "CF", nome: "Constituição da República Federativa do Brasil de 1988", apelidos: ["CF", "CF/88", "CRFB", "Constituição Federal", "Constituição"], urn: "urn:lex:br:federal:constituicao:1988-10-05;1988", tipo: "CON", numero: "1988", ano: 1988 },
  { sigla: "ADCT", nome: "Ato das Disposições Constitucionais Transitórias", apelidos: ["ADCT"], urn: "urn:lex:br:federal:ato.disposicoes.constitucionais.transitorias:1988-10-05;1988", tipo: "ADCT", numero: "1988", ano: 1988 },
  { sigla: "CC", nome: "Código Civil (Lei nº 10.406/2002)", apelidos: ["CC", "CC/2002", "Código Civil"], urn: "urn:lex:br:federal:lei:2002-01-10;10406", tipo: "LEI", numero: "10406", ano: 2002 },
  { sigla: "CPC", nome: "Código de Processo Civil (Lei nº 13.105/2015)", apelidos: ["CPC", "CPC/2015", "Código de Processo Civil", "NCPC"], urn: "urn:lex:br:federal:lei:2015-03-16;13105", tipo: "LEI", numero: "13105", ano: 2015 },
  { sigla: "CDC", nome: "Código de Defesa do Consumidor (Lei nº 8.078/1990)", apelidos: ["CDC", "Código de Defesa do Consumidor", "Lei 8.078/90"], urn: "urn:lex:br:federal:lei:1990-09-11;8078", tipo: "LEI", numero: "8078", ano: 1990 },
  { sigla: "CLT", nome: "Consolidação das Leis do Trabalho (Decreto-Lei nº 5.452/1943)", apelidos: ["CLT", "Consolidação das Leis do Trabalho"], urn: "urn:lex:br:federal:decreto.lei:1943-05-01;5452", tipo: "DEL", numero: "5452", ano: 1943 },
  { sigla: "CTN", nome: "Código Tributário Nacional (Lei nº 5.172/1966)", apelidos: ["CTN", "Código Tributário Nacional"], urn: "urn:lex:br:federal:lei:1966-10-25;5172", tipo: "LEI", numero: "5172", ano: 1966 },
  { sigla: "CP", nome: "Código Penal (Decreto-Lei nº 2.848/1940)", apelidos: ["CP", "Código Penal"], urn: "urn:lex:br:federal:decreto.lei:1940-12-07;2848", tipo: "DEL", numero: "2848", ano: 1940 },
  { sigla: "CPP", nome: "Código de Processo Penal (Decreto-Lei nº 3.689/1941)", apelidos: ["CPP", "Código de Processo Penal"], urn: "urn:lex:br:federal:decreto.lei:1941-10-03;3689", tipo: "DEL", numero: "3689", ano: 1941 },
  { sigla: "LINDB", nome: "Lei de Introdução às Normas do Direito Brasileiro (Decreto-Lei nº 4.657/1942)", apelidos: ["LINDB", "LICC", "Lei de Introdução"], urn: "urn:lex:br:federal:decreto.lei:1942-09-04;4657", tipo: "DEL", numero: "4657", ano: 1942 },
  { sigla: "ECA", nome: "Estatuto da Criança e do Adolescente (Lei nº 8.069/1990)", apelidos: ["ECA", "Estatuto da Criança e do Adolescente"], urn: "urn:lex:br:federal:lei:1990-07-13;8069", tipo: "LEI", numero: "8069", ano: 1990 },
  { sigla: "LBPS", nome: "Lei de Benefícios da Previdência Social (Lei nº 8.213/1991)", apelidos: ["Lei 8.213/91", "LBPS", "Lei de Benefícios"], urn: "urn:lex:br:federal:lei:1991-07-24;8213", tipo: "LEI", numero: "8213", ano: 1991 },
  { sigla: "LLC", nome: "Lei de Licitações e Contratos Administrativos (Lei nº 14.133/2021)", apelidos: ["Lei 14.133/21", "Nova Lei de Licitações", "NLLC"], urn: "urn:lex:br:federal:lei:2021-04-01;14133", tipo: "LEI", numero: "14133", ano: 2021 },
  { sigla: "LGPD", nome: "Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018)", apelidos: ["LGPD", "Lei Geral de Proteção de Dados"], urn: "urn:lex:br:federal:lei:2018-08-14;13709", tipo: "LEI", numero: "13709", ano: 2018 },
  { sigla: "LJE", nome: "Lei dos Juizados Especiais (Lei nº 9.099/1995)", apelidos: ["Lei 9.099/95", "Lei dos Juizados Especiais"], urn: "urn:lex:br:federal:lei:1995-09-26;9099", tipo: "LEI", numero: "9099", ano: 1995 },
  { sigla: "RJU", nome: "Regime Jurídico dos Servidores Públicos Federais (Lei nº 8.112/1990)", apelidos: ["Lei 8.112/90", "RJU", "Estatuto dos Servidores"], urn: "urn:lex:br:federal:lei:1990-12-11;8112", tipo: "LEI", numero: "8112", ano: 1990 },
  { sigla: "LIA", nome: "Lei de Improbidade Administrativa (Lei nº 8.429/1992)", apelidos: ["LIA", "Lei de Improbidade", "Lei 8.429/92"], urn: "urn:lex:br:federal:lei:1992-06-02;8429", tipo: "LEI", numero: "8429", ano: 1992 },
  { sigla: "LEF", nome: "Lei de Execução Fiscal (Lei nº 6.830/1980)", apelidos: ["LEF", "Lei de Execução Fiscal", "Lei 6.830/80"], urn: "urn:lex:br:federal:lei:1980-09-22;6830", tipo: "LEI", numero: "6830", ano: 1980 },
  { sigla: "LI", nome: "Lei do Inquilinato (Lei nº 8.245/1991)", apelidos: ["Lei do Inquilinato", "Lei 8.245/91"], urn: "urn:lex:br:federal:lei:1991-10-18;8245", tipo: "LEI", numero: "8245", ano: 1991 },
  { sigla: "LRF", nome: "Lei de Recuperação Judicial e Falência (Lei nº 11.101/2005)", apelidos: ["Lei 11.101/05", "Lei de Falências", "LREF"], urn: "urn:lex:br:federal:lei:2005-02-09;11101", tipo: "LEI", numero: "11101", ano: 2005 },
  { sigla: "MCI", nome: "Marco Civil da Internet (Lei nº 12.965/2014)", apelidos: ["Marco Civil da Internet", "MCI", "Lei 12.965/14"], urn: "urn:lex:br:federal:lei:2014-04-23;12965", tipo: "LEI", numero: "12965", ano: 2014 },
  { sigla: "LACP", nome: "Lei da Ação Civil Pública (Lei nº 7.347/1985)", apelidos: ["LACP", "Lei da Ação Civil Pública"], urn: "urn:lex:br:federal:lei:1985-07-24;7347", tipo: "LEI", numero: "7347", ano: 1985 },
  { sigla: "LMS", nome: "Lei do Mandado de Segurança (Lei nº 12.016/2009)", apelidos: ["Lei do Mandado de Segurança", "Lei 12.016/09"], urn: "urn:lex:br:federal:lei:2009-08-07;12016", tipo: "LEI", numero: "12016", ano: 2009 },
  { sigla: "EOAB", nome: "Estatuto da Advocacia e da OAB (Lei nº 8.906/1994)", apelidos: ["EOAB", "Estatuto da OAB", "Estatuto da Advocacia"], urn: "urn:lex:br:federal:lei:1994-07-04;8906", tipo: "LEI", numero: "8906", ano: 1994 },
  { sigla: "LEP", nome: "Lei de Execução Penal (Lei nº 7.210/1984)", apelidos: ["LEP", "Lei de Execução Penal"], urn: "urn:lex:br:federal:lei:1984-07-11;7210", tipo: "LEI", numero: "7210", ano: 1984 },
  { sigla: "LD", nome: "Lei de Drogas (Lei nº 11.343/2006)", apelidos: ["Lei de Drogas", "Lei 11.343/06"], urn: "urn:lex:br:federal:lei:2006-08-23;11343", tipo: "LEI", numero: "11343", ano: 2006 },
  { sigla: "LMP", nome: "Lei Maria da Penha (Lei nº 11.340/2006)", apelidos: ["Lei Maria da Penha", "Lei 11.340/06"], urn: "urn:lex:br:federal:lei:2006-08-07;11340", tipo: "LEI", numero: "11340", ano: 2006 },
  { sigla: "EI", nome: "Estatuto do Idoso / da Pessoa Idosa (Lei nº 10.741/2003)", apelidos: ["Estatuto do Idoso", "Estatuto da Pessoa Idosa"], urn: "urn:lex:br:federal:lei:2003-10-01;10741", tipo: "LEI", numero: "10741", ano: 2003 },
  { sigla: "LPS", nome: "Lei dos Planos de Saúde (Lei nº 9.656/1998)", apelidos: ["Lei dos Planos de Saúde", "Lei 9.656/98"], urn: "urn:lex:br:federal:lei:1998-06-03;9656", tipo: "LEI", numero: "9656", ano: 1998 },
  { sigla: "LPCS", nome: "Lei de Custeio da Previdência Social (Lei nº 8.212/1991)", apelidos: ["Lei 8.212/91", "Lei de Custeio"], urn: "urn:lex:br:federal:lei:1991-07-24;8212", tipo: "LEI", numero: "8212", ano: 1991 },
  { sigla: "LSA", nome: "Lei das Sociedades por Ações (Lei nº 6.404/1976)", apelidos: ["Lei das S.A.", "LSA", "Lei 6.404/76"], urn: "urn:lex:br:federal:lei:1976-12-15;6404", tipo: "LEI", numero: "6404", ano: 1976 },
];

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9/]+/g, " ").trim();

/** Resolve "CC", "Código Civil", "Lei 8.078/90", "10.406" etc. para a sigla do catálogo. */
export function resolverNorma(texto: string): NormaCatalogo | undefined {
  const t = norm(texto);
  if (!t) return undefined;
  const numero = texto.replace(/(\d)\.(\d)/g, "$1$2").match(/\b(\d{4,5})\b/)?.[1];
  return (
    CATALOGO.find((n) => n.sigla.toLowerCase() === t) ??
    CATALOGO.find((n) => n.apelidos.some((a) => norm(a) === t)) ??
    (numero ? CATALOGO.find((n) => n.numero === numero && n.tipo !== "CON") : undefined) ??
    CATALOGO.find((n) => n.apelidos.some((a) => norm(a).length > 4 && t.includes(norm(a))))
  );
}

const TIPOS_LEI: Record<string, { tipo: string; rotulo: string }> = {
  lei: { tipo: "LEI", rotulo: "Lei" },
  "lei complementar": { tipo: "LCP", rotulo: "Lei Complementar" },
  "decreto-lei": { tipo: "DEL", rotulo: "Decreto-Lei" },
  "decreto lei": { tipo: "DEL", rotulo: "Decreto-Lei" },
  decreto: { tipo: "DEC", rotulo: "Decreto" },
  "medida provisória": { tipo: "MPV", rotulo: "Medida Provisória" },
  "emenda constitucional": { tipo: "EMC", rotulo: "Emenda Constitucional" },
};

/**
 * Lê "Lei nº 13.146/2015", "Lei 13.146, de 2015", "LC 123/2006", "Decreto-Lei 911/69" e devolve
 * uma norma ad hoc (fora do catálogo), importável sob demanda.
 */
export function normaPorNumero(texto: string): NormaCatalogo | undefined {
  const m = texto.match(
    /\b(lei complementar|lc|decreto[- ]lei|decreto|medida provis[óo]ria|mp|emenda constitucional|ec|lei)\s*(?:federal\s*)?(?:n[º°o.]*\s*)?(\d[\d.]*)\s*(?:\/|,?\s*de\s*(?:\d{1,2}\s*(?:de\s*)?\w+\s*(?:de\s*)?)?)\s*(\d{2,4})/i,
  );
  if (!m) return undefined;
  const chave = m[1]
    .toLowerCase()
    .replace(/^lc$/, "lei complementar")
    .replace(/^mp$/, "medida provisória")
    .replace(/^ec$/, "emenda constitucional")
    .replace("provisoria", "provisória");
  const t = TIPOS_LEI[chave];
  if (!t) return undefined;
  const numero = m[2].replace(/\./g, "");
  let ano = Number(m[3]);
  if (ano < 100) ano += ano > 30 ? 1900 : 2000;
  const doCatalogo = CATALOGO.find((n) => n.numero === numero && n.tipo === t.tipo);
  if (doCatalogo) return doCatalogo;
  return {
    sigla: `${t.tipo}-${numero}-${ano}`,
    nome: `${t.rotulo} nº ${Number(numero).toLocaleString("pt-BR")}/${ano}`,
    apelidos: [],
    urn: "",
    tipo: t.tipo,
    numero,
    ano,
  };
}
