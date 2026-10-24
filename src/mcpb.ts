/**
 * Ponto de entrada do pacote para o Claude Desktop (MCP Bundle, .mcpb).
 *
 * O Claude Desktop costuma rodar extensões com o Node.js embutido, que pode ser antigo.
 * Este arquivo não importa nada além de módulos presentes em qualquer Node recente e:
 *  1. registra a versão do Node em ~/Library/Logs/JurisPetrus/servidor.log;
 *  2. se faltar o SQLite nativo (node:sqlite), reinicia com --experimental-sqlite (Node 22.5+)
 *     ou com um Node 22.13+ instalado no Mac;
 *  3. prepara a pasta de dados, copia a base inicial e inicia o servidor.
 */
import { spawn, execFileSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pastaLog = join(homedir(), "Library", "Logs", "JurisPetrus");
function registrar(msg: string): void {
  console.error(msg);
  try {
    mkdirSync(pastaLog, { recursive: true });
    appendFileSync(join(pastaLog, "servidor.log"), `${new Date().toISOString()} ${msg}\n`);
  } catch {
    // sem log em arquivo, segue só com o stderr
  }
}

process.on("uncaughtException", (e) => {
  registrar(`Erro fatal: ${e?.stack ?? e}`);
  process.exit(1);
});

const script = fileURLToPath(import.meta.url);
const aqui = dirname(script);
const [maior, menor] = process.versions.node.split(".").map(Number);
registrar(
  `Iniciando com Node ${process.version} (${process.execPath})` +
    (process.versions.electron ? ` [Electron ${process.versions.electron}]` : "") +
    (process.env.JURIS_REEXEC ? ` [reinício: ${process.env.JURIS_REEXEC}]` : ""),
);

/**
 * O que o SQLite deste Node oferece: "completo" (FTS5 + extensões, para a busca semântica),
 * "basico" (só FTS5) ou "ausente".
 */
async function recursosSqlite(): Promise<"completo" | "basico" | "ausente"> {
  let DatabaseSync: typeof import("node:sqlite").DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE VIRTUAL TABLE t USING fts5(x)");
    db.close();
  } catch {
    return "ausente";
  }
  try {
    // a opção allowExtension (e loadExtension) só existe a partir do Node 22.13
    const db = new DatabaseSync(":memory:", { allowExtension: true } as never);
    const extensoes = typeof (db as unknown as { loadExtension?: unknown }).loadExtension === "function";
    db.close();
    return extensoes ? "completo" : "basico";
  } catch {
    return "basico";
  }
}

/** Versão (maior, menor) de um executável node, ou null se não rodar. */
function versaoDe(caminho: string): [number, number] | null {
  try {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const v = execFileSync(caminho, ["-v"], { encoding: "utf8", timeout: 5000, env }).trim();
    const m = v.match(/^v(\d+)\.(\d+)/);
    return m ? [Number(m[1]), Number(m[2])] : null;
  } catch {
    return null;
  }
}

/** Procura um Node 22.13+ instalado no Mac (Homebrew, nodejs.org, nvm, volta, fnm, asdf). */
function nodeDoSistema(): string | null {
  if (process.env.JURIS_IGNORAR_NODE_SISTEMA === "1") return null; // diagnóstico
  const h = homedir();
  const candidatos = ["/opt/homebrew/bin/node", "/usr/local/bin/node", join(h, ".volta", "bin", "node"), "/usr/bin/node"];
  for (const base of [join(h, ".nvm", "versions", "node"), join(h, ".fnm", "node-versions"), join(h, ".asdf", "installs", "nodejs")]) {
    try {
      for (const v of readdirSync(base).sort().reverse()) {
        candidatos.push(join(base, v, "bin", "node"), join(base, v, "installation", "bin", "node"));
      }
    } catch {
      // gerenciador não instalado
    }
  }
  for (const c of candidatos) {
    if (!existsSync(c)) continue;
    const v = versaoDe(c);
    if (v && (v[0] > 22 || (v[0] === 22 && v[1] >= 13))) return c;
  }
  return null;
}

