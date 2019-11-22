//---------------------------------------------------------------------------
#ifndef blex_webhare_compiler_astcomplexnodetranslator
#define blex_webhare_compiler_astcomplexnodetranslator
//---------------------------------------------------------------------------

/** The ASTComplexNodeTranslator translates AST nodes that the ILGenerator
    can't handle because the implementation would become too difficult.
    In here they are converted to series of less complex nodes that implement
    the behaviour of the complex node */

#include "ast.h"
#include "astvisitors.h"
#include "astcoder.h"
#include "semanticcheck.h"
#include "opt_constantsarithmatic.h"

namespace HareScript
{
namespace Compiler
{

class ArrayEndVisitor : protected AST::AllNodeVisitor
{
        CompilerContext &context;
        AstCoder *coder;
        TypeStorage &typestorage;

        bool seenendnodes;
        Symbol* lengthvalue;

        virtual void V_ArrayElementConst(AST::ArrayElementConst *obj, Empty);
        virtual void V_ArrayElementModify(AST::ArrayElementModify *obj, Empty);
        virtual void V_End (AST::End *obj, Empty);

        public:
        ArrayEndVisitor(CompilerContext &context, AstCoder *coder, TypeStorage &typestorage);
        ~ArrayEndVisitor();

        bool HasEnds(AST::Rvalue *index);
        Symbol *CreateLengthSymbol(AST::Rvalue *array);
};

class ASTComplexNodeTranslator: protected AST::AllNodeVisitor
{
        CompilerContext &context;
        AstCoder *coder;
        TypeStorage &typestorage;
        SemanticChecker &semanticchecker;
        Opt_ConstantsArithmatic::Opt_ConstantsArithmatic &opt_carim;
        AST::TreeCopyingVisitor copier;
        template <class A> A* Adopt(A* a) { context.owner.Adopt(a); return a; }
        Symbol* lengthvalue;
        AST::Function *currentfunction;

        struct Switch
        {
                signed first;
                AST::Block *second;

                inline Switch(signed _first, AST::Block *_second) : first(_first), second(_second) {}
        };

        typedef std::vector< Switch > SwitchList;
        void SwitchElts(LineColumn pos, Symbol *value, SwitchList::iterator begin, SwitchList::iterator end);

        AST::Variable* GetLvalueVar(AST::Lvalue* val);
        AST::Variable * EnsureStoredInVariable(LineColumn const &position, AST::Rvalue *expr);

        Symbol * GetFunctionObjectMemberIsSimple(LineColumn position);
        void RewriteDeepOperation(AST::DeepOperation *obj, AST::ArrayLocation *arrayloc);

        AST::Rvalue * ArrayExpressionEndRewrite(LineColumn position, AST::Rvalue *array, AST::Rvalue **index, VariableTypes::Type return_type, AST::ExpressionBlock **eblock);
        void ArrayExpressionStatementEndRewrite(LineColumn position, AST::Variable *array, AST::Rvalue **index, AST::Block **block);

        void CodeNormalYieldHandling(AST::Yield *obj, AST::Rvalue *yieldret_rvalue, Symbol *retval);

    public:
        void Execute(AST::Node *obj)
        {
                Visit(obj, Empty());
        }

        ASTComplexNodeTranslator(CompilerContext &context, AstCoder *coder, TypeStorage &typestorage, SemanticChecker &semanticchecker, Opt_ConstantsArithmatic::Opt_ConstantsArithmatic &opt_carim);
        ~ASTComplexNodeTranslator();

    private:
        virtual void V_BinaryOperator(AST::BinaryOperator *obj, Empty);
        virtual void V_ForEveryStatement(AST::ForEveryStatement *obj, Empty);
        virtual void V_SwitchStatement(AST::SwitchStatement *obj, Empty);
        virtual void V_Function(AST::Function *obj, Empty);
        virtual void V_FunctionPtr(AST::FunctionPtr *obj, Empty);
        virtual void V_FunctionPtrCall(AST::FunctionPtrCall *obj, Empty);
        virtual void V_FunctionPtrRebind(AST::FunctionPtrRebind *obj, Empty);

        virtual void V_ArrayDelete (AST::ArrayDelete *obj, Empty);
        virtual void V_ArrayElementConst (AST::ArrayElementConst *obj, Empty);
        virtual void V_ArrayElementModify (AST::ArrayElementModify *obj, Empty);
        virtual void V_ArrayInsert (AST::ArrayInsert *obj, Empty);
        virtual void V_DeepArrayDelete(AST::DeepArrayDelete *obj, Empty);
        virtual void V_DeepArrayInsert(AST::DeepArrayInsert *obj, Empty);
        virtual void V_LvalueSet(AST::LvalueSet *obj, Empty);
        virtual void V_RecordColumnConst(AST::RecordColumnConst *obj, Empty);
        virtual void V_ObjectExtend(AST::ObjectExtend *obj, Empty);
        virtual void V_ObjectTypeUID(AST::ObjectTypeUID *obj, Empty);
        virtual void V_End(AST::End *obj, Empty);
        virtual void V_Yield(AST::Yield *obj, Empty);
};

} // end of namespace Compiler
} // end of namespace HareScript

#endif
