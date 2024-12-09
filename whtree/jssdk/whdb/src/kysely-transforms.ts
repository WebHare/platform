import { BinaryOperationNode, FunctionNode, OperationNodeTransformer, OperatorNode, PrimitiveValueListNode, ValueNode, type KyselyPlugin, type PluginTransformQueryArgs, type PluginTransformResultArgs, type QueryResult, type RootOperationNode, type UnknownRow } from "kysely";

class KyselyInToAnyTransformer extends OperationNodeTransformer {
  protected transformBinaryOperation(node: BinaryOperationNode): BinaryOperationNode {
    node = super.transformBinaryOperation(node);
    // match ( leftOperator, OperatorNode("in"), PrimitiveValueListNode )
    if (OperatorNode.is(node.operator) && node.operator.operator === "in" && PrimitiveValueListNode.is(node.rightOperand)) {
      let valueArray = node.rightOperand.values;
      if (valueArray.findIndex(v => v !== null) > 0) {
        /* First element is a null, but some of the rest are not. postgresql-client only looks
           at the first element to determine the type of an array and will determine `null[]`
           as the type of the array, which is obviously wrong. The easiest fix is to remove
           the nulls and put one at the end.
        */
        const filteredValueArray: unknown[] = valueArray.filter(v => v !== null);
        filteredValueArray.push(null);
        valueArray = filteredValueArray;
      }
      return BinaryOperationNode.create(
        node.leftOperand,
        OperatorNode.create("="),
        FunctionNode.create("any", [ValueNode.create(valueArray)]));
    }
    return node;
  }
};

/** This plugin converts all `"field" in value` expressions to
 * `"field" = ANY(value)` expressions. For the first expression, Kysely
 * adds a parameter for every array element, for the second only a single
 * parameter is used.
 */
export class KyselyInToAnyPlugin implements KyselyPlugin {
  #inToAnyTransformer = new KyselyInToAnyTransformer;

  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    return this.#inToAnyTransformer.transformNode(args.node);
  }

  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    return args.result;
  }
};
