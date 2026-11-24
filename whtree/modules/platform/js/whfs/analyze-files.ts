/* Analyzes files after they have been created in the WHFS, eg. to set a title from a PDF's metadata.
   Scheduled for new files by createWHFSObject (TypeScript) and CreateFile (HareScript) */

import { logNotice, type TaskRequest, type TaskResponse, type WebHareBlob } from "@webhare/services";
import { limitUTF8Length } from "@webhare/std";
import { beginWork } from "@webhare/whdb";
import { openFile } from "@webhare/whfs";
import { getDocumentProxy, getMeta } from "unpdf";

export type AnalyzeFilesTask = {
  /** Files to analyze, with the hash of the data they had when the analysis was scheduled */
  files: Array<{ id: number; hash: string }>;
};

/** Maximum length of a WHFS title, in UTF-8 bytes */
const maxTitleBytes = 256;

/** Read the metadata from a PDF's Info dictionary
 * @param data - PDF file
 * @returns Title, subject and keywords. Empty strings for fields that aren't set
 * @throws If the data isn't a readable PDF
 */
export async function getPDFMetadata(data: WebHareBlob): Promise<{ title: string; subject: string; keywords: string }> {
  const pdf = await getDocumentProxy(new Uint8Array(await data.arrayBuffer()), { verbosity: 0 }); //verbosity 0: don't print warnings about malformed PDFs
  try {
    const { info } = await getMeta(pdf);
    const getString = (field: string) => typeof info[field] === "string" ? (info[field] as string).trim() : "";
    return { title: getString("Title"), subject: getString("Subject"), keywords: getString("Keywords") };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

/** Get the title to set for a file
 * @returns The title, or "" if the file doesn't supply one
 */
async function getTitleFromFile(id: number, data: WebHareBlob, mediaType: string): Promise<string> {
  if (mediaType !== "application/pdf")
    return "";

  try {
    return limitUTF8Length((await getPDFMetadata(data)).title, maxTitleBytes);
  } catch (e) {
    //Not being able to parse an uploaded PDF isn't an error, the file just doesn't get a title
    logNotice("info", `Unable to read the PDF metadata of file #${id}: ${(e as Error).message}`);
    return "";
  }
}

export async function analyzeFiles(req: TaskRequest<AnalyzeFilesTask>): Promise<TaskResponse> { //implements platform:analyzefiles
  const titles = new Map<number, string>();

  //Parse the files outside work, it may take a while
  for (const { id, hash } of req.taskdata.files) {
    const file = await openFile(id, { allowMissing: true });
    const data = file?.data;
    if (!file || file.title || !data || data.hash !== hash) //deleted, given a title or updated since scheduling
      continue;

    const title = await getTitleFromFile(id, data.resource, data.mediaType);
    if (title)
      titles.set(id, title);
  }

  await beginWork();
  for (const [id, title] of titles) {
    const file = await openFile(id, { allowMissing: true });
    if (file && !file.title) //recheck, someone may have set the title while we were parsing
      await file.update({ title, modified: file.modified });
  }
  return req.resolveByCompletion();
}
