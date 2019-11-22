#ifndef blex_webhare_compiler_sqltranslator
#define blex_webhare_compiler_sqltranslator
//---------------------------------------------------------------------------

/* This file contains the functions that translate SQL statements and
   expressions to built-in functions (of the SQL module)

   Optimizations of SQL (like bringing conditional expressions within the
   where clause outside of a select, combining SQL subqueries etc. must be
   done before this step. */

#include "ast.h"
#include "astvisitors.h"
#include "astcoder.h"
#include "semanticcheck.h"
#include "opt_constantsarithmatic.h"

namespace HareScript
{
namespace Compiler
{

struct SQLTranslator: protected AST::AllNodeVisitor
{
        CompilerContext &context;
        AstCoder *coder;
        TypeStorage &typestorage;
        SemanticChecker &semanticchecker;
        template <class A> A* Adopt(A* a) { context.owner.Adopt(a); return a; }
        Opt_ConstantsArithmatic::Opt_ConstantsArithmatic carim;

        typedef std::map<Symbol *, AST::SQLSource *> SubstMap;

        struct SourceColumn
        {
                AST::Rvalue *expr;
                AST::SQLSource *source;
                std::string columnname;
                bool has_touppercase;
                bool has_cast;
                bool is_sc;
        };

        struct DBSingleCondition
        {
                AST::Rvalue *precondition;
                AST::SQLSource *source;
                std::string columnname;
                AST::Rvalue *value;
                DBConditionCode::_type condition;
                BinaryOperatorType::Types hs_condition;
                bool casesensitive;
                AST::Rvalue *expr;
        };

        struct DBRelationCondition
        {
                AST::Rvalue *precondition;
                AST::SQLSource *source1;
                std::string columnname1;
                AST::SQLSource *source2;
                std::string columnname2;
                DBConditionCode::_type condition;
                BinaryOperatorType::Types hs_condition;
                bool casesensitive;
                AST::Rvalue *expr;
        };


        struct DecomposeResult;
        struct TreeLevel;
        struct TreeDecomposeResult;

        Symbol *datamodifierrecord;

        /** Creates a temporary which is filled with the value of an expression. Returns an expression
            that returns the temporary (result can only be used once!)
            @param pos Relevant source file position
            @param expr Expression that has to be calculated
            @param conditional Optional expression that has to evaluate to TRUE before expr may be calculated. May be 0. */
        AST::Rvalue* CreateTempFromExpression(LineColumn pos, AST::Rvalue* expr, AST::Rvalue *conditional);

        /** Convert schema.table to TABLE< tabledef > table := BindTransactionToTable((schema)id, table-name) */
        void ConvertSchemaTableToTable(AST::SQLSource &source);

        bool TryTableColumn(AST::Rvalue *expr, SourceColumn &data, AST::SQLSources const &sources, SubstMap const &subst_map);

        /* Analyses the WHERE-part of a query/update/delete, and decomposes it in parts that can be
            used in query building and database offloading */
        TreeDecomposeResult DecomposeWhere(AST::Rvalue* oldwhere, AST::SQLSources &sources);

        struct SelectQuery
        {
                /** Must return a boolean indicating wether current cursor position passes fase 1
                    Only the sources from the database are available!!! */
//                AST::ExpressionBlock* condition_check;

                // Is called for every cursor position that passed DB fase 1
                AST::Block* result_build;

                // Contains the cursor handle
                Symbol *cursorhandle;
        };

        /** A WhereElement contains a piece of a where. It has value TRUE when either cond evaluates
            to false, or cond and expr BOTH evaluate to TRUE. When cond == 0, it is regarded as TRUE */
        struct WhereElement
        {
                // Precondition for this element
                AST::Rvalue* cond;
                // Condition of this element (does not use subst variables!)
                AST::Rvalue* expr;
                // List of used substitution variables used in this element
                std::set<Symbol *> used;
        };

        /** Splits a where-expression into elements */
        void SplitWhere(AST::Rvalue* where, std::list<WhereElement> &andedelements, AST::SQLSources const &sources);


