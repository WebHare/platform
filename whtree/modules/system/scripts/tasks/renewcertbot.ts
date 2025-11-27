import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { run } from "@webhare/cli";
import { loadlib } from "@webhare/harescript";
import { scheduleTask } from "@webhare/services";
import { addDuration, toCamelCase } from "@webhare/std";
import { beginWork, commitWork, db } from "@webhare/whdb";
import { openFolder } from "@webhare/whfs";

export type WebserverCertificate = {
  id: number;
  name: string;
  chainfile: string;
  keyfile: string;
  validUntil: Date;
  servernames: string[];
};

function getBestCertificateForHost(certificates: WebserverCertificate[], hostname: string) {
  let bestCert: WebserverCertificate | null = null;
  const name = hostname.toLowerCase();
  for (const cert of certificates) {
    const isMatch = isCertificateForHostname(cert, name);
    if (isMatch)
      if (!bestCert || bestCert.validUntil < cert.validUntil)
        bestCert = cert;
  }
  return bestCert;
}

function isCertificateForHostname(cert: WebserverCertificate, hostname: string) {
  const name = hostname.toLowerCase();
  if (cert.servernames.includes(name))
    return true;

  const firstname = hostname.split(".")[0];

  /* Check for matches with wildcard dnsaltnames
      a.b.c matches *.b.c
      *.b.c matches *.b.c
      x.a.b.c does not match *.b.c
      a.*.c does not match *.b.c
  */
  for (const sname of cert.servernames)
    if (sname.startsWith("*.") && name === firstname + sname.substring(1))
      return true;

  return false;
}

run({
  flags: {
    staging: { default: false, description: "use the staging server, if available for the certificate provider" },
    force: { default: false, description: "force a certificate update, even if it's not yet up for renewal" },
    debug: { default: false },
  },
  main: async ({ opts: options }) => {
    const allCerts = toCamelCase(await loadlib("mod::system/lib/internal/nginx/config.whlib").ListCertificates()) as WebserverCertificate[];
    const allHostnames = await loadlib("mod::system/lib/internal/webserver/certbot.whlib").GetCertifiableHostnames() as string[];

    const checkDate = addDuration(new Date, { days: 30 });
    for (const cert of allCerts) {
      // In scope? Do we care?
      if (!cert.name.startsWith("certbot-"))
        continue;
      if (cert.validUntil > checkDate) {
        if (!options.force) {
          if (options.debug)
            console.log(`Certbot certificate '${cert.name}' is not yet up for renewal: ${cert.validUntil.toISOString().split("T")[0]} > ${checkDate.toISOString().split("T")[0]}`);
          continue;
        }
        if (options.debug)
          console.log(`Forcing renewal of certbot certificate '${cert.name}'`);
      } else if (options.debug)
        console.log(`Certbot certificate '${cert.name}' is up for renewal`);

      // Which names do we still need to certify?
      const requestFor: string[] = [];
      for (const host of cert.servernames) {
        const best = getBestCertificateForHost(allCerts, host);
        if (best && best.id !== cert.id) {
          if (options.debug)
            console.log(`Certificate '${best.name}' is better for '${host}' than us`);
          continue;
        }

        if (!host.startsWith("*.") && !allHostnames.includes(host.toUpperCase())) {
          if (options.debug)
            console.log(`Hostname '${host}' is no longer hosted here`);
          continue;
        }

        requestFor.push(host);
      }

      if (!requestFor.length) {
        // We are no longer hosting this site
        // Link the port up to a new key/certificate. note that this generally only happens on non-proxied WebHares that don't do SNI anyway
        let setupReplacement = 0;

        const result = await db<PlatformDB>()
          .selectFrom("system.ports")
          .select("id")
          .where("keypair", "=", cert.id)
          .executeTakeFirst();
        if (result) {
          for (const matchHost of cert.servernames) {
            const replacement = getBestCertificateForHost(allCerts, matchHost);
            if (replacement) {
              setupReplacement = replacement.id;
              break;
            }
          }
          if (!setupReplacement) {
            console.error(`Certificate '${cert.name}' is no longer needed here but still referred by a SSL port!`);
            process.exitCode = 1;
            continue;
          }
        }

        console.log(`Certificate '${cert.name}' is no longer needed here, deleting it`);
        await beginWork();
        const certFolder = await openFolder(cert.id);
        await certFolder.recycle();
        await db<PlatformDB>()
          .updateTable("system.ports")
          .where("keypair", "=", cert.id)
          .set({ keypair: setupReplacement })
          .execute();
        await commitWork();

        continue;
      }

      if (options.debug)
        console.log(`Requesting for ${requestFor.join(", ")}`);

      await beginWork();
      await scheduleTask("platform:requestcertificate", {
        certificateId: cert.id,
        domains: requestFor,
        staging: options.staging,
        debug: options.debug,
      });
      await commitWork();
    }
  }
});
