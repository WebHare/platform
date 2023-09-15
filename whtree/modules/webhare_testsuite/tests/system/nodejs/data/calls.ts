import { generateRandomId } from "@webhare/std";

const random = generateRandomId();

export async function testAsync42() {
  return 42;
}

export function testSync43() {
  return 43;
}

export function getOnceRandom() {
  return random;
}
