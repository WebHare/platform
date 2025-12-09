import { getTid } from "@webhare/gettid";
import { retrieveTaskResult, scheduleTask } from "@webhare/services";
import { beginWork, commitWork } from "@webhare/whdb";
import { createPrivateKey, X509Certificate } from "node:crypto";
import { lookupKey, splitPEMCertificateBundle } from "../webserver/keymgmt";
import type { CertificateRequestResult } from "./internal/task";

export * as acme from "@mod-platform/js/certbot/vendor/acme/src/mod";

type CertificateRequestOptions = {
  /** The id of the certificate/private key to update, if it doesn't exist, a new certificate/private key is created  */
  certificateId?: number;
  /** If this is a certificate renewal, the certificate will only be requested if it's about to expire (defaults to true) */
  isRenewal?: boolean;
  /** If the certificate provider's staging directory should be used, implies testOnly (only if the certificate provider's
      ACME directory is not explicitly set and its issuer domain is known, defaults to true) */
  staging?: boolean;
  /** Only request and test the certificate, do not update/create the certificate/private key */
  testOnly?: boolean;
  debug?: boolean;
};

/** Request a certificate for one or more domains hosted by this installation */
export async function requestACMECertificate(domains: string[], options?: CertificateRequestOptions): Promise<CertificateRequestResult> {
  await beginWork();
  const taskId = await scheduleTask("platform:requestcertificate", {
    certificateId: options?.certificateId ?? 0,
    isRenewal: options?.isRenewal ?? true,
    domains,
    staging: options?.staging ?? true,
    testOnly: options?.testOnly ?? false,
    debug: options?.debug ?? false,
  });
  await commitWork();

  try {
    return await retrieveTaskResult(taskId, { acceptTempFailure: true, acceptPermFailure: true });
  } catch (e) {
    return { success: false, error: "error", errorData: (e as Error).message };
  }
}

type TestCertificateOptions = {
  privateKey?: string;
  checkFullChain?: boolean;
};

export async function testCertificate(certificate: string, options?: TestCertificateOptions): Promise<{
  success: true;
  certificate: string;
} | {
  success: false;
  error: string;
}> {
  // Try to read the certificate chain
  const certificates: X509Certificate[] = splitPEMCertificateBundle(certificate).
    map(_ => new X509Certificate(_));

  // Check if the private key belongs to the (first) certificate
  if (options?.privateKey) {
    const key = createPrivateKey({ key: options.privateKey, format: "pem" });
    if (!certificates[0].checkPrivateKey(key))
      return { success: false, error: getTid("system:tolliumapps.config.keystore.main.certificatenotforthiskey") };
  }

  // Check the certificate chain
  if (options?.checkFullChain) {
    while (certificates[certificates.length - 1].subject !== certificates[certificates.length - 1].issuer) {
      const getIssuer = certificates[certificates.length - 1].issuer.split("\n").join(", ");
      if (certificates.length > 10)
        throw new Error(`Certificate chain too long looking for ${getIssuer}`);

      const cert = await lookupKey(getIssuer);
      if (!cert)
        return { success: false, error: getTid("system:tolliumapps.config.keystore.main.missingcertificate", getIssuer) };

      certificates.push(cert.parsed);
    }
  }

  // Single, self-signed certificate?
  if (certificates.length === 1 && !certificates[0].checkIssued(certificates[0])) {
    return { success: false, error: getTid("system:tolliumapps.config.keystore.main.missingcertificatechain") };
  }

  // If we get here, we've got a chain of certificates
  for (let i = 0; i < certificates.length - 1; ++i) {
    if (!certificates[i].checkIssued(certificates[i + 1])) {
      return { success: false, error: getTid("system:tolliumapps.config.keystore.main.signatureverificationfailed") };
    }
  }

  return {
    success: true,
    certificate: certificates.map(_ => _.toString()).join(""),
  };
}
