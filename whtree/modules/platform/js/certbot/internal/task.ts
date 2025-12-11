import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { systemConfigSchema } from "@mod-platform/generated/wrd/webhare";
import { acme, testCertificate } from "@mod-platform/js/certbot/certbot";
import { doRequestACMECertificate, getCertifiableHostNames } from "@mod-platform/js/certbot/internal/certbot";
import { ACMEChallengeHandlerBase, type ACMEChallengeHandlerFactory } from "@mod-platform/js/certbot/acmechallengehandler";
import { listStoredKeyPairs, openStoredKeyPair } from "@mod-platform/js/webserver/keymgmt";
import { loadlib } from "@webhare/harescript";
import {
  backendConfig,
  importJSFunction,
  lockMutex,
  logDebug,
  logError,
  resolveResource,
  ResourceDescriptor,
  type TaskRequest,
  type TaskResponse,
} from "@webhare/services";
import { getAllModuleYAMLs } from "@webhare/services/src/moduledefparser";
import { addDuration, pick, regExpFromWildcards, toCamelCase, type ToSnakeCase } from "@webhare/std";
import { listDirectory } from "@webhare/system-tools";
import { beginWork, db } from "@webhare/whdb";
import { openFolder } from "@webhare/whfs";
import { stat, unlink } from "node:fs/promises";

type StoredKeyPairProps = Awaited<ReturnType<typeof listStoredKeyPairs>>[0];
type StoredKeyPair = Awaited<ReturnType<typeof openStoredKeyPair>>;

async function getBestCertificateForHost(keyPairs: StoredKeyPairProps[], hostname: string) {
  let bestCert: StoredKeyPair | null = null;
  const name = hostname.toLowerCase();
  for (const { id, hasCertificate } of keyPairs) {
    if (!hasCertificate)
      continue;
    const keyPair = await openStoredKeyPair(id);
    const isMatch = await isCertificateForHostname(keyPair, name);
    if (isMatch) {
      if (bestCert) {
        const bestCertValidTo = await bestCert.getValidTo();
        const keyPairValidTo = await keyPair.getValidTo();
        if (bestCertValidTo && (!keyPairValidTo || bestCertValidTo >= keyPairValidTo))
          continue;
      }
      bestCert = keyPair;
    }
  }
  return bestCert;
}

async function isCertificateForHostname(keyPair: StoredKeyPair, hostname: string) {
  const name = hostname.toLowerCase();
  const dnsNames = await keyPair.getDNSNames();
  if (dnsNames.includes(name))
    return true;

  const firstname = hostname.split(".")[0];

  /* Check for matches with wildcard dnsaltnames
      a.b.c matches *.b.c
      *.b.c matches *.b.c
      x.a.b.c does not match *.b.c
      a.*.c does not match *.b.c
  */
  for (const sname of dnsNames)
    if (sname.startsWith("*.") && name === firstname + sname.substring(1))
      return true;

  return false;
}

export type CertificateRequestResult = {
  /** The request was successful */
  success: true;
  /** The id of the certificate/key pair that was updated/created */
  certificateId: number;
  /** For staging requests, the result certificate */
  certificate?: string;
  /** For staging requests, the result private key */
  privateKey?: string;
} | {
  /** The request was not successful */
  success: false;
  /** The error code */
  error: "nodomains" | "certificateobsolete" | "noprovider" | "noproviderdirectory" | "hostnotlocal" | "hostconnecterror" | "requesterror" | "testerror" | "error";
  /** Additional error data */
  errorData?: string;
};

type CertificateRequestData = {
  certificateId?: number;
  domains?: string[];
  isRenewal?: boolean;
  staging?: boolean;
  testOnly?: boolean;
  debug?: boolean;
};

