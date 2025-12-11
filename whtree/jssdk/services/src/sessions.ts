import { generateRandomId } from "@webhare/std/src/platformbased";
import { toFSPath } from "./resources.ts";
import type { SessionScopes } from "./services.ts";
import { convertWaitPeriodToDate, type WaitPeriod } from "@webhare/std";
import { db, isWorkOpen, onFinishWork } from "@webhare/whdb";
import type { PlatformDB } from "@mod-platform/generated/db/platform";
import type { UploadInstructions, UploadManifest } from "@webhare/upload";
import * as fs from "node:fs/promises";
import { openAsBlob } from "node:fs";
import { prepareAnyForDatabase, readAnyFromDatabase } from "@webhare/whdb/src/formats";

const DefaultChunkSize = 5 * 1024 * 1024;
const DefaultUploadExpiry = "P1D";

export interface SessionOptions {
  //Reuse an existing (expired) session id
  sessionId?: string;
  //Session duration. Defaults to 60 minutes
  expires?: WaitPeriod;
}

/** Create a new session
    @param scope - Scope for session (must be unique for each createServerSession usage so users can't try to trick other getServerSession users to reveal data)
    @param data - Data to store (needs to be serializable to typed JSON)
    @returns Session id (base64url encoded string)
    @example

declare module "@webhare/services" {
  interface SessionScopes {
    "mymodule:myscope": {
      field: string;
    };
  }
}

const sessionId = createServerSession("mymodule:myscope", { field: "value" });
*/
export async function createServerSession<S extends string>(scope: S, data: S extends keyof SessionScopes ? SessionScopes[S] : object, options?: SessionOptions): Promise<string> {
  if (!isWorkOpen()) //HareScript would automanage the session for you for backwards compatibility, but it's better to show what happens
    throw new Error(`Can only manage sessions inside open work`);
  if (!scope)
    throw new Error(`No scope specified for session`);

  const created = new Date();
  const expires = convertWaitPeriodToDate(options?.expires || 60 * 1000 * 1000);

  if (options?.sessionId)
    await closeServerSession(options.sessionId);

  const sessionid = options?.sessionId || generateRandomId();
  const store = await prepareAnyForDatabase(data);
  await db<PlatformDB>().insertInto("system.sessions").values({ sessionid, scope, created, expires, autoextend: 0, ...store }).execute();
  return sessionid;
}

/** Get session data
    @param scope - Scope for session
    @param sessionId - Session id. If this session was created in HareScript, make sure it has the json:true option set
    @returns Session data or null if session has expired
*/
export function getServerSession<S extends keyof SessionScopes>(scope: S, sessionId: string): Promise<SessionScopes[S] | null>;
export function getServerSession(scope: string, sessionId: string): Promise<object | null>;

export async function getServerSession(scope: string, sessionId: string): Promise<object | null> {
  const sessdata = await db<PlatformDB>().selectFrom("system.sessions").select(["id", "expires", "data", "datablob", "scope"]).where("sessionid", "=", sessionId).executeTakeFirst();
  if (!sessdata || sessdata.expires < new Date())
    return null;
  if (sessdata.scope !== scope)
    throw new Error(`Incorrect scope '${scope}' for session '${sessionId}'`);
  return await readAnyFromDatabase(sessdata.data, sessdata.datablob, { failHSON: "Attempting to decode HSON data from a session. Set the json: true flag on the session instead!" });
}

export async function updateServerSession<S extends string>(scope: S, sessionId: string, data: S extends keyof SessionScopes ? SessionScopes[S] : object): Promise<void> {
  if (!isWorkOpen())
    throw new Error(`Can only manage sessions inside open work`);

  const sessdata = await db<PlatformDB>().selectFrom("system.sessions").select(["id", "expires", "data", "datablob", "scope"]).where("sessionid", "=", sessionId).executeTakeFirst();
  if (!sessdata || sessdata.expires < new Date())
    throw new Error(`Session has already expired`);
  if (sessdata.scope !== scope)
    throw new Error(`Incorrect scope '${scope}' for session '${sessionId}'`);

  const store = await prepareAnyForDatabase(data);
  await db<PlatformDB>().updateTable("system.sessions").where("sessionid", "=", sessionId).set(store).execute();
}

/** Close session
 * @param sessionId - Session id to close
 */
