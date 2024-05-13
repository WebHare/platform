import type { UploadManifest, UploadInstructions } from "@webhare/upload";
import { createUploadSession, getUploadedFile } from "@webhare/services";
import { runInWork } from "@webhare/whdb";
import * as crypto from "node:crypto";
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
    const data = file.size > 10 * 1024 ? `[${file.size} bytes]` : await file.text();
    return {
      fileName: file.name,
      size: file.size,
      mediaType: file.type,
      data,
      hash: hash(Buffer.from(await file.arrayBuffer()))
    };
  }
};
