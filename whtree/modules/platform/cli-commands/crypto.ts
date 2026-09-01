// @webhare/cli: Manage SSL keys and certificates

import { requestACMECertificate } from "@mod-platform/js/certbot/certbot";
import { readArgFile } from "@mod-platform/js/cli/cli-tools";
import { CLIRuntimeError, runCli } from "@webhare/cli";
import { loadlib, type HSVMObject } from "@webhare/harescript";
import type { HSVMBlob } from "@webhare/harescript/src/wasm-hsvmvar";
import { decryptForThisServer, type WebHareBlob } from "@webhare/services";
import { beginWork, commitWork } from "@webhare/whdb";

type KeyPair = HSVMObject & {
  TestCertificate(certdata: WebHareBlob): Promise<{ success: boolean; message?: string; finalkey?: WebHareBlob }>;
  UpdateMetadata(metadata: { certificatechain?: WebHareBlob }): Promise<void>;
  RecycleSelf(): Promise<void>;
};

type KeyPairRecord = {
  name: string;
};

type DecodedCertificate = {
  subjectfields: Array<{ fieldname: string; value: string }>;
  issuerfields: Array<{ fieldname: string; value: string }>;
  dns_altnames: string[];
  valid_until: Date;
};

function getKeystoreLib() {
  return loadlib("mod::system/lib/keystore.whlib");
}

function getPkcsLib() {
  return loadlib("wh::filetypes/pkcs.whlib");
}

function getDateTimeLib() {
  return loadlib("wh::datetime.whlib");
}

async function openKey(rawkeyname: boolean, hostname: string): Promise<KeyPair> {
  const keystore = getKeystoreLib();
  const keypair = rawkeyname
    ? await keystore.OpenKeyPairByName(hostname) as KeyPair | undefined
    : await keystore.OpenKeyPair(await keystore.GetBestKeyPairForHostName(hostname)) as KeyPair | undefined;

  if (!keypair)
    throw new CLIRuntimeError(`No such key ${rawkeyname ? `'${hostname}'` : `for hostname '${hostname}'`}`);

  return keypair;
}

async function certbot(primaryhostname: string, hostnames: string[], options: { staging: boolean; debug: boolean }): Promise<void> {
  const result = await requestACMECertificate([primaryhostname, ...hostnames], {
    staging: options.staging,
    debug: options.debug,
  });

  if (!result.success) {
    if (result.error === "hostnotlocal")
      throw new CLIRuntimeError(`The hostname '${result.errorData}' is not hosted on this server`);

    throw new CLIRuntimeError(JSON.stringify(result));
  }
}

async function getKeyInfo(rawkeyname: boolean, hostname: string, which: "privatekey" | "certificatechain"): Promise<void> {
  const keypair = await openKey(rawkeyname, hostname);
  const blob = await keypair.$get<HSVMBlob>(which);
  process.stdout.write(Buffer.from(await blob.arrayBuffer()));
}

async function setKeyCertificate(rawkeyname: boolean, hostname: string, certdata: WebHareBlob): Promise<void> {
  const keypair = await openKey(rawkeyname, hostname);
  const result = await keypair.TestCertificate(certdata);
  if (!result.success)
    throw new CLIRuntimeError(`Error: ${result.message ?? ""}`);

  await beginWork();
  await keypair.UpdateMetadata({ certificatechain: certdata });
  await commitWork();

  console.log("Certificate has been updated");
}