export async function closeServerSession(sessionId: string) {
  if (!isWorkOpen())
    throw new Error(`Can only manage sessions inside open work`);

  const sessinfo = await db<PlatformDB>().selectFrom("system.sessions").select(["id", "scope"]).where("sessionid", "=", sessionId).executeTakeFirst();
  if (!sessinfo)
    return; //already gone

  await db<PlatformDB>().deleteFrom("system.sessions").where("id", "=", sessinfo.id).execute();
  if (sessinfo.scope === "platform:uploadsession") //asynchronously delete the upload data dir. ignore exceptions, if files are stuck maintenance  will fix it at some point
    onFinishWork({ onCommit: () => fs.rm(getStorageFolderForSession(sessionId), { recursive: true }).then(() => { }, () => { }) });
}

export interface UploadSessionOptions {
  chunkSize?: number;
  expires?: WaitPeriod;
  baseUrl?: string;
}

/** Create an upload session
 * @param manifest - Manifest of files to upload as prepared by requestFile(s)
 * @param options - Options for the upload session
 * @param options.chunkSize - Chunk size for the upload. This should generally be in the megabyte range
 * @param options.expires - Upload session expiry
*/
export async function createUploadSession(manifest: UploadManifest, { chunkSize = DefaultChunkSize, expires = DefaultUploadExpiry, baseUrl = "" }: UploadSessionOptions = {}): Promise<UploadInstructions> {
  const sessid = await createServerSession("platform:uploadsession", { manifest, chunkSize }, { expires });
  const relUrl = "/.wh/common/upload/?session=" + sessid;
  return {
    baseUrl: baseUrl ? new URL(relUrl, baseUrl).toString() : relUrl,
    sessionId: sessid,
    chunkSize
  };
}

/* not sure if we need it. it seems that returning a list of Blobs makes live a lot easier
function getUploadedStream(basePath: string, size: number, chunkSize: number): ReadableStream<Uint8Array> {
  const numChunks = Math.ceil(size / chunkSize);

  let curChunk = 0;
  let curFile: fs.FileHandle | null = null;

  return new ReadableStream({
    type: "bytes",
    pull: async (controller: ReadableByteStreamController) => {
      /* TODO fill byobRequest for zero-copy transfers. see also https://developer.mozilla.org/en-US/docs/Web/API/Streams_API/Using_readable_byte_streams#underlying_pull_source_with_byte_reader
              tried that but rean into issues with curfile.read expecting a NodeJS.ArrayBufferView which is incompatible with ArrayBufferView  controller.byobRequest?.view
         * /
      while (curChunk < numChunks) {
        if (!curFile)
          curFile = await fs.open(basePath + (curChunk * chunkSize) + '.dat');

        const block = await curFile!.read({ length: 16384 });
        if (block.bytesRead !== 0) {
          controller.enqueue(block.bytesRead === 16384 ? block.buffer : block.buffer.subarray(0, block.bytesRead));
          return;
        }

        //end of file
        curFile!.close();
        curFile = null;
        ++curChunk;
      }
      controller.close();
    },
    cancel: async () => {
      curFile?.close();
      curFile = null;
    }
  });
}
*/

export function getStorageFolderForSession(sessionId: string): string {
  return toFSPath(`storage::platform/uploads/${sessionId}/`);
}

// Get uploaded file disk details - shared with the HS implementation
export async function getUploadedFileDetails(token: string) {
  const [sessionId, fileIndexStr] = token.split("#");
  const fileIndex = parseInt(fileIndexStr);
  const matchsession = await getServerSession("platform:uploadsession", sessionId);
  const matchfile = matchsession?.manifest.files[fileIndex];
  if (!matchfile)
    return null;

  return {
    fileName: matchfile.name,
    size: matchfile.size,
    mediaType: matchfile.type,
    basePath: `${getStorageFolderForSession(sessionId)}file-${fileIndex}-`,
    chunkSize: matchsession.chunkSize
  };
}

/** Retrieve an uploaded file by its token */
export async function getUploadedFile(token: string): Promise<File> {
  const details = await getUploadedFileDetails(token);
  if (!details)
    throw new Error("File not found: " + token);

  const parts: Blob[] = [];
  for (let pos = 0; pos < details.size; pos += details.chunkSize)
    parts.push(await openAsBlob(details.basePath + pos + ".dat"));

  return new File(parts, details.fileName, { type: details.mediaType });
}
