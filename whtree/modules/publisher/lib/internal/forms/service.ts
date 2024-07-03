import type { RPCFormTarget } from "@webhare/forms/src/types";
import { createUploadSession } from "@webhare/services";
import type { UploadInstructions, UploadManifest } from "@webhare/upload";
import { runInWork } from "@webhare/whdb";

export class FormService {
  //FIXME Validate the form is real and that the data is proper for the types (but even this RPC is more than we ever did)
  async requestUpload(formid: RPCFormTarget, manifest: UploadManifest): Promise<UploadInstructions> {
    return await runInWork(() => createUploadSession(manifest));
  }
}
