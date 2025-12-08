import type { acme } from "@mod-platform/js/certbot/certbot";
import { backendConfig, logDebug, logError, type LoggableRecord } from "@webhare/services";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type DnsTxtRecord = acme.DnsTxtRecord;
export type HttpResource = acme.HttpResource;

export type ACMEChallengeHandlerFactory = (context: ACMEChallengeHandlerContext) => ACMEChallengeHandlerBase;

export type ACMEChallengeHandlerContext = { debug: boolean };

export class ACMEChallengeHandlerBase {
  readonly debug: boolean;

  /** Called with the expected DNS TXT records */
  async setupDNSChallenge(_dnsRecord: DnsTxtRecord[]) {
    throw new Error(`ACME challenge handler not configured for DNS challenges`);
  }

  /** Called with the DNS TXT records that can be cleaned up */
  async cleanupDNSChallenge(_dnsRecord: DnsTxtRecord[]) {}

  /** Called with the expected DNS TXT records */
  async setupHTTPChallenge(httpResource: HttpResource[]) {
    const cacheDir = `${backendConfig.dataRoot}caches/platform/acme/`;
    try {
      await mkdir(cacheDir, { recursive: true });
    } catch (e) {
      logError(e as Error);
      return;
    }
    // Create the challenge resources in the acme cache folder (lowercase the name so the webserver will find it)
    for (const res of httpResource) {
      try {
        await writeFile(join(cacheDir, res.name.toLowerCase()), res.content);
      } catch(e) {
        logError(e as Error);
      }
    }
  }

  /** Called with the DNS TXT records that can be cleaned up */
  async cleanupHTTPChallenge(httpResource: HttpResource[]) {
    const cacheDir = `${backendConfig.dataRoot}caches/platform/acme/`;
    for (const res of httpResource) {
      try {
        const cachePath = join(cacheDir, res.name.toLowerCase());
        if (await stat(cachePath))
          await unlink(cachePath);
      } catch(e) {
        logError(e as Error);
      }
    }
  }

  constructor(context: ACMEChallengeHandlerContext) {
    this.debug = context.debug;
  }

  logDebug(what: string, data: LoggableRecord) {
    if (this.debug)
      logDebug("platform:certbot", { "what": what, ...data});
  }
}
