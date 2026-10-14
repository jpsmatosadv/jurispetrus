import type { FonteAoVivo } from "./tipos.js";
import { fonteTst } from "./tst.js";
import { fonteTjdft } from "./tjdft.js";
import { fonteCarf } from "./carf.js";
import { fonteTcu } from "./tcu.js";

/** Conectores ao vivo disponíveis, na ordem em que aparecem em listar_fontes. */
export const FONTES: FonteAoVivo[] = [fonteTst, fonteTjdft, fonteCarf, fonteTcu];
