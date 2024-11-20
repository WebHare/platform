import { WebHareBlob } from "@webhare/services";
import * as test from "@webhare/test-backend";
import { runJSBasedValidator } from "@mod-platform/js/devsupport/validation";

async function testYAMLVAlidations() {
  { //verify YAML syntax errors properly being reported
    const res = await runJSBasedValidator(WebHareBlob.from(`\n    "`), "mod::webhare_testsuite/moduledefinition.yml");
    test.eq([
      {
        resourcename: 'mod::webhare_testsuite/moduledefinition.yml',
        line: 2,
        col: 6,
        message: /Missing closing.*quote/,
        source: 'validation'
      }
    ], res.errors);
  }

  { //verify schema self-validation
    const res = await runJSBasedValidator(WebHareBlob.from(`
"$schema": http://json-schema.org/draft-07/schema#
type: object
disruption: "It should be 'description' not 'disruption'"
`), "mod::platform/data/schemas/moduledefinition.schema.yml");

    test.eqPartial([
      {
        resourcename: 'mod::platform/data/schemas/moduledefinition.schema.yml',
        //FIXME get line&col info, but it seems like we need validateSchema for that and that one isn't responding with the error
        line: 0,
        col: 0,
        message: /strict mode: unknown keyword.*disruption/,
        source: 'validation'
      }
    ], res.errors);
  }

  { //verify validation against schemas
    const res = await runJSBasedValidator(WebHareBlob.from(`
backendServices:
  invokeservice:
    clientFactory: "js/internal/util/jssupport.ts#getInvokeService"
    klubikWapperdam: false
`), "mod::webhare_testsuite/moduledefinition.yml");

    test.eqPartial([
      {
        //The location and error are not ideal, I'd rather see the property name mentioned. but AN error is better than NONE
        resourcename: 'mod::webhare_testsuite/moduledefinition.yml',
        line: 4,
        col: 5,
        message: /must NOT have additional properties/,
        source: 'validation'
      }
    ], res.errors);
  }
}

test.run([testYAMLVAlidations]);
