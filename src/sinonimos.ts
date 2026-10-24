/**
 * Dicionário de expressões jurídicas equivalentes (ou que os tribunais usam para o mesmo tema).
 * Quando a consulta contém uma expressão de um grupo, as demais entram na pesquisa textual,
 * para achar ementas que descrevem o mesmo assunto com outras palavras.
 *
 * As expressões ficam sem acento e em minúsculas; a comparação ignora acentos, caixa e plural
 * (as palavras longas são comparadas pelo radical).
 */
export const GRUPOS_SINONIMOS: string[][] = [
  // Consumidor
  ["negativacao", "inscricao indevida", "cadastro de inadimplentes", "cadastro restritivo de credito", "orgaos de protecao ao credito", "serasa"],
  ["dano moral presumido", "dano moral in re ipsa", "in re ipsa"],
  ["falha na prestacao do servico", "defeito na prestacao do servico", "fato do servico"],
  ["plano de saude", "operadora de plano de saude", "seguro saude", "saude suplementar"],
  ["negativa de cobertura", "recusa de cobertura", "recusa de atendimento"],
  ["repeticao de indebito", "restituicao do indebito", "devolucao em dobro"],
  ["superendividamento", "minimo existencial"],
  ["atraso de voo", "cancelamento de voo", "extravio de bagagem", "transporte aereo", "companhia aerea"],
  ["atraso na entrega do imovel", "atraso na entrega da obra", "mora da construtora", "mora da incorporadora"],
  ["distrato", "resolucao do compromisso de compra e venda", "rescisao do compromisso de compra e venda"],
  ["erro medico", "responsabilidade civil medica", "ma pratica medica"],
  ["contrato de seguro", "indenizacao securitaria", "seguradora"],
  // Bancário
  ["emprestimo consignado", "credito consignado", "desconto em folha"],
  ["cartao de credito consignado", "reserva de margem consignavel", "rmc", "rcc"],
  ["juros abusivos", "taxa de juros abusiva", "revisao de contrato bancario", "taxa media de mercado"],
  ["capitalizacao de juros", "anatocismo", "juros compostos"],
  ["busca e apreensao", "alienacao fiduciaria"],
  // Previdenciário e assistencial
  ["auxilio doenca", "auxilio por incapacidade temporaria"],
  ["aposentadoria por invalidez", "aposentadoria por incapacidade permanente"],
  ["beneficio de prestacao continuada", "bpc", "loas", "amparo assistencial"],
  ["tempo especial", "atividade especial", "aposentadoria especial"],
  // Civil, família e processo
  ["usucapiao", "prescricao aquisitiva"],
  ["pensao alimenticia", "prestacao alimenticia", "obrigacao alimentar"],
  ["uniao estavel", "companheira", "companheiro", "convivente"],
  ["bem de familia", "impenhorabilidade do imovel residencial"],
  ["desconsideracao da personalidade juridica", "incidente de desconsideracao", "desconsideracao inversa"],
  ["penhora online", "sisbajud", "bacenjud", "bloqueio de ativos financeiros"],
  ["honorarios advocaticios", "honorarios sucumbenciais", "honorarios de sucumbencia", "verba honoraria"],
  ["gratuidade da justica", "justica gratuita", "assistencia judiciaria gratuita"],
  ["tutela de urgencia", "tutela antecipada", "tutela provisoria", "liminar"],
  ["cumprimento de sentenca", "execucao de titulo judicial"],
  ["prescricao intercorrente", "paralisacao do processo"],
  // Trabalho
  ["vinculo empregaticio", "vinculo de emprego", "relacao de emprego"],
  ["horas extras", "horas extraordinarias", "sobrejornada"],
  ["justa causa", "dispensa motivada", "falta grave do empregado"],
  ["rescisao indireta", "falta grave do empregador"],
  ["assedio moral", "dano moral trabalhista"],
  ["acidente de trabalho", "acidente do trabalho", "doenca ocupacional"],
  // Tributário e administrativo
  ["execucao fiscal", "divida ativa", "certidao de divida ativa"],
  ["icms", "imposto sobre circulacao de mercadorias"],
  ["iss", "issqn", "imposto sobre servicos"],
  ["imposto de renda", "irpf", "irpj"],
  ["responsabilidade civil do estado", "responsabilidade objetiva do estado", "responsabilidade extracontratual do estado"],
  ["improbidade administrativa", "ato de improbidade"],
  ["licitacao", "contratacao publica", "pregao"],
  ["desapropriacao", "expropriacao"],
  // Penal
  ["prisao preventiva", "segregacao cautelar", "custodia cautelar"],
  ["trafico de drogas", "trafico de entorpecentes", "lei de drogas"],
  ["violencia domestica", "maria da penha"],
  ["principio da insignificancia", "insignificancia", "crime de bagatela"],
  ["dosimetria", "fixacao da pena"],
];

/** Normaliza para comparação: sem acento, minúsculas, só letras e números separados por espaço. */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const MAX_EXPANSOES = 8;

/**
 * Expressões equivalentes às que aparecem na consulta (sem repetir as que já estão nela).
 * Ex.: "negativação indevida" → ["inscricao indevida", "cadastro de inadimplentes", ...].
 */
export function expandirSinonimos(consulta: string): string[] {
  const texto = ` ${normalizar(consulta)} `;
  const presentes = (e: string) => texto.includes(` ${e} `);
  const extras: string[] = [];
  for (const grupo of GRUPOS_SINONIMOS) {
    if (!grupo.some(presentes)) continue;
    for (const e of grupo) {
      if (!presentes(e) && !extras.includes(e)) extras.push(e);
    }
  }
  return extras.slice(0, MAX_EXPANSOES);
}
