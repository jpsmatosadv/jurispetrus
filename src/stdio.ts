import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "./config.js";
import { Acervo } from "./db.js";
import { criarServidor } from "./server.js";

const acervo = new Acervo(config.dbPath);
const server = criarServidor(acervo, { datajudKey: config.datajudKey });
await server.connect(new StdioServerTransport());
console.error(`JurisPetrus MCP (stdio) — ${acervo.estatisticas().total} documentos indexados`);
