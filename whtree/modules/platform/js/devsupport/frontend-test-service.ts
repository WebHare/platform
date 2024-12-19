import { dtapStage } from "@webhare/env";
import { readLogLines } from "@webhare/services";
import { buildPxlParser } from "../logging/pxllog";


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
}
