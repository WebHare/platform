//---------------------------------------------------------------------------
#ifndef blex_webhare_compiler_opt_ast_shortcircuitor
#define blex_webhare_compiler_opt_ast_shortcircuitor
//---------------------------------------------------------------------------

#include "ast.h"
#include "astvisitors.h"
#include "astcoder.h"
#include "semanticcheck.h"

namespace HareScript
{
namespace Compiler
{
namespace Opt_AST_ShortCircuiter
{

/** AST optimizing, for generating shorthand evaluations

    Converts all OR and AND binary expressions into an equivalent
    that has short-circuit evaluation

*/
class Opt_AST_ShortCircuiter: public AST::AllNodeVisitor
{
        AstCoder *coder;
        TypeStorage &typestorage;
        CompilerContext &context;

    public:
        Opt_AST_ShortCircuiter(AstCoder *coder, TypeStorage &typestorage, CompilerContext &context)
        : coder(coder)
        , typestorage(typestorage)
        , context(context) { }

        void Execute(AST::Node* node) { Visit(node, Empty()); }

    private:
        template <class A> A* Adopt(A* a) { context.owner.Adopt(a); return a; }

        virtual void V_BinaryOperator (AST::BinaryOperator *obj, Empty);
};


} // end of namespace Opt_AST_ShortCircuiter
} // end of namespace Compiler
} // end of namespace HareScript

//---------------------------------------------------------------------------
#endif
