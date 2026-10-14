import { parseArgs } from "node:util";
import { config } from "../config.js";
import { Acervo } from "../db.js";
import { criarEmbedder } from "../embeddings.js";
import { vetorizarPendentes } from "../vetorizar.js";

const { values } = parseArgs({
  options: {
    recriar: { type: "boolean", default: false },
    maximo: { type: "string" },
    lote: { type: "string", default: "64" },
  },
});

const embedder = criarEmbedder(config.embeddings);
if (!embedder) {
  console.error("Busca semântica desativada: defina JURIS_EMBEDDINGS=voyage (com VOYAGE_API_KEY) ou JURIS_EMBEDDINGS=openai.");
  process.exit(1);
}

const acervo = new Acervo(config.dbPath);
try {
  acervo.prepararVetores(embedder.id, embedder.dimensoes, values.recriar);
  const inicio = Date.now();
  const n = await vetorizarPendentes(acervo, embedder, {
    lote: Number(values.lote),
    maximo: values.maximo ? Number(values.maximo) : undefined,
    log: (m) => console.error(m),
  });
  console.error(`Concluído: ${n} documentos vetorizados em ${Math.round((Date.now() - inicio) / 1000)}s com ${embedder.id}.`);
} finally {
  acervo.fechar();
}
