import { pick } from "@webhare/std";
import {
  type AcmeAccount,
  AcmeClient,
  AcmeWorkflows,
  type DnsTxtRecord,
  type HttpResource,
} from "@mod-platform/js/certbot/vendor/acme/src/mod";
import { logError } from "@webhare/services";

export * as acme from "./vendor/acme/src/mod";

type RequestACMECertificateOptions = {
  /** Email address(es) to associate with the request */
  emails?: string[];
  /** Key pair to use for logging in, if not given, a new account is created */
  keyPair?: CryptoKeyPair;
  /** The key pair algorithm to use signing the certificate, defaults to "ec" */
  keyPairAlgorithm?: "ec" | "rsa";
  /** If both kid and hmacKey are set, use these for external account binding */
  kid?: string;
  /** Base64url encoded HMAC key */
  hmacKey?: string;
  /** When set, called with the expected "dns-01" challenge info before the challenges are submitted for verification */
  updateDnsRecords?: (dnsRecords: DnsTxtRecord[]) => Promise<void>;
  /** When set, called with the expected "http-01" challenge info before the challenges are submitted for verification */
  updateHttpResources?: (httpResource: HttpResource[]) => Promise<void>;
  /** Called after the challenges have been verified */
  cleanup?: (challenge: {
    dnsRecords?: DnsTxtRecord[];
    httpResources?: HttpResource[];
  }) => Promise<void>;
  /** The number of milliseconds to wait after the DnsRecords are confirmed by the client before submitting the challenge */
  delayAfterDnsRecordsConfirmed?: number;
  /** The number of milliseconds to poll resources */
  timeout?: number;
  /** Log debug messages to console */
  debug?: boolean;
};

/** Request a certificate for one or more domains
    @param directory - The ACME directory url to use
    @param domains - The domain(s) to request certificates for, if multiple domains are supplied, the first will be the main
           domain and the other domains will be added as alternative domains
    @param options - Options
    @returns PEM-encoded certificate chain, certificate key pair and account key pair
 */
export async function requestACMECertificate(directory: string, domains: string[], options?: RequestACMECertificateOptions) {
  // Initialize the client and create an account and order
  const acmeClient = await AcmeClient.init(directory);
  const emails = options?.emails ?? [];
  let acmeAccount: AcmeAccount | null = null;
  if (options?.keyPair) {
    try {
      acmeAccount = await acmeClient.login({
        keyPair: options.keyPair,
        keyPairAlgorithm: options?.keyPairAlgorithm,
      });
    } catch (e) {
      logError(e as Error);
    }
  }
  // If there's not existing account key pair or login failed, create a new account
  if (!acmeAccount)
    acmeAccount = await acmeClient.createAccount({
      emails,
      externalAccountBinding: options?.kid && options.hmacKey ? { kid: options.kid, hmacKey: options.hmacKey } : undefined,
      keyPairAlgorithm: options?.keyPairAlgorithm,
    });

  const updateHandler = new UpdateHandler(
    options?.updateDnsRecords,
    options?.updateHttpResources,
    options?.cleanup,
  );
  try {
    const result = await AcmeWorkflows.requestCertificate({
      acmeAccount,
      domains,
      updateDnsRecords: options?.updateDnsRecords ? (dnsRecord) => updateHandler.updateDnsRecords(dnsRecord) : undefined,
      updateHttpResources: options?.updateHttpResources ? (httpResource) => updateHandler.updateHttpResources(httpResource) : undefined,
      ...(options ? pick(options, ["delayAfterDnsRecordsConfirmed", "timeout"]) : undefined),
    });
    return {
      ...pick(result, ["certificate", "certKeyPair"]),
      accountKeyPair: acmeAccount.keyPair,
    };
  } finally {
    await updateHandler.cleanup();
  }
}

// Helper class to store the challenge data so it can be cleaned up afterwards
class UpdateHandler {
  dnsRecords?: DnsTxtRecord[];
  httpResources?: HttpResource[];

  constructor(
    public updateDnsRecordsCallback?: RequestACMECertificateOptions["updateDnsRecords"],
    public updateHttpResourcesCallback?: RequestACMECertificateOptions["updateHttpResources"],
    public cleanupCallback?: RequestACMECertificateOptions["cleanup"],
  ) {}

  async updateDnsRecords(dnsRecords: DnsTxtRecord[]) {
    this.dnsRecords = dnsRecords;
    if (this.updateDnsRecordsCallback)
      await this.updateDnsRecordsCallback(dnsRecords);
  }

  async updateHttpResources(httpResources: HttpResource[]) {
    this.httpResources = httpResources;
    if (this.updateHttpResourcesCallback)
      await this.updateHttpResourcesCallback(httpResources);
  }

  async cleanup() {
    if (this.cleanupCallback)
      await this.cleanupCallback({
        dnsRecords: this.dnsRecords,
        httpResources: this.httpResources
      });
  }
}
