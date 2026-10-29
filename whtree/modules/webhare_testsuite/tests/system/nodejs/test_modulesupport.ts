import { gatherManagedServicesFromModDef } from "@mod-platform/js/bootstrap/servicemanager/gatherservices";
import { GenerateContext, getApplicabilityError, getMyApplicabilityInfo, readApplicableToWebHareNode, type LoadedModuleDefs } from "@mod-system/js/internal/generation/shared";
import { generateWebDesigns, type WebDesignsExtract } from "@mod-system/js/internal/generation/webdesigns";
import { listAllServiceTS } from "@mod-system/js/internal/generation/gen_services";
import { parseDocAsXML } from "@mod-system/js/internal/generation/xmlhelpers";
import { parseAndValidateModuleDefYMLText } from "@mod-webhare_testsuite/js/config/testhelpers";
import * as test from "@webhare/test";
import type { Element } from "@xmldom/xmldom";

async function testApplicability() {
  const baseApplicability = getMyApplicabilityInfo();
  baseApplicability.version = "5.6.1";
  test.eq(null, getApplicabilityError(baseApplicability, { ifModules: ["system"] }));
  test.eq(null, getApplicabilityError(baseApplicability, { ifModules: ["webhare_testsuite"] }));
  test.eq(null, getApplicabilityError(baseApplicability, { ifModules: ["webhare_testsuite>= 4.0"] }));
  test.eq(null, getApplicabilityError(baseApplicability, { ifModules: ["webhare_testsuite >= 4.0 <= 9.99"] }));
  test.eq(null, getApplicabilityError(baseApplicability, { ifModules: ["webhare_testsuite >= 4.0", "webhare_testsuite <= 9.99"] }));
  test.eq(/invalid version range/, getApplicabilityError(baseApplicability, { ifModules: ["webhare_testsuite>=.5"] }));
  test.eq(/Module 'webhare_testsuite' version '4.31.0' does not satisfy range '>=9.99.0'/, getApplicabilityError(baseApplicability, { ifModules: ["webhare_testsuite >= 9.99"] }));
  test.eq(/Module 'webhare_testsuite' version '4.31.0' does not satisfy range '>=9.100.0'/, getApplicabilityError(baseApplicability, { ifModules: ["webhare_testsuite >= 4.0", "webhare_testsuite > 9.99"] }));
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
  test.eq(null, getApplicabilityError(baseApplicability, readMockXML({ ifmodules: "webhare_testsuite" })));
  test.eq(null, getApplicabilityError(baseApplicability, readMockXML({ ifmodules: "webhare_testsuite >= 1.0" })));
  test.eq(null, getApplicabilityError(baseApplicability, readMockXML({ ifmodules: "webhare_testsuite >= 1.0 < 9.99" })));
  test.eq(null, getApplicabilityError(baseApplicability, readMockXML({ ifmodules: "webhare_testsuite>=1.0; webhare_testsuite < 9.99" })));
  test.eq(/invalid version range/, getApplicabilityError(baseApplicability, readMockXML({ ifmodules: "webhare_testsuite =.5" })));
  test.eq(/Module 'webhare_testsuite' version '4.31.0' does not satisfy range '>=9.100.0'/, getApplicabilityError(baseApplicability, readMockXML({ ifmodules: "webhare_testsuite > 9.99" })));
  test.eq(/Invalid module name 'System'/, getApplicabilityError(baseApplicability, readMockXML({ ifmodules: "System" })));
  test.eq(/Module 'adsfdfgfdbfadgas' is not installed/, getApplicabilityError(baseApplicability, readMockXML({ ifmodules: "adsfdfgfdbfadgas" })));

  test.eq(null, getApplicabilityError(baseApplicability, readMockXML({ ifenvironset: "WEBHARE_PLATFORM" })));
  test.eq(null, getApplicabilityError(baseApplicability, readMockXML({ ifenvironset: "WEBHARE_PLATFORM=" })));
  test.eq(/Requirement that should not be met is met:/, getApplicabilityError(baseApplicability, readMockXML({ unlessenvironset: "WEBHARE_PLATFORM" })));
  test.eq(/WEBHARE_PLATFORM.*set to '.*' not 'dummy'/, getApplicabilityError(baseApplicability, readMockXML({ ifenvironset: "WEBHARE_PLATFORM=dummy" })));
  test.eq(null, getApplicabilityError(baseApplicability, readMockXML({ ifenvironset: `WEBHARE_PLATFORM=${platform} WEBHARE_PLATFORM` })));
  test.eq(null, getApplicabilityError(baseApplicability, readMockXML({ unlessenvironset: "WEBHARE_PLATFORM=dummy OTHERENV" })));
  test.eq(/WEBHARE_PLATFORM/, getApplicabilityError(baseApplicability, readMockXML({ unlessenvironset: "WEBHARE_PLATFORM=" })));
  test.eq(/Requirement that should not be met is met/, getApplicabilityError(baseApplicability, readMockXML({ unlessenvironset: `WEBHARE_PLATFORM=${platform}` })));
  test.eq(/Requirement that should not be met is met/, getApplicabilityError(baseApplicability, readMockXML({ unlessenvironset: "WEBHARE_PLATFORM=dummy WEBHARE_PLATFORM" })));

  test.eq(/TESTDUMMY/, getApplicabilityError(baseApplicability, readMockXML({ ifenvironset: `TESTDUMMY` })));
  test.eq(/TESTDUMMY/, getApplicabilityError(baseApplicability, readMockXML({ ifenvironset: `TESTDUMMY=` })));
  test.eq(null, getApplicabilityError(baseApplicability, readMockXML({ unlessenvironset: `TESTDUMMY` })));
  test.eq(null, getApplicabilityError(baseApplicability, readMockXML({ unlessenvironset: `TESTDUMMY=` })));

  baseApplicability.env.TESTDUMMY = "";

  test.eq(/Required environment variable 'TESTDUMMY' not set/, getApplicabilityError(baseApplicability, readMockXML({ ifenvironset: `TESTDUMMY` })));
  test.eq(/Required environment variable 'TESTDUMMY' not set/, getApplicabilityError(baseApplicability, readMockXML({ ifenvironset: `TESTDUMMY=` })));
  test.eq(/Required environment variable 'TESTDUMMY' not set/, getApplicabilityError(baseApplicability, readMockXML({ ifenvironset: `TESTDUMMY=x` })));
  test.eq(null, getApplicabilityError(baseApplicability, readMockXML({ unlessenvironset: `TESTDUMMY` })));
  test.eq(null, getApplicabilityError(baseApplicability, readMockXML({ unlessenvironset: `TESTDUMMY=` })));
  test.eq(null, getApplicabilityError(baseApplicability, readMockXML({ unlessenvironset: `TESTDUMMY=x` })));

  baseApplicability.env.TESTDUMMY = "y";

  test.eq(null, getApplicabilityError(baseApplicability, readMockXML({ ifenvironset: `TESTDUMMY` })));
  test.eq(null, getApplicabilityError(baseApplicability, readMockXML({ ifenvironset: `TESTDUMMY=` })));
  test.eq(/not 'x'/, getApplicabilityError(baseApplicability, readMockXML({ ifenvironset: `TESTDUMMY=x` })));
  test.eq(/Requirement that should not be/, getApplicabilityError(baseApplicability, readMockXML({ unlessenvironset: `TESTDUMMY` })));
  test.eq(/Requirement that should not be/, getApplicabilityError(baseApplicability, readMockXML({ unlessenvironset: `TESTDUMMY=` })));
  test.eq(null, getApplicabilityError(baseApplicability, readMockXML({ unlessenvironset: `TESTDUMMY=x` })));

  test.eq(/WEBHARE_PLATFORM/, getApplicabilityError(baseApplicability, readMockXML({ unlessenvironset: "WEBHARE_PLATFORM TESTDUMMY=y" })));
  test.eq(/WEBHARE_PLATFORM/, getApplicabilityError(baseApplicability, readMockXML({ unlessenvironset: "WEBHARE_PLATFORM TESTDUMMY=x" })));
  test.eq(/TESTDUMMY/, getApplicabilityError(baseApplicability, readMockXML({ unlessenvironset: "WEBHARE_PLATFORM=dummy TESTDUMMY=y" })));
  test.eq(null, getApplicabilityError(baseApplicability, readMockXML({ unlessenvironset: "WEBHARE_PLATFORM=dummy TESTDUMMY=x" })));
}

