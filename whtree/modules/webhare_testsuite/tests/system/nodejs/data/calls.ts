import { HSVMMarshallableOpaqueObject, type HSVMObjectWrapper } from "@webhare/harescript/src/wasm-proxies";
import { generateRandomId, toSnakeCase } from "@webhare/std";
import { beginWork, isWorkOpen } from "@webhare/whdb";
import * as test from "@webhare/test";
import { createFirstPartyToken } from "@webhare/auth";
import { getLastAuthAuditEvent } from "@mod-webhare_testsuite/js/wts-backend";
import { wrdTestschemaSchema } from "@mod-platform/generated/wrd/webhare";
import { WebHareBlob } from "@webhare/services";

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

export function getTimes() {
  return {
    date: new Date("2024-01-01T12:13:14Z"),
    instant: Temporal.Instant.from("2024-01-01T12:13:14Z"),
    zoned: Temporal.ZonedDateTime.from("2024-01-01T12:13:14[Europe/Amsterdam]"),
    plainDate: Temporal.PlainDate.from("2024-01-01"),
    plainDateTime: Temporal.PlainDateTime.from("2024-01-01T12:13:14"),
  };
}

export function echo(a: unknown) {
  return a;
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

export function crash() {
  console.error("crash() invoked!");
  process.exit(0);
}

export async function getThrowingProperty(p: HSVMObjectWrapper): Promise<number> {
  return await p.$get("p") as number;
}

export async function setThrowingProperty(p: HSVMObjectWrapper) {
  await p.$set("p", 10);
}

export async function testTokenAudit(user: number) {
  await createFirstPartyToken(wrdTestschemaSchema, "id", user);
  return toSnakeCase(await getLastAuthAuditEvent(wrdTestschemaSchema));
}

export async function getResourceFromDisk(path: string) {
  return WebHareBlob.fromDisk(path);
}

export async function getBlob(text: string) {
  return new Blob([text]);
}

export { isWorkOpen };
