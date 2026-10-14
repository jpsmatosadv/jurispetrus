/**
 * Fontes de legislação consolidada:
 *  - Câmara dos Deputados (legin, "norma atualizada"): texto vigente mais recente, em HTML;
 *  - normas.leg.br (Senado/LexML): árvore estruturada por dispositivo, com versões datadas;
 *  - SIGEN (catálogo do Senado): pesquisa de normas por apelido, número ou ementa.
 */
import { buscarComRetentativa, lerTexto, limparHtml } from "../fontes/tipos.js";
import type { Dispositivo } from "./indice.js";
import { normalizarArtigo } from "./indice.js";
import { docxParaHtml } from "./docx.js";

export type DispositivoNovo = Omit<Dispositivo, "norma" | "norma_nome" | "atualizado_em" | "id">;

const NIVEIS = ["PARTE", "LIVRO", "TÍTULO", "CAPÍTULO", "SEÇÃO", "SUBSEÇÃO"];
// "CAPÍTULO IV", "Seção II", "TÍTULO ÚNICO", "PARTE GERAL", "LIVRO COMPLEMENTAR"
const CABECALHO = /^(PARTE|LIVRO|T[ÍI]TULO|CAP[ÍI]TULO|SE[ÇC][ÃA]O|SUBSE[ÇC][ÃA]O)\s+([IVXLC]+(?:-[A-Z])?|[ÚU]NIC[OA]|GERAL|ESPECIAL|COMPLEMENTAR)\b/i;
const INICIO_ARTIGO = /^Arts?\.\s*(\d[\d.]*(?:\s*-\s*[A-Z]{1,2})?)\s*[º°o]?\s*(?:(?:a|e)\s*(\d[\d.]*)\s*[º°o]?)?\s*[.\-–]?/;
const REVOGADO = /^\(?\s*(revogad[oa]s?|vetad[oa]s?|suprimid[oa]s?)\b/i;

/** Separa as anotações editoriais da Câmara ("(Artigo com redação dada pela Lei ...)") do texto normativo. */
function separarNotas(html: string): { texto: string; notas: string[] } {
  const notas: string[] = [];
  const semNotas = html.replace(/<a\b[^>]*>\s*(?:<[^>]+>\s*)*(\([^<]*?\))\s*(?:<\/[^>]+>\s*)*<\/a>/gi, (_, nota) => {
    notas.push(limparHtml(nota) ?? "");
    return " ";
  });
  return { texto: limparHtml(semNotas)?.replace(/\s+/g, " ").trim() ?? "", notas: notas.filter(Boolean) };
}

/**
 * Lê o HTML da "norma atualizada" e devolve um dispositivo por artigo, com o caminho
 * (Livro/Título/Capítulo/Seção) e a indicação de revogação. Faixas como "Arts. 757 a 777.
 * (Revogados...)" viram um registro por artigo.
 */
export function lerNormaAtualizadaCamara(html: string, fonteUrl: string, opts: { pararEm?: RegExp } = {}): DispositivoNovo[] {
  const blocos = [...html.matchAll(/<(p|h\d)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => separarNotas(m[2])).filter((b) => b.texto);
  const caminho: (string | undefined)[] = [];
  const saida: DispositivoNovo[] = [];
  let atual: (DispositivoNovo & { notas: string[] }) | null = null;
  let aguardandoTitulo = -1;

  const fechar = () => {
    if (!atual) return;
    const { notas, ...d } = atual;
    if (notas.length) d.texto += `\nNotas: ${notas.join(" ")}`;
    saida.push(d);
    atual = null;
  };

  for (const b of blocos) {
    if (opts.pararEm?.test(b.texto)) break;
    if (/^Bras[íi]lia,\s*\d/.test(b.texto)) {
      fechar();
      break;
    }
    const cab = b.texto.match(CABECALHO);
    if (cab && b.texto.length < 90) {
      fechar();
      const nivel = NIVEIS.findIndex((n) => n.normalize("NFD").replace(/[̀-ͯ]/g, "") === cab[1].normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase());
      caminho[nivel] = b.texto;
      caminho.length = nivel + 1;
      aguardandoTitulo = nivel;
      continue;
    }
    const art = b.texto.match(INICIO_ARTIGO);
    if (art) {
      fechar();
      aguardandoTitulo = -1;
      const corpo = b.texto.slice(art[0].length).trim();
      // a revogação pode vir só na anotação da Câmara: "Arts. 757 a 777. (Revogados pela Lei ...)"
      const revogado = REVOGADO.test(corpo) || (!corpo && b.notas.some((n) => REVOGADO.test(n))) ? 1 : 0;
      const inicio = normalizarArtigo(art[1]);
      const fim = art[2] ? normalizarArtigo(art[2]) : null;
      const rotaCaminho = caminho.filter(Boolean).join(" > ") || null;
      if (fim && /^\d+$/.test(inicio) && /^\d+$/.test(fim) && Number(fim) > Number(inicio) && Number(fim) - Number(inicio) < 400) {
        for (let n = Number(inicio); n <= Number(fim); n++) {
          saida.push({ artigo: String(n), ordem: saida.length, rotulo: `Art. ${n}`, caminho: rotaCaminho, texto: `Art. ${n}. ${corpo}${b.notas.length ? `\nNotas: ${b.notas.join(" ")}` : ""}`, revogado, fonte_url: fonteUrl });
        }
        continue;
      }
      atual = { artigo: inicio, ordem: saida.length, rotulo: `Art. ${art[1].replace(/\s+/g, "").replace(/\.+$/, "")}`, caminho: rotaCaminho, texto: b.texto, revogado, fonte_url: fonteUrl, notas: [...b.notas] };
      continue;
    }
    if (aguardandoTitulo >= 0 && !atual) {
      // linha logo abaixo de "CAPÍTULO I": o nome do capítulo
      caminho[aguardandoTitulo] = `${caminho[aguardandoTitulo]} - ${b.texto}`;
      aguardandoTitulo = -1;
      continue;
    }
    if (atual) {
      (atual as DispositivoNovo & { notas: string[] }).texto += `\n${b.texto}`;
      (atual as DispositivoNovo & { notas: string[] }).notas.push(...b.notas);
    }
  }
  fechar();
  // artigos repetidos (ex.: texto anexo) ficam com a primeira ocorrência
  const vistos = new Set<string>();
  return saida.filter((d) => (vistos.has(d.artigo) ? false : (vistos.add(d.artigo), true))).map((d, i) => ({ ...d, ordem: i }));
}

// ---------- normas.leg.br (árvore estruturada) ----------

type No = Record<string, any>;
const lista = <T,>(x: T | T[] | undefined | null): T[] => (Array.isArray(x) ? x : x ? [x] : []);
const tipoNo = (n: No): string => String(n.legislationType?.["@id"] ?? n.legislationType ?? "").split(/[:/]/).pop() ?? "";

/** Versão vigente de um nó: a mais recente que não esteja "NotInForce". */
function versaoVigente(n: No): No | null {
  const versoes = lista<No>(n.workExample).filter((v) => v.legislationLegalForce !== "NotInForce");
  versoes.sort((a, b) => String(a.legislationDate ?? "").localeCompare(String(b.legislationDate ?? "")));
  return versoes.at(-1) ?? null;
}

function textoDoNo(n: No): { texto: string; revogado: boolean } {
  const v = versaoVigente(n);
  const rotulo = v?.name ? `${String(v.name).trim()} ` : "";
  const corpo = limparHtml(v?.text ?? "") ?? "";
  const revogado = n.legislationLegalForce === "NotInForce" || /Repeal|Suppression|Vetoed/i.test(String(v?.legislationType ?? ""));
  const filhos = lista<No>(n.hasPart).map(textoDoNo).filter((f) => f.texto);
  const proprio = `${rotulo}${corpo}`.trim();
  return { texto: [proprio, ...filhos.map((f) => f.texto)].filter(Boolean).join("\n"), revogado: revogado || (!corpo && !filhos.length) };
}

export function lerNormaEstruturada(json: No, fonteUrl: string): DispositivoNovo[] {
  const saida: DispositivoNovo[] = [];
  const andar = (n: No, caminho: string[]) => {
    const tipo = tipoNo(n);
    if (tipo === "artigo") {
      const v = versaoVigente(n);
      const rotulo = String(v?.name ?? lista<No>(n.workExample)[0]?.name ?? "").trim();
      const num = rotulo.match(/Art\.\s*(\d[\d.]*(?:-[A-Z]{1,2})?)/)?.[1] ?? String(n.legislationIdentifier ?? "").match(/!art(\d+[A-Z-]*)$/i)?.[1];
      if (!num) return;
      const { texto, revogado } = textoDoNo(n);
      saida.push({
        artigo: normalizarArtigo(num),
        ordem: saida.length,
        rotulo: `Art. ${num}`,
        caminho: caminho.join(" > ") || null,
        texto: texto || `${rotulo} (sem texto)`,
        revogado: revogado || REVOGADO.test(texto.replace(/^Art\.\s*[\d.]+[º°o]?\s*\.?\s*/, "")) ? 1 : 0,
        fonte_url: fonteUrl,
      });
      return;
    }
    const v = versaoVigente(n);
    const nome = /parte|livro|titulo|capitulo|secao|subsecao/.test(tipo) ? [v?.name, limparHtml(v?.text ?? "")].filter(Boolean).join(" - ") : "";
    for (const f of lista<No>(n.hasPart)) andar(f, nome ? [...caminho, nome] : caminho);
  };
  andar(json, []);
  return saida;
}

// ---------- download ----------

export interface ResultadoDownload {
  fonte: "camara-norma-atualizada" | "normas.leg.br";
  fonte_url: string;
  dispositivos: DispositivoNovo[];
  versao?: string;
}

const CAMARA = "https://www2.camara.leg.br/legin/fed";

export async function baixarDaCamara(caminho: string, opts: { pararEm?: RegExp; fetchImpl?: typeof fetch } = {}): Promise<ResultadoDownload> {
  const url = `${CAMARA}/${caminho}.html`;
  const r = await buscarComRetentativa(url, { fetchImpl: opts.fetchImpl, signal: AbortSignal.timeout(300_000) });
  let html = r.ok ? await lerTexto(r) : "";
  let origem = url;
  // A Câmara às vezes devolve uma página de erro do proxy com status 200 (sobretudo em leis
  // recentes); nesse caso, o mesmo texto atualizado vem do .docx.
  if (html.length < 5000 || !/Art\.\s*1/.test(html)) {
    const urlDocx = `${CAMARA}/${caminho}.docx`;
    const rd = await buscarComRetentativa(urlDocx, { fetchImpl: opts.fetchImpl, signal: AbortSignal.timeout(300_000) });
    const convertido = rd.ok ? docxParaHtml(Buffer.from(await rd.arrayBuffer())) : null;
    if (!convertido) throw new Error(`Câmara não entregou o texto atualizado (HTML ${r.status}, DOCX ${rd.status}) para ${caminho}`);
    html = convertido;
    origem = urlDocx;
  }
  const dispositivos = lerNormaAtualizadaCamara(html, url, { pararEm: opts.pararEm });
  if (dispositivos.length < 3) throw new Error(`Nenhum artigo reconhecido em ${origem}`);
  return { fonte: "camara-norma-atualizada", fonte_url: url, dispositivos };
}

export async function baixarDoNormasLeg(urn: string, fetchImpl: typeof fetch = fetch): Promise<ResultadoDownload> {
  const url = `https://normas.leg.br/api/public/normas?urn=${encodeURIComponent(urn)}&tipo_documento=maior-detalhe`;
  const r = await buscarComRetentativa(url, { fetchImpl, signal: AbortSignal.timeout(300_000) });
  if (!r.ok) throw new Error(`normas.leg.br respondeu HTTP ${r.status}`);
  const json = (await r.json()) as No;
  const pagina = `https://normas.leg.br/?urn=${urn}`;
  if (json.hasPart) {
    const dispositivos = lerNormaEstruturada(json, pagina);
    if (dispositivos.length >= 3) return { fonte: "normas.leg.br", fonte_url: pagina, dispositivos, versao: json.dateModified };
  }
  // Sem árvore estruturada: usa a cópia HTML do texto vigente (compilação da Câmara) guardada no normas.leg.br.
  const vigente = lista<No>(json.encoding).find((e) => e.version === "Current" && e.contentUrl);
  if (!vigente) throw new Error(`normas.leg.br não tem o texto de ${urn}`);
  const urlTexto = String(vigente.contentUrl).replace("/api/binario/", "/api/public/binario/");
  const rt = await buscarComRetentativa(urlTexto, { fetchImpl, signal: AbortSignal.timeout(300_000) });
  if (!rt.ok) throw new Error(`normas.leg.br (texto vigente) respondeu HTTP ${rt.status}`);
  const dispositivos = lerNormaAtualizadaCamara(await lerTexto(rt), pagina);
  if (dispositivos.length < 3) throw new Error(`Nenhum artigo reconhecido no texto vigente de ${urn}`);
  return { fonte: "normas.leg.br", fonte_url: pagina, dispositivos, versao: vigente.dateModified ?? vigente.uploadDate ?? json.dateModified };
}

// ---------- SIGEN (catálogo do Senado) ----------

export interface NormaSigen {
  urn: string;
  nome: string;
  tipo: string;
  numero: string;
  data: string | null;
  apelido: string | null;
  ementa: string | null;
  situacao: string | null;
  revogada_por: string | null;
  url: string;
}

/** Pesquisa normas no catálogo do Senado. Aceita sintaxe de campo: apelido:CDC, numero:8213 AND tipo:lei. */
export async function pesquisarSigen(q: string, opts: { limite?: number; fetchImpl?: typeof fetch } = {}): Promise<{ total: number; normas: NormaSigen[] }> {
  const p = new URLSearchParams({
    q,
    anoInicial: "1500",
    anoFinal: String(new Date().getFullYear()),
    tamanhoPagina: String(Math.min(opts.limite ?? 10, 50)),
    pagina: "0",
  });
  const r = await buscarComRetentativa(`https://legis.senado.leg.br/sigen/api/catalogo/basico?${p}`, {
    fetchImpl: opts.fetchImpl,
    signal: AbortSignal.timeout(30_000),
    tentativas: 2,
  });
  if (!r.ok) throw new Error(`Catálogo do Senado respondeu HTTP ${r.status}`);
  const j = (await r.json()) as { totalHits?: number; searchHits?: { content: Record<string, any> }[] };
  return {
    total: j.totalHits ?? 0,
    normas: (j.searchHits ?? []).map(({ content: c }) => ({
      urn: c.urn,
      nome: c.nome,
      tipo: c.tipo,
      numero: c.numero,
      data: c.assinatura ?? null,
      apelido: c.apelido ?? null,
      ementa: c.ementa ?? null,
      situacao: c.status ?? null,
      revogada_por: c.urnRevogacao ?? null,
      url: `https://normas.leg.br/?urn=${c.urn}`,
    })),
  };
}
