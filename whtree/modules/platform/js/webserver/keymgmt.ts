import { toFSPath } from "@webhare/services";
import { openFolder, type WHFSFolder } from "@webhare/whfs";
import { createHash, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";

function createWebHareDNHash(readableName: string): string {
  const hash = createHash("sha1").update(readableName).digest("hex").toLowerCase();
  return hash;
}

export function splitPEMCertificateBundle(bundle: string): string[] {
  const certs: string[] = [];
  const keyTrailer = "-----END CERTIFICATE-----";
  for (let key of bundle.split(keyTrailer)) {
    key = key.trim();
    if (!key)
      continue;

    certs.push(key + "\n" + keyTrailer + "\n");
  }
  return certs;
}

export interface LookupKeyResult {
  /** The PEM file, including -----BEGIN CERTIFICATE----- and -----END CERTIFICATE----- */
  pem: string;
  /** The parsed X509Certificate object */
  parsed: X509Certificate;
  /** Was the certificate found in our root store? */
  inRootStore: boolean;
}

export async function lookupKey(subject: string, options?: { offline?: boolean }): Promise<null | LookupKeyResult> {
  const bundle = readFileSync(toFSPath("mod::platform/data/facts/mozilla_ca_bundle.pem"), 'utf8');
  for (const cert of splitPEMCertificateBundle(bundle)) {
    const parsed = new X509Certificate(cert);
    const certSubject = parsed.subject.split("\n").join(", ");
    if (certSubject === subject) {
      return { pem: cert, parsed, inRootStore: true };
    }
  }


  if (!options?.offline) { //Not in the cert store. On webhare.dev?
    const fetchKey = await fetch("https://www.webhare.dev/media/certificatestore/" + createWebHareDNHash(subject) + ".pem");
    if (fetchKey.ok) {
      const pem = await fetchKey.text();
      const parsed = new X509Certificate(pem);
      return { pem, parsed, inRootStore: false };
    }
  }

  return null;
}

class StoredKeyPair {
  constructor(private keyFolder: WHFSFolder) {
  }

  async getCertificateChain(): Promise<string[]> {
    const chain = await this.keyFolder.openFile("certificatechain.pem", { allowMissing: true });
    if (!chain)
      return [];
    const content = await chain.data.resource.text();
    return splitPEMCertificateBundle(content);
  }

  async getDNSNames(): Promise<string[]> {
    const chain = await this.getCertificateChain();

    if (!chain.length)
      return [];

    const parsed = new X509Certificate(chain[0]);
    const names: string[] = [];
    for (let name of parsed.subjectAltName?.split(", ") || []) {
      name = name.trim();
      if (name.startsWith("DNS:"))
        names.push(name.substring(4));
    }
    return names;
  }
}

export async function openStoredKeyPair(id: number) {
  const keyfolder = await openFolder(id);
  return new StoredKeyPair(keyfolder);
}

export async function getDNSNamesForHS(id: number): Promise<string[]> {
  return (await openStoredKeyPair(id)).getDNSNames();
}
