import { createVM, loadlib } from "@webhare/harescript";
import { applyConfiguration, decryptForThisServer, encryptForThisServer, getSignatureForThisServer, readLogLines, readRegistryKey, validateSignatureForThisServer, writeRegistryKey } from "@webhare/services";
import { Money } from "@webhare/std";
import * as test from "@webhare/test";
import { runInWork } from "@webhare/whdb";
import { getFullConfigFile } from "@mod-system/js/internal/configuration";
import { updateWebHareConfigFile } from "@mod-system/js/internal/generation/gen_config";
import * as crypto from "node:crypto";
import { getUCPacketHash, getUCSubUrl, type ResourceMetadata } from "@webhare/services/src/descriptor";
import { analyzeUnifiedURLToken } from "@webhare/services/src/unifiedcache";
import { deleteRetiredSecret, disableRetiredSecret, enableRetiredSecret, getRetiredSecretUsage, getSecretFingerprint, listClusterSecrets, rotateClusterSecrets } from "@mod-platform/js/auth/secret-rotation";

declare module "@webhare/services" {
  interface ServerEncryptionScopes {
    "webhare_testsuite:string": string;
    "webhare_testsuite:data": {
      test: number;
      date: Date;
      money: Money;
    };
    "webhare_testsuite:simple": boolean | number | Date | null;
  }
}

async function testCryptForServer() {
  test.typeAssert<test.Assignable<number, 2>>();
  test.typeAssert<test.Equals<string, ReturnType<typeof decryptForThisServer < "webhare_testsuite:string" >>>>();

  // @ts-expect-error -- and not something else:
  test.typeAssert<test.Equals<boolean, ReturnType<typeof decryptForThisServer < "webhare_testsuite:string" >>>>();
  // @ts-expect-error -- and not something else:
  test.typeAssert<test.Equals<unknown, ReturnType<typeof decryptForThisServer < "webhare_testsuite:string" >>>>();

  // @ts-expect-error -- should fail because of incorrect type
  encryptForThisServer("webhare_testsuite:string", 16);

  const roundtrip1 = encryptForThisServer("webhare_testsuite:string", "Hello, world!");
  test.eq(/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/, roundtrip1);
  test.eq("Hello, world!", decryptForThisServer("webhare_testsuite:string", roundtrip1));
  test.throws(/unable to authenticate|bad decrypt/, () => decryptForThisServer("webhare_testsuite:otherscope", roundtrip1), "invalid scope should fail decryption");
  test.eq(null, decryptForThisServer("webhare_testsuite:otherscope", roundtrip1, { nullIfInvalid: true }), "invalid scope should return null when nullIfInvalid is enabled");
  test.eq(null, decryptForThisServer("webhare_testsuite:string", "invalid-token", { nullIfInvalid: true }), "malformed encrypted data should return null when nullIfInvalid is enabled");

  //Test compatibility with Legacy HareScript
  test.eq("Hello, world!", await loadlib("mod::system/lib/services.whlib").DecryptForThisServer("webhare_testsuite:string", roundtrip1));

  const from_native_hs = await loadlib("mod::system/lib/services.whlib").EncryptForThisServer("webhare_testsuite:string2", "Hallo, Wereld") as string;
  test.eq(/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/, from_native_hs);
  test.eq("Hallo, Wereld", decryptForThisServer("webhare_testsuite:string2", from_native_hs));

  //Test compatibility with WASM HareScript
  test.eq("Hello, world!", await loadlib("mod::system/lib/services.whlib").DecryptForThisServer("webhare_testsuite:string", roundtrip1));

  const from_wasm_hs = await loadlib("mod::system/lib/services.whlib").EncryptForThisServer("webhare_testsuite:string2", "Hallo, Wereld");
  test.eq(/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/, from_wasm_hs);
  test.eq("Hallo, Wereld", decryptForThisServer("webhare_testsuite:string2", from_wasm_hs));

  //crypt should support JSON-like data
  const testdata = { test: 42, date: new Date("2022-01-01"), money: new Money("42.42") };
  const roundtrip_js = encryptForThisServer("webhare_testsuite:data", testdata);
  test.eq(testdata, decryptForThisServer("webhare_testsuite:data", roundtrip_js));

  //test compatibility. now that primitives have been verified, dont bother with the legacy HareScript engine
  test.eq(testdata, await loadlib("mod::system/lib/services.whlib").DecryptForThisServer("webhare_testsuite:data", roundtrip_js));

  //test tricky strings that look like specific encoding but should still pass through
  for (const trickyString of ['test', '{"test"}', 'hson:"test"']) {
    const tricky_from_ts = encryptForThisServer("webhare_testsuite:tricky", trickyString);
    test.eq(trickyString, decryptForThisServer("webhare_testsuite:tricky", tricky_from_ts));
    test.eq(trickyString, await loadlib("mod::system/lib/services.whlib").DecryptForThisServer("webhare_testsuite:tricky", tricky_from_ts));

    const tricky_from_hs = await loadlib("mod::system/lib/services.whlib").EncryptForThisServer("webhare_testsuite:tricky", trickyString);
    test.eq(trickyString, decryptForThisServer("webhare_testsuite:tricky", tricky_from_hs));
    test.eq(trickyString, await loadlib("mod::system/lib/services.whlib").DecryptForThisServer("webhare_testsuite:tricky", tricky_from_hs));
  }

  //and ensure we support the simple things fully
  for (const simpleThing of [false, true, null, 42, 8.125, new Date("2023-01-01")]) {
    const simple_from_ts = encryptForThisServer("webhare_testsuite:simple", simpleThing);
    test.eq(simpleThing, decryptForThisServer("webhare_testsuite:simple", simple_from_ts));
    test.eq(simpleThing, await loadlib("mod::system/lib/services.whlib").DecryptForThisServer("webhare_testsuite:simple", simple_from_ts));

    const simple_from_hs = await loadlib("mod::system/lib/services.whlib").EncryptForThisServer("webhare_testsuite:simple", simpleThing);
    test.eq(simpleThing, decryptForThisServer("webhare_testsuite:simple", simple_from_hs));
    test.eq(simpleThing, await loadlib("mod::system/lib/services.whlib").DecryptForThisServer("webhare_testsuite:simple", simple_from_hs));
  }

  //Verify support for custom encryption secrets (technically allowing you to encrypot for another server than 'this')
  const customSecret = "webhare_testsuite:string2";
  const roundtripCK = encryptForThisServer("webhare_testsuite:string", "Hello, world!", { secret: customSecret });
  test.eq(/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/, roundtripCK);
  test.throws(/unable to authenticate|bad decrypt/, () => decryptForThisServer("webhare_testsuite:string", roundtripCK), "should not be able to decrypt with default secret");
  test.throws(/unable to authenticate|bad decrypt/, () => decryptForThisServer("webhare_testsuite:string", roundtripCK, { secret: customSecret + "1" }), "should not be able to decrypt with wrong secret");
  test.eq(null, decryptForThisServer("webhare_testsuite:string", roundtripCK, { secret: customSecret + "1", nullIfInvalid: true }), "wrong secret should return null when nullIfInvalid is enabled");
  test.eq("Hello, world!", decryptForThisServer("webhare_testsuite:string", roundtripCK, { secret: customSecret }));
}

