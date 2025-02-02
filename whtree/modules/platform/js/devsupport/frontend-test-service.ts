import { dtapStage } from "@webhare/env";
import { readLogLines } from "@webhare/services";
import { buildPxlParser } from "../logging/pxllog";
import { openFileOrFolder } from "@webhare/whfs";


export class FrontendTestService {
  constructor() {
    //as we give pretty anonymous users access to potentially sensitive data (eg logs) we should only be avialable on development servers ... and we expect users to protect their dev servers!
    //FIXME switch/add to having the testpage generate a shortlived token and require that as authtoken or httponly cookie
    if (dtapStage !== "development")
      throw new Error("FrontendTestService is only available on development servers");
  }

  async readPxlLog(start: string, session: string) {
    const outlines = [];
    const parser = await buildPxlParser();
    for await (const line of readLogLines("platform:pxl", { start: start ? new Date(start) : undefined })) {
      const parsed = parser.parseLine(line);
      if (!parsed || (session && parsed.sessionid !== session))
        continue;
      outlines.push(parsed);
    }
    return outlines;
  }

  async describeObjRef(objref: string) {
    const parts = objref.split('.');
    //The first part is the ID, the second part is a SHA1hash of the creationdate in msecs
    const id = parseInt(parts[0]);
    const fsobj = await openFileOrFolder(id);
    const tohash = String(fsobj.creationDate.epochMilliseconds);
    const hash = Buffer.from(await crypto.subtle.digest("SHA-1", Buffer.from(tohash))).toString('base64url').slice(-6);
    if (hash !== parts[1])
      throw new Error("Invalid hash for obj #" + id);

    return { id, whfsPath: fsobj.whfsPath, sitePath: fsobj.sitePath, name: fsobj.name, link: fsobj.link };
  }
}
