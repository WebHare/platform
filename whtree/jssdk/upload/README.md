# WebHare upload library

## Uploading blobs to WebHare

Client side

```typescript
import { SingleFileUploader, type UploadInstructions, type UploadResult } from "@webhare/upload";

//Prepares the upload. use requestFile(s) to show a picker to the user
const uploader = new SingleFileUploader(blob);
//Ask the server if it's okay to upload these files
const uploadinstructions = await backend.requestUpload(uploader.manifest);
//Run the actual upload. Options: onProgress, signal
const uploadedfile: UploadResult = await uploader.upload(uploadinstructions);
//Run an API call that does something with the just uploaded file
await backend.processUpload("slide:42", uploadedfile);
```

Server side API

```typescript
import { runInWork } from "@webhare/whdb";
import { createUploadSession, getUploadedFile, type UploadManifest, type UploadInstructions } from "@webhare/services";

export class MyApi {
  async requestUpload(manifest: UploadManifest): Promise<UploadInstructions> {
    return await runInWork(() => createUploadSession(manifest));
  }
  async processUpload(slide: string, upload: UploadResult) {
    const upl: File = await getUploadedFile(upload);
    // add code…
  }
}
```
