import { toSnakeCase, type ToSnakeCase } from "@webhare/hscompat";
import { beginWork, commitWork } from "@webhare/whdb";
import * as services from "@webhare/services";
import { MultiFileUploader, type UploadManifest } from "@webhare/upload";
import { pick } from "@webhare/std";

export async function createUploadSession(manifest: ToSnakeCase<UploadManifest>) {
  //verify its safe to transfer through HS without extra escaping:
  manifest satisfies ToSnakeCase<UploadManifest>;

  await beginWork();
  const uploadinfo = await services.createUploadSession(manifest);
  await commitWork();
  return toSnakeCase(uploadinfo);
}

export async function mockUpload(files: Array<{
  filename: string;
  data: services.WebHareBlob;
  fullpath?: string;
  mimetype?: string;
}>): Promise<Array<{
  filename: string;
  token: string;
  type: "file";
  fullpath?: string;
}>> {
  const filelist = [];
  for (const file of files)
    filelist.push(new File([await file.data.arrayBuffer()], file.filename, { type: file.mimetype ?? "application/octet-stream" }));

  const uploader = new MultiFileUploader(filelist);

  await beginWork();
  const howToUpload = await services.createUploadSession(uploader.manifest);
  await commitWork();

  //We get a relative URL that will work in browsers but not in the backend. Resolve relative to our WebHare install
  howToUpload.baseUrl = new URL(howToUpload.baseUrl, services.backendConfig.backendURL).href;
  const uploadResult = await uploader.upload(howToUpload);
  return files.map((f, i) => ({
    filename: f.filename,
    token: uploadResult[i].token,
    type: "file",
    ...pick(f, ["fullpath"])
  }));
}
