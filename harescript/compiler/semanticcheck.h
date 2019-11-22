//---------------------------------------------------------------------------
#ifndef blex_webhare_compiler_semanticcheck
#define blex_webhare_compiler_semanticcheck
//---------------------------------------------------------------------------

#include "ast.h"
#include "astvisitors.h"
#include "astcoder.h"

namespace HareScript
{
namespace Compiler
{

/** Semantic checker - deduces types as far as possible
    Designed to operate safe on incomplete syntax trees - to extract as much typing
    info (and errors) from erroneous ASTs as possible.
*/

// Can't include header; they are mutually dependent
namespace Opt_ConstantsArithmatic
{
class Opt_ConstantsArithmatic;
} // End of namespace Opt_ConstantsArithmatic

typedef AttributeStorage<AST::Rvalue, VariableTypes::Type> TypeStorage;

class SemanticChecker: public AST::NodeVisitor<void, bool>
{
        TypeStorage &typestorage;
        AstCoder &coder;
        CompilerContext &context;

        bool assign_query;
        unsigned loopdepth;
        unsigned arrayindexdepth;
        AST::Function *currentfunc;
        std::set<Symbol *> checkedsymbols;
        std::set<Symbol *> aggr_inaccessible_sv;
        std::set<Symbol *> aggr_inaccessible_temporaries;
        std::set<Symbol *> aggr_forbidden_inner; // Within a WHERE, aggregates function refer to outer select, may not refer to inner select
        AST::SQLSelect *top_select;
        AST::SQLSelect *cur_select;
        unsigned yield_forbid_counter;

        /** Names of functions that can be skipped because they will generate unneeded errors. Used for object property
            getters/setters when earlier checks have failed.
        */
        std::set< std::string > skipfunctions;
    public:
        SemanticChecker(TypeStorage &typestorage, AstCoder &coder, CompilerContext &context);
        ~SemanticChecker();

        void CheckObjectMembers();

    private:
        template <class A> A* Adopt(A* a) { context.owner.Adopt(a); return a; }

        std::unique_ptr< Opt_ConstantsArithmatic::Opt_ConstantsArithmatic > carim;

        /** Returns true if type1 and type2 are compatible (the same or one is type variant) */
        bool TypesEqual(VariableTypes::Type type1, VariableTypes::Type type2);
        bool VerifyTypeAt(const LineColumn &position, VariableTypes::Type wantedtype, VariableTypes::Type gottype);

        /** Verifies that expr has the type 'wantedtype'. Automatically adds a (run-time) record array conversion or type check if needed. Use only if this cast is needed.
            @param expr Expression to check the type of
            @param wantedtype Needed type
            @return TRUE if type check is successfull */
        bool VerifyTypeWithCast(AST::Rvalue* &expr, VariableTypes::Type wantedtype);

        /** Verifies that expr has a numeric type, i.e. Integer, Integer64, Money or Float
            @param expr Expression to check the type of
            @return TRUE if type check is successfull */
        bool VerifyTypeNumeric(AST::Rvalue* &expr);

        /** Verifies that expr has an integer type, i.e. Integer, Integer64
            @param expr Expression to check the type of
            @return TRUE if type check is successfull */
        bool VerifyTypeInteger(AST::Rvalue* &expr);

        /** Returns the resulting type of a binary operator on numeric operands
            @param lhstype Left hand side type
            @param binop Numeric binary operator
            @param rhstype Right hand side type
            @return The resulting type */
        VariableTypes::Type BinaryNumericType(VariableTypes::Type lhstype, BinaryOperatorType::Types binop, VariableTypes::Type rhstype);

        void CheckToken(Symbol *symbol);
        void CheckObject(Symbol *symbol);
        void CheckTableDef(SymbolDefs::TableDef &td);

        /// Return the object definition for a specific expression, if known
        SymbolDefs::ObjectDef * GetObjectDefFromExpression(AST::Rvalue *expr);

        void inline SafeVisit(AST::Node *node, bool check_return) { if (node) Visit(node, check_return); }

