import { listStoredKeyPairs } from "@mod-platform/js/webserver/keymgmt";
import { run } from "@webhare/cli";
import { scheduleTask } from "@webhare/services";
import { toSnakeCase } from "@webhare/std";
import { beginWork, commitWork } from "@webhare/whdb";

run({
  flags: {
    staging: { default: false, description: "use the staging server, if available for the certificate provider" },
    force: { default: false, description: "force a certificate update, even if it's not yet up for renewal" },
    debug: { default: false },
  },
  main: async ({ opts: options }) => {
    const allCerts = await listStoredKeyPairs();

    for (const cert of allCerts) {
      // In scope?
      if (!cert.name.startsWith("certbot-"))
        continue;

      if (options.debug)
        console.log(`Requesting for '${cert.name}'`);

      await beginWork();
      await scheduleTask("platform:requestcertificate", toSnakeCase({
        certificateId: cert.id,
        isRenewal: !options.force,
        staging: options.staging,
        debug: options.debug,
      }));
      await commitWork();
    }
  }
});
