import { getTid } from "@webhare/gettid";
import { retrieveTaskResult, scheduleTask } from "@webhare/services";
import { beginWork, commitWork } from "@webhare/whdb";
import { createPrivateKey, X509Certificate } from "node:crypto";
import { lookupKey, splitPEMCertificateBundle } from "../webserver/keymgmt";

export * as acme from "@mod-platform/js/certbot/vendor/acme/src/mod";

type CertificateRequestOptions = {
  /** The id of the certificate/private key to update, if it doesn't exist, a new certificate/private key is created  */
  certificateId?: number;
  /** If the staging server should be used (only if the certificate provider's acme directory is not set and its issuer
      domain is known, defaults to true) */
  staging?: boolean;
  /** Only request and test the certificate, do not update/create the certificate/private key */
  testOnly?: boolean;
  debug?: boolean;
};

type CertificateRequestResult = {
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
  /** The error message */
  error: string;
};

/** Request a certificate for one or more domains hosted by this installation */
export async function requestACMECertificate(domains: string[], options?: CertificateRequestOptions): Promise<CertificateRequestResult> {
  await beginWork();
  const taskId = await scheduleTask("platform:requestcertificate", {
    certificateId: options?.certificateId ?? 0,
    domains,
    staging: options?.staging ?? true,
    testOnly: options?.testOnly ?? false,
    debug: options?.debug ?? false,
  });
  await commitWork();

  try {
    return await retrieveTaskResult<CertificateRequestResult>(taskId);
  } catch (e) {
    return { success: false, error: (e as Error).message };
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
      const getIssuer = certificates[certificates.length - 1].issuer;
      if (certificates.length > 10)
        throw new Error(`Certificate chain too long looking for ${getIssuer}`);

      const cert = await lookupKey(getIssuer);
      if (!cert)
        return { success: false, error: getTid("system:tolliumapps.config.keystore.main.missingcertificate", getIssuer) };

      certificates.push(new X509Certificate(cert));
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
