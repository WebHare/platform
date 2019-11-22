//---------------------------------------------------------------------------
#include <harescript/compiler/allincludes.h>

//---------------------------------------------------------------------------

#include "parser.h"
#include <blex/lexer.h>
#include <blex/path.h>

#include "parser_tools.h"
#include "astvisitors.h"

/** Parser: declarations */

using namespace Blex;

namespace HareScript
{
namespace Compiler
{

bool Parser::Try_P_Declaration(bool attoplevel)
{
        PARSERULE("<declaration> ::= [ <visibility-specifier> ] <simple-declaration>");
        bool have_public_private=false;

        LineColumn decl_start = lexer.GetPosition();
        std::pair</*exists*/bool, /*public*/bool> visiblity = std::make_pair(false, false);
        if (TokenType() == Lexer::Public || TokenType() == Lexer::Private)
        {
                have_public_private=true;
                visiblity = P_Visibility_Specifier(attoplevel);
        }

        bool is_public = visiblity.second;
        bool is_constant = TryParse(Lexer::Constant);
        bool is_constref = is_constant || TryParse(Lexer::__Constref);

        // We parse:
        // [ CONSTANT | __CONSTREF ] <type-specifier> identifier ( ';' | ':=' ... ';' ) - variable declaration
        // [ CONSTANT | __CONSTREF ] <type-specifier> identifier '(' - erroneous function declaration - missing FUNCTION
        // <type-specifier> [ AGGREGATE ] FUNCTION [*] identifier - function
        // <type-specifier> MACRO identifier - erroneous macro : expected 'FUNCTION'
        // MACRO identifier - function
        // FUNCTION * identifier - function
        // FUNCTION identifier - erroneous function - missing type specification
        // [ STATIC ] OBJECTTYPE < ... > - object type declaration
        //
        // We return at <type-specifier> '('

        Lexer::State beforetypestate;
        lexer.SaveState(&beforetypestate);

        // Try to parse <type-specifier>.
        bool has_type = false;
        VariableTypes::Type type = Try_P_Type_Specifier(0);
        if (type == VariableTypes::Uninitialized)
        {
                type = VariableTypes::NoReturn;
                if (is_constref
                        && TokenType() != Lexer::Aggregate
                        && TokenType() != Lexer::Async
                        && TokenType() != Lexer::Function
                        && TokenType() != Lexer::Macro)
                {
                        lexer.AddError(Error::TypenameExpected);
                        type = VariableTypes::Variant;
                }
        }
        else
            has_type = true;

        // Is this a cast?
        if (!have_public_private && !is_constant && !is_constref && TokenType() == Lexer::OpenParenthesis)
        {
                lexer.RestoreState(&beforetypestate);
                return false;
        }

        if (TokenType() == Lexer::Static)
        {
                if (has_type || is_constant || is_constref)
                    lexer.AddError(Error::UnexpectedToken, "STATIC");

                NextToken();
                if (TokenType() == Lexer::ObjectType)
                {
                        P_ObjectType_Declaration(is_public, true);
                        return true;
                }
                else
                    lexer.AddError(Error::ExpectedToken, "OBJECTTYPE");
        }

        if (TokenType() == Lexer::ObjectType)
        {
                if (has_type || is_constant || is_constref)
                    lexer.AddError(Error::UnexpectedToken, "OBJECTTYPE");

                P_ObjectType_Declaration(is_public, false);
                return true;
        }

        if (TokenType() != Lexer::Aggregate
              && TokenType() != Lexer::Async
              && TokenType() != Lexer::Function
              && TokenType() != Lexer::Macro && type != VariableTypes::NoReturn)
        {
                Lexer::State aftertypestate;
                lexer.SaveState(&aftertypestate);

                NextToken();
                // Invariant: type != VariableTypes::Uninitialized (otherwise we wouldn't have entered P_Declaration)
                // Check if an opening parenthesis follows the name (in that case the keyword 'function' has probably been forgotten)
                if (TokenType() != Lexer::OpenParenthesis)
                {
                        lexer.RestoreState(&aftertypestate);
                        if (type == VariableTypes::Table)
                        {
                                if (is_constant || is_constref)
                                    lexer.AddError(Error::ConstantOnlyAllowedForVars);
                                P_Table_Declaration(!is_public);
                        }
                        else if (type == VariableTypes::Schema)
                        {
                                if (is_constant || is_constref)
                                    lexer.AddError(Error::ConstantOnlyAllowedForVars);
                                P_Schema_Declaration(!is_public);
                        }
                        else
                            P_Variable_Declaration_List(type, !is_public, is_constant, is_constref);
                        return true;
                }
                else
                    lexer.RestoreState(&aftertypestate);
        }

        bool is_aggregate = false;
        bool is_async = false;
        // It must be a macro/function

        if (is_constant || is_constref)
            lexer.AddError(Error::ConstantOnlyAllowedForVars);

        if (has_type)
        {
                if (TokenType() == Lexer::Macro)
                {
                        lexer.AddErrorAt(decl_start, Error::MacroNoReturnValue);
                }
                else
                {
                        is_aggregate = TryParse(Lexer::Aggregate);
                        if (!is_aggregate)
                            is_async = TryParse(Lexer::Async);
                        if (TokenType() != Lexer::Function)
                            lexer.AddError(Error::ExpectedKeyword,"FUNCTION");
                }
        }
        else if (have_public_private || TokenType() == Lexer::Macro || TokenType() == Lexer::Async)
        {
                is_async = TryParse(Lexer::Async);
                if (is_async)
                {
                        if (TokenType() == Lexer::Function)
                            type = VariableTypes::Object;
                        else if (TokenType() != Lexer::Macro)
                            lexer.AddError(Error::ExpectedKeyword,"FUNCTION");
                }
                else if (TokenType() != Lexer::Macro)
                    lexer.AddError(Error::ExpectedKeyword,"MACRO");
        }
        else if (TokenType() == Lexer::Function) // Short generator form?
        {
                Lexer::State beforefunctionstate;
                lexer.SaveState(&beforefunctionstate);

                NextToken();
                bool isgenerator = TokenType() == Lexer::OpMultiply;

                lexer.RestoreState(&beforefunctionstate);
                if (!isgenerator)
                    return false;

                type = VariableTypes::Object;
        }
        else
        {
                //No type, no public private, no MACRO. Well DUH, it's probably not a function declaration
                return false;
        }


        // Skip MACRO or FUNCTION (if available)
        if (TokenType() == Lexer::Macro || TokenType() == Lexer::Function)
            NextToken();

        if (!attoplevel)
            lexer.AddErrorAt(decl_start, Error::FunctionsTopLevelOnly);

        P_Function_Declaration(type, attoplevel, !is_public, is_aggregate, is_async);
        return true;
}

VariableTypes::Type Parser::P_Type_Specifier(Symbol **objtype)
{
        VariableTypes::Type attempt = Try_P_Type_Specifier(objtype);
        if (attempt == VariableTypes::Uninitialized)
            lexer.AddError(Error::TypenameExpected);

        return attempt;
}

VariableTypes::Type Parser::Try_P_Type_Specifier(Symbol **objtype)
{
        PARSERULE("<type-specifier> ::= ( VARIANT | BOOLEAN | STRING | INTEGER | MONEY | FLOAT | RECORD | BLOB | DATETIME | TABLE | MACRO PTR | FUNCTION PTR | OBJECT [ < objecttype > ] ) [ ARRAY ]");
        // Accept: simpletypename [ARRAY ] | .

        if (TokenType() == Lexer::Ptr || TokenType() == Lexer::Array) //ptr or array without a preceding type
        {
                lexer.AddError(Error::TypenameExpected);
                return VariableTypes::Variant;
        }

        if (TokenType() == Lexer::Function || TokenType() == Lexer::Macro)
        {
                //Try function pointer type parse.
                Lexer::State aftertypestate;
                lexer.SaveState(&aftertypestate);
                NextToken();
                if (TryParse(Lexer::Ptr)) //It's a FUNCTION PTR or MACRO PTR
                {
                        if (TryParse(Lexer::Array))
                            return VariableTypes::FunctionRecordArray;

                        return VariableTypes::FunctionRecord;
                }
                lexer.RestoreState(&aftertypestate);
        }

        if (!lexer.IsTokenVarType())
            return VariableTypes::Uninitialized;

        LineColumn type_start = lexer.GetPosition();

        VariableTypes::Type hstype;
        switch (TokenType())
        {
        case Lexer::Boolean:  hstype = VariableTypes::Boolean; break;
        case Lexer::String:   hstype = VariableTypes::String; break;
        case Lexer::Integer:  hstype = VariableTypes::Integer; break;
        case Lexer::Record:   hstype = VariableTypes::Record; break;
        case Lexer::Blob:     hstype = VariableTypes::Blob; break;
        case Lexer::Table:    hstype = VariableTypes::Table; break;
        case Lexer::Schema:   hstype = VariableTypes::Schema; break;
        case Lexer::DateTime: hstype = VariableTypes::DateTime; break;
        case Lexer::Money:    hstype = VariableTypes::Money; break;
        case Lexer::Float:    hstype = VariableTypes::Float; break;
        case Lexer::Integer64: hstype = VariableTypes::Integer64; break;
        case Lexer::Variant:  hstype = VariableTypes::Variant; break;
        case Lexer::WeakObject: hstype = VariableTypes::WeakObject; break;
        case Lexer::Object:
            {
                    hstype = VariableTypes::Object;
                    NextToken();

                    if (objtype)
                    {
                            *objtype = 0;
                            if (TryParse(Lexer::OpLessThan))
                            {
                                    LineColumn namepos = lexer.GetPosition();
                                    if (ExpectName().empty())
                                    {
                                            lexer.AddError(Error::MayNotBeUsedAsName,lexer.GetTokenSTLString());
                                            EatTillClosure(true);
                                            return hstype;
                                    }

                                    std::string name = lexer.GetTokenIdentifier();
                                    NextToken();

                                    *objtype = symboltable.ResolveSymbolEx(namepos, name, SymbolLookupType::ObjectTypes, false, false).first;
                                    if (!*objtype)
                                        lexer.AddErrorAt(namepos, Error::UnknownObjectType, name);

                                    if (!TryParse(Lexer::OpGreaterThan))
                                        lexer.AddError(Error::ExpectedGreaterThan);
                            }
                    }
            } break;
        default:              throw std::runtime_error("P_Type(): Unknown type but registered as a type in the lexer tabels");
        }

        if (hstype != VariableTypes::Object)
            NextToken();

        if (TryParse(Lexer::Array))
        {
                hstype = VariableTypes::Type(hstype | VariableTypes::Array);

                if (TryParse(Lexer::Array))
                {
                        lexer.AddErrorAt(type_start, Error::NoMultiLevelArrays);
                        return VariableTypes::Variant;
                }
        }
/*
        if (hstype == (VariableTypes::Variant | VariableTypes::Array))
        {
                lexer.AddErrorAt(type_start, Error::NoVariantArray);
                return VariableTypes::Variant;
        }
*/
        if (hstype == (VariableTypes::Schema | VariableTypes::Array))
        {
                lexer.AddErrorAt(type_start, Error::NoSchemaArray);
                return VariableTypes::Variant;
        }
        if (hstype == VariableTypes::TableArray)
        {
                lexer.AddErrorAt(type_start, Error::NoTableArray);
                return VariableTypes::Variant;
        }

        bool is_error = false;
        while ((lexer.IsTokenVarType() || TokenType() == Lexer::Array) && TokenType() != Lexer::Object)
        {
                if (!is_error) { lexer.AddErrorUnknown(); is_error = true; hstype = VariableTypes::Uninitialized; }

                NextToken();
        }

        return hstype;
}

void Parser::P_Function_Declaration(VariableTypes::Type type,bool attoplevel,bool islocal, bool is_aggregate, bool is_async)
{
        PARSERULE("<function-declaration> ::= ( (<object-type-name> '::' <columnname>) | <identifier> ) <function-parameter-list> [ <function-attribute-list> ] ( <statement-block> | ';' )");

        LineColumn declpos = lexer.GetPosition();

        if (!attoplevel)
        {
                lexer.AddError(Error::FunctionsTopLevelOnly);
                return;
        }

        bool is_generator = false;
        if (!is_aggregate)
            is_generator = TryParse(Lexer::OpMultiply);

        if (ExpectName().empty())
        {
                lexer.AddError(Error::MayNotBeUsedAsName,lexer.GetTokenSTLString());
                NextToken();
                return;
        }

        std::string name = lexer.GetTokenIdentifier();
        NextToken();

        Symbol *symbol = symboltable.RegisterForwardSymbol(lexer.GetPosition(), name, SymbolType::Function, false, false);
        symbol->functiondef->returntype = is_async ? VariableTypes::Object : type;
        symbol->functiondef->isasyncmacro = is_async && type == VariableTypes::NoReturn;

        symboltable.EnterScope(lexer.GetPosition());

        P_Function_Body(
                declpos,
                symbol,
                is_aggregate,
                false,
                true,
                islocal,
                is_generator,
                is_async,
                0,
                0,
                0,
                0
                );
        symboltable.LeaveScope(lexer.GetPosition());
}

void Parser::P_Function_Body(
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
                )
{
        SymbolDefs::FunctionDef &mem_def = *symbol->functiondef;

        symbol->functiondef->flags =
            is_aggregate ? FunctionFlags::Aggregate :
                is_member ?
                    FunctionFlags::ObjectMember :
                    FunctionFlags::None;

        P_Function_Argument_List(&mem_def);

        if (is_aggregate && (symbol->functiondef->arguments.size() != 1 ||
                (!(symbol->functiondef->arguments[0].symbol->variabledef->type & VariableTypes::Array) &&
                symbol->functiondef->arguments[0].symbol->variabledef->type != VariableTypes::Variant)))
            lexer.AddErrorAt(declpos, Error::AggregateSignatureWrong);

        if (symbol && TryParse(Lexer::__Attributes__))
            P_Attribute_List(symbol);

        if (is_member && valid_object_type)
        {
                /* If a member, check if the signatures are the same */
                if (symbol->functiondef->arguments.size() != mem_def.arguments.size())
                    lexer.AddErrorAt(declpos, Error::MemberSignatureWrong);
                else if (symbol->functiondef->returntype != mem_def.returntype)
                    lexer.AddErrorAt(declpos, Error::MemberSignatureWrong);
                else
                {
                        for (unsigned i = 0, end = mem_def.arguments.size(); i < end; ++i)
                        {
                                if (symbol->functiondef->arguments[i].symbol->variabledef->type != mem_def.arguments[i].symbol->variabledef->type)
                                {
                                        lexer.AddErrorAt(declpos, Error::MemberSignatureWrong);
                                        break;
                                }
//                                if (mem_def.arguments[i].value)
//                                    lexer.AddErrorAt(declpos, Error::NoDefaultsInMemberDefinition);

                                // FIXME: uber-hack: copy the symbols back to the original declaration
//                                symbol->functiondef->arguments[i].symbol = mem_def.arguments[i].symbol;
                        }

                }
        }
        else if (valid_object_type)
        {
                // Register function
                symboltable.RegisterDeclaredFunction(declpos, symbol, !islocal);
        }

        if (symbol && symbol->functiondef && (symbol->functiondef->flags & FunctionFlags::External))
        {
                if (is_constructor_of)
                    lexer.AddErrorAt(declpos, Error::InternalError, "Constructors may not be external");

                coder->ImRegisterExternalFunction(declpos, symbol);

                ExpectSemicolon();
        }
        else
        {
//                RvaluePtrs base_params;
                if (is_constructor_of && TryParse(Lexer::OpColon))
                {
                        // Initializer list
                        if (ExpectName().empty())
                        {
                                lexer.AddError(Error::MayNotBeUsedAsName,lexer.GetTokenSTLString());
                                NextToken();
                                return;
                        }
                        LineColumn basenamepos = lexer.GetPosition();
                        if (base_init_pos)
                            *base_init_pos = basenamepos;
                        std::string name = lexer.GetTokenIdentifier();
                        NextToken();
                        Symbol *base = symboltable.ResolveSymbolEx(basenamepos, name, SymbolLookupType::ObjectTypes, false, false).first;
                        ExpectOpenParenthesis();
                        within_base_constructor_call = true;
                        assert(base_params);
                        if (TokenType() == Lexer::CloseParenthesis)
                            *base_params = RvaluePtrs();
                        else
                            *base_params = P_Expression_List();
                        within_base_constructor_call = false;
                        ExpectCloseParenthesis();
                        if (!base)
                            lexer.AddErrorAt(basenamepos, Error::UnknownObjectType, name);
                        if (base != is_constructor_of->objectdef->base)
                        {
                                lexer.AddErrorAt(basenamepos, Error::IsNotBaseClass, is_constructor_of->name, name);
                                is_constructor_of = 0;
                        }
                }

                AST::Function *func = coder->ImOpenFunction(declpos, symbol);

                if (is_constructor_of)
                {
                        assert(constructor_init_block);
                        *constructor_init_block = Adopt(new Block(declpos));
                        coder->DoCodeBlock(*constructor_init_block);
                }

                AST::Block *body_block = nullptr;

                if (isasync || isgenerator)
                {
                        const char *objtypename = isasync
                            ? isgenerator
                                ? "__HS_INTERNAL_ASYNCGENERATORGENERATOR"
                                : "__HS_INTERNAL_ASYNCFUNCTIONGENERATOR"
                            : "__HS_INTERNAL_FUNCTIONGENERATOR";

                        Symbol *obj = symboltable.ResolveSymbolEx(declpos, objtypename, SymbolLookupType::ObjectTypes, false, false).first;
                        if (!obj)
                            throw Message(true, Error::InternalError, "Cannot locate objecttype " + std::string(objtypename));

/*                        Symbol *spawn = 0;
                        if (isasync)
                        {
                                spawn = symboltable.ResolveSymbol(declpos, "__HS_INTERNAL_SPAWN", NULL, false);
                                if (!spawn)
                                    throw Message(true, Error::InternalError, "Cannot locate function __HS_INTERNAL_SPAWN");
                        }*/

                        mem_def.generator = context.symboltable->RegisterDeclaredVariable(declpos, 0, false, false, VariableTypes::Object);
                        mem_def.isasync = isasync;

                        RvaluePtrs params;
                        coder->ImExecute(declpos,
                            coder->ImAssignment(declpos,
                                      coder->ImVariable(declpos, mem_def.generator),
                                      coder->ImCodeNew(declpos, obj, 0, params)));

                        if (isgenerator)
                        {
                                coder->ImExecute(declpos,
                                    coder->ImYield(
                                        declpos,
                                        coder->ImVariable(declpos, mem_def.generator),
                                        isasync
                                            ? coder->ImObjectMethodCall(declpos, coder->ImVariable(declpos, mem_def.generator), "INITGENERATOR", true, RvaluePtrs(), false, std::vector< int32_t >())
                                            : static_cast< Rvalue * >(coder->ImVariable(declpos, mem_def.generator)),
                                        isasync,
                                        false,
                                        false,
                                        false));
                        }

                        if (isasync)
                        {

                                AST::TryCatchStatement *trycatch = coder->ImTryCatch(declpos);
                                body_block = trycatch->tryblock;

                                coder->ImOpenBlock(trycatch->catchblock);

                                RvaluePtrs params;
                                params.push_back(coder->ImGetThrowVariable(declpos));
                                coder->ImReturn(
                                        declpos,
                                        coder->ImObjectMethodCall(
                                            declpos,
                                            coder->ImVariable(declpos, mem_def.generator),
                                            "RETURNTHROW",
                                            true,
                                            params,
                                            false,
                                            std::vector< int32_t >()));

                                coder->ImCloseBlock();

                                coder->ImOpenBlock(body_block);
                        }
                }

                Symbol *oldfunction = currentfunction;
                parserattoplevel = false;
                withinfunction = !is_constructor_of && symbol->functiondef->returntype != VariableTypes::NoReturn;
                currentfunction = symbol;
                P_Statement_Block(&func->blockcloseposition);
                parserattoplevel = true;
                withinfunction = false;
                currentfunction = oldfunction;

                if (body_block)
                    coder->ImCloseBlock();

                coder->ImCloseFunction(lexer.GetPosition());
        }
}

void Parser::P_Table_Declaration(bool local)
{
        PARSERULE("<table-declaration> ::=  (( <table-field-list> <identifier>) | (<identifier> LIKE <identifier> [ '.' <table-name> ] [ := <expression ] ';'");

        SymbolDefs::TableDef tabledef;

        bool is_like = TokenType() == Lexer::Identifier;

        if (!is_like)
            P_Table_Field_Specification(tabledef);

        if (ExpectName().empty())
        {
                lexer.AddError(Error::MayNotBeUsedAsName,lexer.GetTokenSTLString());
                EatTillClosure(true);
                return;
        }

        LineColumn namepos = lexer.GetPosition();

        // Set the symbol state to declaring
        LineColumn pos = lexer.GetPosition();
        Symbol *token = symboltable.RegisterForwardSymbol(pos, lexer.GetTokenIdentifier(), SymbolType::Variable, false, false);

        NextToken(); //eat the name

        if (is_like)
            P_Table_Like(tabledef);

        LineColumn assignpos;
        Rvalue* expr = NULL;

        if (token && TryParse(Lexer::__Attributes__))
            P_Attribute_List(token);

        if (TokenType()==Lexer::OpAssignment || TokenType()==Lexer::OpEquality)
        {
                if (TokenType()==Lexer::OpEquality)
                    lexer.AddError(Error::ExpectedAssignmentOperator);

                assignpos = lexer.GetPosition();

                //Found an assignment operator!
                NextToken();

                //We should construct an expression now, and convert it into an assignment
                expr=P_Expression(false);
        }

        symboltable.RegisterDeclaredVariable (namepos, token, !local, parserattoplevel, VariableTypes::Table);

        if (!token)
        {
                // Our token was already defined. Redefine it to our new declaration, this
                // reduces the errors onwards (peaople will probably use the new definition)
                lexer.AddError(Error::VarAlreadyDefinedInScope,lexer.GetTokenSTLString());
                if (token->type == SymbolType::Variable)
                {
                        token->variabledef->type = VariableTypes::Table;
                        token->variabledef->tabledef = tabledef;
                }
                // reset our expression, we don't want the assignment to happen.
                expr = NULL;
        }
        else
            token->variabledef->tabledef = tabledef;

        if (expr != NULL) //expr may be unreliable?
        {
                Symbol *f_rebind = context.symboltable->ResolveSymbol(pos, "__HS_SQL_REBINDTABLEWITHTYPEINFO", NULL, false);
                if (!f_rebind)
                    throw Message(true, Error::InternalError, "Cannot locate function __HS_SQL_REBINDSCHEMAWITHTYPEINFO");

                RvaluePtrs params;
                params.push_back(expr);
                params.push_back(coder->ImTypeInfo(assignpos, token, nullptr, false));

                FunctionCall *rebound = coder->ImFunctionCall(assignpos, f_rebind, params);
                coder->ImExecute(assignpos, coder->ImAssignment(assignpos,
                                      coder->ImVariable(namepos, token),
                                      rebound
                                ));
        }
        else //Just initialize
        {
                coder->CodeInitialize(token);
        }

        ExpectSemicolon();
}

void Parser::P_ObjectType_Declaration(bool is_public, bool is_static)
{
        NextToken(); // Eat 'objecttype'

        PARSERULE("<objecttype-declaration> ::=  <identifier> [ EXTEND <objecttype> ] [ <objecttype-attributes> ] <object-field-specification>");

        if (ExpectName().empty())
        {
                lexer.AddError(Error::MayNotBeUsedAsName,lexer.GetTokenSTLString());
                EatTillClosure(true);
                return;
        }
        LineColumn namepos = lexer.GetPosition();
        std::string name = lexer.GetTokenIdentifier();
        NextToken(); // Eat the name

        LineColumn pos = lexer.GetPosition();
        Symbol *obj = symboltable.RegisterForwardSymbol(pos, name, SymbolType::ObjectType, false, false);
        obj->state = SymbolState::Declared;

        if (TryParse(Lexer::Extend))
        {
                LineColumn namepos = lexer.GetPosition();
                if (ExpectName().empty())
                {
                        lexer.AddError(Error::MayNotBeUsedAsName,lexer.GetTokenSTLString());
                        NextToken();
                }
                else
                {
                        std::string name = lexer.GetTokenIdentifier();
                        NextToken();

                        Symbol *extend = symboltable.ResolveSymbolEx(namepos, name, SymbolLookupType::ObjectTypes, false, true).first;
                        if (!extend)
                            lexer.AddErrorAt(namepos, Error::UnknownObjectType, name);
                        else if (extend == obj)
                        {
                            extend = 0;
                            lexer.AddErrorAt(namepos, Error::ExpectedObjectType);
                        }

                        if (extend && extend->objectdef->flags & ObjectTypeFlags::InternalProtected)
                            lexer.AddErrorAt(namepos, Error::CannotAccessProtectedObjectType);

                        obj->objectdef->base = extend;
                        if (extend)
                            obj->objectdef->uids = extend->objectdef->uids;
                }
        }

        if (TryParse(Lexer::__Attributes__))
        {
                ExpectOpenParenthesis();
                do
                {
                        std::string curattr = lexer.GetTokenSTLString();
                        if (Blex::StrCaseCompare(curattr,"INTERNALPROTECTED") == 0)
                        {
                                obj->objectdef->flags |= ObjectTypeFlags::InternalProtected;
                                NextToken();
                        }
                        else if (Blex::StrCaseCompare(curattr,"DEPRECATED") == 0)
                        {
                                obj->flags |= SymbolFlags::Deprecated;
                                NextToken();

                                if (TokenType() == Lexer::ConstantString)
                                {
                                        obj->deprecation_message = Blex::Lexer::ParseTokenString(lexer.GetTokenSTLString()) ;
                                        NextToken();
                                }
                        }
                        else
                        {
                                lexer.AddError(Error::InvalidAttributes);
                                break;
                        }
                }
                while (TryParse(Lexer::Comma));
                ExpectCloseParenthesis();
        }

        // Apply static-ness
        if (is_static)
            obj->objectdef->flags |= ObjectTypeFlags::Static;

        obj->objectdef->uids.push_back(name + "#" + context.currentlibrary);

        // Constructor is needed for coding 'NEW object' calls
        Symbol *constructor = context.symboltable->RegisterForwardSymbol(LineColumn(), name + "#NEW", SymbolType::Function, false, false);
        constructor->state = SymbolState::Forward;
        obj->objectdef->constructor = constructor;
        constructor->functiondef->object = obj;

        P_ObjectType_Field_Specification(obj);

        // Hack in owner pointers
        for (SymbolDefs::ObjectDef::Symbols::iterator it = obj->objectdef->symbols.begin(), end = obj->objectdef->symbols.end(); it != end; ++it)
            if (it->second->functiondef)
                it->second->functiondef->object = obj;

        // Hack in parent pointers
        for (SymbolDefs::ObjectDef::Fields::iterator fit = obj->objectdef->fields.begin(), fend = obj->objectdef->fields.end(); fit != fend; ++fit)
            fit->object = obj;

        coder->GetRoot()->objecttypes.push_back(symboltable.RegisterDeclaredObjectType(namepos, obj, is_public));

        ExpectSemicolon();
        if (!obj->objectdef->constructor || obj->objectdef->constructor->state == SymbolState::Forward)
             coder->ImCodeObjectInitFunction(namepos, namepos, obj);
}

void Parser::P_Schema_Declaration(bool local)
{
        PARSERULE("<schema-declaration> ::= (('SCHEMA' (('<' <table-list> '>' identifier) | (identifier LIKE identifier)) [ := <expression> ]  ';'");

        SymbolDefs::SchemaDef::TablesDef tablesdef;

        bool is_like = TokenType() == Lexer::Identifier;

        if (!is_like)
            P_Schema_Field_Specification(tablesdef);

        if (ExpectName().empty())
        {
                lexer.AddError(Error::MayNotBeUsedAsName,lexer.GetTokenSTLString());
                EatTillClosure(true);
                return;
        }

        LineColumn namepos = lexer.GetPosition();

        // Set the symbol state to declaring
        LineColumn pos = lexer.GetPosition();
        Symbol *token = symboltable.RegisterForwardSymbol(pos, lexer.GetTokenIdentifier(), SymbolType::Variable, false, false);

        NextToken(); //eat the name

        if (is_like)
        {
                if (!TryParse(Lexer::Like))
                {
                        lexer.AddError(Error::ExpectLike);
                        EatTillClosure(true);
                        return;
                }

                Variable *other_schema = Try_P_Variable(false);
                if (!other_schema || !other_schema->symbol->variabledef || other_schema->symbol->variabledef->type != VariableTypes::Schema)
                {
                        lexer.AddError(Error::ExpectSchemaName);
                        EatTillClosure(true);
                        return;
                }
                else
                    tablesdef = other_schema->symbol->variabledef->schemadef.tablesdef;
        }

        LineColumn assignpos;
        Rvalue* expr = NULL;

        if (token && TryParse(Lexer::__Attributes__))
            P_Attribute_List(token);

        if (TokenType()==Lexer::OpAssignment || TokenType()==Lexer::OpEquality)
        {
                if (TokenType()==Lexer::OpEquality)
                    lexer.AddError(Error::ExpectedAssignmentOperator);

                assignpos = lexer.GetPosition();

                //Found an assignment operator!
                NextToken();

                //We should construct an expression now, and convert it into an assignment
                expr=P_Expression(false);
        }

        symboltable.RegisterDeclaredVariable (namepos, token, !local, parserattoplevel, VariableTypes::Schema);

        if (!token)
        {
                // Our token was already defined. Redefine it to our new declaration, this
                // reduces the errors onwards (people will probably use the new definition)
                lexer.AddError(Error::VarAlreadyDefinedInScope,lexer.GetTokenSTLString());
                if (token->type == SymbolType::Variable)
                {
                        token->variabledef->type = VariableTypes::Schema;
                        token->variabledef->schemadef.tablesdef = tablesdef;
                }
                // reset our expression, we don't want the assignment to happen.
                expr = NULL;
        }
        else
            token->variabledef->schemadef.tablesdef = tablesdef;

        if (expr != NULL) //expr may be unreliable?
        {
                Symbol *f_rebind = context.symboltable->ResolveSymbol(pos, "__HS_SQL_REBINDSCHEMAWITHTYPEINFO", NULL, false);
                if (!f_rebind)
                    throw Message(true, Error::InternalError, "Cannot locate function __HS_SQL_REBINDSCHEMAWITHTYPEINFO");

                RvaluePtrs params;
                params.push_back(expr);
                params.push_back(coder->ImTypeInfo(assignpos, token, nullptr, false));

                FunctionCall *rebound = coder->ImFunctionCall(assignpos, f_rebind, params);
                coder->ImExecute(assignpos, coder->ImAssignment(assignpos,
                                      coder->ImVariable(namepos, token),
                                      rebound
                                ));
        }
        else //Just initialize
        {
                coder->CodeInitialize(token);
        }

        ExpectSemicolon();
}


void Parser::P_Variable_Declaration_List(VariableTypes::Type type, bool local, bool is_constant, bool is_constref)
{
        PARSERULE("P_Variable_Declaration: <simple-variable-declaration> | <table-declaration>");

        do P_Variable_Declaration(type, local, is_constant, is_constref);
        while (TryParse(Lexer::Comma));

        ExpectSemicolon();
}

void Parser::P_Variable_Declaration(VariableTypes::Type type, bool local, bool is_constant, bool is_constref)
{
        PARSERULE("P_Variable_Declaration: <simple-variable-declaration> | <table-declaration>");

        PARSERULE("<variable-declaration> ::= <identifier> [ := <expression ] ';'");

        if (ExpectName().empty())
        {
                NextToken();
                EatTillClosure(true);
                return;
        }

        LineColumn namepos = lexer.GetPosition();

        std::string name = lexer.GetTokenIdentifier();

        Symbol *shadowsymbol = symboltable.ResolveVariableInParentScope(namepos, name);
        if (shadowsymbol)
        {
                lexer.AddWarningAt(namepos, Warning::ShadowingVariable, name);
                lexer.AddWarningAt(shadowsymbol->definitionposition, Warning::ShadowedVariable, name);
        }

        // Set the symbol state to declaring
        LineColumn pos = lexer.GetPosition();
        Symbol *token = symboltable.RegisterForwardSymbol(pos, name, SymbolType::Variable, false, false);

        NextToken(); //eat the name

        SymbolDefs::TableDef tabledef;

        if (TokenType()==Lexer::OpLessThan)
        {
                LineColumn tspecpos = lexer.GetPosition();

                P_Table_Field_Specification(tabledef);

                lexer.AddErrorAt(tspecpos, Error::ColumnDefsOnlyWithTable);
        }

        Rvalue* expr(0); // uninitialized Rvalue*

        LineColumn assignpos;

        if (token && TryParse(Lexer::__Attributes__))
            P_Attribute_List(token);

        if (TokenType()==Lexer::OpAssignment || TokenType()==Lexer::OpEquality)
        {
                if (TokenType()==Lexer::OpEquality)
                    lexer.AddError(Error::ExpectedAssignmentOperator);

                assignpos = lexer.GetPosition();

                //Found an assignment operator!
                NextToken();

                //We should construct an expression now, and convert it into an assignment
                expr=P_Expression(false);
        }

        symboltable.RegisterDeclaredVariable (namepos, token, !local, parserattoplevel, type);
        token->variabledef->is_constant = is_constant;
        token->variabledef->is_constref = is_constant || is_constref;

        if (!token)
        {
                // Our token was already defined. Redefine it to our new declaration, this
                // reduces the errors onwards (people will probably use the new definition)
                lexer.AddError(Error::VarAlreadyDefinedInScope,lexer.GetTokenSTLString());
                if (token->type == SymbolType::Variable)
                {
                        token->variabledef->type = type;
                }
                // reset our expression, we don't want the assignment to happen.
                expr = NULL;
        }
        else
            token->variabledef->tabledef.columnsdef = tabledef.columnsdef;

        if (expr != NULL) //expr may be unreliable?
        {
                coder->ImExecute(assignpos, coder->ImInitialAssignment(assignpos,
                                      coder->ImVariable(namepos, token),
                                      expr
                                ));
        }
        else //Just initialize
        {
                coder->CodeInitialize(token);
        }
}

} // End of namespace Compiler
} // End of namespace HareScript
