import type { UploadManifest, UploadInstructions } from "@webhare/frontend/src/upload";
import { createUploadSession, getUploadedFile } from "@webhare/services";
import { runInWork } from "@webhare/whdb";
import { buffer } from "node:stream/consumers";
import * as crypto from "node:crypto";
import { pick } from "@webhare/std";

function hash(data: Buffer): string {
  return crypto.createHash("sha256").update(data).digest('base64url');
}

export const testInvokeApi = {
  offerFiles: async (manifest: UploadManifest): Promise<UploadInstructions> => {

    //TODO generate instructions
    return await runInWork(() => createUploadSession(manifest));
  },

  getFile: async (token: string) => {
    const file = await getUploadedFile(token);
    const readable = file.stream ? await buffer(file.stream) : Buffer.from("");
    return { ...pick(file, ["fileName", "size", "mediaType"]), data: readable.toString("utf8"), hash: hash(readable) };
  }
};
