import { type LoggableRecord, formatLogObject } from '@webhare/services/src/logmessages';
import * as fs from 'node:fs';

export type RotatingLogFileOptions = {
  /** Log to stdout too? */
  stdout?: boolean;
  /** Callback when a new log file is opened after having already logged some entries */
  onNextFile?: (logfile: RotatingLogFile) => void;
  /** Callback when a log file is closed, use to clarify that the log was not truncated */
  onCloseFile?: (logfile: RotatingLogFile) => void;
};

export class RotatingLogFile {
  readonly basepath: string | null;
  private lastdate = '';
  private logfd = 0;
  private readonly stdout;
  private onNextFile;
  private onCloseFile;

  constructor(basepath: string | null, options?: RotatingLogFileOptions) {
    this.basepath = basepath;
    this.stdout = options?.stdout || false;
    this.onNextFile = options?.onNextFile;
    this.onCloseFile = options?.onCloseFile;
  }

  log(line: string, data?: LoggableRecord) {
    this.__log(line, data);
  }

  logStructured(data: LoggableRecord) {
    this.__log(null, data);
  }

  __log(line: null | string, data?: LoggableRecord) {
    const date = (new Date).toISOString();

    if (this.basepath) {
      const day = date.substring(0, 10); //YYYY-MM-DD
      // const day = date.substring(0, 19).replaceAll(':', '-'); //for testing - rotate every second

      if (this.lastdate !== day || !this.logfd) {
        const alreadylogged = Boolean(this.logfd);

        this.lastdate = day; //update to prevent jumping straight back into the logrotation code
        if (this.logfd) {
          this.onCloseFile?.(this); //any log entries generated will still go to the current file
          fs.close(this.logfd, () => { });
        }

        this.logfd = fs.openSync(`${this.basepath}.${day.replaceAll('-', '')}.log`, 'a');
        if (alreadylogged)
          this.onNextFile?.(this);
      }
    }

    if (this.stdout)
      console.log(`[${date}] ${line ?? formatLogObject(null, data || {})}`);

    if (line !== null)
      data = { message: line, ...data };

    if (this.basepath)
      fs.writeFile(this.logfd, formatLogObject(date, data || {}) + '\n', () => { });
  }
}
