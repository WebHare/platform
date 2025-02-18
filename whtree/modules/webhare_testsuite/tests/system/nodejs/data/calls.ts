import { HSVMMarshallableOpaqueObject } from "@webhare/harescript/src/wasm-proxies";
import { generateRandomId } from "@webhare/std";
import { beginWork, isWorkOpen } from "@webhare/whdb";
import * as test from "@webhare/test";

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

class TestObject extends HSVMMarshallableOpaqueObject {
  #num: number;

  constructor(num: number) {
    super();
    this.#num = num;
  }

  get num() { return this.#num; }
}

const objects = new Map<number, TestObject>();

export function getObject(n: number) {
  const obj = new TestObject(n);
  objects.set(n, obj);
  return obj;
}

export function getObjectValue(o: TestObject) {
  test.assert(o === objects.get(o.num), "Verify stable identity of object on JS side");
  return o.num;
}

export function returnObject(o: TestObject) {
  return o;
}

export { isWorkOpen };
