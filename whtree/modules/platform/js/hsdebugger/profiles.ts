/* HareScript function profiles: profiling a running job through the debugger, and the profiles stored by the 'apr'
   debug tag (written by mod::system/lib/internal/harescript/preload.whlib) */

import { open, readdir, readFile, stat } from "node:fs/promises";
import * as path from "node:path";
import { backendConfig } from "@webhare/services";
import { decodeHSON } from "@webhare/hscompat";
import type { HSDebugConnection } from "./client";
import type { RawFunctionProfile } from "./protocol";

/** Profile a running job for a while. Profiling can only be switched on and off and read while the job is paused, so the
    job is paused briefly at the start and at the end. It is always resumed, also if something fails
    @param conn - Debug manager connection
    @param groupid - Job to profile
    @param options - duration: how long to profile. pauseTimeout: maximum time to wait for the job to pause
*/
export async function profileJob(conn: HSDebugConnection, groupid: string, { duration, pauseTimeout = 5000 }: { duration: number; pauseTimeout?: number }): Promise<RawFunctionProfile> {
  const job = await conn.attach(groupid);
  let profiling = false;
  try {
    await job.pause({ timeout: pauseTimeout });
    try {
      await job.setProfiling("function", true, true);
      profiling = true;
    } finally {
      job.continue();
    }

    await new Promise(resolve => setTimeout(resolve, duration));

    await job.pause({ timeout: pauseTimeout });
    try {
      await job.setProfiling("all", false, false);
      profiling = false;
      return await job.getFunctionProfile();
    } finally {
      job.continue();
    }
  } finally {
    if (profiling && job.attached) { // something failed while profiling, try to switch it off again
      try {
        await job.pause({ timeout: pauseTimeout });
        try {
          await job.setProfiling("all", false, false);
        } finally {
          job.continue();
        }
      } catch {
        // nothing more we can do
      }
    }
    job.detach();
  }
}

/** Header of a stored profile */
export interface StoredProfileHeader {
  type?: string;
  script?: string;
  groupid?: string;
  profilingstart?: string;
  debugcontext?: string;
}

export interface StoredProfileInfo {
  filename: string;
  type: string;
  script: string;
  groupid: string;
  profilingstart: string;
  size: number;
}

function getStoredProfilesRoot() {
  return path.join(backendConfig.dataRoot, "caches/platform/hs-profiles");
}

function checkPathPart(part: string, what: string) {
  if (!part || part.includes("/") || part.includes("\\") || part.startsWith("."))
    throw new Error(`Invalid ${what} '${part}'`);
}

/** List the sessions with stored profiles */
export async function listStoredProfileSessions(): Promise<string[]> {
  try {
    const entries = await readdir(getStoredProfilesRoot(), { withFileTypes: true });
    return entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      return [];
    throw e;
  }
}

function parseStoredProfile(data: Buffer): { header: StoredProfileHeader; body: Buffer } {
  const nl = data.indexOf(10);
  if (nl < 0)
    throw new Error("Not a stored profile");
  return { header: JSON.parse(data.subarray(0, nl).toString("utf-8")) as StoredProfileHeader, body: data.subarray(nl + 1) };
}

/** List the stored profiles of a session, newest first
    @param session - Session name, eg 'default'
    @param options - filter: only return profiles whose file name, script or group id contain this text (case insensitive). limit: maximum number to return
    @returns The profiles and the total number of matching profiles
*/
export async function listStoredProfiles(session: string, { filter = "", limit = 20 }: { filter?: string; limit?: number } = {}): Promise<{ profiles: StoredProfileInfo[]; totalCount: number }> {
  checkPathPart(session, "session");
  const dir = path.join(getStoredProfilesRoot(), session);
  // File names start with a timestamp, so sorting by name puts the newest first
  const files = (await readdir(dir)).filter(name => name.endsWith(".prof")).sort().reverse();
  const needle = filter.toLowerCase();

  const profiles: StoredProfileInfo[] = [];
  let totalCount = 0;
  for (const filename of files) {
    let header: StoredProfileHeader, size: number;
    try {
      const fullpath = path.join(dir, filename);
      size = (await stat(fullpath)).size;
      // The header is the first line; read a limited amount to find it
      const handle = await open(fullpath);
      try {
        const buf = Buffer.alloc(Math.min(size, 256 * 1024));
        await handle.read(buf, 0, buf.length, 0);
        header = parseStoredProfile(buf).header;
      } finally {
        await handle.close();
      }
    } catch {
      continue;
    }

    const row: StoredProfileInfo = {
      filename,
      type: header.type ?? "",
      script: header.script ?? "",
      groupid: header.groupid ?? "",
      profilingstart: header.profilingstart ?? "",
      size
    };
    if (needle && !`${row.filename}\t${row.script}\t${row.groupid}`.toLowerCase().includes(needle))
      continue;
    ++totalCount;
    if (profiles.length < limit)
      profiles.push(row);
  }
  return { profiles, totalCount };
}

/** Read a stored profile */
export async function readStoredProfile(session: string, filename: string): Promise<{ header: StoredProfileHeader; rawdata: RawFunctionProfile }> {
  checkPathPart(session, "session");
  checkPathPart(filename, "file name");
  const { header, body } = parseStoredProfile(await readFile(path.join(getStoredProfilesRoot(), session, filename)));
  return { header, rawdata: decodeHSON(body.toString("utf-8").trim()) as unknown as RawFunctionProfile };
}
