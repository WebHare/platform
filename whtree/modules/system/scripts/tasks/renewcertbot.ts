import { listStoredKeyPairs } from "@mod-platform/js/webserver/keymgmt";
import { run } from "@webhare/cli";
import { describeTask, listTasks, scheduleTask } from "@webhare/services";
import { toSnakeCase } from "@webhare/std";
import { beginWork, commitWork } from "@webhare/whdb";

run({
  flags: {
    staging: { default: false, description: "use the staging server, if available for the certificate provider" },
    force: { default: false, description: "force a certificate update, even if it's not yet up for renewal" },
    debug: "Debug output",
    "dry-run": "Perform a dry run without scheduling tasks",
  },
  main: async ({ opts: options }) => {
    const debug = options.debug || options.dryRun;
    const allCerts = await listStoredKeyPairs();
    await beginWork();

    for (const cert of allCerts) {
      // In scope?
      if (!cert.name.startsWith("certbot-"))
        continue;


      // Don't schedule if a task for this certificate is already running/pending
      for (const task of await listTasks("platform:requestcertificate", { onlyPending: true })) {
        const data = await describeTask(task.id);
        if (data?.data && typeof data.data === "object" && "certificate_id" in data.data && data.data.certificate_id === cert.id) {
          if (debug)
            console.log(`Request task ${task.id} already scheduled for '${cert.name}'`);
          continue;
        }
      }

      if (debug)
        console.log(`Requesting for '${cert.name}'`);

      await scheduleTask("platform:requestcertificate", toSnakeCase({
        certificateId: cert.id,
        isRenewal: !options.force,
        staging: options.staging,
        debug: options.debug,
      }));
    }
    await commitWork();
  }
});
