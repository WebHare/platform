/* Support functions for the rich text editor */

import { getDataURLAsFile } from "@webhare/upload";

/** Image types we accept when importing pasted images */
export const pastedImageTypes = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"];
/** Maximum size for a pasted image */
export const pastedImageMaxSize = 20 * 1024 * 1024;
/** Timeout for downloading a pasted image (ms) */
export const pastedImageTimeout = 30_000;

/** Copy the dimensions of a pasted image from its style to its width/height attributes (if not set), so the upload
 *  placeholder takes the size the image will have and the dimensions survive paste cleanup
 * @param img - Pasted image
 */
export function copyPastedImageStyleDimensions(img: HTMLImageElement) {
  for (const dim of ["width", "height"] as const) {
    const match = img.style[dim].match(/^(\d+(?:\.\d+)?)px$/);
    if (match && !img.hasAttribute(dim))
      img.setAttribute(dim, String(Math.round(parseFloat(match[1]))));
  }
}

/** Read a response body, aborting as soon as it exceeds our maximum size (Content-Length may be absent or wrong) */
async function readLimitedResponse(response: Response): Promise<Blob> {
  const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!response.body)
    return new Blob([], { type });

  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let total = 0;
  for (; ;) {
    const { done, value } = await reader.read();
    if (done)
      break;

    total += value.byteLength;
    if (total > pastedImageMaxSize) {
      void reader.cancel();
      throw new Error(`Image is too large (more than ${pastedImageMaxSize} bytes)`);
    }
    chunks.push(value);
  }
  return new Blob(chunks, { type });
}

/** Get the content of a pasted image. data: URLs are decoded without fetch() as the CSP's connect-src (eg. the backend's)
 *  generally won't allow fetching those. Other images are downloaded by the browser, which requires the remote server to
 *  allow CORS requests
 * @param src - The src of the pasted image
 * @returns The image data
 */
export async function downloadPastedImage(src: string): Promise<Blob> {
  const url = new URL(src, location.href);
  if (url.protocol === "data:")
    return getDataURLAsFile(src, { fileName: "image", maxSize: pastedImageMaxSize });
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error(`Unsupported image URL protocol '${url.protocol}'`);

  const response = await fetch(url, {
    mode: "cors",
    credentials: "omit",
    referrerPolicy: "strict-origin", //send our origin (some servers/filters require a referrer) but not the full URL
    signal: AbortSignal.timeout(pastedImageTimeout)
  });
  if (!response.ok)
    throw new Error(`Image download failed with status ${response.status}`);

  const contentlength = parseInt(response.headers.get("content-length") || "0");
  if (contentlength > pastedImageMaxSize) { //early exit, readLimitedResponse will enforce the actual limit
    void response.body?.cancel();
    throw new Error(`Image is too large (${contentlength} bytes)`);
  }

  return await readLimitedResponse(response);
}

/** Verify a pasted image is of a supported type and size and can actually be decoded
 * @param blob - The image data
 * @throws If the image is unacceptable
 */
export async function validatePastedImage(blob: Blob): Promise<void> {
  if (!pastedImageTypes.includes(blob.type))
    throw new Error(`Unsupported image type '${blob.type}'`);
  if (blob.size > pastedImageMaxSize)
    throw new Error(`Image is too large (${blob.size} bytes)`);

  (await createImageBitmap(blob)).close(); //throws if the image can't be decoded
}
