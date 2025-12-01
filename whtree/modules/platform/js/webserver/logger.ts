import { RotatingLogFile } from '../logging/rotatinglogfile';
import { backendConfig } from '@mod-system/js/internal/configuration';
import type { WebRequest } from '@webhare/router';

export interface WebServerLogger {
  logRequest(request: WebRequest): void;
}

export class WebServerConsoleLogger implements WebServerLogger {
  logRequest(request: WebRequest) {
    console.log(`${request.method} ${request.url}`);
  }
}

export class WebServerFileLogger implements WebServerLogger {
  accesslog = new RotatingLogFile(backendConfig.dataRoot + "log/access");
  pxllog = new RotatingLogFile(backendConfig.dataRoot + "log/pxl");

  logRequest(request: WebRequest) {
    /* TODO
    {"@timestamp":"2025-11-27T00:00:00.311Z","ip":"10.55.55.55","method":"GET","url":"https://webhare.moe.sf.webhare.dev/testoutput/edudex_api/admin/v1/organizations","statusCode":200,"bodySent":278011,"userAgent":"node","mimeType":"application/json","responseTime":0.119902}
    */

    const data = {
      ip: request.clientIp,
      method: request.method,
      url: request.url,
      userAgent: request.headers.get("user-agent") || undefined
    };

    this.accesslog.logStructured(data);

    let isPxl;
    try {
      isPxl = request.localPath.startsWith(".wh/ea/pxl/");
    } catch {
      return; // URL parser failed, probably broken URL. don't log as pxl
    }

    if (isPxl)
      this.pxllog.logStructured(data);
  }
}