/** Encrypt like encryptForThisServer, but with a specific cluster GCM secret */
function encryptWithGCMSecret(gcmSecret: string, scope: string, data: string) {
  const key = crypto.createHash("SHA-256").update(gcmSecret, "base64url").update(scope, "utf8").digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = cipher.update(JSON.stringify(data), "utf8", "base64url") + cipher.final("base64url");
  return `${enc}.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
}

function signWithCookieSecret(cookieSecret: string, scope: string, text: string) {
  return crypto.createHash("SHA-256").update(text + "\t" + scope + "\t" + cookieSecret).digest().toString("base64url");
}

async function setRetiredSecrets(value: string) {
  await runInWork(() => writeRegistryKey("system:webserver.security.retiredsecrets", value));
  await updateWebHareConfigFile();
}

async function testRetiredSecrets() {
  const hsServices = loadlib("mod::system/lib/services.whlib");
  const hsSecrets = loadlib("mod::system/lib/internal/cluster/secrets.whlib");
  const scope = "webhare_testsuite:retired";
  const start = new Date;

  const acceptedGCM = crypto.randomBytes(32).toString("base64url");
  const disabledGCM = crypto.randomBytes(32).toString("base64url");
  const retiredCookie = crypto.randomBytes(32).toString("base64url");
  const malformedGCM = crypto.randomBytes(32).toString("base64url");
  const tokAccepted = encryptWithGCMSecret(acceptedGCM, scope, "accepted");
  const tokDisabled = encryptWithGCMSecret(disabledGCM, scope, "disabled");
  const sigRetired = signWithCookieSecret(retiredCookie, scope, "text");
  const tokMalformed = encryptWithGCMSecret(malformedGCM, scope, "malformed");

  //Image cache URLs are signed with the cache secret. Re-sign a current URL with retired secrets
  const acceptedCache = crypto.randomBytes(16).toString("base64url");
  const disabledCache = crypto.randomBytes(16).toString("base64url");
  const exampleImage = { width: 320, height: 240, mediaType: "image/png", hash: "u4HI1_mWV8E0UWndfoBvwsQr4PxwK7pdZLzYjWSw_0Q", refPoint: null, dbLoc: { source: 1, id: 123, cc: 456 } } as ResourceMetadata;
  const ucPacket = Buffer.from(getUCSubUrl({ method: "fill", width: 25, height: 25, format: "keep" }, exampleImage, 1, ".png").substring(8), "hex");
  const ucToken = (secret?: string) => `i${getUCPacketHash(ucPacket, ".png", secret)}${ucPacket.toString("hex")}/image.png`;
  const analyzeHSToken = async (token: string) => Boolean(await loadlib("mod::system/lib/internal/cache/imgcache.whlib").AnalyzeUnifiedURLToken(token));

  //Make sure HareScript has cached the current secrets, so we also test that it picks up the change
  test.eq("fallback", await hsServices.DecryptForThisServer(scope, tokAccepted, { fallback: "fallback", acceptretired: true }));

  const original = await readRegistryKey("system:webserver.security.retiredsecrets");
  try {
    const retiredAt = new Date().toISOString();
    await setRetiredSecrets(JSON.stringify([
      { id: "test-accepted", type: "gcm", secret: acceptedGCM, retiredAt, compromised: false, disabledSince: null },
      { id: "test-disabled", type: "gcm", secret: disabledGCM, retiredAt, compromised: true, disabledSince: retiredAt },
      { id: "test-cookie", type: "cookie", secret: retiredCookie, retiredAt, compromised: false, disabledSince: null },
      { id: "test-cache", type: "cache", secret: acceptedCache, retiredAt, compromised: false, disabledSince: null },
      { id: "test-cachedisabled", type: "cache", secret: disabledCache, retiredAt, compromised: false, disabledSince: retiredAt },
      { id: "test-broken", type: "nosuchtype", secret: "x", retiredAt },
      //Entries whose state can't be trusted must be dropped, not treated as accepted secrets
      { id: "test-baddisabled", type: "gcm", secret: malformedGCM, retiredAt, compromised: false, disabledSince: 12345 },
      { id: "test-emptydisabled", type: "gcm", secret: malformedGCM, retiredAt, compromised: false, disabledSince: "" },
      { id: "test-badcompromised", type: "gcm", secret: malformedGCM, retiredAt, compromised: "no", disabledSince: null },
      { id: "test-nocompromised", type: "gcm", secret: malformedGCM, retiredAt, disabledSince: null }
    ]));
    test.eq(["test-accepted", "test-disabled", "test-cookie", "test-cache", "test-cachedisabled"], getFullConfigFile().secrets.retired?.map(_ => _.id), "malformed entries should be dropped");

    //TypeScript: only accept retired secrets when asked, and never disabled ones
    test.throws(/unable to authenticate|bad decrypt/, () => decryptForThisServer(scope, tokAccepted));
    test.eq("accepted", decryptForThisServer(scope, tokAccepted, { acceptRetired: true }));
    test.throws(/unable to authenticate|bad decrypt/, () => decryptForThisServer(scope, tokDisabled, { acceptRetired: true }));
    test.eq(null, decryptForThisServer(scope, tokDisabled, { acceptRetired: true, nullIfInvalid: true }));
    test.eq(null, decryptForThisServer(scope, tokMalformed, { acceptRetired: true, nullIfInvalid: true }), "secrets from malformed entries should never be accepted");
    test.eq(false, validateSignatureForThisServer(scope, "text", sigRetired), "signatures never accept retired secrets");
    test.eq(true, validateSignatureForThisServer(scope, "text", getSignatureForThisServer(scope, "text")));

    //Image cache URLs signed with a retired cache secret are accepted until it's disabled
    test.assert(analyzeUnifiedURLToken(ucToken()));
    test.assert(analyzeUnifiedURLToken(ucToken(acceptedCache)));
    test.eq(null, analyzeUnifiedURLToken(ucToken(disabledCache)));
    test.eq(null, analyzeUnifiedURLToken(ucToken(crypto.randomBytes(16).toString("base64url"))));

    //HareScript should see the change (its cache is invalidated by system:configupdate)
    await test.wait(async () => await hsServices.DecryptForThisServer(scope, tokAccepted, { fallback: "", acceptretired: true }) === "accepted");
    await test.throws(/Value decryption failed/, () => hsServices.DecryptForThisServer(scope, tokAccepted));
    await test.throws(/Value decryption failed/, () => hsServices.DecryptForThisServer(scope, tokDisabled, { acceptretired: true }));
    test.eq(false, await hsSecrets.ValidateSignatureForThisServer(scope, "text", sigRetired));
    test.eq(true, await hsSecrets.ValidateSignatureForThisServer(scope, "text", getSignatureForThisServer(scope, "text")));

    test.assert(await analyzeHSToken(ucToken()));
    test.assert(await analyzeHSToken(ucToken(acceptedCache)));
    test.eq(false, await analyzeHSToken(ucToken(disabledCache)));
    test.eq(false, await analyzeHSToken(ucToken(crypto.randomBytes(16).toString("base64url"))));

    //Legacy (Blowfish) encryption uses the cookie secret. Only HareScript supports it
    const legacyAlgorithm = "SHA-1,BLOWFISH+CBC,8";
    const tokLegacy = await loadlib("wh::crypto.whlib").EncryptAndSignData("legacy", legacyAlgorithm, retiredCookie + scope) as string;
    await test.throws(/Value decryption failed/, () => hsServices.DecryptForThisServer(scope, tokLegacy, { algorithm: legacyAlgorithm }));
    test.eq("legacy", await hsServices.DecryptForThisServer(scope, tokLegacy, { algorithm: legacyAlgorithm, acceptretired: true }));

    //The notice throttling is shared by all VMs in the process (a native webserver request gets a fresh VM), so another VM shouldn't log the accepted use again
    {
      await using otherVM = await createVM();
      test.eq("accepted", await otherVM.loadlib("mod::system/lib/services.whlib").DecryptForThisServer(scope, tokAccepted, { acceptretired: true }));
    }

    //Every use should be in the notice log
    type SecretNotice = { event: string; secretid: string; scope: string; engine: string; reason?: string };
    const notices: Array<{ type: string } & SecretNotice> = [];
    for await (const line of readLogLines("system:notice", { start }))
      if (line.data && typeof line.data === "object" && String((line.data as SecretNotice).event).startsWith("platform:retired-secret-") && [scope, "platform:unifiedcache"].includes((line.data as SecretNotice).scope))
        notices.push({ type: String(line.type), ...line.data as SecretNotice });

    for (const engine of ["typescript", "harescript"]) {
      test.eq([{ type: "info" }], notices.filter(_ => _.engine === engine && _.secretid === "test-accepted" && _.event === "platform:retired-secret-accepted").map(_ => ({ type: _.type })), `${engine}: accepted use should be logged once (it's throttled)`);
      test.assert(notices.some(_ => _.engine === engine && _.secretid === "test-accepted" && _.event === "platform:retired-secret-rejected" && _.reason === "scope" && _.type === "warning"), `${engine}: retired secret rejected by scope`);
      test.assert(notices.some(_ => _.engine === engine && _.secretid === "test-disabled" && _.event === "platform:retired-secret-rejected" && _.reason === "disabled" && _.type === "error"), `${engine}: disabled compromised secret should log an error`);
      test.assert(notices.some(_ => _.engine === engine && _.secretid === "test-cookie" && _.event === "platform:retired-secret-rejected" && _.reason === "scope"), `${engine}: signature with retired secret`);
      test.assert(notices.some(_ => _.engine === engine && _.secretid === "test-cache" && _.event === "platform:retired-secret-accepted"), `${engine}: image cache URL with retired cache secret`);
      test.assert(notices.some(_ => _.engine === engine && _.secretid === "test-cachedisabled" && _.event === "platform:retired-secret-rejected" && _.reason === "disabled"), `${engine}: image cache URL with disabled cache secret`);
    }
    test.assert(notices.some(_ => _.engine === "harescript" && _.secretid === "test-cookie" && _.event === "platform:retired-secret-accepted"), "harescript: legacy decryption with retired cookie secret");
  } finally {
    await setRetiredSecrets(original);
  }
}

