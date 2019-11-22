#ifndef blex_webhare_harescript_parser_parser
#define blex_webhare_harescript_parser_parser

#include <harescript/vm/hs_lexer.h>

// out when AstCoder implementation and AST types are complete
#include "compiler.h"
#include "astcoder.h"
#include "ast.h"
#include "symboltable.h"

namespace HareScript
{
class ErrorHandler;

namespace Compiler
{
using namespace AST;

class SQLTableList;

/** own forward declarations */
class SymbolTable;

/** A HareScriptParser is set up during the initial parse of a template. It builds
    the parse and expression trees, and does the parse state maintaining. When
    the template has been parsed, the HareScriptParser can be destroyed. */
class Parser
{
    public:
        struct OperatorDescription
        {
                enum BindingClarity
                {
                        Clear,                          ///< No binding interpretation problems
                        DiffCategoryOk,                 ///< Multiple operators from the same category cause unclear binding
                        DiffCategoryOrIdEqualOk         ///< Mixed operators from the same category cause unclear binding
                };
                inline OperatorDescription()
                : op(BinaryOperatorType::OpMerge), priority(0), bindingclarity(Clear), inverted(false) {}

                inline OperatorDescription(LineColumn _pos, BinaryOperatorType::Types _op, unsigned _priority, BindingClarity _bindingclarity, bool _inverted)
                : pos(_pos), op(_op), priority(_priority), bindingclarity(_bindingclarity), inverted(_inverted) {}

                LineColumn pos;
                BinaryOperatorType::Types op;
                unsigned priority;
                BindingClarity bindingclarity;
                bool inverted;
        };

        struct PtrDefinition
        {
                SymbolDefs::FunctionDef def;

                unsigned argument_count;

                std::set< Symbol * > used_vars;
        };

        struct SQLWorkBlock;

        Parser(const uint8_t *_bufferstart, unsigned _bufferlength, CompilerContext &context, SymbolTable &table, AstCoder &coder);

        static void InitStatementTables();

        Symbol * CreateSubstituteRecord(SQLSource* source, std::string const &rename, bool allow_use);

        bool ConvertRvalueIntoLvalueLayers(Rvalue *expr, ConvertedLvalue *result, bool force);
        ExpressionBlock* BuildLvalueFromLayers(LineColumn const &position, ConvertedLvalue &clvalue, Block* calcblock, Block* workblock, bool old_value_needed);
        ExpressionBlock* Try_Build_Lvalue(Rvalue *expr, Block* calcblock, Block* workblock, bool force, bool old_value_needed);

        void P_Script(bool only_report_loadlibs);
        void P_Loadlibs(bool only_report);
        std::vector<LoadlibInfo> GetLoadlibs();
        UnaryOperatorType::Types ConvertToUnaryOperator(Lexer::Type t);
        OperatorDescription ConvertToBinaryOperator();
        OperatorDescription ConvertToInvertedBinaryOperator();
        bool CheckLoadlibPath(std::string const &libname, bool report_errors);
        void P_Export_List(SymbolDefs::Library* imported_lib);
        void P_Loadlib_Statement(bool only_report);
        std::pair< bool, bool > EatUntilCSIfEnd(bool parse_else);
        void P_CompilerStatement(bool only_report);
        bool Try_P_Declaration(bool attoplevel);
        void P_Statement_List(bool attoplevel);
        void P_Function_Declaration(VariableTypes::Type type,bool attoplevel,bool islocal, bool is_aggregate, bool is_async);
        void P_Function_Body(
                LineColumn declpos,
                Symbol *symbol,
                bool is_aggregate,
                bool is_member,
                bool valid_object_type,
                bool islocal,
                bool isgenerator,
                bool isasync,
                Symbol *is_constructor_of,
                AST::Block **constructor_init_block,
                RvaluePtrs *base_params,
                LineColumn *base_init_pos
                );
        void P_Table_Declaration(bool local);
        void P_Schema_Declaration(bool local);
        void P_Variable_Declaration_List(VariableTypes::Type type, bool local, bool is_constant, bool is_constref);
        void P_Variable_Declaration(VariableTypes::Type type, bool local, bool is_constant, bool is_constref);
        void P_ObjectType_Declaration(bool is_public, bool is_static);
        std::pair</*exists*/bool, /*public*/bool> P_Visibility_Specifier(bool attoplevel);
        VariableTypes::Type Try_P_Type_Specifier(Symbol **objtype);
        VariableTypes::Type P_Type_Specifier(Symbol **objtype);
        void P_Attribute_List(Symbol *sym);
        void P_ExportSymbol_Attribute_List(Symbol *sym);
        void P_Schema_Field_Specification(SymbolDefs::SchemaDef::TablesDef &tables);
        void P_Table_Field_Specification(SymbolDefs::TableDef &tabledef);
        void P_ObjectType_PropertyAccessor(Symbol *objtype, SymbolDefs::ObjectField &field, bool setter);
        void P_ObjectType_Field_Specification(Symbol *objtype);
        void P_Statement();
        void P_Function_Argument_List(SymbolDefs::FunctionDef *def);
        bool P_Function_Argument(SymbolDefs::FunctionDef::Argument &arg, bool *is_rest_argument);
        void P_ScopedCodeBlock();
        void P_CodeBlock();

