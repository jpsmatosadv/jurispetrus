#!/usr/bin/env bash
# Gera o pacote do Claude Desktop para macOS (Apple Silicon e Intel): pacotes/jurispetrus-mac.mcpb
# Uso: scripts/empacotar-mac.sh [caminho/da/base.db]   (padrão: data/acervo.db)
set -euo pipefail
cd "$(dirname "$0")/.."

BASE="${1:-data/acervo.db}"
PASTA="build/mcpb-mac"
SAIDA="pacotes/jurispetrus-mac.mcpb"
VERSAO="$(node -p "require('./package.json').version")"
SQLITE_VEC="$(node -p "require('./package.json').dependencies['sqlite-vec'].replace(/^[^0-9]*/, '')")"

[ -f "$BASE" ] || { echo "Base não encontrada: $BASE (rode npm run ingest antes)"; exit 1; }
MODELO="modelos/granite-embedding-107m-multilingual"
[ -f "$MODELO/model_quantized.onnx" ] || scripts/baixar-modelo.sh

echo "» compilando"
npm run build >/dev/null

echo "» montando $PASTA"
rm -rf "$PASTA" && mkdir -p "$PASTA/server" "$PASTA/data"
cp -R dist/. "$PASTA/server/"
find "$PASTA/server" -name "*.map" -delete
cp mcpb/icon.png "$PASTA/"
node -e "
  const fs = require('fs');
  const m = JSON.parse(fs.readFileSync('mcpb/manifest.json', 'utf8'));
  m.version = '$VERSAO';
  fs.writeFileSync('$PASTA/manifest.json', JSON.stringify(m, null, 2));
  const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  fs.writeFileSync('$PASTA/package.json', JSON.stringify({ name: p.name, version: p.version, type: p.type, private: true, dependencies: p.dependencies }, null, 2));
"
cp package-lock.json "$PASTA/"

echo "» dependências de produção para macOS (arm64 e x64)"
( cd "$PASTA" \
  && npm ci --omit=dev --ignore-scripts --os=darwin --cpu=arm64 --no-audit --no-fund >/dev/null \
  && npm install --no-save --ignore-scripts --force --os=darwin --cpu=x64 "sqlite-vec-darwin-x64@$SQLITE_VEC" --no-audit --no-fund >/dev/null \
  && rm -f package-lock.json )
for arq in sqlite-vec-darwin-arm64 sqlite-vec-darwin-x64; do
  [ -d "$PASTA/node_modules/$arq" ] || { echo "Faltou $arq"; exit 1; }
done
rm -rf "$PASTA/node_modules/sqlite-vec-linux-"* "$PASTA/node_modules/sqlite-vec-windows-"*
# onnxruntime-node traz binários de todas as plataformas; o pacote leva só o do macOS
# (Apple Silicon; a versão em uso não publica binário para Mac Intel, que fica só com a busca por palavras)
ORT="$PASTA/node_modules/onnxruntime-node/bin/napi-v6"
[ -f "$ORT/darwin/arm64/onnxruntime_binding.node" ] || { echo "Faltou o onnxruntime para darwin/arm64"; exit 1; }
find "$ORT" -mindepth 1 -maxdepth 1 ! -name darwin -exec rm -rf {} +
# o binding carrega @rpath/libonnxruntime.1.dylib; a cópia com a versão completa no nome é redundante
rm -f "$ORT/darwin/arm64/libonnxruntime."*.*.*.dylib
[ -f "$ORT/darwin/arm64/libonnxruntime.1.dylib" ] || { echo "Faltou libonnxruntime.1.dylib"; exit 1; }

echo "» modelo da busca semântica local"
mkdir -p "$PASTA/modelos"
cp -R "$MODELO" "$PASTA/modelos/"

echo "» base inicial (compactada, sem cache de análises e sem o índice textual, refeito na 1ª execução)"
node --no-warnings -e "
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync('$BASE', { readOnly: true });
  db.exec(\"VACUUM INTO '$PASTA/data/acervo-inicial.db'\");
  db.close();
  const c = new DatabaseSync('$PASTA/data/acervo-inicial.db');
  c.exec(\"DELETE FROM analises; INSERT INTO documentos_fts(documentos_fts) VALUES('delete-all'); INSERT INTO dispositivos_fts(dispositivos_fts) VALUES('delete-all'); INSERT OR REPLACE INTO meta (chave, valor) VALUES ('indice_textual_pendente', '1'); PRAGMA journal_mode = DELETE; VACUUM;\");
  c.close();
"

echo "» validando e empacotando"
mkdir -p pacotes
npx --yes @anthropic-ai/mcpb@2.1.2 validate "$PASTA/manifest.json"
npx --yes @anthropic-ai/mcpb@2.1.2 pack "$PASTA" "$SAIDA"
ls -lh "$SAIDA"