async function testSecretRotation() {
  const scope = "webhare_testsuite:rotation";
  const start = new Date;
  const keys = ["system:webserver.security.cachesecret", "system:webserver.security.cookiesecret", "system:webserver.security.debugsecret", "system:webserver.security.gcmsecret", "system:webserver.security.retiredsecrets"] as const;
  const original = new Map<string, string>();
  for (const key of keys)
    original.set(key, await readRegistryKey(key));

  const findRetired = async (id: string) => (await listClusterSecrets()).retired.find(_ => _.id === id);
  const waitForRetiredState = (id: string, disabled: boolean) => test.wait(() => getFullConfigFile().secrets.retired?.some(_ => _.id === id && Boolean(_.disabledSince) === disabled) ?? false);

  try {
    const oldGCM = getFullConfigFile().secrets.gcm;
    const oldCache = getFullConfigFile().secrets.cache;
    const tokOld = encryptForThisServer(scope, "before rotation");
    const sigOld = getSignatureForThisServer(scope, "text");

    //Rotate gcm and cookie. The other secrets should stay as they are
    const retired = await rotateClusterSecrets(["gcm", "cookie"]);
    test.eq(["gcm", "cookie"], retired.map(_ => _.type));
    const gcmId = retired[0].id;
    test.eq(getSecretFingerprint("gcm", oldGCM), gcmId);
    test.eq(null, retired[0].disabledSince);
    test.assert(!("secret" in retired[0]), "never return the secret itself");

    await test.wait(() => getFullConfigFile().secrets.gcm !== oldGCM);
    test.eq(oldCache, getFullConfigFile().secrets.cache);

    //Old tokens only work for scopes that accept retired secrets, old signatures don't work at all
    test.throws(/unable to authenticate|bad decrypt/, () => decryptForThisServer(scope, tokOld));
    test.eq("before rotation", decryptForThisServer(scope, tokOld, { acceptRetired: true }));
    test.eq(false, validateSignatureForThisServer(scope, "text", sigOld));
    //New tokens work
    test.eq("after rotation", decryptForThisServer(scope, encryptForThisServer(scope, "after rotation")));

    const list = await listClusterSecrets();
    test.eq(getSecretFingerprint("gcm", getFullConfigFile().secrets.gcm), list.current.find(_ => _.type === "gcm")?.id);
    test.assert(!JSON.stringify(list).includes(oldGCM), "list should never reveal secrets");

    //Disable, enable, delete
    await test.throws(/still accepted/, () => deleteRetiredSecret(gcmId));
    await disableRetiredSecret(gcmId);
    await waitForRetiredState(gcmId, true);
    test.throws(/unable to authenticate|bad decrypt/, () => decryptForThisServer(scope, tokOld, { acceptRetired: true }));

    await enableRetiredSecret(gcmId);
    await waitForRetiredState(gcmId, false);
    test.eq("before rotation", decryptForThisServer(scope, tokOld, { acceptRetired: true }));

    await disableRetiredSecret(gcmId);
    await deleteRetiredSecret(gcmId);
    test.eq(undefined, await findRetired(gcmId));
    await test.throws(/No retired secret/, () => disableRetiredSecret(gcmId));

    //Compromised secrets are disabled immediately and can't be enabled again
    const [debugRetired] = await rotateClusterSecrets(["debug"], { compromised: true });
    test.eq({ type: "debug", compromised: true }, { type: debugRetired.type, compromised: debugRetired.compromised });
    test.assert(debugRetired.disabledSince);
    await test.throws(/compromised/, () => enableRetiredSecret(debugRetired.id));

    //The usage report should have seen the accepted and rejected tokens
    const usage = (await getRetiredSecretUsage({ start })).get(gcmId);
    test.eq([scope], usage?.acceptedScopes);
    test.assert(usage && usage.rejected > 0 && usage.rejectedScopes.includes(scope));
  } finally {
    await runInWork(async () => {
      for (const [key, value] of original)
        await writeRegistryKey(key as typeof keys[number], value);
    });
    await applyConfiguration({ subsystems: ["config.base", "webserver"], source: "test_services_secrets" });
  }
}

test.runTests(
  [
    testCryptForServer,
    testRetiredSecrets,
    testSecretRotation
  ]);
