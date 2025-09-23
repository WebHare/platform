import type { ContentValidationFunction, ValidationState } from "@webhare/services";
import type { TestSchemaType } from "wh:schema/webhare_testsuite/testschematype";

export async function validateTestFile(resourceName: string, content: TestSchemaType, result: ValidationState): Promise<void> {
  if (content.answer !== 42) //FIXME how are we going to get the actual error line/number?
    result.messages.push({ type: "error", resourcename: resourceName, line: 0, col: 0, message: `Answer should be 42, not ${content.answer}`, source: "validation" });
}

validateTestFile satisfies ContentValidationFunction<TestSchemaType>;