export async function requestCertificateTask(req: TaskRequest<ToSnakeCase<CertificateRequestData>, CertificateRequestResult>): Promise<TaskResponse> {
  const taskdata = toCamelCase(req.taskdata);
  await beginWork();

  // Find the domains to request certificates for
  const domains = taskdata.domains ?? [];
  const storedKeyPair = taskdata.certificateId ? await openStoredKeyPair(taskdata.certificateId) : null;
  if (storedKeyPair) {
    const checkDate = addDuration(new Date, { days: 30 });
    const validUntil = await storedKeyPair.getValidTo();
    if (taskdata.debug)
      logDebug("platform:certbot", {
        "#what": "Check stored key pair",
      });
    if (validUntil && validUntil > checkDate) {
      if (taskdata.isRenewal) {
        return req.resolveByPermanentFailure("Certificate not up for renewal", { result: {
          success: false,
          error: "stillvalid",
          errorData: validUntil.toISOString(),
        }});
      }
    }
  } else if (taskdata.certificateId)
    return req.resolveByPermanentFailure("Certificate not found", { result: {
      success: false,
      error: "nodomains",
      errorData: taskdata.certificateId.toString(),
    }});
  if (!domains.length && storedKeyPair)
    domains.push(...(await storedKeyPair.getDNSNames()));

  // Check the requested domains with the certificate
  const allCerts = await listStoredKeyPairs();
  const allHostnames = await getCertifiableHostNames();
  const requestDomains: string[] = [];
  const skippedDomains: string[] = [];
  let setupReplacement = 0;
  for (const host of domains) {
    if (storedKeyPair) {
      const best = await getBestCertificateForHost(allCerts, host);
      if (best && best.id !== storedKeyPair.id) {
        skippedDomains.push(`Certificate '${best.name}' for '${host}'`);
        setupReplacement = best.id;
        continue;
      }
    }

    if (!host.startsWith("*.") && !allHostnames.includes(host.toUpperCase())) {
      skippedDomains.push(`Hostname '${host}' is no longer hosted here`);
      continue;
    }

    requestDomains.push(host);
  }
  if (!requestDomains.length) {
    if (storedKeyPair) {
      // We are no longer hosting this site
      // Link the port up to a new key/certificate. note that this generally only happens on non-proxied WebHares that don't do SNI anyway
      const result = await db<PlatformDB>()
        .selectFrom("system.ports")
        .select("id")
        .where("keypair", "=", storedKeyPair.id)
        .executeTakeFirst();
      if (result) {
        if (!setupReplacement) {
          return req.resolveByPermanentFailure(`Certificate '${storedKeyPair.name}' is no longer needed here but still referred by a SSL port!`, { result: {
            success: false,
            error: "certificateobsolete",
            errorData: skippedDomains.join("; "),
          }});
        }
      }

      const certFolder = await openFolder(storedKeyPair.id);
      await certFolder.recycle();
      await db<PlatformDB>()
        .updateTable("system.ports")
        .where("keypair", "=", storedKeyPair.id)
        .set({ keypair: setupReplacement })
        .execute();
    }

    return req.resolveByPermanentFailure("No domains to request certificate for", { result: {
      success: false,
      error: "nodomains",
      errorData: skippedDomains.join("; "),
    }});
  }

  // Find the relevant certificate provider
  const providers = await systemConfigSchema
    .query("certificateProvider")
    .select([
      "wrdId", "issuerDomain", "acmeDirectory", "accountPrivatekey", "eabKid", "eabHmackey", "email", "allowlist",
      "keyPairAlgorithm", "acmeChallengeHandler", "skipConnectivityCheck", "wrdOrdering"
    ])
    .execute();
  // Split the allowlist into separate domain masks
  const providersWithMasks = providers.map(provider => ({
    ...provider,
    allowlist: provider.allowlist
      .split(" ").filter(_ => _) // split into separate masks
      .map(_ => regExpFromWildcards(_)), // convert to regexp
  })).sort((a, b) => a.wrdOrdering - b.wrdOrdering); // sort by ordering
  // Find the first matching provider
  let provider: typeof providersWithMasks[0] | null = null;
  for (const prov of providersWithMasks) {
    // If this provider has an allowlist, every requested host must match one of the allowlist masks
    if (!prov.allowlist.length || requestDomains.every(host => prov.allowlist.some(regexp => regexp.test(host)))) {
      provider = prov;
      break;
    }
  }
  if (!provider)
    return req.resolveByTemporaryFailure(`No matching certificate provider found matching domains ${requestDomains.join(", ")}`, { result: {
      success: false,
      error: "noprovider",
      errorData: requestDomains.join(", "),
    }});

  let directory = provider.acmeDirectory;
  if (!directory) {
    if (provider.issuerDomain === "letsencrypt.org") {
      directory = taskdata.staging ? acme.ACME_DIRECTORY_URLS.LETS_ENCRYPT_STAGING : acme.ACME_DIRECTORY_URLS.LETS_ENCRYPT;
    }
  }
  if (!directory)
    return req.resolveByTemporaryFailure(`No directory for provider ${provider.issuerDomain}`, { nextRetry: null, result: {
      success: false,
      error: "noproviderdirectory",
      errorData: provider.issuerDomain,
    }});

  let keyPair: CryptoKeyPair | undefined = undefined;
  if (provider.accountPrivatekey)
    keyPair = await acme.CryptoKeyUtils.importKeyPairFromPemPrivateKey(await provider.accountPrivatekey.resource.text());

  // Check if any of the domains is a wildcard domain (in which case we need to use DNS challenge) and if all non-wildcard
  // domains are reachable
  let wildcard = false;
  for (const domain of requestDomains) {
    if (domain.includes("*")) {
      wildcard = true;
    } else if (!provider.skipConnectivityCheck) {
      const myUuid = await loadlib("mod::system/lib/internal/webserver/config.whlib").GenerateWebserverUUID();
      try {
        const response = await fetch(`http://${domain}/.webhare/direct/system/uuid.shtml`, { signal: AbortSignal.timeout(2000) });
        if (!response.ok)
          return req.resolveByPermanentFailure(`Error while checking domain '${domain}' connectivity: ${response.statusText.substring(0, 512) || "Unknown error"}`, { result: {
            success: false,
            error: "hostconnecterror",
            errorData: response.statusText.substring(0, 512) || "Unknown error",
          }});
        const serverUuid = await response.text();
        if (serverUuid !== myUuid) {
          if (taskdata.debug)
            logDebug("platform:certbot", { "#what": "Server mismatch", myUuid, serverUuid });
          return req.resolveByPermanentFailure(`Domain '${domain}' not hosted by this installation`, { result: {
            success: false,
            error: "hostnotlocal",
            errorData: domain,
          }});
        }
      } catch (e) {
        return req.resolveByPermanentFailure(`Error while checking domain '${domain}' connectivity: ${(e as Error).message}`, { result: {
          success: false,
          error: "hostconnecterror",
          errorData: (e as Error).message,
        }});
      }
    }
  }

  // Request the certificate
  using mutex = await lockMutex(`platform:certbot`);
  void(mutex);

  let result: Awaited<ReturnType<typeof doRequestACMECertificate>>;
  try {
    if (taskdata.debug)
      logDebug("platform:certbot", {
        "#what": "request",
        directory,
        domains: requestDomains,
        provider: provider.issuerDomain,
        // For wildcard certificates, use dns-01, otherwise use http-01 challenges
        dnsChallenge: wildcard,
        httpChallenge: !wildcard,
        skippedDomains,
      });
    result = await doRequestACMECertificate(directory, requestDomains, {
      emails: provider.email ? [provider.email] : undefined,
      keyPair,
      keyPairAlgorithm: provider.keyPairAlgorithm ?? "rsa",
      kid: provider.eabKid ? provider.eabKid : undefined,
      hmacKey: provider.eabHmackey ? provider.eabHmackey : undefined,
      updateDnsRecords: wildcard ? updateDnsRecords.bind(null, provider.acmeChallengeHandler, taskdata.debug ?? false) : undefined,
      updateHttpResources: !wildcard ? updateHttpResources.bind(null, provider.acmeChallengeHandler, taskdata.debug ?? false) : undefined,
      cleanup: cleanup.bind(null, provider.acmeChallengeHandler, taskdata.debug ?? false),
    });
  } catch(e) {
    logError(e as Error);

    let errorData = (e as Error).message;
    //FIXME: Maybe have the acme client throw the error in a nice error structure instead of having to string match the error and parse the error text as JSON?
    if (errorData.startsWith(`Order status is "invalid"\n`)) {
      // The error thrown is `Order status is "invalid"\n${JSON.stringify(latestOrderResponse, null, 2)}` and we're
      // interested in the latestOrderResponse. That doesn't contain the error itself, but we can request that by fetching
      // the authorization url.
      try {
        const order = JSON.parse(errorData.substring(26)) as acme.AcmeOrderObjectSnapshot;
        // Fetch the (first) authorization status
        const response = await fetch(order.authorizations[0]);
        if (response.ok) {
          const authorization = await response.json() as acme.AcmeAuthorizationObjectSnapshot;
          // The 'error' field (which contains the actual challenge validation error) is not defined in AcmeChallengeObjectSnapshot
          const error = authorization.challenges
            .filter(_ => "error" in _)
            .map(_ => _.error)[0] as { "type": string; "detail": string; "status": number } | undefined;
          // Use the error detail as the actual error data
          if (error)
            errorData = error.detail;
        }
      } catch(_) {}
    }
    return req.resolveByPermanentFailure((e as Error).message, { result: {
      success: false,
      error: "requesterror",
      errorData,
    }});
  }

  const certificate = result.certificate;
  const certKeyPair = await acme.CryptoKeyUtils.exportKeyPairToPem(result.certKeyPair);
  const accountKeyPair = await acme.CryptoKeyUtils.exportKeyPairToPem(result.accountKeyPair);

  // Check the certificate
  const test = await testCertificate(certificate, { privateKey: certKeyPair.privateKey, checkFullChain: !taskdata.staging && !taskdata.testOnly });
  if (!test.success) {
    return req.resolveByTemporaryFailure(`Invalid certificate received: ${test.error}`, { result: {
      success: false,
      error: "testerror",
      errorData: test.error,
    }});
  }

  if (taskdata.staging || taskdata.testOnly) {
    // Don't actually update the certificate and private keys, but return them in the task result for inspection
    return req.resolveByCompletion({
      success: true,
      certificateId: 0,
      certificate,
      privateKey: certKeyPair.privateKey,
    });
  }

  try {
    // Store the certificate and its private key
    let certFolder = storedKeyPair ? await openFolder(storedKeyPair.id, { allowMissing: true }) : null;
    if (!certFolder) {
      // Create the certificate folder
      const keystore = await openFolder("/webhare-private/system/keystore");
      certFolder = await keystore.createFolder(`certbot-${requestDomains[0]}`.replaceAll("*", "_wildcard") + "-" + new Date().toISOString().slice(0, -5).replaceAll(/[-:]/g, "").replace("T", "-"));
    }
    const certFile = await certFolder.ensureFile("certificatechain.pem", { type: "http://www.webhare.net/xmlns/publisher/plaintextfile" });
    await certFile.update({ data: await ResourceDescriptor.from(certificate) });
    const certKeyPairFile = await certFolder.ensureFile("privatekey.pem", { type: "http://www.webhare.net/xmlns/publisher/plaintextfile" });
    await certKeyPairFile.update({ data: await ResourceDescriptor.from(certKeyPair.privateKey) });

    // Store the account private key if new or updated
    const resource = await ResourceDescriptor.from(accountKeyPair.privateKey);
    if (!provider.accountPrivatekey || provider.accountPrivatekey.hash !== resource.hash)
      await systemConfigSchema.update("certificateProvider", provider.wrdId, { accountPrivatekey: resource });

    return req.resolveByCompletion({
      success: true,
      certificateId: certFolder.id,
    });
  } catch(e) {
    logError(e as Error);
    return req.resolveByPermanentFailure((e as Error).message, { result: {
      success: false,
      error: "storeerror",
      errorData: (e as Error).message,
    }});
  }
}