async function testYMLTitles() {
  const moduledef: LoadedModuleDefs = {
    name: "publisher",
    resourceBase: "mod::publisher/",
    modXml: null,
    modYml: {
      module: "publisher",
      baseResourcePath: "mod::publisher/",
      webDesigns: {
        nodesign: { title: "No webdesign", siteProfile: "mod::webhare_testsuite/dummy.siteprl.yml", }
      },
      webFeatures: {
        literal: { title: "Literal feature" },
        translated: { tid: "features.translated" },
        untitled: {}
      }
    }
  };
  const context = new GenerateContext([moduledef], false);
  test.eq(":No webdesign", context.parseYMLTid(moduledef, { title: "No webdesign" }, "title"));
  test.eq(":Literal: title", context.parseYMLTid(moduledef, { title: "Literal: title" }, "title"));
  test.eq("publisher:titles.translated", context.parseYMLTid(moduledef, { tid: "titles.translated" }, "title"));
  test.eq("other:titles.translated", context.parseYMLTid(moduledef, { tid: "other:titles.translated" }, "title"));
  test.eq(":Description", context.parseYMLTid(moduledef, { description: "Description" }, "description"));
  test.eq("", context.parseYMLTid(moduledef, {}, "title"));

  const extract: WebDesignsExtract = JSON.parse(await generateWebDesigns(context));
  test.eq(":No webdesign", extract.webDesigns[0].title);
  test.eq([":Literal feature", "publisher:features.translated", ":publisher:untitled"], extract.webFeatures.map(feature => feature.title));
}

