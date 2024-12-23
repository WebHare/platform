import { gatherManagedServicesFromModDef } from "@mod-platform/js/bootstrap/servicemanager/gatherservices";
import { getApplicabilityError, getMyApplicabilityInfo, readApplicableToWebHareNode } from "@mod-system/js/internal/generation/shared";
import { parseAndValidateModuleDefYMLText } from "@mod-webhare_testsuite/js/config/testhelpers";
import * as test from "@webhare/test";

async function testApplicability() {
  const baseApplicability = getMyApplicabilityInfo();
  baseApplicability.version = "5.6.1";
  test.eq(null, getApplicabilityError(baseApplicability, { ifModules: ["system"] }));
  test.eq(null, getApplicabilityError(baseApplicability, { whVersion: ">= 5.6.0" }));
  test.eq(/not a valid semver/, getApplicabilityError(baseApplicability, { whVersion: ">= .1" }));
  test.eq(/.*5\.6\.1.*does not satisfy range: <5\.6\.0/, getApplicabilityError(baseApplicability, { whVersion: "<  5.6.0" }));

  baseApplicability.version = "";
  baseApplicability.versionnum = 40800;
  test.eq(null, getApplicabilityError(baseApplicability, { whVersion: ">=4.8.0" }));
  test.eq(/WebHare version '4\.8\.0' does not satisfy range: >=5\.6\.0/, getApplicabilityError(baseApplicability, { whVersion: ">= 5.6.0" }));

  const servicedefs = gatherManagedServicesFromModDef(await parseAndValidateModuleDefYMLText(`
managedServices:
  service1:
    script: mod::system/scripts/internal/apprunner.whscr
    run: always
  service2:
    script: mod::system/scripts/internal/apprunner.whscr
    run: always
    ifWebHare:
      serverNames: ["dummyserver.example.com"]
  service3:
    script: mod::system/scripts/internal/apprunner.whscr
    run: on-demand
    ifWebHare:
      not:
      - not:
        - not:
          - serverNames: ["dummyserver.example.com"]
`));

  test.eq(["webhare_testsuite:service1", "webhare_testsuite:service3"], Object.keys(servicedefs).toSorted());
}

function readMockXML(attrs: Record<string, string>) {
  //an ugly but safe way to reproduce reading an XML node
  return readApplicableToWebHareNode(
    {
      getAttribute: (x: string) => x in attrs ? attrs[x] : null,
      hasAttribute: (x: string) => x in attrs
    } as unknown as Element, "");
}

function testApplicabilityXML() {
  const platform = process.env.WEBHARE_PLATFORM;
  test.assert(platform, `Cannot run this test if WEBHARE_PLATFORM is unset`);

  const baseApplicability = getMyApplicabilityInfo({ unsafeEnv: true });
  test.eq(null, getApplicabilityError(baseApplicability, readMockXML({})), `Empty settings should always be applicable`);
  test.eq(null, getApplicabilityError(baseApplicability, readMockXML({ ifmodules: "system; publisher" })));
  test.eq(/neversuchmodule.*not installed/, getApplicabilityError(baseApplicability, readMockXML({ ifmodules: "system; neversuchmodule" })));
  test.eq(null, getApplicabilityError(baseApplicability, readMockXML({ ifmodules: "system;;;" })));
  test.eq(/System.*not installed/, getApplicabilityError(baseApplicability, readMockXML({ ifmodules: "System" })));

  test.eq(null, getApplicabilityError(baseApplicability, readMockXML({ ifenvironset: "WEBHARE_PLATFORM" })));
  test.eq(/WEBHARE_PLATFORM/, getApplicabilityError(baseApplicability, readMockXML({ ifenvironset: "WEBHARE_PLATFORM=" })));
  test.eq(/Requirement that should not be met is met:/, getApplicabilityError(baseApplicability, readMockXML({ unlessenvironset: "WEBHARE_PLATFORM" })));
  test.eq(/WEBHARE_PLATFORM.*set to '.*' not 'dummy'/, getApplicabilityError(baseApplicability, readMockXML({ ifenvironset: "WEBHARE_PLATFORM=dummy" })));
  test.eq(null, getApplicabilityError(baseApplicability, readMockXML({ ifenvironset: `WEBHARE_PLATFORM=${platform} WEBHARE_PLATFORM` })));
  test.eq(null, getApplicabilityError(baseApplicability, readMockXML({ unlessenvironset: "WEBHARE_PLATFORM=dummy OTHERENV" })));
  test.eq(null, getApplicabilityError(baseApplicability, readMockXML({ unlessenvironset: "WEBHARE_PLATFORM=" })));
  test.eq(/Requirement that should not be met is met/, getApplicabilityError(baseApplicability, readMockXML({ unlessenvironset: `WEBHARE_PLATFORM=${platform}` })));
  test.eq(/Requirement that should not be met is met/, getApplicabilityError(baseApplicability, readMockXML({ unlessenvironset: "WEBHARE_PLATFORM=dummy WEBHARE_PLATFORM" })));

  test.eq(/TESTDUMMY/, getApplicabilityError(baseApplicability, readMockXML({ ifenvironset: `TESTDUMMY` })));
  test.eq(/TESTDUMMY/, getApplicabilityError(baseApplicability, readMockXML({ ifenvironset: `TESTDUMMY=` })));
  test.eq(null, getApplicabilityError(baseApplicability, readMockXML({ unlessenvironset: `TESTDUMMY` })));
  test.eq(null, getApplicabilityError(baseApplicability, readMockXML({ unlessenvironset: `TESTDUMMY=` })));

  baseApplicability.env.TESTDUMMY = "";

  test.eq(null, getApplicabilityError(baseApplicability, readMockXML({ ifenvironset: `TESTDUMMY` })));
  test.eq(null, getApplicabilityError(baseApplicability, readMockXML({ ifenvironset: `TESTDUMMY=` })));
  test.eq(/not 'x'/, getApplicabilityError(baseApplicability, readMockXML({ ifenvironset: `TESTDUMMY=x` })));
  test.eq(/Requirement that should not be/, getApplicabilityError(baseApplicability, readMockXML({ unlessenvironset: `TESTDUMMY` })));
  test.eq(/Requirement that should not be/, getApplicabilityError(baseApplicability, readMockXML({ unlessenvironset: `TESTDUMMY=` })));
  test.eq(null, getApplicabilityError(baseApplicability, readMockXML({ unlessenvironset: `TESTDUMMY=x` })));
}

test.runTests([
  testApplicability,
  testApplicabilityXML
]);