async function listKeys(_allkeys: boolean): Promise<void> {
  const keystore = getKeystoreLib();
  const pkcs = getPkcsLib();
  const datetime = getDateTimeLib();

  for (const record of await keystore.ListKeyPairs() as KeyPairRecord[]) {
    const keypair = await keystore.OpenKeyPairByName(record.name) as KeyPair;
    const certificate = await keypair.$get<HSVMBlob>("certificate");

    console.log(`Key name: ${record.name}`);
    if (certificate.size === 0) {
      console.log("- No certificate");
    } else {
      const decoded = await pkcs.DecodePEMFile(await certificate.text()) as DecodedCertificate;
      const validUntil = await datetime.FormatISO8601DateTime(decoded.valid_until, "", "", "CET") as string;
      const difference = await datetime.GetDateTimeDifference(await datetime.GetCurrentDateTime(), decoded.valid_until) as { days: number };

      console.log(`- Common name: ${decoded.subjectfields.find(field => field.fieldname === "CN")?.value ?? ""}`);
      console.log(`- DNS alternative names: ${decoded.dns_altnames.join(" ")}`);
      console.log(`- Issuer: ${decoded.issuerfields.find(field => field.fieldname === "CN")?.value ?? ""}`);
      console.log(`- Valid until: ${validUntil} (${difference.days} days)`);
      console.log();
    }
  }
}

runCli({
  description: "Manage SSL keys and certificates",
  subCommands: {
    "request-certificate": {
      description: "Generate a certificate using ACME",
      flags: {
        staging: "Use the ACME staging environment",
        debug: "Enable debug output",
      },
      arguments: [
        { name: "<primaryhostname>", description: "Primary domain" },
        { name: "[hostnames...]", description: "Additional domains" },
      ],
      async main({ args, opts }) {
        await certbot(args.primaryhostname, args.hostnames, opts);
      }
    },
    "list-keys": {
      description: "List all keys",
      flags: {
        raw: "Keep compatibility with the legacy command syntax",
      },
      async main({ opts }) {
        await listKeys(opts.raw);
      }
    },
    "get-private-key": {
      description: "Output the private key for the requested hostname",
      flags: {
        rawkeyname: "Interpret name as a raw key name",
      },
      arguments: [
        { name: "<hostname>", description: "Hostname or key name" },
      ],
      async main({ args, opts }) {
        await getKeyInfo(opts.rawkeyname, args.hostname, "privatekey");
      }
    },
    "add-private-key": {
      description: "Add a new private key",
      flags: {
        replace: "Replace an existing key",
        rawkeyname: "Interpret name as a raw key name",
      },
      arguments: [
        { name: "<hostname>", description: "Key name" },
        { name: "<filename>", description: "Private key file" },
      ],
      async main({ args, opts }) {
        if (!opts.rawkeyname)
          throw new CLIRuntimeError("Keys can only be added by using a rawkeyname");

        const keystore = getKeystoreLib();
        await beginWork();
        const existingkey = await keystore.OpenKeyPairByName(args.hostname) as KeyPair | undefined;
        if (existingkey) {
          if (!opts.replace)
            throw new CLIRuntimeError(`Key ${args.hostname} already exists`);
          await existingkey.RecycleSelf();
        }

        await keystore.CreateKeyPair(args.hostname, await readArgFile(args.filename));
        await commitWork();
      }
    },
    "get-certificate": {
      description: "Output the certificate for the requested hostname",
      flags: {
        rawkeyname: "Interpret name as a raw key name",
      },
      arguments: [
        { name: "<hostname>", description: "Hostname or key name" },
      ],
      async main({ args, opts }) {
        await getKeyInfo(opts.rawkeyname, args.hostname, "certificatechain");
      }
    },
    "set-certificate": {
      description: "Set the certificate for the requested hostname",
      flags: {
        rawkeyname: "Interpret name as a raw key name",
      },
      arguments: [
        { name: "<hostname>", description: "Hostname or key name" },
        { name: "<filename>", description: "Certificate file, or - to read stdin" },
      ],
      async main({ args, opts }) {
        await setKeyCertificate(opts.rawkeyname, args.hostname, await readArgFile(args.filename));
      }
    },
    "decrypt-server": {
      description: "Decrypt data encrypted by encryptForThisServer",
      arguments: [
        {
          name: "<scope>",
          description: "The scope of the decryption (e.g 'wrd:oidcauth')",
        }, {
          name: "<data>",
          description: "The encrypted data to decrypt",
        }
      ],
      async main({ opts, args }) {
        console.log(JSON.stringify(await decryptForThisServer(args.scope, args.data), null, 2));

      }
    }
  }
});
