import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "./config.js";
import { Acervo } from "./db.js";
import { criarServidor } from "./server.js";
import { criarEmbedder } from "./embeddings.js";
import { FONTES } from "./fontes/index.js";
import { criarAnalista } from "./ia.js";

const acervo = new Acervo(config.dbPath);
const server = criarServidor(acervo, {
  datajudKey: config.datajudKey,
  embedder: criarEmbedder(config.embeddings),
  fontes: FONTES,
  timeoutFontes: config.timeoutFontes,
  analista: criarAnalista(),
});
await server.connect(new StdioServerTransport());
console.error(`JurisPetrus MCP (stdio) — ${acervo.estatisticas().total} documentos indexados`);
