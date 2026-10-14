/** Leitura mínima de .docx (zip + word/document.xml), sem dependências externas. */
import { inflateRawSync } from "node:zlib";

/** Extrai um arquivo de um zip lendo o diretório central (suporta "stored" e "deflate"). */
export function extrairDoZip(zip: Buffer, nome: string): Buffer | null {
  const fimCentral = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (fimCentral < 0) return null;
  const total = zip.readUInt16LE(fimCentral + 10);
  let p = zip.readUInt32LE(fimCentral + 16);
  for (let i = 0; i < total; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) return null;
    const metodo = zip.readUInt16LE(p + 10);
    const tamComprimido = zip.readUInt32LE(p + 20);
    const lenNome = zip.readUInt16LE(p + 28), lenExtra = zip.readUInt16LE(p + 30), lenComent = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const arquivo = zip.toString("utf8", p + 46, p + 46 + lenNome);
    if (arquivo === nome) {
      const inicio = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const dados = zip.subarray(inicio, inicio + tamComprimido);
      return metodo === 0 ? Buffer.from(dados) : metodo === 8 ? inflateRawSync(dados) : null;
    }
    p += 46 + lenNome + lenExtra + lenComent;
  }
  return null;
}

const decodificarXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Converte o corpo de um .docx em HTML simples, um <p> por parágrafo (o leitor da Câmara faz o resto). */
export function docxParaHtml(docx: Buffer): string | null {
  const xml = extrairDoZip(docx, "word/document.xml")?.toString("utf8");
  if (!xml) return null;
  const paragrafos = [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((m) =>
    [...m[0].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\/>/g)].map((t) => (t[1] === undefined ? " " : decodificarXml(t[1]))).join(""),
  );
  return paragrafos
    .filter((p) => p.trim())
    .map((p) => `<p>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`)
    .join("\n");
}