        std::vector< Rvalue* > P_Expression_List();
        Rvalue* P_Expression(bool toplevel);
        std::string P_Column_Name(bool force_uppercase = true);
        std::vector< std::string > P_Column_Name_List();
        std::string P_Table_Name(bool force_uppercase);

        Rvalue* Try_P_Constant();
        ConstantRecord* P_Record_Constant();
        ConstantArray* P_Array_Constant(VariableTypes::Type elttype);

        Rvalue* Try_P_TemplateString();

        // New advanced lvalue parser
        ExpressionBlock* Try_P_Lvalue(Block* workblock, bool force, bool old_value_needed, Rvalue **org_expr);
        // Old lvalue parser; won't accept function calls (used for insert into)
        ExpressionBlock* Try_P_Lvalue_old(Block* workblock, bool force, bool old_value_needed);

        ExpressionBlock* P_Lvalue(Block* workblock, bool old_value_needed);
        Variable* Try_P_Variable(bool has_var_qualifier);
        Variable* Try_P_Opcount_Variable();
        Variable* Try_P_Variable_Name(bool has_var_qualifier);
        Rvalue* P_Logical_Expression(bool toplevel);
        Rvalue* P_Assignment_Expression();
        Rvalue* P_Prefix_Expression();
        Rvalue* P_Postfix_Expression();
        Rvalue* P_Simple_Object();
        Rvalue* P_Closure();
        Rvalue* Try_P_Function_Call();
        void P_Function_Call_Parameters(RvaluePtrs *params, std::vector< int32_t > *passthrough_parameters, bool *any_passthrough);
        void P_Statement_Block(LineColumn *blockcloseposition);
        void P_Scoped_Statement_Block();
        Rvalue* P_Bind_Expression();

        void P_NULL_Statement();
        void P_If_Statement();
        void P_While_Statement();
        void P_For_Statement();
        void P_Forevery_Statement();
        void P_Break_Statement();
        void P_Continue_Statement();
        void P_Return_Statement();
        void P_Update_Statement();
        void P_Delete_Statement();
        void P_Extend_Statement();
        void P_Try_Statement();
        void P_Throw_Statement();
        void P_WithAsyncContext_Statement();

        void P_Insert_Statement();
        void P_Insert_Statement_Record(LineColumn insert_pos);
        void P_Insert_Statement_Member(LineColumn insert_pos);
        void P_Insert_Statement_Array(LineColumn insert_pos);
        void P_Insert_Statement_SQL(LineColumn insert_pos);

        AST::ArrayLocation Try_P_Delete_Location();
        AST::ArrayLocation Try_P_Where();

        void P_Delete_Statement(LineColumn delete_pos);
        void P_Delete_Statement_Record(LineColumn delete_pos);
        void P_Delete_Statement_Member(LineColumn delete_pos);
        void P_Delete_Statement_Array(LineColumn delete_pos, SQLSource *sqlsource, SQLWorkBlock &workblock);
        void P_Delete_Statement_SQL(LineColumn delete_pos, SQLSource *sqlsource, SQLWorkBlock &workblock);

        void P_Update_Statement_SQL();

        std::pair < std::string, Rvalue* > P_Set_Expression(bool allow_shorthand, bool *has_error = 0);
        bool P_Set_Expression_List(SQLDataModifier* modifier);
        bool SkipToFrom(std::map< std::string, Symbol * > *temporaries);
        bool SkipExpressionUntilComma();
        void P_Select_Source_List(SQLSources *sources);
        AST::SQLSource * P_SQLSource(SQLWorkBlock *modifyable, bool is_insert_into);
        void P_SQL_GroupBy(SQLSelect *select);

