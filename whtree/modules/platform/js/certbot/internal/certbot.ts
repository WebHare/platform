import {
  type AcmeAccount,
  AcmeClient,
  AcmeWorkflows,
  type DnsTxtRecord,
  type HttpResource,
} from "@mod-platform/js/certbot/vendor/acme/src/mod";
import { loadlib } from "@webhare/harescript";
import { pick } from "@webhare/std";
import { logError } from "@webhare/services";
import { resolveDns } from "@mod-platform/js/certbot/vendor/acme/src/resolveDns.node";

//TODO remove once we're at TS6
declare global {
  interface Uint8Array {
    /**
     * Converts the `Uint8Array` to a base64-encoded string.
     * @param options If provided, sets the alphabet and padding behavior used.
     * @returns A base64-encoded string.
     */
    toBase64(
      options?: {
        alphabet?: "base64" | "base64url" | undefined;
        omitPadding?: boolean | undefined;
      },
    ): string;

    /**
     * Sets the `Uint8Array` from a base64-encoded string.
     * @param string The base64-encoded string.
     * @param options If provided, specifies the alphabet and handling of the last chunk.
     * @returns An object containing the number of bytes read and written.
     * @throws {SyntaxError} If the input string contains characters outside the specified alphabet, or if the last
     * chunk is inconsistent with the `lastChunkHandling` option.
     */
    setFromBase64(
      string: string,
      options?: {
        alphabet?: "base64" | "base64url" | undefined;
        lastChunkHandling?: "loose" | "strict" | "stop-before-partial" | undefined;
      },
    ): {
      read: number;
      written: number;
    };
  }

  interface Uint8ArrayConstructor {
    /**
     * Creates a new `Uint8Array` from a base64-encoded string.
     * @param string The base64-encoded string.
     * @param options If provided, specifies the alphabet and handling of the last chunk.
     * @returns A new `Uint8Array` instance.
     * @throws {SyntaxError} If the input string contains characters outside the specified alphabet, or if the last
     * chunk is inconsistent with the `lastChunkHandling` option.
     */
    fromBase64(
      string: string,
      options?: {
        alphabet?: "base64" | "base64url" | undefined;
        lastChunkHandling?: "loose" | "strict" | "stop-before-partial" | undefined;
      },
    ): Uint8Array<ArrayBuffer>;
  }
}


export async function getCertifiableHostNames() {
  const allHostNames: string[] = [];
  const config = await loadlib("mod::system/lib/internal/webserver/config.whlib").DownloadWebserverConfig();
  for (const host of config.hosts)
    allHostNames.push(...host.listenhosts);
  return allHostNames;
}

type RequestACMECertificateOptions = {
  /** Email address(es) to associate with the request */
  emails?: string[];
  /** Key pair to use for logging in, if not given, a new account is created */
  keyPair?: CryptoKeyPair;
  /** The key pair algorithm to use signing the certificate, defaults to "ec" */
  keyPairAlgorithm?: "ec" | "rsa" | "rsa-4096";
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
export async function doRequestACMECertificate(directory: string, domains: string[], options?: RequestACMECertificateOptions) {
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
      resolveDns,
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
  public updateDnsRecordsCallback?: RequestACMECertificateOptions["updateDnsRecords"];
  public updateHttpResourcesCallback?: RequestACMECertificateOptions["updateHttpResources"];
  public cleanupCallback?: RequestACMECertificateOptions["cleanup"];

  constructor(
    updateDnsRecordsCallback?: RequestACMECertificateOptions["updateDnsRecords"],
    updateHttpResourcesCallback?: RequestACMECertificateOptions["updateHttpResources"],
    cleanupCallback?: RequestACMECertificateOptions["cleanup"],
  ) {
    this.updateDnsRecordsCallback = updateDnsRecordsCallback;
    this.updateHttpResourcesCallback = updateHttpResourcesCallback;
    this.cleanupCallback = cleanupCallback;
  }

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
