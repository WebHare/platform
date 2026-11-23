// @webhare/cli: Manage the WebHare configuration

import { CLIRuntimeError, runCli } from "@webhare/cli";
import { applyConfiguration, getServerRoles, readRegistryKey, writeRegistryKey } from "@webhare/services";
import { runInWork } from "@webhare/whdb";
import { getTid } from "@webhare/gettid";
import { compareProperties } from "@webhare/std";
import { getExtractedConfig } from "@mod-system/js/internal/configuration";
import { builtinServerRoles, parseServerRoles } from "@mod-system/js/internal/generation/gen_config_nodb";

const serverRolesKey = "system:global.serverroles";

/** Describe why the configured roles aren't the active roles, if they aren't */
function getRolesOverrideReason(): string | null {
  if (process.env.WEBHARE_ISRESTORED)
    return "this server is in restore mode (WEBHARE_ISRESTORED), so the configured roles aren't active";
  if (process.env.WEBHARE_SERVERROLES)
    return "WEBHARE_SERVERROLES is set, so it overrides the configured roles";
  return null;
}

async function readStoredRoles(): Promise<string[]> {
  return parseServerRoles(await readRegistryKey(serverRolesKey));
}

/** Verify role names given on the command line: they must be declared by an installed module and can't be built-in */
function checkRoleNames(roles: string[]) {
  const invalid = roles.filter(role => !parseServerRoles([role]).length);
  if (invalid.length)
    throw new CLIRuntimeError(`Invalid role name${invalid.length > 1 ? "s" : ""}: ${invalid.join(", ")}. A role name looks like 'module:tag'`);

  const builtin = roles.filter(role => builtinServerRoles.includes(role));
  if (builtin.length)
    throw new CLIRuntimeError(`Built-in role${builtin.length > 1 ? "s" : ""} ${builtin.join(", ")} can't be configured. They follow from the DTAP stage, restore mode and WEBHARE_CI`);

  const declared: string[] = getExtractedConfig("serverroles").roles.map(role => role.name);
  const undeclared = roles.filter(role => !declared.includes(role));
  if (undeclared.length)
    throw new CLIRuntimeError(`Unknown role${undeclared.length > 1 ? "s" : ""} ${undeclared.join(", ")}: no installed module declares ${undeclared.length > 1 ? "them" : "it"}. Use 'wh config roles list' to see the available roles`);
}

async function updateStoredRoles(update: (current: string[]) => string[]) {
  const current = await readStoredRoles();
  const updated = parseServerRoles(update(current));
  if (updated.join(" ") !== current.join(" ")) {
    await runInWork(() => writeRegistryKey(serverRolesKey, updated.join(" ")));
    //Server roles affect which rules apply (ifWebHare serverRoles, ifserverroles), so apply the full configuration
    await applyConfiguration({ subsystems: ["all"], source: "wh config roles" });
  }

  console.log(`Configured roles: ${updated.join(" ") || "(none)"}`);
  const reason = getRolesOverrideReason();
  if (reason)
    console.warn(`Note: ${reason}`);
}

runCli({
  description: "Manage the WebHare configuration",
  subCommands: {
    roles: {
      shortDescription: "Manage the server roles of this server",
      description: "Manage the server roles of this server. Roles are declared by modules in the serverRoles section of their moduledefinition.yml",
      subCommands: {
        list: {
          description: "List all available roles and whether they're active",
          flags: {
            "j,json": { description: "Output in JSON format" }
          },
          async main({ opts }) {
            const active = getServerRoles();
            const stored = await readStoredRoles();
            const declared = getExtractedConfig("serverroles").roles;

            //Also list active or configured roles that no installed module declares
            const undeclared = [...new Set([...active, ...stored])].filter(role => !declared.some(_ => _.name === role));
            const roles = [
              ...declared.map(role => ({ role: role.name, title: role.title ? getTid(role.title) : "", builtin: role.isBuiltin })),
              ...undeclared.map(role => ({ role, title: "", builtin: false }))
            ].map(role => ({ ...role, active: active.includes(role.role), configured: stored.includes(role.role) }))
              .sort(compareProperties(["role"]));

            if (opts.json) {
              console.log(JSON.stringify(roles, null, 2));
              return;
            }

            console.table(roles.map(role => ({
              role: role.role,
              title: role.title,
              active: role.active,
              configured: role.configured,
              builtin: role.builtin //built-in roles can't be configured
            })));
            const reason = getRolesOverrideReason();
            if (reason)
              console.log(`Note: ${reason}`);
          }
        },
        add: {
          description: "Add roles to the configured roles",
          arguments: [{ name: "<roles...>", description: "Roles to add, eg 'mymodule:primary'" }],
          async main({ args }) {
            checkRoleNames(args.roles);
            await updateStoredRoles(current => [...current, ...args.roles]);
          }
        },
        remove: {
          description: "Remove roles from the configured roles",
          arguments: [{ name: "<roles...>", description: "Roles to remove" }],
          async main({ args }) {
            const current = await readStoredRoles();
            for (const role of args.roles.filter(_ => !current.includes(_)))
              console.warn(`Warning: the role '${role}' isn't configured`);
            await updateStoredRoles(roles => roles.filter(role => !args.roles.includes(role)));
          }
        }
      }
    }
  }
});
