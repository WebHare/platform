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

function suggestByArrayItemType(valueConstraints: Readonly<ValueConstraints>): AnyTolliumComponent | string {
  switch (valueConstraints.itemType) {
    case "whfsRef": {
      return { "http://www.webhare.net/xmlns/publisher/components#browseforobjectarray": { valueConstraints } };
    }
  }

  return `Unable to suggest a component for array itemType: ${valueConstraints.itemType}`;
}

function suggestByType(valueConstraints: Readonly<ValueConstraints>): AnyTolliumComponent | string {
  //Valuetype handling
  switch (valueConstraints.valueType) {
    case "string": {
      const textedit = {
        valueConstraints,
        width: valueConstraints.maxLength! < 30 ? (valueConstraints.maxLength! + 1) + 'x' : "1pr"
      };
      return { textedit };
    }

    case "integer":
      return { textedit: { valueConstraints, valueType: "integer" } };


    case "float":
      return { textedit: { valueConstraints, valueType: "float" } };


    case "boolean":
      return { checkbox: { valueConstraints } };

    case "money":
      return { textedit: { valueConstraints, valueType: "money" } };

    case "date": {
      const datetime = { valueConstraints, type: "date", storeUTC: false };
      return { datetime };
    }

    case "dateTime": {
      const datetime = { valueConstraints, type: "datetime", storeUTC: true };
      if (!valueConstraints.precision)
        datetime.valueConstraints = { ...datetime.valueConstraints, precision: "millisecond" };

      return { datetime };
    }

    case "file":
      return { fileedit: { valueConstraints } };

    case "image":
      return { imgedit: { valueConstraints } };

    case "whfsRef":
      return { "http://www.webhare.net/xmlns/publisher/components#browseforobject": { valueConstraints } };

    case "richTextDocument":
      return { "richdocument": { valueConstraints } };

    case "array":
      return suggestByArrayItemType(valueConstraints);
  }

  return `Unable to suggest a component for valueType: ${valueConstraints.valueType}`;
}

export function suggestTolliumComponent(valueConstraints: Readonly<ValueConstraints>): { component?: AnyTolliumComponent; error?: string } {
  //Global checks
  if (valueConstraints.maxLength !== undefined && !(valueConstraints.maxLength >= 0))
    throw new Error(`maxLength should be a positive number, got ${valueConstraints.maxLength}`);

  if (!valueConstraints.valueType)
    return { error: `Unable to suggest a component without a valueType` };


  const suggestion = suggestByType(valueConstraints);
  if (typeof suggestion === "string")
    return { error: suggestion };
  return { component: suggestion };
}
