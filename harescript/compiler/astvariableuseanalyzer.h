//---------------------------------------------------------------------------
#ifndef blex_webhare_compiler_astvariableuseanalyzer
#define blex_webhare_compiler_astvariableuseanalyzer
//---------------------------------------------------------------------------

/** The ASTVariabeleUseAnalyzer analyses which variables are used and defined
    in functions. This cannot be done in the IL code generation, because
    the info is already needed there to generate dependency information.

    This is needed to identify all global variables; and to construct a mapping
    for function symbols to AST::Function objects.

    SQL types may NOT be in the AST anymore. The caller is responsible, there is
    no checking on that.

    Every write to a global variable is also a use of that variable. This
    is done to make sure that no two SSA versios of a global can exist at the
    same time. */

#include "ast.h"
#include "astvisitors.h"

namespace HareScript
{
namespace Compiler
{

/** This class generates the variable use and define lists for all functions. That
    info is needed to build dependency information, for efficient compiling. */
class ASTVariabeleUseAnalyzer: public AST::AllNodeVisitor
{
    public:
        CompilerContext &context;
        ASTVariabeleUseAnalyzer(CompilerContext &context);
        ~ASTVariabeleUseAnalyzer();

        /** All functions have a FunctionData structure (also external and imported functions), that
            indicate which function they, from which they are called, which symbols they use, and
            which they redefine. If an imported name is used, :outsidestate is also used (also with defines) */
        class FunctionData // For all function symbols!
        {
            private:
                std::set<Symbol *> internal_usedsymbols;        ///< List of all global variables used or assigned to (used for internal processing)
                std::set<Symbol *> internal_defdsymbols;        ///< List of all global variables assigned to (used for internal processing)

                std::set<Symbol *> calledfunctions;             ///< List of all called functions
                std::set<Symbol *> callers;                     ///< List of all calling functions

                bool invokes_function_ptr;                      ///< Indicates whether this function (indirectly) can call a function pointer

                unsigned unprocessed_calledfncs;                ///< Number of unprocessed called functions left
                signed depth;                                   ///< Approximate depth in the calling hierarchy
                bool is_processed;                              ///< Flag indicating if this function has already been processed
            public:
                bool is_coded;                                  ///< Flag indicating if this is a HareScript function (and not external!)
                std::vector<Symbol *> usedsymbols;              ///< List of all global variables used or assigned to
                std::vector<Symbol *> defdsymbols;              ///< List of all global variables assigned to

                inline FunctionData() : invokes_function_ptr(false), unprocessed_calledfncs(0), depth(0), is_processed(false), is_coded(false) {}

                friend class ASTVariabeleUseAnalyzer;
        };

        /// Builds data, functionsymbolmappings and globalsymbols in this object for an AST
        void Execute(AST::Module *module);

        /// Function data for all function symbols
        std::map< Symbol *, FunctionData > data;

        /// List of all global symbols
        std::vector< Symbol *> globalsymbols;

    private:
        /// Map for all symbols that represent functions that are written in HareScript in this module (no externals, no imports)
        std::map<Symbol *, AST::Function *> functionsymbolmappings;

        /// Function data of the initfunction, set by GatherPrivateFunctionData
        FunctionData* initdata;

        /// Function data of functionpointer call (0 if not called in this module)
        Symbol *initsymbol;

        /// Currently processed function
        Symbol *current_function;

        // Sets minimum calling depth for called functions
        void SetDepthsIterate(std::list<Symbol *> &worklist);
        void SetDepths(Symbol *start);

        /** Gathers all raw use/def data from the AST trees, and the function call data
            Does not try to propagate that data */
        void GatherPrivateSymbolData(AST::Module *module);

        /** Finds all variables that need to be globals. They are:
            1. imported variables
            2. public variables
            3. variables defined in initfunction, used in subfunctions. */
        void FindAllGlobals();

        /** Filters all variable uses by the list of globals */
        void FilterRawVariableUseDefs();

        /** Propagates ExecutesHarescript flag to parents */
        void AnalyseFunctionPtrData();

        /** Constructs the calls relation */
        void ConstructCallsRelation();

        /** Sets the uses and defs for all external functions */
        void SetExternalUseDefs();

        void WalkGraphBreadthFirst();

        /** Propagates uses and defs to one single caller
            @param fdata Function data of function that must be propagated
            @param caller Caller the data must be propagated to
            @return Returns whether callers use-def data was modified as result of processing */
        bool PropagateToCaller(FunctionData &fdata, Symbol *caller);

        /** Propagates uses and defs to all callers
            @param fdata Function data of function that must be propagated
            @return Returns whether any callers use-def data was modified as result of processing */
        bool PropagateToCallers(FunctionData &fdata);

        /** Copies all data from internal sets to the (outside vsisible) vectors */
        void CopyDataToVectors();

