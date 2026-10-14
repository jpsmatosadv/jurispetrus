/** e-SAJ — consulta completa de jurisprudência (cjsg) dos TJs sem captcha: TJAL e TJAC. */
import type { Documento } from "../db.js";
import { dataBr, dataIso, dataPlausivel, idEstavel, lerTexto, limparHtml, type FonteAoVivo } from "./tipos.js";

export const PORTAIS_ESAJ: Record<string, string> = {
  TJAL: "https://www2.tjal.jus.br",
  TJAC: "https://esaj.tjac.jus.br",
};

export function lerResultadosEsaj(html: string, tribunal: string, host: string, agora: string): Documento[] {
  const docs: Documento[] = [];
  for (const bloco of html.split(/<tr class="fundocinza1">/).slice(1)) {
    const [, cdAcordao, cdForo] = bloco.match(/cdAcordao="(\d+)"\s+cdForo="(\d+)"/) ?? [];
    if (!cdAcordao) continue;
    const processo = limparHtml(bloco.match(/downloadEmenta"[^>]*>([\s\S]*?)<\/a>/)?.[1]);
    const campo = (rotulo: string) =>
      limparHtml(bloco.match(new RegExp(`<strong>\\s*${rotulo}:?\\s*</strong>([\\s\\S]*?)</td>`, "i"))?.[1]);
    const ementa =
      limparHtml(bloco.match(/<div align="justify" style="display: none;">\s*<strong>Ementa:\s*<\/strong>([\s\S]*?)<\/div>/)?.[1]) ??
      limparHtml(bloco.match(/<strong>Ementa:\s*<\/strong>([\s\S]*?)<\/div>/)?.[1]);
    if (!ementa) continue;
    const [classe, assunto] = (campo("Classe/Assunto") ?? "").split(" / ");
    const orgao = campo("Órgão julgador");
    docs.push({
      id: idEstavel(tribunal, "ESAJ", cdAcordao),
      tribunal,
      tipo: "acordao",
      classe: classe || null,
      numero: processo,
      registro: processo?.replace(/\D/g, "") ?? null,
      orgao,
      relator: campo("Relator\\(a\\)"),
      data_julgamento: dataPlausivel(dataIso(campo("Data do julgamento"))),
      data_publicacao: dataPlausivel(dataIso(campo("Data de publicação") ?? campo("Data de registro"))),
      autoridade: /pleno|especial|se[çc][ãa]o/i.test(orgao ?? "") ? "C" : "D",
      situacao: null,
      titulo: `Acórdão ${tribunal} — ${classe || "Processo"} ${processo ?? ""}${orgao ? ` — ${orgao}` : ""}`.trim(),
      ementa: ementa.replace(/\s*\(Número do Processo:[\s\S]*$/, ""),
      tese: null,
      inteiro_teor: null,
      referencias: null,
      assuntos: assunto ?? null,
      fonte: "esaj-cjsg",
      // o inteiro teor abre uma verificação para humanos no próprio portal
      fonte_url: `${host}/cjsg/getArquivo.do?cdAcordao=${cdAcordao}&cdForo=${cdForo ?? 0}`,
      atualizado_em: agora,
    });
  }
  return docs;
}

export function fonteEsaj(tribunal: string): FonteAoVivo {
  const host = PORTAIS_ESAJ[tribunal];
  return {
    id: `esaj-${tribunal.toLowerCase()}`,
    nome: `${tribunal} — jurisprudência do e-SAJ`,
    tribunais: [tribunal],
    padrao: false,
    async pesquisar(f, ctx) {
      // A consulta exige a sessão aberta na página do formulário.
      const inicio = await ctx.fetch(`${host}/cjsg/consultaCompleta.do`, { signal: ctx.signal });
      const cookie = inicio.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
      await inicio.arrayBuffer();
      const corpo = new URLSearchParams({
        "dados.buscaInteiroTeor": f.consulta,
        "dados.pesquisarComSinonimos": "S",
        "dados.ordenarPor": "relevancia",
        tipoDecisaoSelecionados: "A",
        "dados.origensSelecionadas": "T",
      });
      if (f.data_inicio) corpo.set("dados.dtJulgamentoInicio", dataBr(f.data_inicio));
      if (f.data_fim) corpo.set("dados.dtJulgamentoFim", dataBr(f.data_fim));
      const r = await ctx.fetch(`${host}/cjsg/resultadoCompleta.do`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
        body: corpo,
        signal: ctx.signal,
      });
      if (!r.ok) throw new Error(`${tribunal} (e-SAJ) respondeu HTTP ${r.status}`);
      return lerResultadosEsaj(await lerTexto(r), tribunal, host, ctx.agora).slice(0, f.limite);
    },
  };
}
