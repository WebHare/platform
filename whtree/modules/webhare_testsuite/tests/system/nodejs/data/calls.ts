import { generateRandomId } from "@webhare/std";

const random = generateRandomId();

export async function test42() {
  return 42;
}

export function getOnceRandom() {
  return random;
}
