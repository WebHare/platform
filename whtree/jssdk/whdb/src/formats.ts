/* Formats used, mostly not public because pretty HareScript specific (eg the idea of overflowing after 4K) */

import { WebHareBlob } from "@webhare/services/src/webhareblob";
import { uploadBlob } from "./impl";
import { parseTyped, stringify } from "@webhare/std";
import { decodeHSON } from "@webhare/hscompat/src/hson";

export async function prepareAnyForDatabase(indata: object | null): Promise<{ data: string; datablob: WebHareBlob | null }> {
  if (!indata)
    return { data: "", datablob: null };

  const text = stringify(indata, { typed: true });
  if (text.length <= 4096)
    return { data: text, datablob: null };

  const datablob = WebHareBlob.from(text);
  await uploadBlob(datablob);
  return { data: "json", datablob };
}

export async function readAnyFromDatabase(data: string, datablob: WebHareBlob | null, { failHSON = "" } = {}): Promise<object | null> {
  if (!data && !datablob?.size)
    return null;

  if (!data && datablob?.size) //JSON data would have had 'json' in the data member
    if (failHSON)
      throw new Error("Attempting to decode HSON data from a session. Set the json: true flag on the session instead!");
    else
      return decodeHSON(await datablob.text()) as object;

  const input = data === "json" ? (await datablob?.text() ?? 'null') : data;
  if (input.startsWith("hson:"))
    if (failHSON)
      throw new Error("Attempting to decode HSON data from a session. Set the json: true flag on the session instead!");
    else
      return decodeHSON(input) as object;

  return parseTyped(input);
}
