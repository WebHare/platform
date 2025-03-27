import type { PlatformDB } from "@mod-platform/generated/db/platform";
import { loadlib } from "@webhare/harescript";
import { beginWork, commitWork, db } from "@webhare/whdb";

export interface TestIndexDocType {
  "@timestamp": string;
  title: string;
}

export interface TestSuffixedTestType {
  no: { such: { field: { yet: number } } };
}

export async function prepConsilioTests() {
  //FIXME:      // TestEq(1, Length(SELECT FROM ListIndexManagers() WHERE isbuiltin), "One OpenSearch must exist");

  //Force deletion and recreation, they'll be garbage collected - but leave managed indices alone, our test doesn't use them and recreation takes time
  await beginWork();
  await db<PlatformDB>().deleteFrom("consilio.catalogs").where("name", "like", "consilio:testfw_%").execute();
  await db<PlatformDB>().deleteFrom("consilio.catalogs").where("name", "like", "webhare_testsuite:%").execute();
  await commitWork();

  await loadlib("mod::consilio/lib/internal/updateindices.whlib").FixConsilioIndices({ catalogmask: "webhare_testsuite:*" });
}
