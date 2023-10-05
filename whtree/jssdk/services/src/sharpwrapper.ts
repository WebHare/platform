import type * as sharp from "sharp";

let sharppromise: Promise<typeof sharp> | undefined = undefined;

export async function loadSharp(): Promise<typeof sharp> {
  if (!sharppromise)
    sharppromise = import("sharp");
  return await sharppromise;
}

export async function createSharpImage(...args: Parameters<typeof sharp.default>): Promise<ReturnType<typeof sharp.default>> {
  const lib = await loadSharp();
  return lib.default(...args);
}
