// This gets TypeScript to refer to us by our @webhare/... name in auto imports:
declare module "@webhare/graphics" {
}

import { resizeImageData } from "@mod-platform/js/cache/imgcache";
import type { Sharp } from "@webhare/deps";
import type { ResourceDescriptor, ResizeMethod } from "@webhare/services";
import { createSharpImageFromBlob, mimeToExt, suggestImageFormat, type PackMethods } from "@webhare/services/src/descriptor";
import { extname } from "node:path";

export { createQRCode } from "./qrcode";

/** Image resize options using canonical method names, without legacy HareScript aliases. */
export type ImageResizeMethod = Omit<ResizeMethod, "method"> & { method: keyof typeof PackMethods };

function prepareResizedImage(resource: ResourceDescriptor, method: ImageResizeMethod): Promise<Sharp | null> {
  const methodName = method.method === "fitCanvas" ? "fitcanvas" : method.method === "scaleCanvas" ? "scalecanvas" : method.method;
  return resizeImageData(resource, resource.file, { ...method, method: methodName, format: method.format ?? "keep" });
}

/** Prepare a resized image for further processing with Sharp. Defaults to keeping the source format. */
export async function createdResizedSharpImage(resource: ResourceDescriptor, method: ImageResizeMethod): Promise<Sharp> {
  return await prepareResizedImage(resource, method)
    ?? await createSharpImageFromBlob(resource.file, { mediaType: resource.mediaType });
}

/** Resize an image and return a File with the output MIME type and matching filename extension.
 * Preserves the original bytes when noForce is set and no processing is needed.
 */
export async function resizeImage(resource: ResourceDescriptor, method: ImageResizeMethod): Promise<File> {
  const image = await prepareResizedImage(resource, method);
  const mediaType = !method.format || method.format === "keep" ? suggestImageFormat(resource.mediaType) : method.format;
  const fileName = resource.fileName || "image";
  const extension = extname(fileName);
  const outputName = fileName.slice(0, fileName.length - extension.length) + mimeToExt[mediaType];
  return new File([image ? await image.toBuffer() : await resource.file.arrayBuffer()], outputName, { type: mediaType });
}