async function updateDnsRecords(acmeChallengeHandler: string, debug: boolean, dnsRecord: acme.DnsTxtRecord[]) {
  const handler = await createACMEChallengeHandler(acmeChallengeHandler, debug);

  try {
    await handler.setupDNSChallenge(dnsRecord);
    if (debug)
      logDebug("platform:certbot", { "#what": "update dns records", dnsRecords: dnsRecord.map(_ => pick(_, ["domain", "wildcard", "name"])) });
  } catch (e) {
    logError(e as Error);
    if (debug)
      logDebug("platform:certbot", { "#what": "update dns records error", dnsRecords: dnsRecord.map(_ => pick(_, ["domain", "wildcard", "name"])), error: (e as Error).message });
  }
}

async function updateHttpResources(acmeChallengeHandler: string, debug: boolean, httpResource: acme.HttpResource[]) {
  const handler = await createACMEChallengeHandler(acmeChallengeHandler, debug);

  try {
    await handler.setupHTTPChallenge(httpResource);
    if (debug)
      logDebug("platform:certbot", { "#what": "update http resources", httpResources: httpResource.map(_ => pick(_, ["domain", "wildcard", "name"])) });
  } catch (e) {
    logError(e as Error);
    if (debug)
      logDebug("platform:certbot", { "#what": "update http resources error", httpResources: httpResource.map(_ => pick(_, ["domain", "wildcard", "name"])), error: (e as Error).message });
  }
}

