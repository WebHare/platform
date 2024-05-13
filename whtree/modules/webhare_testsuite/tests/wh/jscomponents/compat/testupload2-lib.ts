import type { UploadManifest, UploadInstructions } from "@webhare/upload";
import { createUploadSession, getUploadedFile } from "@webhare/services";
import { runInWork } from "@webhare/whdb";
import { buffer } from "node:stream/consumers";
import * as crypto from "node:crypto";
import { pick } from "@webhare/std";
import type { UploadSessionOptions } from "@webhare/services/src/sessions";

function hash(data: Buffer): string {
  return crypto.createHash("sha256").update(data).digest('base64url');
}

export const testInvokeApi = {
  offerFiles: async (manifest: UploadManifest, { chunkSize = 0 }): Promise<UploadInstructions> => {

    //TODO generate instructions
    const opts: UploadSessionOptions = {};
    if (chunkSize)
      opts.chunkSize = chunkSize;
    return await runInWork(() => createUploadSession(manifest, opts));
  },

  getFile: async (token: string) => {
    const file = await getUploadedFile(token);
    const readable = file.stream ? await buffer(file.stream) : Buffer.from("");
    const data = readable.length > 10 * 1024 ? `[${readable.length} bytes]` : readable.toString("utf8");
    return { ...pick(file, ["fileName", "size", "mediaType"]), data, hash: hash(readable) };
  }
};
