import type { FonteAoVivo } from "./tipos.js";
import { fonteTst } from "./tst.js";
import { fonteStf } from "./stf.js";
import { fonteTjdft } from "./tjdft.js";
import { fonteCarf } from "./carf.js";
import { fonteTcu } from "./tcu.js";
import { fonteEproc, PORTAIS_EPROC } from "./eproc.js";
import { fonteEsaj, PORTAIS_ESAJ } from "./esaj.js";
import { fonteTjpr } from "./tjpr.js";
import { fonteTjba, fonteTjes, fonteTrf5 } from "./json-tribunais.js";

/** Conectores ao vivo disponíveis, na ordem em que aparecem em listar_fontes. */
export const FONTES: FonteAoVivo[] = [
  fonteStf,
  fonteTst,
  ...Object.keys(PORTAIS_EPROC).map(fonteEproc),
  fonteTrf5,
  fonteTjdft,
  fonteTjpr,
  fonteTjba,
  fonteTjes,
  ...Object.keys(PORTAIS_ESAJ).map(fonteEsaj),
  fonteCarf,
  fonteTcu,
];

/** Siglas cobertas por alguma fonte ao vivo. */
export const TRIBUNAIS_AO_VIVO = [...new Set(FONTES.flatMap((f) => f.tribunais))].sort();
