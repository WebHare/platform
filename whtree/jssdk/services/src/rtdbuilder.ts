import { buildRTDFromHareScriptRTD, type HareScriptRTD } from "@webhare/hscompat";

/** @deprecated In WH5.7, import HareScriptRTD from hscompat */
export type HSRichDoc = HareScriptRTD;

/** @deprecated In WH5.7, import buildRTDFromHareScriptRTD from hscompat */
export const createRichDocumentFromHSRichDoc = buildRTDFromHareScriptRTD;
