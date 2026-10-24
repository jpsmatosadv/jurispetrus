import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "./config.js";
import { Acervo } from "./db.js";
import { criarServidor } from "./server.js";
import { criarEmbedder } from "./embeddings.js";
import { FONTES } from "./fontes/index.js";
import { criarAnalista } from "./ia.js";
import { travar, vetorizarEmSegundoPlano } from "./vetorizar-fundo.js";
import { agendarAtualizacaoAutomatica } from "./atualizacao.js";

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
const vetorizarFundo = () => {
  if (!embedder || config.embeddings.provedor !== "local" || process.env.JURIS_VETORIZAR_FUNDO !== "1") return;
  vetorizarEmSegundoPlano(acervo, embedder as Parameters<typeof vetorizarEmSegundoPlano>[1], { trava: `${config.dbPath}.vetorizando` }).catch((e) =>
    console.error(`Vetorização em segundo plano interrompida: ${(e as Error).message}`),
  );
};
setTimeout(vetorizarFundo, 5_000).unref?.();

// Atualização automática semanal (legislação, STF, STJ, TST, BNP); ao terminar, vetoriza o que entrou.
if (process.env.JURIS_ATUALIZACAO_AUTOMATICA === "1") {
  setTimeout(() => {
    try {
      if (agendarAtualizacaoAutomatica(acervo, { trava: (nome) => travar(`${config.dbPath}.${nome}`), aoTerminar: vetorizarFundo })) {
        console.error("Atualização semanal do acervo iniciada em segundo plano");
      }
    } catch (e) {
      console.error(`Atualização automática não iniciada: ${(e as Error).message}`);
    }
  }, 60_000).unref?.();
}
