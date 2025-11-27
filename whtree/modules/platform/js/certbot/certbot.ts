import { retrieveTaskResult, scheduleTask } from "@webhare/services";
import { beginWork, commitWork } from "@webhare/whdb";

export * as acme from "@mod-platform/js/certbot/vendor/acme/src/mod";

type CertificateRequestOptions = {
  /** The id of the certificate/private key to update, if it doesn't exist, a new certificate/private key is created  */
  certificateId?: number;
  /** If the staging server should be used (not available for all certificate providers, does not update/create the
      certificate/private key, defaults to true) */
  staging?: boolean;
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
    debug: options?.debug ?? false,
  });
  await commitWork();

  try {
    return await retrieveTaskResult<CertificateRequestResult>(taskId);
  } catch(e) {
    return { success: false, error: (e as Error).message };
  }
}
