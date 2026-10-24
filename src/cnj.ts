/**
 * Número único do processo (Resolução CNJ 65/2008): NNNNNNN-DD.AAAA.J.TR.OOOO.
 * Dígito verificador (DD) pelo módulo 97 (ISO 7064), correção do DV e reconstrução de números
 * incompletos (sem zeros à esquerda ou sem o DV), sempre como sugestão a conferir.
 */

/** Tribunais válidos por segmento de Justiça (J). */
const TR_VALIDOS: Record<string, (tr: number) => boolean> = {
  "1": (tr) => tr === 0, // STF
  "2": (tr) => tr === 0, // CNJ
  "3": (tr) => tr === 0, // STJ
  "4": (tr) => tr >= 1 && tr <= 6, // TRFs
  "5": (tr) => tr >= 0 && tr <= 24, // TST e TRTs
  "6": (tr) => tr >= 0 && tr <= 27, // TSE e TREs
  "7": (tr) => tr === 0 || (tr >= 1 && tr <= 12), // STM e auditorias
  "8": (tr) => tr >= 1 && tr <= 27, // TJs
  "9": (tr) => [13, 21, 26].includes(tr), // TJMs
};

/** DV correto para o sequencial e o restante (AAAA J TR OOOO). */
export function digitoVerificador(sequencial: string, resto: string): string {
  const n = BigInt(sequencial.padStart(7, "0") + resto + "00");
  return String(98n - (n % 97n)).padStart(2, "0");
}

export function formatar(n: string): string {
  return `${n.slice(0, 7)}-${n.slice(7, 9)}.${n.slice(9, 13)}.${n[13]}.${n.slice(14, 16)}.${n.slice(16)}`;
}

function estruturaPlausivel(ano: string, j: string, tr: string): boolean {
  const a = Number(ano);
  return a >= 1900 && a <= new Date().getFullYear() && !!TR_VALIDOS[j]?.(Number(tr));
}

/** Para um número de 20 dígitos com DV errado, o mesmo número com o DV correto. */
export function corrigirDv(n20: string): string | null {
  const n = n20.replace(/\D/g, "");
  if (n.length !== 20) return null;
  const correto = digitoVerificador(n.slice(0, 7), n.slice(9));
  return correto === n.slice(7, 9) ? null : `${n.slice(0, 7)}${correto}${n.slice(9)}`;
}

/**
 * Números CNJ completos compatíveis com um número incompleto (13 a 19 dígitos), lido da direita:
 * OOOO, TR, J e AAAA são fixos; o que sobra à esquerda é o sequencial, com ou sem o DV.
 * Ex.: "249120198130303" → 0002491-??.2019.8.13.0303 (DV calculado) e 0000024-91.2019.8.13.0303
 * (se "91" for o DV e ele conferir).
 */
export function candidatosCnj(entrada: string): { numero: string; formatado: string; leitura: string }[] {
  const n = entrada.replace(/\D/g, "");
  if (n.length < 12 || n.length > 19) return [];
  const resto = n.slice(-11); // AAAA J TR OOOO
  const ano = resto.slice(0, 4), j = resto[4], tr = resto.slice(5, 7);
  if (!estruturaPlausivel(ano, j, tr)) return [];
  const inicio = n.slice(0, -11);
  const out: { numero: string; formatado: string; leitura: string }[] = [];
  // 1) o início é só o sequencial (faltou o DV)
  if (inicio.length >= 1 && inicio.length <= 7) {
    const seq = inicio.padStart(7, "0");
    const numero = seq + digitoVerificador(seq, resto) + resto;
    out.push({ numero, formatado: formatar(numero), leitura: `sequencial ${inicio}, DV calculado (faltava)` });
  }
  // 2) os dois últimos dígitos do início são o DV (faltaram zeros à esquerda)
  if (inicio.length >= 3 && inicio.length <= 9) {
    const seq = inicio.slice(0, -2).padStart(7, "0");
    const dv = inicio.slice(-2);
    if (digitoVerificador(seq, resto) === dv) {
      const numero = seq + dv + resto;
      out.push({ numero, formatado: formatar(numero), leitura: `sequencial ${inicio.slice(0, -2)} e DV ${dv} (que confere)` });
    }
  }
  return out.filter((c, i, arr) => arr.findIndex((x) => x.numero === c.numero) === i);
}

/** Sequência de 12 a 19 dígitos que parece um número CNJ incompleto (com ou sem pontuação). */
export function numeroIncompleto(texto: string): string | null {
  for (const m of texto.matchAll(/(?<![\d])(\d[\d.\-]{10,24}\d)(?![\d])/g)) {
    const d = m[1].replace(/\D/g, "");
    if (d.length >= 12 && d.length <= 19 && candidatosCnj(d).length) return d;
  }
  return null;
}
