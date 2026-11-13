/* Rotation of the cluster secrets (system:webserver.security.*secret)

   Rotating a secret generates a new one and moves the old one to the retiredsecrets registry key, from which
   gen_config.ts copies it into platform.json. TypeScript and HareScript then recognize data encrypted or signed with
   it (see @webhare/services/src/retiredsecrets.ts). A retired secret goes through these states:
   - accepted: used for decryption by scopes that pass acceptRetired
   - disabled: never accepted, but still checked to log that it's being used
   - deleted: removed from the registry, no longer recognized at all
*/

import * as crypto from "node:crypto";
import { applyConfiguration, readLogLines, readRegistryKey, writeRegistryKey } from "@webhare/services";
import type { ClusterSecretType, RetiredSecret } from "@webhare/services/src/config";
import { runInWork } from "@webhare/whdb";
import { parseRetiredSecrets } from "@mod-system/js/internal/generation/gen_config_nodb";

export const clusterSecretTypes: readonly ClusterSecretType[] = ["cache", "cookie", "debug", "gcm"];

const registryKeys = {
  cache: "system:webserver.security.cachesecret",
  cookie: "system:webserver.security.cookiesecret",
  debug: "system:webserver.security.debugsecret",
  gcm: "system:webserver.security.gcmsecret",
} as const;

const retiredSecretsKey = "system:webserver.security.retiredsecrets";

/** Generate a new secret in the same format initdb.whscr uses */
function generateSecret(type: ClusterSecretType): string {
  if (type === "gcm")
    return crypto.randomBytes(32).toString("base64url"); //the key itself
  return crypto.randomBytes(16).toString("base64url") + crypto.randomBytes(16).toString("base64url");
}

/** Get a short identifier for a secret that doesn't reveal it */
export function getSecretFingerprint(type: ClusterSecretType, secret: string): string {
  return crypto.createHash("SHA-256").update(type + ":" + secret).digest("hex").substring(0, 8);
}

async function readRetiredSecrets(): Promise<RetiredSecret[]> {
  const value = await readRegistryKey(retiredSecretsKey);
  if (!value)
    return [];
  try {
    return parseRetiredSecrets(JSON.parse(value));
  } catch (e) {
    throw new Error(`The registry key ${retiredSecretsKey} is damaged: ${(e as Error).message}`);
  }
}

async function writeRetiredSecrets(retired: RetiredSecret[]) {
  await writeRegistryKey(retiredSecretsKey, retired.length ? JSON.stringify(retired) : "");
}

/** Update platform.json and the webserver configuration after changing the secrets */
async function applySecrets(verbose: boolean) {
  //platform.json first. Its system:configupdate broadcast tells other processes to reload their secrets
  await applyConfiguration({ subsystems: ["config.base"], source: "wh auth rotate-secrets", verbose });
  //The webserver's debug tags are derived from the debug secret
  await applyConfiguration({ subsystems: ["webserver"], source: "wh auth rotate-secrets", verbose });
}

export type ClusterSecretInfo = {
  type: ClusterSecretType;
  id: string;
};

export type RetiredSecretInfo = Omit<RetiredSecret, "secret">;

/** List the current and retired secrets, without revealing the secrets themselves */
export async function listClusterSecrets(): Promise<{ current: ClusterSecretInfo[]; retired: RetiredSecretInfo[] }> {
  const current: ClusterSecretInfo[] = [];
  for (const type of clusterSecretTypes) {
    const secret = await readRegistryKey(registryKeys[type]);
    current.push({ type, id: secret ? getSecretFingerprint(type, secret) : "" });
  }
  return {
    current,
    retired: (await readRetiredSecrets()).map(({ secret, ...rest }) => rest)
  };
}

/** Replace secrets with newly generated ones, keeping the old ones as retired secrets
    @param types - Secrets to rotate
    @param options.compromised - The secrets leaked. Disable the retired secrets immediately so they're never accepted
    @returns The retired secrets */
export async function rotateClusterSecrets(types: ClusterSecretType[], options?: { compromised?: boolean; verbose?: boolean }): Promise<RetiredSecretInfo[]> {
  const now = new Date().toISOString();
  const newlyRetired: RetiredSecret[] = [];

  await runInWork(async () => {
    const retired = await readRetiredSecrets();
    for (const type of new Set(types)) {
      const oldSecret = await readRegistryKey(registryKeys[type]);
      if (oldSecret) {
        const entry: RetiredSecret = {
          id: getSecretFingerprint(type, oldSecret),
          type,
          secret: oldSecret,
          retiredAt: now,
          compromised: Boolean(options?.compromised),
          disabledSince: options?.compromised ? now : null
        };
        newlyRetired.push(entry);
        //Most recently retired first, so it's tried first. Remove an older entry for the same secret (shouldn't happen)
        retired.splice(0, retired.length, entry, ...retired.filter(_ => _.id !== entry.id || _.type !== type));
      }
      await writeRegistryKey(registryKeys[type], generateSecret(type));
    }
    await writeRetiredSecrets(retired);
  }, { mutex: "platform:rotatesecrets" });

  await applySecrets(Boolean(options?.verbose));
  return newlyRetired.map(({ secret, ...rest }) => rest);
}