        /* Visitor functions to walk the AST to find variable defines and references. Derived
           from AllNodeVisitor to walk all node types. SQL types are not permitted! */

        // Processing stuff for AST walker
        bool assignment_lvalue;
        FunctionData *currentdata;
        AST::Module *mdl;

        virtual void V_ArrayDelete(AST::ArrayDelete *obj, Empty);
//        virtual void V_ArrayElementConst(AST::ArrayElementConst *obj, Empty);
        virtual void V_ArrayElementModify(AST::ArrayElementModify *obj, Empty);
        virtual void V_ArrayInsert(AST::ArrayInsert *obj, Empty);
        virtual void V_Assignment(AST::Assignment *obj, Empty);
//        virtual void V_BinaryOperator(AST::BinaryOperator *obj, Empty);
//        virtual void V_Block(AST::Block *obj, Empty);
//        virtual void V_BreakStatement(AST::BreakStatement *obj, Empty);
        virtual void V_BuiltinInstruction(AST::BuiltinInstruction *obj, Empty);
//        virtual void V_ConditionalOperator(AST::ConditionalOperator *obj, Empty);
//        virtual void V_ConditionalStatement(AST::ConditionalStatement *obj, Empty);
//        virtual void V_ConstantBoolean(AST::ConstantBoolean *obj, Empty);
//        virtual void V_ConstantInteger(AST::ConstantInteger *obj, Empty);
//        virtual void V_ConstantString(AST::ConstantString *obj, Empty);
//        virtual void V_ContinueStatement(AST::ContinueStatement *obj, Empty);
        virtual void V_DeepOperation(AST::DeepOperation *obj, Empty);
        virtual void V_DeepArrayDelete(AST::DeepArrayDelete *obj, Empty);
        virtual void V_DeepArrayInsert(AST::DeepArrayInsert *obj, Empty);
        virtual void V_Function(AST::Function *obj, Empty);
        virtual void V_FunctionCall(AST::FunctionCall *obj, Empty);
        virtual void V_InitializeStatement(AST::InitializeStatement *obj, Empty);
//        virtual void V_LoopStatement(AST::LoopStatement *obj, Empty);
//        virtual void V_Lvalue(AST::Lvalue *obj, Empty);
        virtual void V_LvalueSet(AST::LvalueSet *obj, Empty);
//        virtual void V_Module(AST::Module *obj, Empty);
//        virtual void V_Node(AST::Node *obj, Empty);
        virtual void V_RecordCellDelete(AST::RecordCellDelete *obj, Empty);
        virtual void V_RecordCellSet(AST::RecordCellSet *obj, Empty);
        virtual void V_ObjectMemberConst(AST::ObjectMemberConst *obj, Empty);
        virtual void V_ObjectMethodCall(AST::ObjectMethodCall *obj, Empty);
        virtual void V_ObjectMemberSet(AST::ObjectMemberSet *obj, Empty);
//        virtual void V_RecordColumnConst(AST::RecordColumnConst *obj, Empty);
//        virtual void V_ReturnStatement(AST::ReturnStatement *obj, Empty);
//        virtual void V_Rvalue(AST::Rvalue *obj, Empty);

//        virtual void V_SQL(AST::SQL *sql, Empty);
//        virtual void V_SQLAlterTable(AST::SQLAlterTable * sqlaltertable, Empty);
//        virtual void V_SQLDataModifier(AST::SQLDataModifier *sqldatamodifier, Empty);
//        virtual void V_SQLDelete(AST::SQLDelete * sqldelete, Empty);
//        virtual void V_SQLColumn(AST::SQLColumn * sqlcolumn, Empty);
//        virtual void V_SQLColumnName(AST::SQLColumnName * sqlcolumnname, Empty);
//        virtual void V_SQLCreateTable(AST::SQLCreateTable * sqlcreatetable, Empty);
//        virtual void V_SQLSelect(AST::SQLSelect * sqlselect, Empty);
//        virtual void V_SQLSource(AST::SQLSource * sqlsource, Empty);
//        virtual void V_SQLSources(AST::SQLSources * sqlsources, Empty);
//        virtual void V_SQLInsert(AST::SQLInsert * sqlinsert, Empty);
//        virtual void V_SQLUpdate(AST::SQLUpdate * sqlupdate, Empty);
//        virtual void V_SingleExpression(AST::SingleExpression *singleexpression, Empty);
//        virtual void V_Statement(AST::Statement *statement, Empty);
//        virtual void V_UnaryOperator(AST::UnaryOperator *unaryoperator, Empty);
        virtual void V_Variable(AST::Variable *variable, Empty);
};

} // end of namespace Compiler
} // end of namespace HareScript
//---------------------------------------------------------------------------
#endif
