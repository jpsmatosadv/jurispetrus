import { parseArgs } from "node:util";
import { config } from "../config.js";
import { Acervo } from "../db.js";
import { ingerirEspelhos, ingerirTemas, PACOTES_ESPELHOS } from "./stj.js";
import { ingerirBnp } from "./bnp.js";
import { ingerirRepercussaoGeral } from "./stf.js";
import { ingerirEnunciadosTst } from "./tst.js";

const FONTES_INGESTAO = ["stj", "bnp", "stf", "tst"] as const;

const { values } = parseArgs({
  options: {
    fonte: { type: "string", multiple: true },
    tribunal: { type: "string", multiple: true },
    "rg-arquivo": { type: "string" },
    meses: { type: "string", default: "12" },
    orgao: { type: "string", multiple: true },
    forcar: { type: "boolean", default: false },
    "so-temas": { type: "boolean", default: false },
    ajuda: { type: "boolean", short: "h", default: false },
  },
});

if (values.ajuda) {
  console.log(`Uso: npm run ingest -- [opções]

  --fonte F        stj | bnp | stf | tst (pode repetir; padrão: todas)
                   stj = acórdãos e precedentes qualificados do STJ (Dados Abertos)
                   bnp = Banco Nacional de Precedentes do CNJ: súmulas, SV, RG, ADI/ADPF,
                         IRDR, IAC, IRR de STF, TST, TNU, TRFs, TJs e TRTs
                   stf = temas de repercussão geral (exportação oficial do STF)
                   tst = súmulas, OJs e precedentes normativos do TST
  --tribunal SIGLA só esses tribunais no BNP (ex.: TJSP, TRF4); pode repetir
  --rg-arquivo P   planilha de repercussão geral baixada no navegador (se o STF recusar o download)
  --meses N        arquivos mensais mais recentes por órgão (padrão 12)
  --orgao NOME     só os pacotes que contêm NOME (ex.: terceira-turma); pode repetir
  --so-temas       importa apenas os precedentes qualificados
  --forcar         reimporta arquivos já importados

Pacotes de espelhos disponíveis:
  ${PACOTES_ESPELHOS.join("\n  ")}`);
  process.exit(0);
}

const fontes = values.fonte?.length ? values.fonte : [...FONTES_INGESTAO];
const invalidas = fontes.filter((f) => !(FONTES_INGESTAO as readonly string[]).includes(f));
if (invalidas.length) {
  console.error(`Fonte(s) não suportada(s): ${invalidas.join(", ")}. Disponíveis: ${FONTES_INGESTAO.join(", ")}`);
  process.exit(1);
}

const acervo = new Acervo(config.dbPath);
const inicio = Date.now();
try {
  let total = 0;
  if (fontes.includes("stj")) {
    total += await ingerirTemas(acervo);
    if (!values["so-temas"]) {
      const pacotes = values.orgao?.length
        ? PACOTES_ESPELHOS.filter((p) => values.orgao!.some((o) => p.includes(o)))
        : PACOTES_ESPELHOS;
      total += await ingerirEspelhos(acervo, { meses: Number(values.meses), pacotes, forcar: values.forcar });
    }
  }
  // O STF vem depois do BNP para que a redação oficial dos temas de RG prevaleça.
  if (fontes.includes("bnp")) total += await ingerirBnp(acervo, { orgaos: values.tribunal });
  if (fontes.includes("tst")) total += await ingerirEnunciadosTst(acervo);
  if (fontes.includes("stf")) {
    try {
      total += await ingerirRepercussaoGeral(acervo, { arquivo: values["rg-arquivo"] });
    } catch (e) {
      // o BNP já traz as teses de RG; a planilha do STF só enriquece
      console.error(`! STF repercussão geral: ${(e as Error).message}`);
    }
  }
  const s = acervo.estatisticas();
  console.error(`Concluído: ${total} documentos importados em ${Math.round((Date.now() - inicio) / 1000)}s; acervo com ${s.total}.`);
} finally {
  acervo.fechar();
}