        /** Builds a query over a webhare database
            @param pos Relevant position
            @param sources Sources that this query uses
            @param singles Single conditions on this query
            @param relations Inter-columnrelations on this query
            @param returnset Variable that will contain result-value of the expression this query will deliver (make 0 for
               inserts, updates and deletes)
            @param limit Rvalue* with integer-value limit (set to 0, (or set value to 0) for no limit)
            @param query_type Type of query (select, delete or insert; look for values in vm/hsvm_sqlinterface.h FIXME: use that enum!
            @return first: block that is execute once per found entry, second: handle that can be used to access the cursor */
        std::pair<AST::Block*, Symbol*> BuildDatabaseQuery(
                const LineColumn &pos,
                std::vector<AST::SQLSource *> const &sources,
                std::vector<DBSingleCondition> const &singles,
                std::vector<DBRelationCondition> const &relations,
                Symbol *returnset,
                AST::Rvalue* limit,
                bool withloop,
                unsigned query_type);

        /** Returns whether a expression is dependent on the contents of the substitution variables
            @param expr Expression to test
            @param sources List of sources
            @return Whether epxr is depentend on the substitution variables in sources */
        bool IsDependent(AST::Rvalue* expr, AST::SQLSources const &sources);


        /** Returns the number of a source */
        unsigned GetTableNr(DecomposeResult const &dr, AST::SQLSource *source);
        unsigned GetTableNr(TreeDecomposeResult const &dr, AST::SQLSource *source);

        // returns: success, db condition code
        static std::pair<bool, DBConditionCode::_type> IsCondition(BinaryOperatorType::Types op);

        // returns: success, db condition code
        static std::pair<bool, DBConditionCode::_type> SwappedCondition(DBConditionCode::_type cond);

                // returns: hs condition code
        static BinaryOperatorType::Types GetHSConditionFromDBCondition(DBConditionCode::_type op);

        SQLTranslator::SelectQuery BuildSimpleRecArrQueryFinal(
                const LineColumn &pos,
                TreeDecomposeResult &dr);

        SQLTranslator::SelectQuery BuildCursoringQueryFinal(
                const LineColumn &pos,
                TreeDecomposeResult &dr,
                AST::Rvalue* limit,
                unsigned query_type_id,
                bool need_fase2_records,
                AST::SQLDataModifier *update_cols,
                AST::Variable* result_array_assign);

    public:
        /** Translates all SQL expressions statements below node obj. Needs valid type info, so run semantic checker before calling this.
            @param obj Node to start at replacing */
        void Execute(AST::Node *obj);

        SQLTranslator(CompilerContext &context, AstCoder *coder, TypeStorage &typestorage, SemanticChecker &semanticchecker);
        ~SQLTranslator();
    private:
        Symbol *coldefrec;

        unsigned skip_schema_trans_replacement;

//        AST::Block * BuildExpressionLoop(const LineColumn &pos, AST::SQLSource *source);
//        AST::Block* BuildCursoringQuery(const LineColumn &pos, DecomposeResult const &dr, AST::Rvalue* limit);
        void CopySelectToTypedVariable(const LineColumn &pos, Symbol *result, AST::Variable *recarr, std::string const &cell_name, VariableTypes::Type cell_type);

        virtual void V_Cast(AST::Cast *obj, Empty);
        virtual void V_SQLDelete(AST::SQLDelete * sqldelete, Empty);
        virtual void V_SQLSelect(AST::SQLSelect * sqlselect, Empty);
        virtual void V_SQLInsert(AST::SQLInsert * sqlinsert, Empty);
        virtual void V_SQLUpdate(AST::SQLUpdate * sqlupdate, Empty);
        virtual void V_SQLDataModifier(AST::SQLDataModifier *obj, Empty);

        Symbol * V_SQLSelect_Grouped(AST::SQLSelect *obj);
        Symbol * V_SQLSelect_NonGrouped(AST::SQLSelect *obj);
        void V_SQLSelect_CodeResultLoop(AST::SQLSelect *obj, Symbol *temprec, Symbol *temparray);
};

} // end of namespace HareScript
} // end of namespace Compiler

//---------------------------------------------------------------------------
#endif
