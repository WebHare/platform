import { generateRandomId } from "@webhare/std";
import { beginWork, isWorkOpen } from "@webhare/whdb";

const random = generateRandomId();

export async function testAsync42() {
  return 42;
}

export async function testReject() {
  throw new Error("Rejection");
}

export function testSync43() {
  return 43;
}

export function getOnceRandom() {
  return random;
}

export function runVoid(): void {
  return;
}

export async function runAsyncVoid(): Promise<void> {
  return;
}

export async function leakWork() {
  await beginWork();
}

export { isWorkOpen };
