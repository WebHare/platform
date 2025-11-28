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
    const data = {
      ip: request.clientIp,
      method: request.method,
      url: request.url,
      userAgent: request.headers.get("user-agent") || undefined
    };

    this.accesslog.logStructured(data);
    if (request.localPath.startsWith(".wh/ea/pxl/"))
      this.pxllog.logStructured(data);
  }
}
