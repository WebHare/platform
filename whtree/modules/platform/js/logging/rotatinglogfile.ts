import { type LoggableRecord, formatLogObject } from '@webhare/services/src/logmessages';
import * as fs from 'node:fs';

export class RotatingLogFile {
  readonly basepath;
  private lastdate = '';
  private logfd = 0;
  private readonly stdout;

  constructor(basepath: string | null, { stdout }: { stdout?: boolean } = {}) {
    this.basepath = basepath;
    this.stdout = stdout || false;
  }

  log(line: string, data?: LoggableRecord) {
    //TODO escape any control characters in 'line
    const date = (new Date).toISOString();
    if (this.stdout)
      console.log(`[${date}] ${line}`);

    if (!this.basepath)
      return; //not atually logging to a file

    const day = date.substring(0, 10); //YYYY-MM-DD

    if (this.lastdate !== day || !this.logfd) {
      if (this.logfd)
        fs.close(this.logfd, () => { });

      this.logfd = fs.openSync(`${this.basepath}.${day.replaceAll('-', '')}.log`, 'a');
      this.lastdate = day;
    }

    fs.writeFile(this.logfd, formatLogObject(date, { message: line, ...data }) + '\n', () => { });
  }
}