async function cleanup(acmeChallengeHandler: string, debug: boolean, challenge: {
  dnsRecords?: acme.DnsTxtRecord[];
  httpResources?: acme.HttpResource[];
}) {
  const handler = await createACMEChallengeHandler(acmeChallengeHandler, debug);

  if (challenge.httpResources) {
    if (debug)
      logDebug("platform:certbot", { "#what": "cleanup http resources", httpResources: challenge.httpResources.map(_ => _.name) });
    try {
      await handler.cleanupHTTPChallenge(challenge.httpResources);
    } catch (e) {
      logError(e as Error);
    }
  }
  if (challenge.dnsRecords) {

    if (debug)
      logDebug("platform:certbot", { "#what": "cleanup dns records", dnsRecords: challenge.dnsRecords.map(_ => _.name) });
    try {
      await handler.cleanupDNSChallenge(challenge.dnsRecords);
    } catch (e) {
      logError(e as Error);
    }
  }
}

async function createACMEChallengeHandler(acmeChallengeHandler: string, debug: boolean) {
  // Initialize the ACME challenge handler
  if (debug)
    logDebug("platform:certbot", { "#what": "initialize challenge handler", acmeChallengeHandler });
  const module = acmeChallengeHandler.split(":")[0];
  const handler = acmeChallengeHandler.substring(module.length + 1);
  for (const modyml of await getAllModuleYAMLs())
    if (modyml.module === module && modyml.acmeChallengeHandlers)
      if (handler in modyml.acmeChallengeHandlers) {
        const factory = resolveResource(modyml.baseResourcePath, modyml.acmeChallengeHandlers[handler].handlerFactory);
        return (await importJSFunction<ACMEChallengeHandlerFactory>(factory))({ debug });
      }
  return new ACMEChallengeHandlerBase({ debug });
}

export async function cleanupOutdatedHttpResources(debug?: boolean) {
  const cacheFiles = await listDirectory(`${backendConfig.dataRoot}caches/platform/acme/`, { allowMissing: true });
  // Delete http challenge resources older than one hour
  const threshold = addDuration(new Date(), { hours: -1 });
  const httpResources: string[] = [];
  for (const file of cacheFiles) {
    if (file.name.startsWith("."))
      continue;
    if ((await stat(file.fullPath)).mtime < threshold) {
      httpResources.push(file.name);
      await unlink(file.fullPath);
    }
  }
  if (debug)
    logDebug("platform:certbot", { "#what": "cleaned up outdated http resources", httpResources });
}
