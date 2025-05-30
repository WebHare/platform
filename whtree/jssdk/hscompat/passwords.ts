import { loadlib } from "@webhare/harescript";
import * as bcrypt from "bcrypt";

const expectRounds = 10;

export function isPasswordStillSecure(hash: string): boolean {
  if (!hash.startsWith("WHBF:$2y$"))
    return false;

  const rounds = parseInt(hash.split("$")[2], 10);
  return rounds >= expectRounds;
}

export async function verifyWebHarePasswordHash(password: string, hash: string): Promise<boolean> {
  if (hash.startsWith("PLAIN:"))
    return password === hash.substring(6);

  if (hash.startsWith("WHBF:$2y$"))
    return await bcrypt.compare(password, "$2b$" + hash.substring(9));

  return await loadlib("wh::crypto.whlib").VERIFYWEBHAREPASSWORDHASH(password, hash);
}

export async function createWebHarePasswordHash(password: string): Promise<string> {
  return "WHBF:$2y$" + (await bcrypt.hash(password, expectRounds)).substring(4);
}