        virtual void V_ArrayDelete (AST::ArrayDelete *obj, bool check_return);
        virtual void V_ArrayElementConst (AST::ArrayElementConst *obj, bool check_return);
        virtual void V_ArrayElementModify (AST::ArrayElementModify *obj, bool check_return);
        virtual void V_ArrayInsert (AST::ArrayInsert *obj, bool check_return);
        virtual void V_Assignment (AST::Assignment *obj, bool check_return);
        virtual void V_BinaryOperator (AST::BinaryOperator *obj, bool check_return);
        virtual void V_Block (AST::Block *obj, bool check_return);
        virtual void V_BreakStatement (AST::BreakStatement *obj, bool check_return);
        virtual void V_BuiltinInstruction (AST::BuiltinInstruction *obj, bool check_return);
        virtual void V_Cast (AST::Cast *obj, bool check_return);
        virtual void V_ConditionalOperator (AST::ConditionalOperator *obj, bool check_return);
        virtual void V_ConditionalStatement (AST::ConditionalStatement *obj, bool check_return);
        virtual void V_Constant (AST::Constant *obj, bool check_return);
        virtual void V_ConstantRecord (AST::ConstantRecord *obj, bool check_return);
        virtual void V_ConstantArray (AST::ConstantArray *obj, bool check_return);
        virtual void V_ContinueStatement (AST::ContinueStatement *obj, bool check_return);
        virtual void V_DeepOperation (AST::DeepOperation *obj, bool check_return);
        virtual void V_DeepArrayDelete (AST::DeepArrayDelete *obj, bool check_return);
        virtual void V_DeepArrayInsert (AST::DeepArrayInsert *obj, bool check_return);
        virtual void V_End(AST::End *obj, bool check_return);
        virtual void V_ExpressionBlock (AST::ExpressionBlock *obj, bool check_return);
        virtual void V_ForEveryStatement(AST::ForEveryStatement *obj, bool check_return);
        virtual void V_Function (AST::Function *obj, bool check_return);
        virtual void V_FunctionCall (AST::FunctionCall *obj, bool check_return);
        virtual void V_FunctionPtr (AST::FunctionPtr *obj, bool check_return);
        virtual void V_FunctionPtrCall (AST::FunctionPtrCall *obj, bool check_return);
        virtual void V_FunctionPtrRebind (AST::FunctionPtrRebind *obj, bool check_return);
        virtual void V_InitializeStatement (AST::InitializeStatement *obj, bool check_return);
        virtual void V_LoopStatement (AST::LoopStatement *obj, bool check_return);
        virtual void V_Lvalue (AST::Lvalue *obj, bool check_return);
        virtual void V_LvalueSet (AST::LvalueSet *obj, bool check_return);
        virtual void V_Module (AST::Module *obj, bool check_return);
        virtual void V_Node (AST::Node *obj, bool check_return);
        virtual void V_RecordCellDelete (AST::RecordCellDelete *obj, bool check_return);
        virtual void V_RecordCellSet (AST::RecordCellSet *obj, bool check_return);
        virtual void V_RecordColumnConst (AST::RecordColumnConst *obj, bool check_return);
        virtual void V_ObjectExtend (AST::ObjectExtend *obj, bool check_return);
        virtual void V_ObjectMemberDelete (AST::ObjectMemberDelete *obj, bool check_return);
        virtual void V_ObjectMemberInsert (AST::ObjectMemberInsert *obj, bool check_return);
        virtual void V_ObjectMemberSet (AST::ObjectMemberSet *obj, bool check_return);
        virtual void V_ObjectMemberConst (AST::ObjectMemberConst *obj, bool check_return);
        virtual void V_ObjectMethodCall (AST::ObjectMethodCall *obj, bool check_return);
        virtual void V_ObjectTypeUID (AST::ObjectTypeUID *obj, bool check_return);
        virtual void V_ReturnStatement (AST::ReturnStatement *obj, bool check_return);
        virtual void V_Rvalue (AST::Rvalue *obj, bool check_return);
        virtual void V_SchemaTable (AST::SchemaTable *obj, bool check_return);
        virtual void V_SingleExpression (AST::SingleExpression *obj, bool check_return);
        virtual void V_Statement (AST::Statement *obj, bool check_return);
        virtual void V_SwitchStatement (AST::SwitchStatement *obj, bool check_return);
        virtual void V_TryCatchStatement(AST::TryCatchStatement *obj, bool check_return);
        virtual void V_TryFinallyStatement(AST::TryFinallyStatement *obj, bool check_return);
        virtual void V_TypeInfo(AST::TypeInfo *obj, bool check_return);
        virtual void V_UnaryOperator (AST::UnaryOperator *obj, bool check_return);
        virtual void V_Variable (AST::Variable *obj, bool check_return);
        virtual void V_Yield (AST::Yield *obj, bool check_return);

        virtual void V_SQL (AST::SQL *obj, bool check_return);
        virtual void V_SQLDataModifier (AST::SQLDataModifier *obj, bool check_return);
        virtual void V_SQLDelete (AST::SQLDelete *obj, bool check_return);
        virtual void V_SQLInsert (AST::SQLInsert *obj, bool check_return);
        virtual void V_SQLSource (AST::SQLSource *obj, bool check_return);
        virtual void V_SQLSources (AST::SQLSources *obj, bool check_return);
        virtual void V_SQLSelect (AST::SQLSelect *obj, bool check_return);
        virtual void V_SQLUpdate (AST::SQLUpdate *obj, bool check_return);

        void CheckGroupableExpressions(AST::SQLSelect *obj, bool is_grouped);

        std::string GetFunctionSignature(Symbol *funcsymbol);
        bool LookupFunctionSymbol(Symbol **funcsymbol, LineColumn const &pos);
        bool LookupObjectTypeSymbol(Symbol **objtypesymbol, LineColumn const &pos);

        void GenerateFunctionParameterError(Symbol *funcsymbol, LineColumn const &pos);
        void AppendDefaultParameters(Symbol *funcsymbol, AST::RvaluePtrs *current_param_list, std::vector<int32_t> *passthrough_parameters, LineColumn const &callpos);
};

} // end of namespace Compiler
} // end of namespace HareScript

#endif
