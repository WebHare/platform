import type { UploadManifest, UploadInstructions } from "@webhare/frontend/src/upload";

export const testInvokeApi = {
  offerFiles: async (manifest: UploadManifest): Promise<UploadInstructions> => {
    //TODO generate instructions
    return { justupload: manifest };
  }
};
