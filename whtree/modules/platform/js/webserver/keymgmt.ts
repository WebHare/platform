import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { ASN1_TAGS } from "@mod-platform/js/certbot/vendor/acme/src/Asn1/Asn1";
import { decodeSequence, decodeTagLengthValue } from "@mod-platform/js/certbot/vendor/acme/src/Asn1/Asn1DecodeHelpers";
import { toFSPath } from "@webhare/services";
import { db } from "@webhare/whdb";
import { openFolder, type WHFSFolder } from "@webhare/whfs";
import { createHash, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";

function createWebHareDNHash(readableName: string): string {
  const hash = createHash("sha1").update(readableName).digest("hex").toLowerCase();
  return hash;
}

const decodeOctetString = (octetStrTLVDer: Uint8Array<ArrayBuffer>) => {
  const [tag, , value] = decodeTagLengthValue(octetStrTLVDer);

  if (tag !== ASN1_TAGS.OCTET_STRING) {
    throw new Error(
      `Expect tag to be 0x${ASN1_TAGS.OCTET_STRING.toString(16)}, but got 0x${tag.toString(16)}.`,
    );
  }

  return value;
};

const decodeObjectIdentifier = (objIdTLVDer: Uint8Array<ArrayBuffer>) => {
  const [tag, length, value] = decodeTagLengthValue(objIdTLVDer);

  if (tag !== ASN1_TAGS.OID) {
    throw new Error(
      `Expect tag to be 0x${ASN1_TAGS.OID.toString(16)}, but got 0x${tag.toString(16)}.`,
    );
  }
  if (length < 2) {
    throw new Error("oid does not contain part 1 or 2");
  }

  const oidPart1 = Math.floor(value[0] / 40);
  const oidPart2 = value[0] % 40;
  const rest: number[] = [];
  let n = 0;
  for (const num of value.slice(1)) {
    n <<= 7;
    n += num & 0b01111111;
    if (!(num & 0b10000000)) {
      rest.push(n);
      n = 0;
    }
  }
  return [oidPart1, oidPart2, ...rest].join(".");
};

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

  private keyFolder: WHFSFolder;

  constructor(keyFolder: WHFSFolder) {
    this.keyFolder = keyFolder;
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
    const content = await chain.data?.file.text() ?? "";
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

  async getKeyIdentifier() {
    const parsed = await this.getCertificate();
    if (!parsed)
      return null;

    /**
     * Leaf ASN.1
     *
     * Certificate  ::=  SEQUENCE  {
     *    tbsCertificate       TBSCertificate,
     *    signatureAlgorithm   AlgorithmIdentifier,
     *    signatureValue       BIT STRING
     * }
     *
     * TBSCertificate  ::=  SEQUENCE  {
     *    version         [0]  EXPLICIT Version DEFAULT v1,
     *    serialNumber         CertificateSerialNumber,
     *    signature            AlgorithmIdentifier,
     *    issuer               Name,
     *    validity             Validity,
     *    subject              Name,
     *    subjectPublicKeyInfo SubjectPublicKeyInfo,
     *    issuerUniqueID  [1]  IMPLICIT UniqueIdentifier OPTIONAL,
     *                         -- If present, version MUST be v2 or v3
     *    subjectUniqueID [2]  IMPLICIT UniqueIdentifier OPTIONAL,
     *                         -- If present, version MUST be v2 or v3
     *    extensions      [3]  EXPLICIT Extensions OPTIONAL
     *                         -- If present, version MUST be v3
     * }
     *
     * @see https://datatracker.ietf.org/doc/html/rfc5280#section-4.1
     */

    const [tbsCertificate] = decodeSequence(parsed.raw);
    // We cannot just use the last element of the sequence, as it might be the subjectPublicKeyInfo if all optional parts are absent
    const [/*version*/, /*serialNumber*/, /*signature*/, /*issuer*/, /*validity*/, /*subject*/, /*subjectPublicKeyInfo*/, ...otherParts] =
      decodeSequence(tbsCertificate);

    // We're only interested in the extensions part, the last of the optional other parts
    const rawExtensions = otherParts.length ? otherParts.at(-1) : null;
    if (rawExtensions) {
      // Change the 'extensions' part type from context-specific BIT STRING (0xa3) to universal SEQUENCE (0x30)
      rawExtensions[0] = 0x30;
      const extensions = decodeSequence(rawExtensions);
      // The actual extensions are in a sequence
      if (extensions[0]?.[0] === 0x30) {
        // Find the Authority Key Identifier (2.5.29.35)
        for (const rawExtension of decodeSequence(extensions[0])) {
          const extension = decodeSequence(rawExtension);
          const oid = decodeObjectIdentifier(extension[0]);
          if (oid === "2.5.29.35") {
            // The last element of the sequence is an octet string, containing a sequence, containing a context-specific byte
            // string, which is the actual key identifier
            const rawKeyString = decodeOctetString(extension.at(-1)!);
            const rawKeySequence = decodeSequence(rawKeyString);
            const [tag, , value] = decodeTagLengthValue(rawKeySequence[0]);
            if (tag === 0x80)
              // Return the hex encoded key identifier
              return [...value].map(_ => _.toString(16).padStart(2, "0")).join("").toUpperCase();
          }
        }
      }
    }
    return null;
  }

  async getSerialNumber() {
    const parsed = await this.getCertificate();
    if (!parsed)
      return null;
    return parsed.serialNumber;
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
