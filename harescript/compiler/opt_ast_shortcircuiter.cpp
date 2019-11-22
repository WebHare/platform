//---------------------------------------------------------------------------
#include <harescript/compiler/allincludes.h>

//---------------------------------------------------------------------------


#include "opt_ast_shortcircuiter.h"
#include <blex/decimalfloat.h>

namespace HareScript
{
namespace Compiler
{
namespace Opt_AST_ShortCircuiter
{
using namespace AST;

void Opt_AST_ShortCircuiter::V_BinaryOperator (AST::BinaryOperator *obj, Empty)
{
        Visit(obj->lhs, Empty());
        Visit(obj->rhs, Empty());

        if (obj->operation == BinaryOperatorType::OpOr)
        {
                Rvalue *replacement =
                        coder->ImConditionalOperator(
                                obj->position,
                                obj->lhs,
                                coder->ImConstantBoolean(obj->lhs->position, true),
                                obj->rhs);
                typestorage[replacement] = typestorage[obj];
                ReplacePtr(replacement);
        } else if (obj->operation == BinaryOperatorType::OpAnd)
        {
                Rvalue *replacement =
                        coder->ImConditionalOperator(
                                obj->position,
                                obj->lhs,
                                obj->rhs,
                                coder->ImConstantBoolean(obj->rhs->position, false));
                typestorage[replacement] = typestorage[obj];
                ReplacePtr(replacement);
        }
}



} // end of namespace Opt_AST_ShortCircuiter
} // end of namespace Compiler
} // end of namespace HareScript

//---------------------------------------------------------------------------
