import { toFSPath } from "@webhare/services";
import { createHash, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";

function createWebHareDNHash(readableName: string): string {
  const hash = createHash("sha1").update(readableName).digest("hex").toLowerCase();
  return hash;
}

export function splitPEMCertificateBundle(bundle: string): string[] {
  const certs: string[] = [];
  const keyTrailer = "-----END CERTIFICATE-----";
  for (const key of bundle.split(keyTrailer)) {
    if (!key.trim())
      continue;

    certs.push(key + keyTrailer);
  }
  return certs;
}

export async function lookupKey(subject: string) {
  const bundle = readFileSync(toFSPath("mod::platform/data/facts/mozilla_ca_bundle.pem"), 'utf8');
  for (const key of splitPEMCertificateBundle(bundle)) {
    const parsed = new X509Certificate(key);
    const certSubject = parsed.subject.split("\n").join(", ");
    if (certSubject === subject) {
      return key;
    }
  }

  //Not in the cert store. On webhare.dev?
  const fetchKey = await fetch("https://www.webhare.dev/media/certificatestore/" + createWebHareDNHash(subject) + ".pem");
  if (fetchKey.ok) {
    return await fetchKey.text();
  }

  return '';
}

// console.log(lookupKey("C=GR, O=Hellenic Academic and Research Institutions CA, CN=HARICA TLS RSA Root CA 2021"));
// console.log(lookupKey("C=GR, L=Athens, O=Hellenic Academic and Research Institutions Cert. Authority, CN=Hellenic Academic and Research Institutions RootCA 2015"));
