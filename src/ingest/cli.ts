import { parseArgs } from "node:util";
import { config } from "../config.js";
import { Acervo } from "../db.js";
import { ingerirEspelhos, ingerirTemas, PACOTES_ESPELHOS } from "./stj.js";

const { values } = parseArgs({
  options: {
    fonte: { type: "string", default: "stj" },
    meses: { type: "string", default: "12" },
    orgao: { type: "string", multiple: true },
    forcar: { type: "boolean", default: false },
    "so-temas": { type: "boolean", default: false },
    ajuda: { type: "boolean", short: "h", default: false },
  },
});

if (values.ajuda) {
  console.log(`Uso: npm run ingest -- [opções]

  --meses N        arquivos mensais mais recentes por órgão (padrão 12)
  --orgao NOME     só os pacotes que contêm NOME (ex.: terceira-turma); pode repetir
  --so-temas       importa apenas os precedentes qualificados
  --forcar         reimporta arquivos já importados

Pacotes de espelhos disponíveis:
  ${PACOTES_ESPELHOS.join("\n  ")}`);
  process.exit(0);
}

if (values.fonte !== "stj") {
  console.error(`Fonte '${values.fonte}' ainda não suportada. Disponível: stj`);
  process.exit(1);
}

const acervo = new Acervo(config.dbPath);
const inicio = Date.now();
try {
  let total = await ingerirTemas(acervo);
  if (!values["so-temas"]) {
    const pacotes = values.orgao?.length
      ? PACOTES_ESPELHOS.filter((p) => values.orgao!.some((o) => p.includes(o)))
      : PACOTES_ESPELHOS;
    total += await ingerirEspelhos(acervo, { meses: Number(values.meses), pacotes, forcar: values.forcar });
  }
  const s = acervo.estatisticas();
  console.error(`Concluído: ${total} documentos importados em ${Math.round((Date.now() - inicio) / 1000)}s; acervo com ${s.total}.`);
} finally {
  acervo.fechar();
}
