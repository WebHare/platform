import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { toFSPath } from "@webhare/services";
import { addDuration } from "@webhare/std";
import { db } from "@webhare/whdb";
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
  get id() {
    return this.keyFolder.id;
  }

  get name() {
    return this.keyFolder.name;
  }

  constructor(private keyFolder: WHFSFolder) {
  }

  async shouldRenew(): Promise<{ shouldRenew: boolean; validUntil: Temporal.Instant }> {
    const validFrom = await this.getValidFrom();
    const validUntil = await this.getValidTo();

    if (validFrom && validUntil) {
      const timeStillValid = validUntil.getTime() - Date.now();
      const totalValidity = validUntil.getTime() - validFrom.getTime();
      //LetsEncrypt recommends renewal when 1/3 of the validity period is left
      return { shouldRenew: (timeStillValid / totalValidity) < 1 / 3, validUntil: Temporal.Instant.from(validUntil.toISOString()) };
    } else {
      return { shouldRenew: true, validUntil: Temporal.Instant.fromEpochMilliseconds(0) };
    }
  }

  async getCertificateChain(): Promise<string[]> {
    const chain = await this.keyFolder.openFile("certificatechain.pem", { allowMissing: true });
    if (!chain)
      return [];
    const content = await chain.data.resource.text();
    return splitPEMCertificateBundle(content);
  }

  async getDNSNames(): Promise<string[]> {
    const parsed = await this.getCertificate();
    if (!parsed)
      return [];
    const names: string[] = [];
    for (let name of parsed.subjectAltName?.split(", ") || []) {
      name = name.trim();
      if (name.startsWith("DNS:"))
        names.push(name.substring(4));
    }
    return names;
  }

  async getValidFrom() {
    const parsed = await this.getCertificate();
    if (!parsed)
      return null;
    return parsed.validFromDate;
  }

  async getValidTo() {
    const parsed = await this.getCertificate();
    if (!parsed)
      return null;
    return parsed.validToDate;
  }

  private async getCertificate() {
    const chain = await this.getCertificateChain();
    if (!chain.length)
      return null;

    return new X509Certificate(chain[0]);
  }
}

export async function openStoredKeyPair(id: number) {
  const keyfolder = await openFolder(id);
  return new StoredKeyPair(keyfolder);
}

export async function getDNSNamesForHS(id: number): Promise<string[]> {
  return (await openStoredKeyPair(id)).getDNSNames();
}

/** List all keypairs
    @returns A list of keypairs
    @cell(integer) return.id Key ids
    @cell(integer) return.name Key name
    @cell(integer) return.title Title
    @cell(integer) return.hasCertificate True if this key has a certificate
*/
export async function listStoredKeyPairs(): Promise<Array<{
  id: number;
  name: string;
  title: string;
  hasCertificate: boolean;
}>> {
  const keystore = await openFolder("/webhare-private/system/keystore", { allowMissing: true });
  if (!keystore)
    return [];

  const keyfolders = await keystore.list(["title"]);
  const certificates = await db<PlatformDB>().selectFrom("system.fs_objects").select(["parent"]).where("name", "=", "certificatechain.pem").where("parent", "in", keyfolders.map(_ => _.id)).execute();
  return keyfolders.map(kf => ({
    id: kf.id,
    name: kf.name,
    title: kf.title,
    hasCertificate: certificates.some(c => c.parent === kf.id)
  }));
}
