import { BinaryOperationNode, FunctionNode, OperationNodeTransformer, OperatorNode, PrimitiveValueListNode, ValueNode, type KyselyPlugin, type PluginTransformQueryArgs, type PluginTransformResultArgs, type QueryResult, type RootOperationNode, type UnknownRow } from "kysely";

class KyselyInToAnyTransformer extends OperationNodeTransformer {
  protected transformBinaryOperation(node: BinaryOperationNode): BinaryOperationNode {
    node = super.transformBinaryOperation(node);
    // match ( leftOperator, OperatorNode("in"), PrimitiveValueListNode )
    if (OperatorNode.is(node.operator) && node.operator.operator === "in" && PrimitiveValueListNode.is(node.rightOperand)) {
      let valueArray = node.rightOperand.values;
      const firstNonNull = valueArray.findIndex(v => v !== null);

      if (!valueArray.length || firstNonNull === -1) {
        /* no elements or only nulls. In this context, we don't know the type of leftOperand, so we can't determine the
           type the array should be cast to (there is no such thing as an array of nulls in PostgreSQL). However, we know
            the outcome of the expression:
           - `x = ANY([])` is always false
           - `x = ANY([NULL])` is always null
           We need to return a binary operation, so return `true = false` for the first case and 'true = NULL' for the second.
        */
        return BinaryOperationNode.create(
          ValueNode.create(true),
          OperatorNode.create("="),
          ValueNode.create(valueArray.length ? null : false));
      }

      if (valueArray.findIndex(v => v !== null) > 0) {
        /* First element is a null, but some of the rest are not. postgresql-client only looks
           at the first element to determine the type of an array and will determine `unknown`
           as the type of the array - and that will lead to encoding problems. Remove all nulls
           from the array and put on at the back as fix.
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
}

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
}
