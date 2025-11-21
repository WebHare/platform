import { systemConfigSchema } from "@mod-platform/generated/wrd/webhare";
import { acme, requestACMECertificate } from "@mod-platform/js/certbot/certbot";
import {
  backendConfig,
  lockMutex,
  logDebug,
  logError,
  ResourceDescriptor,
  type TaskRequest,
  type TaskResponse,
} from "@webhare/services";
import { addDuration, pick, regExpFromWildcards } from "@webhare/std";
import { listDirectory } from "@webhare/system-tools";
import { beginWork } from "@webhare/whdb";
import { openFolder } from "@webhare/whfs";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const letsencryptRootCertificate =
`-----BEGIN CERTIFICATE-----
MIIDSjCCAjKgAwIBAgIQRK+wgNajJ7qJMDmGLvhAazANBgkqhkiG9w0BAQUFADA/
MSQwIgYDVQQKExtEaWdpdGFsIFNpZ25hdHVyZSBUcnVzdCBDby4xFzAVBgNVBAMT
DkRTVCBSb290IENBIFgzMB4XDTAwMDkzMDIxMTIxOVoXDTIxMDkzMDE0MDExNVow
PzEkMCIGA1UEChMbRGlnaXRhbCBTaWduYXR1cmUgVHJ1c3QgQ28uMRcwFQYDVQQD
Ew5EU1QgUm9vdCBDQSBYMzCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEB
AN+v6ZdQCINXtMxiZfaQguzH0yxrMMpb7NnDfcdAwRgUi+DoM3ZJKuM/IUmTrE4O
rz5Iy2Xu/NMhD2XSKtkyj4zl93ewEnu1lcCJo6m67XMuegwGMoOifooUMM0RoOEq
OLl5CjH9UL2AZd+3UWODyOKIYepLYYHsUmu5ouJLGiifSKOeDNoJjj4XLh7dIN9b
xiqKqy69cK3FCxolkHRyxXtqqzTWMIn/5WgTe1QLyNau7Fqckh49ZLOMxt+/yUFw
7BZy1SbsOFU5Q9D8/RhcQPGX69Wam40dutolucbY38EVAjqr2m7xPi71XAicPNaD
aeQQmxkqtilX4+U9m5/wAl0CAwEAAaNCMEAwDwYDVR0TAQH/BAUwAwEB/zAOBgNV
HQ8BAf8EBAMCAQYwHQYDVR0OBBYEFMSnsaR7LHH62+FLkHX/xBVghYkQMA0GCSqG
SIb3DQEBBQUAA4IBAQCjGiybFwBcqR7uKGY3Or+Dxz9LwwmglSBd49lZRNI+DT69
ikugdB/OEIKcdBodfpga3csTS7MgROSR6cz8faXbauX+5v3gTt23ADq1cEmv8uXr
AvHRAosZy5Q6XkjEGB5YGV8eAlrwDPGxrancWYaLbumR9YbK+rlmM6pZW87ipxZz
R8srzJmwN0jP41ZL9c8PDHIyh8bwRLtTcm1D9SZImlJnt1ir/md2cXjbDaJWFBM5
JDGFoqgCWjBH4d1QB7wCCZAA62RjYJsWvIjJEubSfZGL+T0yjWW06XyxV3bqxbYo
Ob8VZRzI9neWagqNdwvYkQsEjgfbKbYK7p2CNTUQ
-----END CERTIFICATE-----
`;