        Symbol* P_Single_Select_Expression(SQLSelect *select, SQLSelect::SelectItem &item);
        bool P_Select_Temporaries(SQLSelect *select, std::map< std::string, Symbol * > const &temporaries);
        Rvalue* P_Select_Expression();
        void P_Renamed_Expression_List(SQLSelect *select);
        void P_Select_Ordering_List(SQLSelect* select);
        Rvalue* P_TypeId();
        Rvalue* P_Yield();

        void P_Table_Like(SymbolDefs::TableDef &tabledef);

        void P_Case_List(SwitchStatement *stat);
        void P_Case(SwitchStatement *stat);
        void P_Default_Case(SwitchStatement *stat);
        void P_Switch_Statement();

        std::string LexerLookahead();
        std::string ExpectName();

        struct SQLWorkBlock
        {
                inline SQLWorkBlock() : sql_block(0), expr_block(0) {}

                /// SQL block, insert sql code in this block. Always set.
                AST::Block *sql_block;

                /// Expression block, for if the sql statement can modify (record arrays). Can be 0.
                AST::ExpressionBlock *expr_block;
        };

        void ExecuteSQLBlock(LineColumn pos, SQLWorkBlock &block);


        void ParseHareScriptFile();

        std::vector<LoadlibInfo> GetLoadLibs() { return GetLoadlibs(); }

        Lexer lexer;

    private:
        template <class A> A* Adopt(A* a)
        {
                context.owner.Adopt(a);
                return a;
        }

        typedef void (Parser::*RuleJumpFunc)(void);

        struct RuleJump
        {
                RuleJump() : jumpfunc(NULL) { }

                RuleJump(const char *_rule, RuleJumpFunc _jump)
                : rule(_rule)
                , jumpfunc(_jump)
                {
                }

                std::string rule;
                RuleJumpFunc jumpfunc;
        };

        typedef std::map<Lexer::Type,RuleJump> RuleJumpMap;

        static void InitTables();

        static RuleJump const * GetRule(RuleJumpMap const &rulemap, Lexer::Type type);

        /** Move to next token */
        void NextToken();

        /** Expect a comma (',') and eat it if it appears */
        void ExpectComma();

        /** Expect an opening curly brace ('{') and eat it if it appears */
        bool ExpectOpenBlock();

        /** Expect a closing curly brace ('}') and eat it if it appears */
        void ExpectCloseBlock();

        /** Expect a semicolon (';') and eat it if it appears. If no semicolon
            appears, generate an error and look ahead for any closure for a
            succesful resynch */
        void ExpectSemicolon();

        /** Expect an opening parenthesis '(') and eat it if it appears */
        bool ExpectOpenParenthesis();

        /** Expect an opening parenthesis after a function '(') and eat it if it appears */
        bool ExpectFunctionOpenParenthesis(Symbol *function);

        /** Expect a closing parenthesis (')') and eat it if it appears */
        bool ExpectCloseParenthesis();

        /** Expect a closing subscript bracket (']') and eat it if it appears */
        void ExpectCloseSubscript();

        /** Expect an SQL token  */
        bool ExpectSQLToken(Lexer::Type tokentype, const std::string &tokenname);

        /** Eat tokens until any closure token is found. This is used by some
            resynch functions to get back 'on track'.
            @param final Eat till the final closure (only '}' and ';') */
        void EatTillClosure(bool final);

        /** Look ahead until we find a from keyword (or a closure)
            @return Whether a 'from' is found */
        bool SQLSelectFindFrom();

        void GotContent();

        inline Lexer::Type TokenType() const
        {
                return lexer.GetToken();
        }

        bool TryParse(Lexer::Type to_parse);

        bool IsCompStart();

        static RuleJumpMap single_statement_map;

        AstCoder *coder;

        ///Context for error messages and the transaction
        CompilerContext &context;

        bool parserattoplevel;
        bool withinfunction;
        bool systemredirectallowed;
        Symbol *currentfunction;
        Symbol *currentcatchobj;

        SymbolTable &symboltable;

        unsigned loopdepth;

        bool in_bind_expression;

        bool within_base_constructor_call;

        // Compiler statements IF levels (stored TRUE if ELSE is still allowed)
        std::vector< std::pair< LineColumn, bool > > cs_if_levels;

        std::vector<LoadlibInfo> loadlibs;

        unsigned closure_counter;

        friend class InvokeInitTables;
};

} // End of namespace Compiler
} // End of namespace HareScript


#endif
