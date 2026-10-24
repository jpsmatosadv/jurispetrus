import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "./config.js";
import { Acervo } from "./db.js";
import { criarServidor } from "./server.js";
import { criarEmbedder } from "./embeddings.js";
import { FONTES } from "./fontes/index.js";
import { criarAnalista } from "./ia.js";
import { vetorizarEmSegundoPlano } from "./vetorizar-fundo.js";

const acervo = new Acervo(config.dbPath);
const embedder = criarEmbedder(config.embeddings);
const server = criarServidor(acervo, {
  datajudKey: config.datajudKey,
  embedder,
  fontes: FONTES,
  timeoutFontes: config.timeoutFontes,
  analista: criarAnalista(),
  permitirAtualizacao: process.env.JURIS_PERMITIR_ATUALIZACAO === "1",
});
await server.connect(new StdioServerTransport());
console.error(`JurisPetrus MCP (stdio) — ${acervo.estatisticas().total} documentos indexados`);

// Busca semântica local: gera em segundo plano os vetores que faltam (na 1ª execução, o acervo todo).
if (embedder && config.embeddings.provedor === "local" && process.env.JURIS_VETORIZAR_FUNDO === "1") {
  setTimeout(() => {
    vetorizarEmSegundoPlano(acervo, embedder as Parameters<typeof vetorizarEmSegundoPlano>[1], { trava: `${config.dbPath}.vetorizando` }).catch((e) =>
      console.error(`Vetorização em segundo plano interrompida: ${(e as Error).message}`),
    );
  }, 5_000).unref?.();
}