/** Update the retired secrets
    @param update - Callback receiving the list of retired secrets and the secret with the given id. Returns the updated list */
async function updateRetiredSecret(id: string, update: (retired: RetiredSecret[], entry: RetiredSecret) => RetiredSecret[], options?: { verbose?: boolean }) {
  await runInWork(async () => {
    const retired = await readRetiredSecrets();
    const entry = retired.find(_ => _.id === id);
    if (!entry)
      throw new Error(`No retired secret with id '${id}'`);
    await writeRetiredSecrets(update(retired, entry));
  }, { mutex: "platform:rotatesecrets" });

  await applySecrets(Boolean(options?.verbose));
}

/** Stop accepting a retired secret. It's still checked to log that it's being used */
export async function disableRetiredSecret(id: string, options?: { verbose?: boolean }) {
  await updateRetiredSecret(id, (retired, entry) => {
    entry.disabledSince ??= new Date().toISOString();
    return retired;
  }, options);
}

/** Accept a disabled retired secret again */
export async function enableRetiredSecret(id: string, options?: { verbose?: boolean }) {
  await updateRetiredSecret(id, (retired, entry) => {
    if (entry.compromised)
      throw new Error(`Retired secret '${id}' was compromised and cannot be enabled again`);
    entry.disabledSince = null;
    return retired;
  }, options);
}

/** Delete a retired secret. It won't be recognized at all anymore
    @param options.force - Also delete the secret if it's still accepted */
export async function deleteRetiredSecret(id: string, options?: { force?: boolean; verbose?: boolean }) {
  await updateRetiredSecret(id, (retired, entry) => {
    if (!entry.disabledSince && !options?.force)
      throw new Error(`Retired secret '${id}' is still accepted. Disable it first to see whether anything still uses it, or use --force`);
    return retired.filter(_ => _ !== entry);
  }, options);
}

export type RetiredSecretUsage = {
  id: string;
  /** Last time the secret was accepted (as logged, at most once per 10 minutes per process) */
  lastAccepted: Temporal.Instant | null;
  /** Scopes that had tokens accepted with this secret */
  acceptedScopes: string[];
  /** Number of logged rejections. The log is rate limited so there may have been more */
  rejected: number;
  lastRejected: Temporal.Instant | null;
  /** Scopes that had tokens rejected */
  rejectedScopes: string[];
  /** Client IPs that sent rejected tokens (where known) */
  rejectedIps: string[];
};

type RetiredSecretNotice = {
  event?: string;
  secretid?: string;
  scope?: string;
  ip?: string;
};

/** Collect the use of retired secrets from the notice log */
export async function getRetiredSecretUsage(options?: { start?: Date }): Promise<Map<string, RetiredSecretUsage>> {
  const usage = new Map<string, RetiredSecretUsage>();
  for await (const line of readLogLines("system:notice", { start: options?.start })) {
    const data = line.data as RetiredSecretNotice | undefined;
    if (!data || typeof data !== "object" || typeof data.secretid !== "string" || typeof data.event !== "string")
      continue;
    const accepted = data.event === "platform:retired-secret-accepted";
    if (!accepted && data.event !== "platform:retired-secret-rejected")
      continue;

    let entry = usage.get(data.secretid);
    if (!entry) {
      entry = { id: data.secretid, lastAccepted: null, acceptedScopes: [], rejected: 0, lastRejected: null, rejectedScopes: [], rejectedIps: [] };
      usage.set(data.secretid, entry);
    }

    const scope = typeof data.scope === "string" ? data.scope : "";
    if (accepted) {
      entry.lastAccepted = line["@timestamp"];
      if (scope && !entry.acceptedScopes.includes(scope))
        entry.acceptedScopes.push(scope);
    } else {
      ++entry.rejected;
      entry.lastRejected = line["@timestamp"];
      if (scope && !entry.rejectedScopes.includes(scope))
        entry.rejectedScopes.push(scope);
      if (typeof data.ip === "string" && data.ip && !entry.rejectedIps.includes(data.ip))
        entry.rejectedIps.push(data.ip);
    }
  }
  return usage;
}
