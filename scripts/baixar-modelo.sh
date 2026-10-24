#!/usr/bin/env bash
# Baixa o modelo de embeddings da busca semântica local e o quantiza em int8 (≈107 MB).
# Modelo: ibm-granite/granite-embedding-107m-multilingual (Apache 2.0), em revisão fixa e
# com os arquivos conferidos por SHA-256. Requer Python 3 com os pacotes onnx e onnxruntime
# (pip install onnx onnxruntime). Uso: scripts/baixar-modelo.sh
set -euo pipefail
cd "$(dirname "$0")/.."

REPO="ibm-granite/granite-embedding-107m-multilingual"
REVISAO="d6cffd338414d6a1c1f5decfad5fec62eebc90d5"
DESTINO="modelos/granite-embedding-107m-multilingual"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

[ -f "$DESTINO/model_quantized.onnx" ] && { echo "Modelo já presente em $DESTINO"; exit 0; }

baixar() { # arquivo sha256
  curl -sSL --fail -o "$TMP/$1" "https://huggingface.co/$REPO/resolve/$REVISAO/$1"
  echo "$2  $TMP/$1" | sha256sum -c --quiet - || { echo "SHA-256 não confere: $1"; exit 1; }
}
echo "» baixando $REPO@${REVISAO:0:7}"
baixar model.onnx 387e6f91dce3c651cb3dc06661d74fb1d3947f20ed9c3ecf49d2b3b77086b954
baixar tokenizer.json 7fc9e475f2ac473f070052d92b0c46ec2b91d9cd672935feb6fd837a65d33f78
baixar tokenizer_config.json 740c9d63e16f34a7915b4c2be299db105d1fd2e6753f2a981769a353f8902280

echo "» quantizando (int8)"
python3 -I -c "
import sys
from onnxruntime.quantization import quantize_dynamic, QuantType
quantize_dynamic(sys.argv[1], sys.argv[2], weight_type=QuantType.QInt8)
" "$TMP/model.onnx" "$TMP/model_quantized.onnx"

mkdir -p "$DESTINO"
mv "$TMP/model_quantized.onnx" "$TMP/tokenizer.json" "$TMP/tokenizer_config.json" "$DESTINO/"
cat > "$DESTINO/LEIA-ME.txt" <<TXT
granite-embedding-107m-multilingual (IBM), licença Apache 2.0.
Origem: https://huggingface.co/$REPO (revisão $REVISAO), quantizado em int8 (quantize_dynamic do onnxruntime).
TXT
ls -lh "$DESTINO"
