import type { TrackedYAML } from "@mod-platform/js/devsupport/validation";
import type { ContentValidationFunction, ValidationState } from "@webhare/services";
import type { TestSchemaType } from "wh:schema/webhare_testsuite/testschematype";

export async function validateTestFile(resourceName: string, content: TrackedYAML<TestSchemaType>, result: ValidationState): Promise<void> {
  if (content.doc.root?.answer !== 42) //FIXME how are we going to get the actual error line/number?
    result.messages.push({ type: "error", resourcename: resourceName, line: 0, col: 0, ...content.getPosition(content.doc.root), message: `Answer should be 42, not ${content.doc.root?.answer}`, source: "validation" });
}

validateTestFile satisfies ContentValidationFunction<TestSchemaType>;