export async function requestCertificateTask(req: TaskRequest<{
  certificate: number;
  domains: string[];
  staging?: boolean;
  debug?: boolean;
}>): Promise<TaskResponse> {
  await beginWork();

  // Find the relevant certificate provider
  const providers = await systemConfigSchema
    .query("certificateProvider")
    .select(["wrdId", "issuerDomain", "acmeDirectory", "accountPrivatekey", "eabKid", "eabHmackey", "email", "allowlist"])
    .execute();
  // Split the allowlist into separate domain masks
  const providersWithMasks = providers.map(provider => ({
    ...provider,
    allowlist: provider.allowlist
      .split(" ").filter(_ => _) // split into separate masks
      .sort((a, b) => b.length - a.length) // sort by longest mask first
      .map(_ => regExpFromWildcards(_)), // convert to regexp
  }));
  // Find the first matching provider
  let provider: typeof providersWithMasks[0] | null = null;
  for (const prov of providersWithMasks) {
    // Every requested host must match one of the allowlist masks
    if (req.taskdata.domains.every(host => prov.allowlist.some(regexp => regexp.test(host)))) {
      provider = prov;
      break;
    }
  }
  if (!provider)
    return req.resolveByTemporaryFailure(`No matching certificate provider found matching domains ${req.taskdata.domains.join(", ")}`);

  let directory = provider.acmeDirectory;
  if (!directory) {
    if (provider.issuerDomain === "letsencrypt.org") {
      directory = req.taskdata.staging ? acme.ACME_DIRECTORY_URLS.LETS_ENCRYPT_STAGING : acme.ACME_DIRECTORY_URLS.LETS_ENCRYPT;
    }
  }
  if (!directory)
    return req.resolveByTemporaryFailure(`No directory for provider ${provider.issuerDomain}`, { nextRetry: null });

  let keyPair: CryptoKeyPair | undefined = undefined;
  if (provider.accountPrivatekey)
    keyPair = await acme.CryptoKeyUtils.importKeyPairFromPemPrivateKey(await provider.accountPrivatekey.resource.text());

  let wildcard = false;
  for (const domain of req.taskdata.domains) {
    if (domain.includes("*")) {
      wildcard = true;
    } else {
      //FIXME: Check if DNS for domains points to this server?
    }
  }

  try {
    using mutex = await lockMutex(`platform:certbot`);
    void(mutex);

    // For DNS challenges, we need the PortalAPI client from the webharebv_policy module
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- we cannot import the type from webharebv_policy
    let getPolicyPortalAPIClient: any = null;
    if ("webharebv_policy" in backendConfig.module)
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- TODO - our require plugin doesn't support await import yet
        ({ getPolicyPortalAPIClient } = require("@mod-webharebv_policy/js/apis"));
      } catch(e) {}

    if (req.taskdata.debug)
      logDebug("platform:certbot", {
        "#what": "request",
        directory,
        domains: req.taskdata.domains,
        provider: provider.issuerDomain,
        // For wildcard certificates, use dns-01, otherwise use http-01 challenges, for harica.gr no challenge is needed
        dnsChallenge: wildcard && provider.issuerDomain !== "harica.gr" ? true : false,
        httpChallenge: !wildcard && provider.issuerDomain !== "harica.gr" ? true : false,
      });
    const result = await requestACMECertificate(directory, req.taskdata.domains, {
      emails: provider.email ? [provider.email] : undefined,
      keyPair,
      kid: provider.eabKid ? provider.eabKid : undefined,
      hmacKey: provider.eabHmackey ? provider.eabHmackey : undefined,
      updateDnsRecords: wildcard && provider.issuerDomain !== "harica.gr" ? updateDnsRecords.bind(null, getPolicyPortalAPIClient, req.taskdata.debug ?? false) : undefined,
      updateHttpResources: !wildcard && provider.issuerDomain !== "harica.gr" ? updateHttpResources.bind(null, req.taskdata.debug ?? false) : undefined,
      cleanup: cleanup.bind(null, req.taskdata.debug ?? false),
    });

    // Add Let's Encrypt root certificate
    let certificate = result.certificate;
    if (provider.issuerDomain === "letsencrypt.org")
      certificate += letsencryptRootCertificate;

    const certKeyPair = await acme.CryptoKeyUtils.exportKeyPairToPem(result.certKeyPair);
    const accountKeyPair = await acme.CryptoKeyUtils.exportKeyPairToPem(result.accountKeyPair);

    if (req.taskdata.staging) {
      // When using the staging server, don't actually update the certificate and private keys, but return them in the task
      // result for inspection
      return req.resolveByCompletion({
        certificate,
        privatekey: certKeyPair.privateKey,
        accountkey: accountKeyPair.privateKey,
      });
    }

    // Store the certificate and its key pair
    let certFolder = await openFolder(req.taskdata.certificate, { allowMissing: true });
    if (!certFolder) {
      // Create the certificate folder
      const keystore = await openFolder("/webhare-private/system/keystore");
      certFolder = await keystore.createFolder(`certbot-${req.taskdata.domains[0]}`.replaceAll("*", "_wildcard") + "-" + new Date().toISOString().slice(0, -5).replaceAll(/[-:]/g, "").replace("T", "-"));
    }
    const certFile = await certFolder.ensureFile("certificatechain.pem", { type: "http://www.webhare.net/xmlns/publisher/plaintextfile" });
    await certFile.update({ data: await ResourceDescriptor.from(certificate) });
    const certKeyPairFile = await certFolder.ensureFile("privatekey.pem", { type: "http://www.webhare.net/xmlns/publisher/plaintextfile" });
    await certKeyPairFile.update({ data: await ResourceDescriptor.from(certKeyPair.privateKey) });

    // Store the account key pair if new or updated
    const resource = await ResourceDescriptor.from(accountKeyPair.privateKey);
    if (!provider.accountPrivatekey || provider.accountPrivatekey.hash !== resource.hash)
      await systemConfigSchema.update("certificateProvider", provider.wrdId, { accountPrivatekey: resource });

    return req.resolveByCompletion();
  } catch(e) {
    return req.resolveByPermanentFailure((e as Error).message);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- we cannot import the type from webharebv_policy
async function updateDnsRecords(getPolicyPortalAPIClient: any, debug: boolean, dnsRecord: acme.DnsTxtRecord[]) {
  if (!getPolicyPortalAPIClient)
    throw new Error("Module webharebv_policy not installed, dns-01 challenges unavailable!");

  const client = await getPolicyPortalAPIClient();
  if (debug)
    logDebug("platform:certbot", { "#what": "portalapi client", client: await client.getMe() });
  await client.prepareACMEDNSChallenge(dnsRecord.map(_ => ({ domain: _.domain, token: _.content })));

  if (debug)
    logDebug("platform:certbot", { "#what": "update dns records", dnsRecords: dnsRecord.map(_ => pick(_, ["domain", "name"])) });
}

async function updateHttpResources(debug: boolean, httpResource: acme.HttpResource[]) {
  const cacheDir = `${backendConfig.dataRoot}caches/platform/acme/`;
  try {
    if (!await stat(cacheDir))
      await mkdir(cacheDir, { recursive: true });
  } catch(e) {
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

  if (debug)
    logDebug("platform:certbot", { "#what": "update http resources", httpResources: httpResource.map(_ => pick(_, ["domain", "name"])) });
}

async function cleanup(debug: boolean, challenge: {
  dnsRecords?: acme.DnsTxtRecord[];
  httpResources?: acme.HttpResource[];
}) {
  if (challenge.httpResources) {
    if (debug)
      logDebug("platform:certbot", { "#what": "cleanup http resources", httpResources: challenge.httpResources.map(_ => _.name) });
    const cacheDir = `${backendConfig.dataRoot}caches/platform/acme/`;
    for (const res of challenge.httpResources) {
      try {
        const cachePath = join(cacheDir, res.name.toLowerCase());
        if (await stat(cachePath))
          await unlink(cachePath);
      } catch(e) {
        logError(e as Error);
      }
    }
  }
  // No cleanup for DNS records
}

export async function cleanupOutdatedHttpResources(debug?: boolean) {
  const cacheFiles = await listDirectory(`${backendConfig.dataRoot}caches/platform/acme/`);
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