/** Reinicia este mesmo script com outro executável/opção, repassando stdin/stdout (o canal MCP). */
function reiniciar(executavel: string, args: string[], motivo: string, env: NodeJS.ProcessEnv = process.env): void {
  registrar(`Reiniciando: ${motivo}`);
  const filho = spawn(executavel, [...args, script], { stdio: "inherit", env: { ...env, JURIS_REEXEC: motivo } });
  filho.on("exit", (codigo, sinal) => process.exit(codigo ?? (sinal ? 1 : 0)));
  for (const s of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.on(s, () => filho.kill(s));
}

const sqlite = await recursosSqlite();
const reinicio = process.env.JURIS_REEXEC;
registrar(`SQLite nativo: ${sqlite}`);
const sistema = sqlite !== "completo" && reinicio !== "node do sistema" ? nodeDoSistema() : null;

if (sistema) {
  // Um Node 22.13+ instalado no Mac dá todos os recursos (inclusive a busca semântica).
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  reiniciar(sistema, ["--no-warnings"], "node do sistema", env);
} else if (sqlite === "ausente") {
  registrar(`Node ${process.version} sem SQLite com FTS5 e nenhum Node 22.13+ encontrado no Mac: modo de instalação.`);
  await modoInstalacao();
} else {
  if (sqlite === "basico") registrar("Sem suporte a extensões do SQLite: a busca semântica fica desativada.");
  await iniciar();
}

/**
 * Sem um Node.js adequado, a extensão não pode abrir a base. Em vez de encerrar (o que aparece
 * como "Server disconnected"), sobe um servidor mínimo que explica ao Claude o que instalar.
 */
async function modoInstalacao(): Promise<void> {
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const orientacao =
    `O JurisPetrus está instalado, mas precisa do Node.js 22.13 ou superior para abrir a base de jurisprudência e legislação. ` +
    `O Node.js em uso pelo Claude Desktop é ${process.version}, e nenhum Node.js compatível foi encontrado neste Mac.\n\n` +
    "Como resolver:\n" +
    "1. Baixe e instale o Node.js LTS em https://nodejs.org (instalador para macOS).\n" +
    "2. Feche o Claude Desktop por completo (Cmd+Q) e abra de novo.\n" +
    "A extensão encontra o Node.js instalado sozinha; não é preciso mudar nenhuma configuração.";
  const server = new McpServer({ name: "jurispetrus", version: "0.2.0" }, { instructions: orientacao });
  server.registerTool(
    "jurispetrus_instalacao",
    {
      title: "JurisPetrus: concluir instalação",
      description:
        "O JurisPetrus ainda não está pronto neste computador. Chame esta ferramenta sempre que o usuário pedir pesquisa de " +
        "jurisprudência, legislação ou análise de caso, e repasse a orientação ao usuário.",
      inputSchema: {},
    },
    async () => ({ content: [{ type: "text", text: orientacao }] }),
  );
  await server.connect(new StdioServerTransport());
}

async function iniciar(): Promise<void> {
  const { DatabaseSync } = await import("node:sqlite");
  const pasta = process.env.JURIS_DIR_DADOS?.trim() && !process.env.JURIS_DIR_DADOS.startsWith("${")
    ? process.env.JURIS_DIR_DADOS.trim()
    : join(homedir(), "Library", "Application Support", "JurisPetrus");
  mkdirSync(pasta, { recursive: true });
  const base = join(pasta, "acervo.db");
  const inicial = join(aqui, "..", "data", "acervo-inicial.db");
  if (!existsSync(base) && existsSync(inicial)) {
    // O Claude Desktop pode abrir várias cópias do servidor ao mesmo tempo: copia para um
    // arquivo temporário e renomeia (operação atômica), para nenhuma ver a base pela metade.
    const temporario = `${base}.${process.pid}.tmp`;
    copyFileSync(inicial, temporario);
    if (existsSync(base)) rmSync(temporario, { force: true });
    else {
      renameSync(temporario, base);
      registrar(`Base inicial copiada para ${base}`);
    }
  }

  // A base inicial vem sem o índice textual (para caber no pacote); ele é refeito aqui, em ~1 s.
  if (existsSync(base)) {
    const db = new DatabaseSync(base);
    db.exec("PRAGMA busy_timeout = 30000");
    const pendente = () => !!db.prepare("SELECT 1 FROM meta WHERE chave = 'indice_textual_pendente'").get();
    if (pendente()) {
      // transação exclusiva: só um processo reconstrói; os demais esperam e encontram pronto
      db.exec("BEGIN IMMEDIATE");
      try {
        if (pendente()) {
          db.exec(
            "INSERT INTO documentos_fts(documentos_fts) VALUES('rebuild'); INSERT INTO dispositivos_fts(dispositivos_fts) VALUES('rebuild'); " +
              "DELETE FROM meta WHERE chave = 'indice_textual_pendente';",
          );
          registrar("Índice textual da base inicial reconstruído");
        }
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    }
    db.close();
  }
  process.env.JURIS_DB_PATH = base;
  process.env.JURIS_PERMITIR_ATUALIZACAO = "1";

  // Campos opcionais vazios na configuração da extensão desligam o recurso correspondente.
  const vazio = (v: string | undefined) => !v || !v.trim() || v.startsWith("${");
  if (vazio(process.env.ANTHROPIC_API_KEY)) delete process.env.ANTHROPIC_API_KEY;
  // Busca semântica local (modelo no pacote, sem API): os vetores que faltam são gerados em
  // segundo plano, na 1ª execução o acervo todo (alguns minutos).
  const { modeloLocalPresente } = await import("./embeddings-local.js");
  if (modeloLocalPresente()) {
    process.env.JURIS_EMBEDDINGS = "local";
    process.env.JURIS_VETORIZAR_FUNDO = "1";
  } else {
    registrar("Modelo da busca semântica local ausente: busca só por palavras.");
  }

  await import("./stdio.js");
  registrar("Servidor iniciado");
}
