import { dtapStage } from "@webhare/env";
import { readLogLines } from "@webhare/services";
import { buildPxlParser } from "../logging/pxllog";
import { openFileOrFolder } from "@webhare/whfs";
import type { RPCContext } from "@webhare/router";
import { waitForPublishCompletion } from "@webhare/test-backend";

export function filterTestService() {
  /* As we give pretty anonymous users access to potentially sensitive data (eg logs) we should only be avialable on development servers ... and we expect users to protect their dev servers!
     TODO lock up even further by verifying a logged in WebHare user and generate a (shortlived) token for invoking test services - so just access to the WebHare won't be enough ?
          does break Incognito testing though, a middleground may be *either* logged in *or* connecting from a local ip?
  */
  if (dtapStage !== "development")
    throw new Error("FrontendTestService is only available on development servers, we are: " + dtapStage);
}

export const testService = {
  async readLog(context: RPCContext, log: string, start: Date) {
    const outlines = [];
    for await (const line of readLogLines(log, { start: start ? new Date(start) : undefined })) {
      outlines.push(line);
    }
    return outlines;
  },


  async readPxlLog(context: RPCContext, start: Date, session: string) {
    const outlines = [];
    const parser = await buildPxlParser();
    for await (const line of readLogLines("platform:pxl", { start: start ? new Date(start) : undefined })) {
      const parsed = parser.parseLine(line);
      if (!parsed || (session && parsed.sessionid !== session))
        continue;
      outlines.push(parsed);
    }
    return outlines;
  },

  async describeObjRef(context: RPCContext, objref: string) {
    const parts = objref.split('-');
    //The first part is the ID, the second part is a SHA1hash of the creationdate in msecs
    const id = parseInt(parts[0]);
    const fsobj = await openFileOrFolder(id);
    const tohash = id + '-' + Math.floor(fsobj.created.epochMilliseconds / 1000);
    const hash = Buffer.from(await crypto.subtle.digest("SHA-1", Buffer.from(tohash))).toString('base64url').slice(-8);
    if (hash !== parts[1])
      throw new Error("Invalid hash for obj #" + id);

    return { id, whfsPath: fsobj.whfsPath, sitePath: fsobj.sitePath, name: fsobj.name, link: fsobj.link };
  },

  async waitForPublishCompletion(context: RPCContext, args: Parameters<typeof waitForPublishCompletion>) {
    return await waitForPublishCompletion(...args);
  }
};
