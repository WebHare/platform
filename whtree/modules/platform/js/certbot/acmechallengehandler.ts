import type { acme } from "@mod-platform/js/certbot/certbot";
import { logDebug, type LoggableRecord } from "@webhare/services";

export type DnsTxtRecord = acme.DnsTxtRecord;

export type ACMEChallengeHandlerFactory = (context: ACMEChallengeHandlerContext) => ACMEChallengeHandlerBase;

export type ACMEChallengeHandlerContext = { debug: boolean };

export abstract class ACMEChallengeHandlerBase {
  readonly debug: boolean;

  /** Called with the expected DNS TXT records */
  setupDNSChallenge(_dnsRecord: DnsTxtRecord[]): Promise<void> | void {}
  /** Called with the DNS TXT records that can be cleaned up */
  cleanupDNSChallenge(_dnsRecord: DnsTxtRecord[]): Promise<void> | void {}

  constructor(context: ACMEChallengeHandlerContext) {
    this.debug = context.debug;
  }

  logDebug(what: string, data: LoggableRecord) {
    if (this.debug)
      logDebug("platform:certbot", { "what": what, ...data});
  }
}
