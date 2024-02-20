import type * as sharp from "sharp";

////////////////////////////// SHARP //////////////////////////
let sharppromise: Promise<typeof sharp> | undefined = undefined;

/** Load Sharp  */
export async function loadSharp(): Promise<typeof sharp> {
  if (!sharppromise)
    sharppromise = import("sharp");
  return await sharppromise;
}

/** Load an image (loading sharp as needed) */
export async function createSharpImage(...args: Parameters<typeof sharp.default>): Promise<ReturnType<typeof sharp.default>> {
  const lib = await loadSharp();
  return lib.default(...args);
}