async function testModuleServices() {
  const modules = ["platform", "webhare_testsuite_service_a", "webhare_testsuite_service_b"];
  const context = new GenerateContext(modules.map(name => ({
    name,
    resourceBase: `mod::${name}/`,
    modXml: null,
    modYml: {
      module: name,
      baseResourcePath: `mod::${name}/`,
      rpcServices: { example: { api: "rpc.ts#ExampleService" } }
    }
  })), false);
  const files = await listAllServiceTS(modules);
  test.eq(["ts/services.ts", "ts/services.ts", "ts/webhare_testsuite_service_a/services.ts", "ts/webhare_testsuite_service_b/services.ts"], files.map(file => file.path));
  test.eq(["platform", "dummy-installed", ...modules.slice(1)], files.map(file => file.module));

  const builtin = await files[0].generator(context);
  test.eq(/"platform:example": typeof platform\$example;/, builtin);
  test.assert(!builtin.includes("webhare_testsuite_service_"));

  const aggregate = await files[1].generator(context);
  for (const module of modules.slice(1)) {
    test.eq(new RegExp(`import type \\{ \\} from "\\./${module}/services";`), aggregate);
    const definition = await files.find(file => file.module === module)!.generator(context);
    test.eq(new RegExp(`"${module}:example": typeof ${module}\\$example;`), definition);
    test.assert(!definition.includes(modules.find(name => name !== module && name !== "platform")!));
    test.assert(!definition.includes("platform:example"));
  }
  test.assert(!aggregate.includes("declare module"));
}

function testModuleDependencies() {
  const definitions = {
    application: `<dependency module="dependency" /><dependency module="dependency" /><dependency module="system" /><dependency module="missing" /><dependency module="unrelated" ifmodules="missing" />`,
    dependency: `<dependency module=" LEAF " /><dependency module="application" /><dependency module="unrelated" unlessenvironset="WEBHARE_PLATFORM" />`,
    leaf: `<dependency module="dependency" />`,
    system: `<dependency module="unrelated" />`,
    unrelated: ""
  };
  const context = new GenerateContext(Object.entries(definitions).map(([name, dependencies]) => ({
    name,
    resourceBase: `mod::${name}/`,
    modXml: parseDocAsXML(`<module xmlns="http://www.webhare.net/xmlns/system/moduledefinition"><meta><packaging>${dependencies}</packaging></meta></module>`, "text/xml"),
    modYml: null
  })), false);
  test.eq(["dependency", "leaf"], context.getModuleDependencies("application"));
  test.eq(["leaf", "application"], context.getModuleDependencies("dependency"));
  test.eq(["dependency", "application"], context.getModuleDependencies("leaf"));
  test.eq([], context.getModuleDependencies("system"));
  test.eq([], context.getModuleDependencies("unrelated"));
  test.eq([], context.getModuleDependencies("missing"));
  context.moduledefs[0].modXml = null;
  test.eq([], context.getModuleDependencies("application"));
}

test.runTests([
  testModuleDependencies,
  testModuleServices,
  testYMLTitles,
  testApplicability,
  testApplicabilityXML
]);
