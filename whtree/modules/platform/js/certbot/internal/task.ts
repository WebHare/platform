import { systemConfigSchema } from "@mod-platform/generated/wrd/webhare";
import { acme, testCertificate } from "@mod-platform/js/certbot/certbot";
import { doRequestACMECertificate } from "@mod-platform/js/certbot/internal/certbot";
import { ACMEChallengeHandlerBase, type ACMEChallengeHandlerFactory } from "@mod-platform/js/certbot/acmechallengehandler";
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
import { addDuration, pick, regExpFromWildcards } from "@webhare/std";
import { listDirectory } from "@webhare/system-tools";
import { beginWork } from "@webhare/whdb";
import { openFolder } from "@webhare/whfs";
import { stat, unlink } from "node:fs/promises";

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
  error: "noprovider" | "noproviderdirectory" | "hostnotlocal" | "hostconnecterror" | "requesterror" | "testerror" | "error";
  /** Additional error data */
  errorData?: string;
};

export async function requestCertificateTask(req: TaskRequest<{
  certificateId: number;
  domains: string[];
  staging?: boolean;
  testOnly?: boolean;
  debug?: boolean;
}, CertificateRequestResult>): Promise<TaskResponse> {
  await beginWork();

  // Find the relevant certificate provider
  const providers = await systemConfigSchema
    .query("certificateProvider")
    .select([
      "wrdId", "issuerDomain", "acmeDirectory", "accountPrivatekey", "eabKid", "eabHmackey", "email", "allowlist",
      "keyPairAlgorithm", "acmeChallengeHandler"
    ])
    .execute();
  // Split the allowlist into separate domain masks
  const providersWithMasks = providers.map(provider => ({
    ...provider,
    allowlist: provider.allowlist
      .split(" ").filter(_ => _) // split into separate masks
      .sort((a, b) => b.length - a.length) // sort by longest mask first
      .map(_ => regExpFromWildcards(_)), // convert to regexp
  })).sort((a, b) => (b.allowlist[0]?.source.length ?? 0) - (a.allowlist[0]?.source.length ?? 0)); // sort providers by longest mask first
  // Find the first matching provider
  let provider: typeof providersWithMasks[0] | null = null;
  for (const prov of providersWithMasks) {
    // If this provider has an allowlist, every requested host must match one of the allowlist masks
    if (!prov.allowlist.length || req.taskdata.domains.every(host => prov.allowlist.some(regexp => regexp.test(host)))) {
      provider = prov;
      break;
    }
  }
  if (!provider)
    return req.resolveByTemporaryFailure(`No matching certificate provider found matching domains ${req.taskdata.domains.join(", ")}`, { result: {
      success: false,
      error: "noprovider",
      errorData: req.taskdata.domains.join(", "),
    }});

  let directory = provider.acmeDirectory;
  if (!directory) {
    if (provider.issuerDomain === "letsencrypt.org") {
      directory = req.taskdata.staging ? acme.ACME_DIRECTORY_URLS.LETS_ENCRYPT_STAGING : acme.ACME_DIRECTORY_URLS.LETS_ENCRYPT;
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

  let wildcard = false;
  const allHostnames = await loadlib("mod::system/lib/internal/webserver/certbot.whlib").GetCertifiableHostnames() as string[];
  for (const domain of req.taskdata.domains) {
    if (domain.includes("*")) {
      wildcard = true;
    } else {
      //FIXME: Check if DNS for domains points to this server?
      if (!allHostnames.includes(domain.toUpperCase())) {
        return req.resolveByPermanentFailure(`Domain '${domain}' not hosted by this installation`, { result: {
          success: false,
          error: "hostnotlocal",
          errorData: domain,
        }});
      }
    }
  }

  using mutex = await lockMutex(`platform:certbot`);
  void(mutex);

  let result: Awaited<ReturnType<typeof doRequestACMECertificate>>;
  try {
    if (req.taskdata.debug)
      logDebug("platform:certbot", {
        "#what": "request",
        directory,
        domains: req.taskdata.domains,
        provider: provider.issuerDomain,
        // For wildcard certificates, use dns-01, otherwise use http-01 challenges
        dnsChallenge: wildcard,
        httpChallenge: !wildcard,
      });
    result = await doRequestACMECertificate(directory, req.taskdata.domains, {
      emails: provider.email ? [provider.email] : undefined,
      keyPair,
      keyPairAlgorithm: provider.keyPairAlgorithm ?? "rsa",
      kid: provider.eabKid ? provider.eabKid : undefined,
      hmacKey: provider.eabHmackey ? provider.eabHmackey : undefined,
      updateDnsRecords: wildcard ? updateDnsRecords.bind(null, provider.acmeChallengeHandler, req.taskdata.debug ?? false) : undefined,
      updateHttpResources: !wildcard ? updateHttpResources.bind(null, provider.acmeChallengeHandler, req.taskdata.debug ?? false) : undefined,
      cleanup: cleanup.bind(null, provider.acmeChallengeHandler, req.taskdata.debug ?? false),
    });
  } catch(e) {
    logError(e as Error);
    return req.resolveByPermanentFailure((e as Error).message, { result: {
      success: false,
      error: "requesterror",
      errorData: (e as Error).message.split("\n")[0],
    }});
  }

  const certificate = result.certificate;
  const certKeyPair = await acme.CryptoKeyUtils.exportKeyPairToPem(result.certKeyPair);
  const accountKeyPair = await acme.CryptoKeyUtils.exportKeyPairToPem(result.accountKeyPair);

  // Check the certificate
  const test = await testCertificate(certificate, { privateKey: certKeyPair.privateKey, checkFullChain: !req.taskdata.staging && !req.taskdata.testOnly });
  if (!test.success) {
    return req.resolveByTemporaryFailure(`Invalid certificate received: ${test.error}`, { result: {
      success: false,
      error: "testerror",
      errorData: test.error,
    }});
  }

  if (req.taskdata.staging || req.taskdata.testOnly) {
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
    let certFolder = await openFolder(req.taskdata.certificateId, { allowMissing: true });
    if (!certFolder) {
      // Create the certificate folder
      const keystore = await openFolder("/webhare-private/system/keystore");
      certFolder = await keystore.createFolder(`certbot-${req.taskdata.domains[0]}`.replaceAll("*", "_wildcard") + "-" + new Date().toISOString().slice(0, -5).replaceAll(/[-:]/g, "").replace("T", "-"));
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
