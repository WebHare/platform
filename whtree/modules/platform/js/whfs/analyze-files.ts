/* Analyzes files after they have been created in the WHFS, eg. to set a title from a PDF's metadata.
   Scheduled for new files by createWHFSObject (TypeScript) and CreateFile (HareScript) */

import { logNotice, type WebHareBlob } from "@webhare/services";
import { limitUTF8Length } from "@webhare/std";
import type { TaskRequest, TaskResponse } from "@webhare/tasks";
import { beginWork } from "@webhare/whdb";
import { openFile } from "@webhare/whfs";
import { getDocumentProxy, getMeta } from "unpdf";

export type AnalyzeFilesTask = {
  /** Files to analyze, with the hash of the data they had when the analysis was scheduled */
  files: Array<{ id: number; hash: string }>;
};

/** Maximum length of a WHFS title, in UTF-8 bytes */
const maxTitleBytes = 256;

/** Larger PDFs aren't parsed: pdf.js reads the whole file into memory, and a title isn't worth that */
const maxPDFBytes = 100 * 1024 * 1024;

/** Read the metadata from a PDF's Info dictionary
 * @param data - PDF file
 * @returns Title, subject and keywords. Empty strings for fields that aren't set
 * @throws If the data isn't a readable PDF
 */
export async function getPDFMetadata(data: WebHareBlob): Promise<{ title: string; subject: string; keywords: string }> {
  const pdf = await getDocumentProxy(new Uint8Array(await data.arrayBuffer()), { verbosity: 0 }); //verbosity 0: don't print warnings about malformed PDFs
  try {
    const { info } = await getMeta(pdf);
    //Replace control characters by spaces: titles may contain NULs (eg. a terminating \0 in UTF-16 titles), which PostgreSQL rejects
    const getString = (field: "Title" | "Subject" | "Keywords") => typeof info[field] === "string" ? info[field].replace(/\p{Cc}+/gu, " ").trim() : "";
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
  if (data.size > maxPDFBytes) {
    logNotice("info", `Not reading the PDF metadata of file #${id}, it's larger than ${maxPDFBytes} bytes`);
    return "";
  }

  try {
    return limitUTF8Length((await getPDFMetadata(data)).title, maxTitleBytes);
  } catch (e) {
    //Not being able to parse an uploaded PDF isn't an error, the file just doesn't get a title
    logNotice("info", `Unable to read the PDF metadata of file #${id}: ${(e as Error).message}`);
    return "";
  }
}

export async function analyzeFiles(req: TaskRequest<AnalyzeFilesTask>): Promise<TaskResponse> { //implements platform:analyzefiles
  //Handle the files one by one and store each title right away, so a file that fails (or hangs the task) doesn't cost
  //the files before it their titles when the task is retried
  for (const { id, hash } of req.taskdata.files) {
    //Parse outside work, it may take a while
    const file = await openFile(id, { allowMissing: true });
    const data = file?.data;
    if (!file || file.title || !data || data.hash !== hash) //deleted, given a title or updated since scheduling
      continue;

    const title = await getTitleFromFile(id, data.resource, data.mediaType);
    if (!title)
      continue;

    try {
      await using work = await beginWork(); //rolled back when leaving this block without committing (commit closes it, even when it fails)
      const current = await openFile(id, { allowMissing: true });
      if (current && !current.title && current.data?.hash === hash) //recheck, the file may have changed while we were parsing
        await current.update({ title, modified: current.modified });
      await work.commit();
    } catch (e) {
      logNotice("error", `Unable to set the title of file #${id}: ${(e as Error).message}`);
    }
  }

  await beginWork(); //the task runner commits the task's completion in this work
  return req.resolveByCompletion();
}
