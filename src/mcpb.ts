/**
 * Ponto de entrada do pacote para o Claude Desktop (MCP Bundle, .mcpb).
 * Prepara a pasta de dados do usuário, copia a base inicial na primeira execução
 * e inicia o servidor em modo stdio.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const versao = process.versions.node.split(".").map(Number);
if (versao[0] < 22 || (versao[0] === 22 && versao[1] < 13)) {
  console.error(
    `JurisPetrus precisa do Node.js 22.13 ou superior (encontrado ${process.versions.node}). ` +
      "Instale o Node.js 22 (nodejs.org) e, no Claude Desktop, desative 'Usar Node.js embutido' em Configurações > Extensões.",
  );
  process.exit(1);
}

const aqui = dirname(fileURLToPath(import.meta.url));
const pasta = process.env.JURIS_DIR_DADOS?.trim() || join(homedir(), "Library", "Application Support", "JurisPetrus");
mkdirSync(pasta, { recursive: true });
const base = join(pasta, "acervo.db");
const inicial = join(aqui, "..", "data", "acervo-inicial.db");
if (!existsSync(base) && existsSync(inicial)) {
  copyFileSync(inicial, base);
  console.error(`Base inicial copiada para ${base}`);
}
process.env.JURIS_DB_PATH = base;
process.env.JURIS_PERMITIR_ATUALIZACAO = "1";

// Campos opcionais vazios na configuração da extensão desligam o recurso correspondente.
const vazio = (v: string | undefined) => !v || !v.trim() || v.startsWith("${");
if (vazio(process.env.ANTHROPIC_API_KEY)) delete process.env.ANTHROPIC_API_KEY;
if (vazio(process.env.VOYAGE_API_KEY)) delete process.env.VOYAGE_API_KEY;
else process.env.JURIS_EMBEDDINGS ??= "voyage";

await import("./stdio.js");
