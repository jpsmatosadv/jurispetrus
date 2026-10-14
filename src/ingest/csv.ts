/** Parser CSV (RFC 4180): aspas, aspas escapadas e quebras de linha dentro de campos. */
export function lerCsv(texto: string, separador = ","): Record<string, string>[] {
  const linhas: string[][] = [];
  let campo = "";
  let linha: string[] = [];
  let entreAspas = false;

  const t = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (entreAspas) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          campo += '"';
          i++;
        } else entreAspas = false;
      } else campo += c;
    } else if (c === '"') entreAspas = true;
    else if (c === separador) {
      linha.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = "";
    } else campo += c;
  }
  if (campo || linha.length) {
    linha.push(campo);
    linhas.push(linha);
  }

  const [cabecalho, ...dados] = linhas.filter((l) => l.some((v) => v !== ""));
  if (!cabecalho) return [];
  return dados.map((l) => Object.fromEntries(cabecalho.map((h, i) => [h.trim(), (l[i] ?? "").trim()])));
}
