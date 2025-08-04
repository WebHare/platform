/** This library implements the AuthenticationSettings type */

import { decodeHSON, defaultDateTime, encodeHSON, HareScriptType, setHareScriptType } from "@webhare/hscompat";
import { createWebHarePasswordHash, isPasswordStillSecure, verifyWebHarePasswordHash } from "@webhare/hscompat/passwords";

interface HSONAuthenticationSettings {
  version: number;
  passwords?: Array<{ passwordhash: string; validfrom: Date }>;
  totp?: {
    url: string;
    backupcodes?: Array<{
      code: string;
      used?: Date;
    }>;
    locked?: Date;
  };
}

export class AuthenticationSettings {
  #passwords: Array<{ hash: string; validFrom: Date | null }> = [];
  #totp: {
    url: string;
    backupCodes: Array<{ code: string; used: Date | null }>;
    locked: Date | null;
  } | null = null;

  static fromPasswordHash(hash: string): AuthenticationSettings {
    const auth = new AuthenticationSettings;
    if (hash) //shouldn't set a validity date, the passord will look too recently changed and interfere with password resets
      auth.#passwords.push({ hash, validFrom: null });
    return auth;
  }

  static fromHSON(hson: string): AuthenticationSettings {
    const obj = decodeHSON(hson) as unknown as HSONAuthenticationSettings;
    if (typeof obj !== "object")
      throw new Error(`Expected a HSON encoded record, got '${typeof obj}'`);
    if (!obj || !("version" in obj))
      throw new Error("Missing version field");
    if (obj.version !== 1)
      throw new Error(`Unsupported authentication settings version ${obj.version}`);

    const auth = new AuthenticationSettings;
    if (Array.isArray(obj.passwords))
      for (const pwd of (obj.passwords ?? [])) {
        if (!pwd || !pwd.passwordhash || !pwd.validfrom)
          throw new Error("Invalid password record");
        auth.#passwords.push({ hash: pwd.passwordhash, validFrom: pwd.validfrom.getTime() === defaultDateTime.getTime() ? null : pwd.validfrom });
      }

    //FIXME we're not properly setting the various dates to 'null' currently, but to minimum datetime. we'll hit that as soon as we need to manipulate TOTP, but for now the round-trip works okay
    if (obj.totp) {
      auth.#totp = {
        url: obj.totp.url,
        backupCodes: (obj.totp.backupcodes ?? []).map(_ => ({ code: _.code, used: _.used ?? null })),
        locked: obj.totp.locked ?? null
      };
    }
    return auth;
  }

  toHSON() {
    const passwords = this.#passwords.map(_ => ({ passwordhash: _.hash, validfrom: _.validFrom ?? defaultDateTime }));
    setHareScriptType(passwords, HareScriptType.RecordArray);

    return encodeHSON({
      version: 1,
      passwords,
      totp: this.#totp ? {
        url: this.#totp.url,
        backupcodes: setHareScriptType(this.#totp.backupCodes.map(_ => ({ code: _.code, used: _.used ?? defaultDateTime })), HareScriptType.RecordArray),
        locked: this.#totp.locked ?? null
      } : null
    });
  }

  hasTOTP(): boolean {
    return Boolean(this.#totp);
  }

  getLastPasswordChange(): Temporal.Instant | null {
    return this.#passwords.at(-1)?.validFrom?.toTemporalInstant() ?? null;
  }

  isPasswordStillSecure(): boolean {
    return this.#passwords.length === 0 || isPasswordStillSecure(this.#passwords.at(-1)!.hash);
  }

  getNumPasswords(): number {
    return this.#passwords.length;
  }

  //TODO when to clear password? probably needs to be a WRD schema setting enforced on updateEntity
  /** Update the password in this setting
   * @param password - The new password
   * @param options - Options for updating the password
   * @param options.algorithm - The hash algorithm to use. If not set, use best known method (may change in future versions)
   * @param options.inPlace - Update the last password in place (if it exists), otherwise add to the list. Used to upgrade passwords to a new algorithm without changing the password history and resetting the password age
  */
  async updatePassword(password: string, options?: { algorithm?: "PLAIN" | "WHBF"; inPlace?: boolean }): Promise<void> {
    if (!password)
      throw new Error("Password cannot be empty");

    let hash = '';
    const alg = options?.algorithm ?? "WHBF"; //default to WHBF, which is the best known method
    if (alg === "PLAIN")
      hash = 'PLAIN:' + password;
    else if (alg === "WHBF")
      hash = await createWebHarePasswordHash(password);
    else
      throw new Error(`Unsupported password hash algorithm '${alg}'`);

    if (options?.inPlace && this.#passwords.length > 0)
      this.#passwords.at(-1)!.hash = hash;
    else
      this.#passwords.push({ hash, validFrom: new Date });
  }

  async verifyPassword(password: string): Promise<boolean> {
    if (!password || !this.#passwords.length)
      return false;

    const tryHash = this.#passwords[this.#passwords.length - 1].hash;
    if (tryHash.startsWith("PLAIN:"))
      return password === tryHash.substring(6);

    return await verifyWebHarePasswordHash(password, tryHash);
  }

  async isUsedSince(password: string, cutoff: Temporal.Instant): Promise<boolean> {
    for (let i = this.#passwords.length - 1; i >= 0; i--) {
      const tryHash = this.#passwords[i].hash;
      if (tryHash.startsWith("PLAIN:")) {
        if (password === tryHash.substring(6))
          return true;
      } else if (await verifyWebHarePasswordHash(password, tryHash))
        return true;
      const vf = this.#passwords[i].validFrom;
      if (!vf || vf.getTime() <= cutoff.epochMilliseconds)
        break;
    }
    return false;
  }
}
