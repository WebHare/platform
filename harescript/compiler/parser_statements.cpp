//---------------------------------------------------------------------------
#include <harescript/compiler/allincludes.h>

//---------------------------------------------------------------------------

#include "parser.h"
#include <blex/lexer.h>
#include <blex/path.h>
#include <blex/branding.h>

#include "parser_tools.h"

/** Parser: statements */

using namespace Blex;

namespace HareScript
{
namespace Compiler
{

void Parser::P_Script(bool only_report_loadlibs)
{
        PARSERULE("<script> ::= <loadlibs> <statement-list>");

        // Eat loadlibs
        P_Loadlibs(only_report_loadlibs);

        if (only_report_loadlibs)
            return;

        //eat statements
        P_Statement_List(true);

        //expect eof
        if (TokenType()==Lexer::CloseBlock)
        {
                lexer.AddError(Error::UnexpectedCloseCurlyBrace);
                return;
        }

        coder->ImReturn(lexer.GetPosition(), 0);

        if (!cs_if_levels.empty())
            lexer.AddErrorAt(cs_if_levels.back().first, Error::CompilerDirectiveNotClosed);

        symboltable.CloseScript(lexer.GetPosition());
}

void Parser::P_Loadlibs(bool only_report)
{
        PARSERULE("<loadlibs> ::= ( <loadlib-statement> | <external-data> | ';' ) *");

        bool loaded_system_library = false;
        bool reported_error = false, got_content = false;
        LineColumn firstcontent;
        loadlibs.clear();
        while (true)
        {
                if (TokenType()==Lexer::ExternalData) //skip external data
                {
                        if (!got_content)
                        {
                                firstcontent = lexer.GetPosition();
                                got_content = true;
                        }
                        if (!only_report)
                        {
                                GotContent();
                                coder->CodeExternalData(lexer.GetPosition(), lexer.RawTokenData(),lexer.RawTokenLength(), lexer.AtEndOfFile());
                        }
                        NextToken();
                }
                else if (IsCompStart())
                {
                        P_CompilerStatement(only_report);
                }
                else
                {
                        //Preventing a wh::system.whlib load must be done before the first real statement
                        if (!context.is_system_library && !loaded_system_library)
                        {
                                std::pair<SymbolDefs::Library*, LoadlibInfo> res = coder->LoadLib(lexer.GetPosition(), context.currentlibrary, "wh::system.whlib", !only_report, true);
                                loadlibs.push_back(res.second);

                                std::pair<SymbolDefs::Library*, LoadlibInfo> res2 = coder->LoadLib(lexer.GetPosition(), context.currentlibrary, "wh::internal/hsservices.whlib", !only_report, true);
                                loadlibs.push_back(res2.second);

                                if(!Blex::StrLike(context.currentlibrary, "wh::*") && !context.nonwhpreload.empty())
                                {
                                        std::pair<SymbolDefs::Library*, LoadlibInfo> res3 = coder->LoadLib(lexer.GetPosition(), context.currentlibrary, context.nonwhpreload, !only_report, true);
                                        loadlibs.push_back(res3.second);
                                }

                                loaded_system_library = true;
                        }

                        if (TryParse(Lexer::Loadlib)) //eat all loadlib statements
                        {
                                // .whlib files may not start with embedded content before the the last loadlib
                                if (Blex::StrLike(context.currentlibrary, "*.whlib") && got_content && !reported_error)
                                {
                                        reported_error = true;
                                        lexer.AddErrorAt(firstcontent, Error::NoContentBeforeLoadLibs);
                                }

                                P_Loadlib_Statement(only_report);
                        }
                        else if (!TryParse(Lexer::Semicolon)) //a ?> also 'looks' like a semicolon, so eat that..
                            break;
                }
        }
}

void Parser::P_Export_List(SymbolDefs::Library* imported_lib)
{
        PARSERULE("<export-list> ::= <name> [ ',' <export-list> ]");
        // accepts: * UNTIL ';'

        while (true)
        {
                if (TokenType() == Lexer::Identifier)
                {
                        const std::string& identifier = lexer.GetTokenIdentifier();

                        // FIXME: merge duplicate symbols (through 2 different libraries)
                        Symbol *symbol = symboltable.ResolveSymbol(lexer.GetPosition(), identifier, NULL, false);
                        if (!symbol)
                        {
                                lexer.AddErrorUnknown();
                        }
                        else
                        {
                                if (std::find(symbol->exportlibraries.begin(), symbol->exportlibraries.end(), imported_lib) == symbol->exportlibraries.end())
                                {
                                        lexer.AddError(Error::UnknownVariable, symbol->name);
                                }
                                else
                                {
                                        if (symbol->type == SymbolType::Variable)
                                            coder->GetRoot()->exportedvars.push_back(symbol);
                                        symbol->flags |= SymbolFlags::Public;
                                }
                        }

                        if (!symbol)
                            lexer.AddError(Error::ExpectedExportName, imported_lib->liburi);


                        NextToken();
                        if (TryParse(Lexer::__Attributes__))
                        {
                                if (symbol)
                                    P_ExportSymbol_Attribute_List(symbol);
                                else
                                {
                                        // Just skip the attr list, no symbol to associate it with
                                        NextToken();
                                        EatTillClosure(false);
                                        TryParse(Lexer::CloseParenthesis);
                                }
                        }
                }
                else
                {
                        lexer.AddError(Error::ExpectedExportName, imported_lib->liburi);
                        EatTillClosure(true);
                        break;
                }

                // Stop at the end of the list ; 2 non ',' tokens will also have this effect
                if (!TryParse(Lexer::Comma))
                    break;
        }
}

Parser::RuleJumpMap Parser::single_statement_map;

#define ADDRULEJUMP(mapname, token, func, name) mapname[Lexer::token] = RuleJump(name, &Parser::func)
void Parser::InitStatementTables()
{
        ADDRULEJUMP(single_statement_map, If,        P_If_Statement,        "<if-statement>");
        ADDRULEJUMP(single_statement_map, While,     P_While_Statement,     "<while-statement>");
        ADDRULEJUMP(single_statement_map, For,       P_For_Statement,       "<for-statement>");
        ADDRULEJUMP(single_statement_map, Forevery,  P_Forevery_Statement,  "<forevery-statement>");
        ADDRULEJUMP(single_statement_map, Break,     P_Break_Statement,     "<break-statement>");
        ADDRULEJUMP(single_statement_map, Continue,  P_Continue_Statement,  "<continue-statement>");
        ADDRULEJUMP(single_statement_map, Return,    P_Return_Statement,    "<return-statement>");
        ADDRULEJUMP(single_statement_map, OpenBlock, P_Scoped_Statement_Block, "<statement-block>");
        ADDRULEJUMP(single_statement_map, Update,    P_Update_Statement,    "<update-statement>");
        ADDRULEJUMP(single_statement_map, Insert,    P_Insert_Statement,     "<insert-statement>");
        ADDRULEJUMP(single_statement_map, Delete,    P_Delete_Statement,    "<delete-statement>");
        ADDRULEJUMP(single_statement_map, Switch,    P_Switch_Statement,    "<switch-statement>");
        ADDRULEJUMP(single_statement_map, Extend,    P_Extend_Statement,    "<extend-statement>");
        ADDRULEJUMP(single_statement_map, Try,       P_Try_Statement,       "<try-statement>");
        ADDRULEJUMP(single_statement_map, Throw,     P_Throw_Statement,     "<throw-statement>");
        ADDRULEJUMP(single_statement_map, __WithAsyncContext, P_WithAsyncContext_Statement, "<withasynccontext-statement>");
}

class InvokeInitTables
{
        public:
        InvokeInitTables() { Parser::InitStatementTables(); }
};
InvokeInitTables xxx_InvokeInitTables;

void Parser::P_Loadlib_Statement(bool only_report)
{
        PARSERULE("<loadlib-statement> ::= LOADLIB <string-constant> [ EXPORT <export-list> ] ';'");
        // Accepts (* UNTIL ';') ';'

        GotContent();

        if (TokenType()!=Lexer::ConstantString)
        {
                lexer.AddError(Error::LoadlibNeedsLibraryName);

                // Ignore the rest of the invalid statement
                EatTillClosure(true);
                return;
        }

        std::string libname = Blex::Lexer::ParseTokenString(lexer.GetTokenSTLString());
        bool libname_ok = CheckLoadlibPath(libname, !only_report);

        SymbolDefs::Library* currentlib = NULL;
        std::pair<SymbolDefs::Library*, LoadlibInfo> loadlibres;

        //Allow the filesystem to rewrite relative library names
        //ADDME: cleanup - the loadlib functions  shouldn't throw, but leave that up to the caller..
        try
        {
                context.filesystem->ResolveAbsoluteLibrary(*context.keeper, context.currentlibrary, &libname);
                //FIXME: Volgens mij is de return value van LoadLib dubbelop - LibraryURI staat immers al in een LibraryPTR (Arnold)
                loadlibres = coder->LoadLib(lexer.GetPosition(), context.currentlibrary, libname, !only_report, false);
                currentlib = loadlibres.first;
        }
        catch (HareScript::Message &e)
        {
                lexer.AddError((Error::Codes)e.code,e.msg1,e.msg2);
        }

        if (libname_ok)
            loadlibs.push_back(loadlibres.second);

        // Eat the library-name
        NextToken();

        if (TryParse(Lexer::__Attributes__))
        {
                bool used = P_Loadlib_Attribute_List();
                if (loadlibres.first && used)
                    loadlibres.first->referred = true;
        }

        if (TryParse(Lexer::Export))
        {
                // If only reporting the loadlibs we don't check the syntax of the export statements.
                if (only_report || currentlib==NULL /*illegal loadlib name*/)
                    EatTillClosure(true);
                else
                    P_Export_List(currentlib);
        }
        ExpectSemicolon();
}

void Parser::P_Statement_List(bool attoplevel)
{
        PARSERULE("<statement-list> ::= ( <statement> | <declaration> ) [ <statement-list> ]");
        // Accepts: *

        while (TokenType() != Lexer::Eof && TokenType() != Lexer::CloseBlock)
        {
                GotContent();

                // Determine whether we are seeing a declaration or a statement at the moment
                // Declarations are:
                //
                // [ <visibility-specifier> ] <type-specifier> identifier ...
                // [ <visibility-specifier> ] <type-specifier> FUNCTION ...
                // [ <visibility-specifier> ] MACRO ...
                //
                // All other things are statements
                if (Try_P_Declaration(attoplevel))
                    continue;

                if (TokenType()==Lexer::ExternalData)
                {
                        coder->CodeExternalData(lexer.GetPosition(), lexer.RawTokenData(),lexer.RawTokenLength(), lexer.AtEndOfFile());
                        NextToken();
                }
                else if (IsCompStart())
                {
                        P_CompilerStatement(false);
                }
                else
                {
                        P_Statement();
                }
        }
}


void Parser::P_Scoped_Statement_Block()
{
        symboltable.EnterScope(lexer.GetPosition());
        P_Statement_Block(0);
        symboltable.LeaveScope(lexer.GetPosition());
}

void Parser::P_Statement_Block(LineColumn *blockcloseposition)
{
        PARSERULE("<statement-block> ::= '{' [ <statementlist> ] '}'");

        if (ExpectOpenBlock())
        {
                P_Statement_List(false);
                if (blockcloseposition)
                    *blockcloseposition = lexer.GetPosition();
                ExpectCloseBlock();
        }
        else
        {
                EatTillClosure(true);
                if (blockcloseposition)
                    *blockcloseposition = lexer.GetPosition();
                TryParse(Lexer::CloseBlock);
        }
}

void Parser::P_Statement()
{
        RuleJump const * rule = GetRule(single_statement_map, TokenType());
        if (rule)
        {
                PARSERULE("<statement> ::= <" << rule->rule << ">");
                (this->*rule->jumpfunc)();
        }
        else
        {
                if (TokenType() == Lexer::Semicolon)
                {
                        PARSERULE("<statement> ::= ';'");
                        ExpectSemicolon();
                }
                else
                {
                        PARSERULE("<statement> ::= <assignment-expression>");

                        coder->ImExecute(lexer.GetPosition(), P_Assignment_Expression());

                        ExpectSemicolon();
                }
        }
}

void Parser::P_If_Statement()
{
        PARSERULE("<if-statement> ::= IF '(' <expression> ')' <statement> [ ELSE <statement> ]");

        LineColumn ifpos = lexer.GetPosition();

        NextToken(); // eat the IF

        ExpectOpenParenthesis();

        Rvalue* if_expr=P_Expression(false);
        if (if_expr != NULL)
            coder->ImIf_Open(ifpos, if_expr);

        ExpectCloseParenthesis();

        if (TokenType()==Lexer::Semicolon)
            lexer.AddError(Error::EmptyStatementNotAllowedHere);

        //Left to parse: SingleCodeBlock [ ELSE SingleCodeBlock ]
        P_Statement();

        if (TokenType()==Lexer::Else)
        {
                if (if_expr != NULL)
                    coder->ImIf_Else(lexer.GetPosition());
                NextToken(); //Eat 'Else'

                if (TokenType()==Lexer::Semicolon)
                    lexer.AddError(Error::EmptyStatementNotAllowedHere);

                P_Statement();
        }

        if (if_expr != NULL)
            coder->ImIf_Close(lexer.GetPosition());
}

/* The IMFOR is a special Coder version of FOR - it looks like the C++ for,
   but there is no initialization condition.

   More or less:   FOR (a;b;c) d ;=> a; IMFOR (b;c) d;
*/

void Parser::P_While_Statement()
{
        // WHILE (Expression) Statements => IMFOR (Expression;NULL) Statements;

        PARSERULE("<while_statement> ::= WHILE '(' <expression> ')' <single-statement>");

        LineColumn whilepos = lexer.GetPosition();
        NextToken(); // eat the WHILE

        ++loopdepth;

        ExpectOpenParenthesis();
        coder->ImFor_Open(whilepos, P_Expression(false), NULL);
        ExpectCloseParenthesis();

        //Left to parse: SingleCodeBlock [ ELSE SingleCodeBlock ]
        P_Statement();

        coder->ImFor_Close(lexer.GetPosition());

        --loopdepth;
}

void Parser::P_For_Statement()
{
        /* FOR (Assignment; Condition; Increment) Statements
           => Assignment; IMFOR (Condition;Increment) Statements; */

        PARSERULE("<for-statement> ::= FOR '(' [ <type-specifier> <simple-variable-declaration> | <assignment-expression> ] ';' [ <expression> ] ';' <assignment-expression> ')' <statement>");

        LineColumn forpos = lexer.GetPosition();
        NextToken(); // eat the FOR

        ++loopdepth;

        symboltable.EnterScope(lexer.GetPosition());

        ExpectOpenParenthesis();

        //Parse the assignment/declaration: note that this will also insert the proper code already!
        VariableTypes::Type hsvartype = Try_P_Type_Specifier(0);

        if (hsvartype != VariableTypes::Uninitialized)
        {
                P_Variable_Declaration_List(hsvartype, true, false, false);
                // Semicolon has been eaten by declaration
        }
        else
        {
                if (TokenType() != Lexer::Semicolon)
                {
                        LineColumn assignpos = lexer.GetPosition();
                        // No type, no semicolon -> this must be an assignment
                        Rvalue* expr = P_Assignment_Expression();
                        if (expr != NULL)
                            coder->ImExecute(assignpos, expr);
                }
                ExpectSemicolon();
        }

        // Read the expression that controls the break
        Rvalue* loop_expr=NULL;
        Rvalue* increment_expr=NULL;

        if (TokenType() == Lexer::CloseParenthesis)
            lexer.AddError(Error::ExpectedSemicolon);
        else
        {
                if (TokenType() != Lexer::Semicolon)
                    loop_expr = P_Expression(false);
                ExpectSemicolon();

                if (TokenType() != Lexer::CloseParenthesis)
//                    lexer.AddError(Error::ExpectedSemicolon);
//                else
                {
                        // And get the increment expression
                        if (TokenType() != Lexer::CloseParenthesis && TokenType() != Lexer::Semicolon)
                            increment_expr = P_Assignment_Expression();
                }
        }

        ExpectCloseParenthesis();

        // Open the loop!
        coder->ImFor_Open(forpos, loop_expr, increment_expr);
        // Get the loop statement
        P_Statement();
        // And end the loop..
        coder->ImFor_Close(lexer.GetPosition());

        symboltable.LeaveScope(lexer.GetPosition());

        --loopdepth;
}

void Parser::P_Forevery_Statement()
{
        PARSERULE("<forevery-Statement> ::= FOREVERY '(' [ <type-specifier> ] <variable-name> 'FROM' <expression> ')' <statement>");

        LineColumn pos = lexer.GetPosition();

        NextToken(); // eat the FOREVERY

        symboltable.EnterScope(pos);

        ExpectOpenParenthesis();

        Symbol *elementstore;
        LineColumn varpos = lexer.GetPosition();

        VariableTypes::Type hsvartype = Try_P_Type_Specifier(0);
        if (hsvartype != VariableTypes::Uninitialized)
        {
                if (ExpectName().empty())
                {
                        NextToken();
                        symboltable.LeaveScope(lexer.GetPosition());
                        return;
                }
                varpos = lexer.GetPosition();

                Symbol *shadowsymbol = symboltable.ResolveVariableInParentScope(varpos, lexer.GetTokenIdentifier());
                if (shadowsymbol)
                {
                        lexer.AddWarningAt(varpos, Warning::ShadowingVariable, lexer.GetTokenIdentifier());
                        lexer.AddWarningAt(shadowsymbol->definitionposition, Warning::ShadowedVariable, lexer.GetTokenIdentifier());
                }

                elementstore = symboltable.RegisterForwardSymbol(varpos, lexer.GetTokenIdentifier(), SymbolType::Variable, false, false);
                NextToken(); //eat the name
        }
        else
        {
                if (ExpectName().empty())
                {
                        NextToken();
                        symboltable.LeaveScope(lexer.GetPosition());
                        return;
                }

                std::pair<Symbol *, bool> res = symboltable.ResolveSymbolEx(pos, lexer.GetTokenIdentifier(), SymbolLookupType::Variables, false, true);
                NextToken();

                if (!res.first) // Has symbol been found?
                {
                        // Fill with anonymous variable; we don't want 0-ptr derefs
                        elementstore = context.symboltable->RegisterDeclaredVariable (varpos, 0, false, false, VariableTypes::Variant);
                }
                else
                    elementstore = res.first;
        }

        if (TokenType()==Lexer::From)
            NextToken();
        else
            lexer.AddError(Error::ExpectedForeveryFrom);

        Rvalue* foreveryexpr=P_Expression(false);
        ExpectCloseParenthesis();

        if (hsvartype != VariableTypes::Uninitialized)
            symboltable.RegisterDeclaredVariable(varpos, elementstore, false, false, hsvartype);

        //Create the loop variable
        Symbol *position_symbol = context.symboltable->RegisterDeclaredVariable (varpos, 0, false, false, VariableTypes::Integer);
        position_symbol->variabledef->is_counter = true;

        AST::Variable* position_var = coder->ImVariable(varpos, position_symbol);

        //Create the iterator..
        AST::Variable* iterator_var = coder->ImVariable(varpos, elementstore);

        //Store the current counter-symbol pointer for the iterator var
        Symbol *save_counter_symbol = elementstore->variabledef->countersymbol;
        elementstore->variabledef->countersymbol = position_symbol;

        Block* loopblock = Adopt(new Block(lexer.GetPosition()));
        coder->ImOpenBlock(loopblock);

        if (TokenType()==Lexer::Semicolon)
            lexer.AddError(Error::EmptyStatementNotAllowedHere);

        ++loopdepth;
        P_Statement();
        --loopdepth;

        coder->ImCloseBlock();

        //Restore the original counter-symbol
        elementstore->variabledef->countersymbol = save_counter_symbol;

        coder->ImForEvery(pos,
                iterator_var,
                foreveryexpr,
                loopblock,
                position_var);

        symboltable.LeaveScope(lexer.GetPosition());
}

void Parser::P_Break_Statement()
{
        PARSERULE("<break-statement> ::= BREAK ';'");
        LineColumn position = lexer.GetPosition();
        NextToken(); // eat the BREAK

        if (loopdepth)
            coder->ImBreak(position);
        else
            lexer.AddError(Error::UnexpectedBreakContinue);

        ExpectSemicolon();
}

void Parser::P_Continue_Statement()
{
        PARSERULE("<continue-statement> ::= CONTINUE ';'");
        LineColumn position = lexer.GetPosition();
        NextToken(); // eat the CONTINUE

        if (loopdepth)
            coder->ImContinue(position);
        else
            lexer.AddError(Error::UnexpectedBreakContinue);

        ExpectSemicolon();
}

void Parser::P_Return_Statement()
{
        PARSERULE("<return-statement> ::= RETURN [ <expression> ] ';'");

        LineColumn position = lexer.GetPosition();
        NextToken(); // eat the RETURN

        Rvalue* expr = 0;

        if (parserattoplevel && TokenType() != Lexer::Semicolon)
            lexer.AddError(Error::ScriptNoReturnCode);

        LineColumn exprpos = lexer.GetPosition();
        if (TokenType() != Lexer::Semicolon)
        {
                expr = P_Expression(false);

                if (currentfunction && (currentfunction->functiondef->returntype == VariableTypes::NoReturn || currentfunction->functiondef->isasyncmacro))
                    context.errorhandler.AddErrorAt(exprpos, Error::MacroNoReturnValue);
        }
        else if (currentfunction && (currentfunction->functiondef->returntype != VariableTypes::NoReturn && !currentfunction->functiondef->isasyncmacro))
            context.errorhandler.AddErrorAt(exprpos, Error::FunctionMustReturnValue);

        if (currentfunction && currentfunction->functiondef->generator)
        {
                if (currentfunction->functiondef->isasync)
                {
                        RvaluePtrs params;
                        if (expr)
                            params.push_back(expr);
                        else
                            params.push_back(coder->ImConstantBoolean(position, false));

                        coder->ImReturn(
                            position,
                            coder->ImObjectMethodCall(
                                position,
                                coder->ImVariable(position, currentfunction->functiondef->generator),
                                "RETURNVALUE",
                                true,
                                params,
                                false,
                                std::vector< int32_t >()));
                }
                else
                {
                        AST::ConstantRecord *retval = coder->ImConstantRecord(position);
                        retval->columns.push_back(std::make_tuple(AST::ConstantRecord::Item, "DONE", coder->ImConstantBoolean(position, true)));
                        if (expr)
                            retval->columns.push_back(std::make_tuple(AST::ConstantRecord::Item, "VALUE", expr));
                        else
                            retval->columns.push_back(std::make_tuple(AST::ConstantRecord::Item, "VALUE", coder->ImConstantRecord(position)));

                        coder->ImReturn(position, retval);
                }
        }
        else
            coder->ImReturn(position, expr);

        ExpectSemicolon();
}

void Parser::P_Case_List(SwitchStatement *stat)
{
        PARSERULE("<case-list> ::= CASE <expression-list> <statement-block>");

        while (TokenType() == Lexer::Case)
            P_Case(stat);
}

void Parser::P_Case(SwitchStatement *stat)
{
        PARSERULE("<case> ::= CASE <expression-list> <statement-block>");
        NextToken(); // Eat CASE

        std::pair< std::vector< Rvalue * > , Block * > pair;
        pair.first = P_Expression_List();
        pair.second = Adopt(new Block(stat->position));

        coder->ImOpenBlock(pair.second);
        P_Scoped_Statement_Block();
        coder->ImCloseBlock();

        stat->cases.push_back(pair);
}

void Parser::P_Default_Case(SwitchStatement *stat)
{
        PARSERULE("<default-case> ::= DEFAULT <statement-block>");

        NextToken(); // Eat the return

        stat->defaultcase = Adopt(new Block(stat->position));

        coder->ImOpenBlock(stat->defaultcase);
        P_Scoped_Statement_Block();
        coder->ImCloseBlock();
}
void Parser::P_Switch_Statement()
{
        PARSERULE("<switch-statement> ::= SWITCH '(' <expression> ')' '{' <case-list> [ <default-case> ] '}' ';'");

        SwitchStatement *stat = coder->ImSwitch(lexer.GetPosition());

        NextToken(); // Eat Switch

        ExpectOpenParenthesis();
        stat->value = P_Expression(false);
        ExpectCloseParenthesis();

        if (ExpectOpenBlock())
        {
                P_Case_List(stat);
                if (TokenType() == Lexer::Default)
                    P_Default_Case(stat);
                ExpectCloseBlock();
        }
        else
        {
                EatTillClosure(true);
                TryParse(Lexer::CloseBlock);
        }
}

void Parser::P_Extend_Statement()
{
        PARSERULE("<extend-statement> ::= EXTEND <rvalue> WITH <objecttype> [ <parameters> ]';'");
        NextToken(); // Eat EXTEND

        Rvalue *obj = P_Expression(false);

        Variable *source = dynamic_cast< Variable * >(obj);
        bool via_this = source && source->symbol->name == ":THIS";

        if (!TryParse(Lexer::By))
        {
                lexer.AddErrorAt(lexer.GetPosition(), Error::ExpectedKeyword, "BY");
                EatTillClosure(true);
                return;
        }

        LineColumn namepos = lexer.GetPosition();
        if (ExpectName().empty())
        {
                lexer.AddError(Error::MayNotBeUsedAsName,lexer.GetTokenSTLString());
                EatTillClosure(true);
                return;
        }

        std::string name = lexer.GetTokenIdentifier();
        NextToken();

        Symbol *newtype = symboltable.ResolveSymbolEx(namepos, name, SymbolLookupType::ObjectTypes, false, false).first;
        if (!newtype)
        {
                // Keep in sync with code that parses NEW object/EXTENDSFROM oject
                newtype = symboltable.RegisterForwardSymbol(namepos, name, SymbolType::ObjectType, false, false);
                newtype->state = SymbolState::Forward;

                Symbol *constructor = context.symboltable->RegisterForwardSymbol(LineColumn(), name + "#NEW", SymbolType::Function, false, false);
                constructor->state = SymbolState::Forward;
                newtype->objectdef->constructor = constructor;
                constructor->functiondef->object = newtype;
        }

        RvaluePtrs params;
        if (TryParse(Lexer::OpenParenthesis) && !TryParse(Lexer::CloseParenthesis))
        {
                params = P_Expression_List();
                ExpectCloseParenthesis();
        }

        if (newtype)
            coder->ImObjectExtend(namepos, obj, newtype, params, via_this);

        ExpectSemicolon();

/*
        Symbol* symbol = context.symboltable->ResolveSymbol(namepos, name+"#NEW", NULL, false);
        if (newtype && !symbol)
            lexer.AddError(Error::InternalError, "Could not locate constructor function");

        RvaluePtrs exprs;
        exprs.push_back(obj);

        // Valid object type?
        if (obj && symbol)
            coder->ImExecute(lexer.GetPosition(), coder->ImFunctionCall(namepos, symbol, exprs));
*/
}

void Parser::P_Try_Statement()
{
        PARSERULE("<extend-statement> ::= TRY <statement> CATCH <statement>");

        LineColumn pos = lexer.GetPosition();
        NextToken(); // Eat TRY

        bool have_catches = false;

        AST::Block *catch_root_block = Adopt(new Block(pos));

        coder->ImOpenBlock(catch_root_block);
        TryCatchStatement *stat = coder->ImTryCatch(lexer.GetPosition());
        coder->ImCloseBlock();

        coder->ImOpenBlock(stat->tryblock);

        // FIXME: Should disallow TRY statements here
        P_Statement();
        coder->ImCloseBlock();

        coder->ImOpenBlock(stat->catchblock);

        unsigned open_ifs = 0;

        Symbol *obj = symboltable.RegisterDeclaredVariable (pos, 0, false, false, VariableTypes::Object);
        coder->ImExecute(pos,
                coder->ImAssignment(
                        pos,
                        coder->ImVariable(pos, obj),
                        coder->ImGetThrowVariable(pos)));

        if (TokenType() != Lexer::Catch && TokenType() != Lexer::Finally)
            lexer.AddError(Error::ExpectedCatchOrFinallyAfterTry);

        while (TokenType() == Lexer::Catch)
        {
                LineColumn namepos = lexer.GetPosition();
                Symbol *objtype = 0;
                std::string name;
                VariableTypes::Type type = VariableTypes::Uninitialized;

                NextToken();
                have_catches = true;

                if (TryParse(Lexer::OpenParenthesis))
                {
                        type = P_Type_Specifier(&objtype);

                        namepos = lexer.GetPosition();
                        if (ExpectName().empty())
                        {
                                lexer.AddError(Error::MayNotBeUsedAsName,lexer.GetTokenSTLString());
                                EatTillClosure(true);
                                continue;
                        }

                        name = lexer.GetTokenIdentifier();
                        NextToken();

                        ExpectCloseParenthesis();
                }

                Rvalue *cond;
                if (type == VariableTypes::Object && objtype)
                    cond = coder->ImObjectIsOfType(namepos, coder->ImVariable(namepos, obj), objtype);
                else
                    cond = coder->ImConstantBoolean(namepos, true);

                coder->ImIf_Open(lexer.GetPosition(), cond);

                symboltable.EnterScope(lexer.GetPosition());

                if (!name.empty())
                {
                        Symbol *shadowsymbol = symboltable.ResolveVariableInParentScope(namepos, name);
                        if (shadowsymbol)
                        {
                                lexer.AddWarningAt(namepos, Warning::ShadowingVariable, name);
                                lexer.AddWarningAt(shadowsymbol->definitionposition, Warning::ShadowedVariable, name);
                        }
                }

                if (type != VariableTypes::Uninitialized)
                {
                        Symbol *token = symboltable.RegisterForwardSymbol(namepos, name, SymbolType::Variable, false, false);
                        symboltable.RegisterDeclaredVariable (namepos, token, false, false, type);

                        coder->ImExecute(namepos,
                                coder->ImAssignment(
                                        namepos,
                                        coder->ImVariable(namepos, token),
                                        coder->ImVariable(namepos, obj)));
                }

                Symbol *old_catchobj = currentcatchobj;
                currentcatchobj = obj;

                P_Statement();

                currentcatchobj = old_catchobj;

                symboltable.LeaveScope(lexer.GetPosition());
                coder->ImIf_Else(lexer.GetPosition());

                ++open_ifs;
        }

        // Not caught: rethrow
        coder->ImThrow(pos, coder->ImVariable(pos, obj), true);

        for (unsigned idx = 0; idx < open_ifs; ++idx)
            coder->ImIf_Close(lexer.GetPosition());

        coder->ImCloseBlock();

        // No catches at all? Ignore the try-catch, just use the try block
        if (!have_catches)
            catch_root_block = stat->tryblock;

        if (TokenType() == Lexer::Finally)
        {
                NextToken();

                bool have_var = false;
                VariableTypes::Type type = VariableTypes::Uninitialized;
                LineColumn namepos;
                std::string name;

                if (TokenType() == Lexer::OpenParenthesis)
                {
                        NextToken();

                        type = P_Type_Specifier(0);

                        namepos = lexer.GetPosition();
                        if (ExpectName().empty())
                        {
                                lexer.AddError(Error::MayNotBeUsedAsName,lexer.GetTokenSTLString());
                                EatTillClosure(true);
                                return;
                        }

                        name = lexer.GetTokenIdentifier();
                        NextToken();

                        ExpectCloseParenthesis();

                        have_var = true;
                }

                TryFinallyStatement *tryfinally_stat = coder->ImTryFinally(lexer.GetPosition(),
                        withinfunction,
                        loopdepth,
                        have_var,
                        namepos);

                coder->ImOpenBlock(tryfinally_stat->tryblock->tryblock);
                coder->DoCodeBlock(catch_root_block);
                coder->ImCloseBlock();

                coder->ImOpenBlock(tryfinally_stat->finallycodeblock);
                symboltable.EnterScope(lexer.GetPosition());

                if (have_var)
                {
                        Symbol *token = symboltable.RegisterForwardSymbol(namepos, name, SymbolType::Variable, false, false);
                        symboltable.RegisterDeclaredVariable (namepos, token, false, false, type);

                        coder->ImExecute(namepos,
                                coder->ImAssignment(
                                        namepos,
                                        coder->ImVariable(namepos, token),
                                        coder->ImVariable(namepos, tryfinally_stat->var)));
                }

                P_Statement();
                symboltable.LeaveScope(lexer.GetPosition());


                coder->ImCloseBlock();
        }
        else
            coder->DoCodeBlock(catch_root_block);
}

void Parser::P_Throw_Statement()
{
        PARSERULE("<throw-statement> ::= THROW [ <expression> ] ';'");
        NextToken(); // Eat THROW

        LineColumn pos = lexer.GetPosition();
        Rvalue *expr;
        if (currentcatchobj == 0 || TokenType() != Lexer::Semicolon)
        {
                expr = P_Expression(false);
                coder->ImThrow(pos, expr, false);
        }
        else // rethrow
        {
                expr = coder->ImVariable(pos, currentcatchobj);
                coder->ImThrow(pos, expr, true);
        }


        ExpectSemicolon();
}

void Parser::P_WithAsyncContext_Statement()
{
        PARSERULE("<throw-statement> ::= __WithAsyncContext(<expression>, <expression>) <single-statement>");
        LineColumn pos = lexer.GetPosition();

        NextToken(); // Eat __WITHASYNCCONTEXT

        ExpectOpenParenthesis();
        Rvalue *ctx_expr = P_Expression(false);
        Rvalue *skip_expr;
        if (TryParse(Lexer::Comma))
            skip_expr = P_Expression(false);
        else
            skip_expr = coder->ImConstantInteger(pos, 0);

        ExpectCloseParenthesis();

        coder->ImExecute(pos, coder->ImGetAsyncContextModifier(pos, ctx_expr, skip_expr));

        TryFinallyStatement *tryfinally = coder->ImTryFinally(pos,
                withinfunction,
                loopdepth,
                false,
                LineColumn());

        // Code the statement
        coder->ImOpenBlock(tryfinally->tryblock->tryblock);
        P_Statement();
        coder->ImCloseBlock();

        // Code the finally block which pops the async context
        coder->ImOpenBlock(tryfinally->finallycodeblock);
        coder->ImExecute(pos, coder->ImGetAsyncContextModifier(pos, nullptr, nullptr));
        coder->ImCloseBlock();
}

std::pair< bool, bool > Parser::EatUntilCSIfEnd(bool parse_else)
{
        unsigned nestedlevel = 0;
        while (true)
        {
                while (TokenType() != Lexer::Eof && !IsCompStart())
                    NextToken();

                if (TokenType() == Lexer::Eof)
                {
                        // Give expected-end/else error
                        return std::make_pair(false, false);
                }

                // Eat compiler directive
                NextToken();
                NextToken();

                if (TokenType() == Lexer::Else || TokenType() == Lexer::End)
                {
                        bool is_else = lexer.GetTokenIdentifier()=="ELSE";
                        if (is_else && nestedlevel == 0 && !parse_else)
                            return std::make_pair(false, true);
                        NextToken();

                        while(TokenType() != Lexer::OpMultiply && TokenType() != Lexer::Eof)
                            NextToken();

                        NextToken(); //eat *
                        ExpectCloseParenthesis();

                        bool must_return = false;

                        if (nestedlevel == 0)
                            must_return = true;
                        if (!is_else)
                            --nestedlevel;

                        if (must_return)
                            return std::make_pair(true, is_else);
                }
                else if (TokenType() == Lexer::Identifier && lexer.GetTokenIdentifier()=="IFVERSION")
                {
                        ++nestedlevel;

                        while(TokenType() != Lexer::OpMultiply && TokenType() != Lexer::Eof)
                            NextToken();

                        NextToken(); //eat *
                        ExpectCloseParenthesis();
                }
        }
}

void Parser::P_CompilerStatement(bool only_report)
{
        NextToken(); //eat the '('
        NextToken(); //eat the '*'

        LineColumn pos = lexer.GetPosition();

        if(TokenType() == Lexer::Identifier && lexer.GetTokenIdentifier()=="ISSYSTEMLIBRARY")
        {
                context.is_system_library=true;
                NextToken();
                if(TokenType() == Lexer::OpMultiply) //eureka! it might be all good ADDME: proper detection of *)
                {
                        NextToken();//eat it!
                        ExpectCloseParenthesis();
                        return;
                }
        }
        else if(TokenType() == Lexer::Else)
        {
                NextToken();

                if (TokenType() == Lexer::OpMultiply)
                {
                        NextToken();
                        ExpectCloseParenthesis();

                        if (cs_if_levels.empty())
                            lexer.AddErrorAt(pos, Error::UnexpectedCompilerDirectiveElse);
                        else if (!cs_if_levels.back().second)
                            lexer.AddErrorAt(pos, Error::UnexpectedCompilerDirectiveElse);
                        else
                        {
                                std::pair< bool, bool > res = EatUntilCSIfEnd(false);
                                if (!res.first)
                                {
                                        if (!res.second)
                                            lexer.AddErrorAt(pos, Error::CompilerDirectiveNotClosed);
                                        else
                                        {
                                                lexer.AddError(Error::UnexpectedCompilerDirectiveElse);
                                                // Remove rest of (*<here>ELSE*) directive
                                                NextToken();
                                                TryParse(Lexer::OpMultiply);
                                                TryParse(Lexer::CloseParenthesis);
                                        }
                                }
                                cs_if_levels.pop_back();
                        }
                        return;
                }
        }
        else if(TokenType() == Lexer::End)
        {
                NextToken();

                if (TokenType() == Lexer::OpMultiply)
                {
                        NextToken();
                        ExpectCloseParenthesis();

                        if (cs_if_levels.empty())
                            lexer.AddErrorAt(pos, Error::UnexpectedCompilerDirectiveEnd);
                        else
                            cs_if_levels.pop_back();

                        return;
                }
        }
        else if(TokenType() == Lexer::Identifier && lexer.GetTokenIdentifier()=="IFVERSION")
        {
                NextToken();

                if (TokenType() == Lexer::OpGreaterThan
                    || TokenType() == Lexer::OpLessThan
                    || TokenType() == Lexer::OpGreaterThanOrEqual
                    || TokenType() == Lexer::OpLessThanOrEqual
                    || TokenType() == Lexer::OpEquality
                    || TokenType() == Lexer::OpInequality)
                {
                        Lexer::Type type = TokenType();
                        NextToken();
                        if (TokenType() == Lexer::ConstantNumber)
                        {
                                int32_t val = lexer.GetTokenNumber().first.ToS32();
                                NextToken();

                                int32_t version = BLEX_BRANDING_PRODUCT_VERSION_NUMBER;
                                bool passcheck = false;
                                switch (type)
                                {
                                case Lexer::OpGreaterThan:        passcheck = version > val; break;
                                case Lexer::OpLessThan:           passcheck = version < val; break;
                                case Lexer::OpGreaterThanOrEqual: passcheck = version >= val; break;
                                case Lexer::OpLessThanOrEqual:    passcheck = version <= val; break;
                                case Lexer::OpEquality:           passcheck = version == val; break;
                                case Lexer::OpInequality:         passcheck = version != val; break;
                                default: ;
                                }

                                if (TokenType() == Lexer::OpMultiply)
                                {
                                        NextToken();
                                        ExpectCloseParenthesis();

                                        if (passcheck)
                                            cs_if_levels.push_back(std::make_pair(pos, true)); // first block may be parsed
                                        else
                                        {
                                                // Parse until end or else
                                                std::pair< bool, bool > res = EatUntilCSIfEnd(true);
                                                if (!res.first)
                                                    lexer.AddErrorAt(pos, Error::CompilerDirectiveNotClosed);
                                                else if (res.second)
                                                    cs_if_levels.push_back(std::make_pair(pos, false)); // got an else
                                        }
                                        return;
                                }
                        }
                }
        }

        if(TokenType() == Lexer::Identifier && lexer.GetTokenIdentifier()=="SCRIPTPROPERTY")
        {
                NextToken();
                if (TokenType() == Lexer::ConstantString && Blex::Lexer::ParseTokenString (lexer.GetTokenSTLString()) =="FILEID") //ADDME: Support more identifiers
                {
                        NextToken();
                        if(TokenType() == Lexer::ConstantNumber) //ADDME: Variant types
                        {
                                int32_t val = lexer.GetTokenNumber().first.ToS32();
                                NextToken();
                                if(TokenType() == Lexer::OpMultiply) //eureka! it might be all good ADDME: proper detection of *)
                                {
                                        NextToken();//eat it!
                                        ExpectCloseParenthesis();
                                        //ADDME: Detect duplicate setting of same script property
                                        //ADDME: Store as a constant
                                        coder->GetRoot()->scriptproperty_fileid = val;
                                        return;
                                }
                        }
                }
                else if (TokenType() == Lexer::ConstantString && Blex::Lexer::ParseTokenString (lexer.GetTokenSTLString()) =="FILECREATIONDATE")
                {
                        NextToken();
                        if(TokenType() == Lexer::ConstantNumber) //ADDME: Variant types
                        {
                                int32_t val = lexer.GetTokenNumber().first.ToS32();
                                NextToken();
                                if(TokenType() == Lexer::ConstantNumber)
                                {
                                        int32_t val2 = lexer.GetTokenNumber().first.ToS32();
                                        NextToken();

                                        if(TokenType() == Lexer::OpMultiply) //eureka! it might be all good ADDME: proper detection of *)
                                        {
                                                NextToken();//eat it!
                                                ExpectCloseParenthesis();
                                                //ADDME: Detect duplicate setting of same script property
                                                //ADDME: Store as a constant
                                                coder->GetRoot()->scriptproperty_filecreationdate = Blex::DateTime(val,val2);
                                                return;
                                        }
                                }
                        }
                        NextToken();
                }
                else if (TokenType() == Lexer::ConstantString && Blex::Lexer::ParseTokenString (lexer.GetTokenSTLString()) == "SYSTEMREDIRECT")
                {
                        NextToken();

                        if(TokenType() == Lexer::OpMultiply) //eureka! it might be all good ADDME: proper detection of *)
                        {
                                NextToken();//eat it!
                                ExpectCloseParenthesis();

                                if (!systemredirectallowed || coder->GetRoot()->scriptproperty_systemredirect)
                                    lexer.AddError(Error::NoContentWithSystemRedirect);
                                else
                                {
                                        coder->GetRoot()->scriptproperty_systemredirect = true;
                                        std::pair<SymbolDefs::Library*, LoadlibInfo> res = coder->LoadLib(lexer.GetPosition(), context.currentlibrary, "module::system/internal/webserver/systemredirect.whlib", !only_report, true);
                                        loadlibs.push_back(res.second);
                                }
                                return;
                        }
                }
        }

        if(!only_report)
            lexer.AddError(Error::InvalidCompilerDirective);

        while(TokenType() != Lexer::OpMultiply && TokenType() != Lexer::Eof)
            NextToken();
        NextToken(); //eat *
        ExpectCloseParenthesis();
}

} // End of namespace Compiler
} // End of namespace HareScript

