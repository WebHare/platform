import type { ValueConstraints } from "@mod-platform/generated/schema/siteprofile";

//As long as we get away with exactly copying the definition in the futureit guarantees some consistency..
export type { ValueConstraints };

export function mergeConstraints(lhs: Readonly<ValueConstraints>, rhs: Readonly<ValueConstraints>): ValueConstraints;
export function mergeConstraints(lhs: Readonly<ValueConstraints> | null, rhs: Readonly<ValueConstraints> | null): ValueConstraints | null;

export function mergeConstraints(lhs: Readonly<ValueConstraints> | null, rhs: Readonly<ValueConstraints> | null): ValueConstraints | null {
  if (lhs === null)
    return rhs;
  if (rhs === null)
    return lhs;

  //Now neither will be null
  const mergedConstraints = { ...lhs, ...rhs };

  //Any value in both constraints will have been set to the one in rhs. So now copy any lhs values where needed
  if (lhs.minValue !== undefined && lhs.minValue > mergedConstraints.minValue!)
    mergedConstraints.minValue = lhs.minValue;
  if (lhs.maxValue !== undefined && lhs.maxValue < mergedConstraints.maxValue!)
    mergedConstraints.maxValue = lhs.maxValue;
  if (lhs.maxBytes !== undefined && lhs.maxBytes < mergedConstraints.maxBytes!)
    mergedConstraints.maxBytes = lhs.maxBytes;

  return mergedConstraints;
}

type AnyTolliumComponent = Record<string, unknown>;

export function suggestTolliumComponent(constraints: Readonly<ValueConstraints>): { component?: AnyTolliumComponent; error?: string } {
  if (constraints.valueType === "string") {
    return { component: { textEdit: { valueConstraints: constraints } } };
  }
  if (constraints.valueType === "integer") {
    return { component: { textEdit: { valueConstraints: constraints, valueType: "integer" } } };
  }

  if (!constraints.valueType)
    return { error: `Unable to suggest a component without a valueType` };

  return { error: `Unable to suggest a component for valueType: ${constraints.valueType}` };
}
