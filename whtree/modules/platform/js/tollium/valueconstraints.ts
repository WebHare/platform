import type { ValueConstraints } from "@mod-platform/generated/schema/siteprofile";

//As long as we get away with exactly copying the definition in the future it guarantees some consistency..
export type { ValueConstraints };

export function mergeConstraints(lhs: Readonly<ValueConstraints>, rhs: Readonly<ValueConstraints>): ValueConstraints;
export function mergeConstraints(lhs: Readonly<ValueConstraints> | null, rhs: Readonly<ValueConstraints> | null): ValueConstraints | null;

export function mergeConstraints(lhs: Readonly<ValueConstraints> | null, rhs: Readonly<ValueConstraints> | null): ValueConstraints | null {
  if (lhs === null)
    return rhs;
  if (rhs === null)
    return lhs;

  //Now neither will be null. Merge them together
  const mergedConstraints = { ...rhs };

  //Any value in both constraints will have been set to the one in rhs. So now copy any lhs values where needed
  if (lhs.minValue !== undefined && (mergedConstraints.minValue === undefined || lhs.minValue > mergedConstraints.minValue))
    mergedConstraints.minValue = lhs.minValue;
  if (lhs.maxValue !== undefined && (mergedConstraints.maxValue === undefined || lhs.maxValue < mergedConstraints.maxValue))
    mergedConstraints.maxValue = lhs.maxValue;
  if (lhs.maxBytes !== undefined && (mergedConstraints.maxBytes === undefined || lhs.maxBytes < mergedConstraints.maxBytes))
    mergedConstraints.maxBytes = lhs.maxBytes;

  if (lhs.valueType) {
    if (!mergedConstraints.valueType)
      mergedConstraints.valueType = lhs.valueType;
    else if (lhs.valueType !== mergedConstraints.valueType)
      throw new Error(`Conflicting valueType constraint: '${lhs.valueType}' vs '${mergedConstraints.valueType}'`);
  }

  if (lhs.required)
    mergedConstraints.required = true;

  return mergedConstraints;
}

export type AnyTolliumComponent = Record<string, unknown>;

export function suggestTolliumComponent(valueConstraints: Readonly<ValueConstraints>): { component?: AnyTolliumComponent; error?: string } {
  if (valueConstraints.maxLength !== undefined && !(valueConstraints.maxLength >= 0))
    throw new Error(`maxLength should be a positive number, got ${valueConstraints.maxLength}`);

  if (valueConstraints.valueType === "string") {
    const textedit = {
      valueConstraints,
      width: valueConstraints.maxLength! < 30 ? (valueConstraints.maxLength! + 1) + 'x' : "1pr"
    };
    return { component: { textedit } };
  }
  if (valueConstraints.valueType === "integer") {
    return { component: { textedit: { valueConstraints, valueType: "integer" } } };
  }
  if (valueConstraints.valueType === "datetime") {
    if (valueConstraints.precision === "day")
      return { component: { datetime: { valueConstraints, type: "date", storeUTC: true } } };

    const datetime = { valueConstraints, type: "datetime", storeUTC: true };
    if (!valueConstraints.precision)
      datetime.valueConstraints = { ...datetime.valueConstraints, precision: "millisecond" };

    return { component: { datetime } };
  }

  if (!valueConstraints.valueType)
    return { error: `Unable to suggest a component without a valueType` };

  return { error: `Unable to suggest a component for valueType: ${valueConstraints.valueType}` };
}
