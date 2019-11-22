//---------------------------------------------------------------------------
#include <harescript/compiler/allincludes.h>

//---------------------------------------------------------------------------

#include <blex/lexer.h>
#include <blex/path.h>
#include "parser.h"
#include "parser_tools.h"
#include <harescript/vm/filesystem.h>

/** Parser base file. Contains support functions, and root parse functions. */

using namespace Blex;

namespace HareScript
{
namespace Compiler
{

//---------------------------------------------------------------------------//
//                                                                           //
// HareScript Parser                                                         //
//                                                                           //

Parser::Parser(const uint8_t *_bufferstart, unsigned _bufferlength, CompilerContext &context, SymbolTable &table, AstCoder &coder )
: lexer(&context.errorhandler)
, coder(&coder)
, context(context)
, symboltable(table)
, closure_counter(0)
{
        lexer.StartLexer(_bufferstart,_bufferlength);
        NextToken();
        loopdepth=0;
        parserattoplevel=true;
        withinfunction=false;
        currentfunction=0;
        currentcatchobj=0;
        systemredirectallowed=true;
        in_bind_expression = false;
        within_base_constructor_call = false;
}

// Parses a harescript file
void Parser::ParseHareScriptFile()
{
        try
        {
                P_Script(false);
        }
        catch (VMRuntimeError &e)
        {
                if (e.position.line == 1 && e.position.column == 1)
                    e.position = lexer.GetPosition();
                throw;
        }
}

// Quick parse for determining loadlibs
std::vector<LoadlibInfo> Parser::GetLoadlibs()
{
        P_Script(true);
        return loadlibs;
}

//---------------------------------------------------------------------------//
//                                                                           //
// Parser shorthand functions                                                //
//                                                                           //

void Parser::NextToken()
{
        do lexer.MovetoNextToken();
        while (lexer.GetToken() == Lexer::Comment);
}

void Parser::EatTillClosure(bool final)
{
        if (final)
            while (TokenType()<Lexer::FakeStartClosures
                   || TokenType()>Lexer::FakeEndFinalClosures)
                NextToken();
        else
        {
                signed level = 0;
                while (TokenType()<Lexer::FakeStartClosures
                        || (TokenType()>Lexer::FakeEndClosures
                                && (level == 0 && TokenType()>Lexer::FakeEndFinalClosures)))
                {
                        switch (TokenType())
                        {
                        case Lexer::OpenParenthesis:
                        case Lexer::OpenSubscript:
                                ++level;
                                //fallthrough
                        case Lexer::CloseParenthesis:
                        case Lexer::CloseSubscript:
                                if (--level == 0) return;
                        default: ;
                        }
                        NextToken();
                }
        }
}

bool Parser::TryParse(Lexer::Type to_parse)
{
        if (TokenType()!=to_parse)
            return false;

        NextToken();
        return true;
}

void Parser::ExpectSemicolon()
{
        if (TryParse(Lexer::Semicolon))
            return;

        if (TokenType() == Lexer::Eof)
            lexer.AddErrorUnknown();
        else
            lexer.AddError(Error::ExpectedSemicolon);
        EatTillClosure(true);
        TryParse(Lexer::Semicolon);
        return;
}

bool Parser::ExpectOpenBlock()
{
        if (TryParse(Lexer::OpenBlock))
            return true;

        if (TokenType() == Lexer::Eof)
            lexer.AddErrorUnknown();
        else
            lexer.AddError(Error::ExpectedOpeningCurlyBrace);
        return false;
}

void Parser::ExpectComma()
{
        if (TryParse(Lexer::Comma))
            return;

        if (TokenType() == Lexer::Eof)
            lexer.AddErrorUnknown();
        else
            lexer.AddError(Error::ExpectedComma);
        return;
}

void Parser::ExpectCloseBlock()
{
        if (TryParse(Lexer::CloseBlock))
            return;

        if (TokenType() == Lexer::Eof)
            lexer.AddErrorUnknown();
        else
            lexer.AddError(Error::ExpectedClosingCurlyBrace);
        EatTillClosure(true);
        TryParse(Lexer::CloseBlock);
}

bool Parser::ExpectOpenParenthesis()
{
        if (TryParse(Lexer::OpenParenthesis))
            return true;

        if (TokenType() == Lexer::Eof)
            lexer.AddErrorUnknown();
        else
            lexer.AddError(Error::ExpectedOpeningParenthesis);
        return false;
}

bool Parser::ExpectFunctionOpenParenthesis(Symbol *function)
{
        if (TryParse(Lexer::OpenParenthesis))
            return true;

        if (TokenType() == Lexer::Eof)
            lexer.AddErrorUnknown();
        else
            lexer.AddError(Error::ExpectedFunctionOpenParen, function->name);
        return false;
}

bool Parser::ExpectCloseParenthesis()
{
        if (TryParse(Lexer::CloseParenthesis))
            return true;

        if (TokenType() == Lexer::Eof)
            lexer.AddErrorUnknown();
        else
            lexer.AddError(Error::ExpectedClosingParenthesis);
        EatTillClosure(false);
        return TryParse(Lexer::CloseParenthesis);
}

void Parser::ExpectCloseSubscript()
{
        if (TryParse(Lexer::CloseSubscript))
            return;

        if (TokenType() == Lexer::Eof)
            lexer.AddErrorUnknown();
        else
            lexer.AddError(Error::ExpectedClosingBracket);
        EatTillClosure(false);
        TryParse(Lexer::CloseSubscript);
}

bool Parser::ExpectSQLToken(Lexer::Type tokentype, const std::string &tokenname)
{
        if (TryParse(tokentype))
            return true;

        if (TokenType() == Lexer::Eof)
            lexer.AddErrorUnknown();
        else
            lexer.AddError(Error::ExpectedSQLClause,tokenname);
        return false;
}

std::string Parser::ExpectName()
{
        if (TokenType() != Lexer::Identifier)
        {
                lexer.AddError(Error::MayNotBeUsedAsName,lexer.GetTokenSTLString());
                return "";
        }
        else
            return lexer.GetTokenIdentifier();
}

//---------------------------------------------------------------------------//
//                                                                           //
// Token conversion support                                                  //
//                                                                           //

UnaryOperatorType::Types Parser::ConvertToUnaryOperator(Lexer::Type t)
{
        switch (t)
        {
        case Lexer::Not:                return UnaryOperatorType::OpNot;
        case Lexer::BitNeg:             return UnaryOperatorType::OpBitNeg;
        case Lexer::OpSubtract:         return UnaryOperatorType::OpNeg;
        case Lexer::OpAdd:              return UnaryOperatorType::OpPlus;
        default:
            throw std::runtime_error("Unimplemented unary operator type in UnaryOperatorType::ConvertFromX");
        }
}

Parser::OperatorDescription Parser::ConvertToBinaryOperator()
{
        LineColumn pos = lexer.GetPosition();
        switch (TokenType())
        {
        case Lexer::And:                return OperatorDescription(pos, BinaryOperatorType::OpAnd, 1, OperatorDescription::DiffCategoryOrIdEqualOk, false);
        case Lexer::Or:                 return OperatorDescription(pos, BinaryOperatorType::OpOr, 1, OperatorDescription::DiffCategoryOrIdEqualOk, false);
        case Lexer::Xor:                return OperatorDescription(pos, BinaryOperatorType::OpXor, 1, OperatorDescription::DiffCategoryOrIdEqualOk, false);

        case Lexer::OpLessThan:         return OperatorDescription(pos, BinaryOperatorType::OpLess, 2, OperatorDescription::DiffCategoryOk, false);
        case Lexer::OpLessThanOrEqual:  return OperatorDescription(pos, BinaryOperatorType::OpLessEqual, 2, OperatorDescription::DiffCategoryOk, false);
        case Lexer::OpEquality:         return OperatorDescription(pos, BinaryOperatorType::OpEqual, 2, OperatorDescription::DiffCategoryOk, false);
        case Lexer::OpInequality:       return OperatorDescription(pos, BinaryOperatorType::OpUnEqual, 2, OperatorDescription::DiffCategoryOk, false);
        case Lexer::OpGreaterThan:      return OperatorDescription(pos, BinaryOperatorType::OpGreater, 2, OperatorDescription::DiffCategoryOk, false);
        case Lexer::OpGreaterThanOrEqual: return OperatorDescription(pos, BinaryOperatorType::OpGreaterEqual, 2, OperatorDescription::DiffCategoryOk, false);
        case Lexer::Like:               return OperatorDescription(pos, BinaryOperatorType::OpLike, 2, OperatorDescription::DiffCategoryOk, false);
        case Lexer::In:                 return OperatorDescription(pos, BinaryOperatorType::OpIn, 2, OperatorDescription::DiffCategoryOk, false);

        case Lexer::OpMerge:            return OperatorDescription(pos, BinaryOperatorType::OpMerge, 3, OperatorDescription::Clear, false);
        case Lexer::Concat:             return OperatorDescription(pos, BinaryOperatorType::OpConcat, 3, OperatorDescription::Clear, false);

        case Lexer::BitAnd:             return OperatorDescription(pos, BinaryOperatorType::OpBitAnd, 4, OperatorDescription::DiffCategoryOrIdEqualOk, false);
        case Lexer::BitOr:              return OperatorDescription(pos, BinaryOperatorType::OpBitOr, 4, OperatorDescription::DiffCategoryOrIdEqualOk, false);
        case Lexer::BitXor:             return OperatorDescription(pos, BinaryOperatorType::OpBitXor, 4, OperatorDescription::DiffCategoryOrIdEqualOk, false);

        case Lexer::BitLShift:          return OperatorDescription(pos, BinaryOperatorType::OpBitLShift, 5, OperatorDescription::DiffCategoryOrIdEqualOk, false);
        case Lexer::BitRShift:          return OperatorDescription(pos, BinaryOperatorType::OpBitRShift, 5, OperatorDescription::DiffCategoryOrIdEqualOk, false);

        case Lexer::OpAdd:              return OperatorDescription(pos, BinaryOperatorType::OpAdd, 6, OperatorDescription::Clear, false);
        case Lexer::OpSubtract:         return OperatorDescription(pos, BinaryOperatorType::OpSubtract, 6, OperatorDescription::Clear, false);

        case Lexer::OpMultiply:         return OperatorDescription(pos, BinaryOperatorType::OpMultiply, 7, OperatorDescription::Clear, false);
        case Lexer::OpDivide:           return OperatorDescription(pos, BinaryOperatorType::OpDivide, 7, OperatorDescription::Clear, false);
        case Lexer::OpDivideRemainder:  return OperatorDescription(pos, BinaryOperatorType::OpModulo, 7, OperatorDescription::Clear, false);

        default:
            throw std::runtime_error("Unimplemented binary operator type in BinaryOperatorType::ConvertFromX");
        }
}

Parser::OperatorDescription Parser::ConvertToInvertedBinaryOperator()
{
        LineColumn pos = lexer.GetPosition();
        switch (TokenType())
        {
        case Lexer::Like:               return OperatorDescription(pos, BinaryOperatorType::OpLike, 2, OperatorDescription::DiffCategoryOk, true);
        case Lexer::In:                 return OperatorDescription(pos, BinaryOperatorType::OpIn, 2, OperatorDescription::DiffCategoryOk, true);

        default:
            throw std::runtime_error("Unimplemented binary operator type in BinaryOperatorType::ConvertFromX");
        }
}


//---------------------------------------------------------------------------//
//                                                                           //
// Token conversion support                                                  //
//                                                                           //

bool Parser::CheckLoadlibPath(std::string const &libname, bool report_errors)
{
        if (!HareScript::IsValidFilesystemPath(libname))
        {
                if (report_errors)
                    lexer.AddError(Error::InvalidLoadlib);
                return false;
        }
        return true;
}

Parser::RuleJump const * Parser::GetRule(Parser::RuleJumpMap const &rulemap, Lexer::Type type)
{
        RuleJumpMap::const_iterator item = rulemap.find(type);
        if (item == rulemap.end())
            return NULL;
        else
            return &item->second;
}

Symbol * Parser::CreateSubstituteRecord(SQLSource* source, std::string const &rename, bool allow_use)
{
        std::string name(rename);

        SymbolDefs::TableDef *tabledef(0);

        AST::Variable *var = dynamic_cast< AST::Variable * >(source->org_expression);
        if (var && var->symbol->variabledef)
        {
                if (name.empty() && var->symbol->name[0] != ':')
                    name = var->symbol->name;
                if (var->symbol->variabledef->type == VariableTypes::Table && !var->symbol->variabledef->tabledef.columnsdef.empty())
                    tabledef = &var->symbol->variabledef->tabledef;
        }
        if (!var)
        {
                AST::SchemaTable *st = dynamic_cast< AST::SchemaTable * >(source->org_expression);
                if (st)
                {
                        SymbolDefs::SchemaDef &schemadef = st->schema->symbol->variabledef->schemadef;
                        for (SymbolDefs::SchemaDef::TablesDef::iterator it = schemadef.tablesdef.begin(); it != schemadef.tablesdef.end(); ++it)
                            if (it->name == st->name)
                            {
                                    if (lexer.IsValidIdentifier(it->name) && name.empty())
                                        name = it->name;
                                    tabledef = &it->tabledef;
                            }
                }
                else if (AST::ObjectMemberConst *omc = dynamic_cast< AST::ObjectMemberConst * >(source->org_expression))
                {
                        if (lexer.IsValidIdentifier(omc->name) && name.empty())
                            name = omc->name;
                }
                else if (AST::RecordColumnConst *rcc = dynamic_cast< AST::RecordColumnConst * >(source->org_expression))
                {
                        if (lexer.IsValidIdentifier(rcc->name) && name.empty())
                            name = rcc->name;
                }
        }

        source->symbol = context.symboltable->CreateSQLSubstituteRecord(source->position, name);

        if (tabledef)
            source->symbol->variabledef->substitutedef = tabledef;
        else
        {
                source->symbol->variabledef->countersymbol = context.symboltable->RegisterDeclaredVariable (source->position, 0, false, false, VariableTypes::Integer);
                source->symbol->variabledef->countersymbol->variabledef->is_counter = true;
        }
        source->symbol->variabledef->allow_substitute_use = allow_use;

        return source->symbol;
}

std::string Parser::LexerLookahead()
{
        std::string str = std::string(lexer.RawTokenData(), lexer.RawTokenData() + 70);
        for (signed idx = 0; idx < (signed)str.size(); ++idx)
            if (str[idx] == '\r')
               str.erase(str.begin() + idx--);
            else if (str[idx] == '\n')
            {
                    str[idx] = 'n';
                    str.insert(str.begin() + idx, '\\');
            }
        return str;
}

void Parser::ExecuteSQLBlock(LineColumn pos, SQLWorkBlock &block)
{
        if (block.expr_block)
            coder->ImExecute(pos, block.expr_block);
        else
            coder->DoCodeBlock(block.sql_block);
}

bool Parser::IsCompStart()
{
        if (TokenType() != Lexer::OpenParenthesis)
            return false;

        Lexer::State pstate;
        lexer.SaveState(&pstate);
        NextToken();
        bool is_ok = TokenType() == Lexer::OpMultiply;
        lexer.RestoreState(&pstate);
        return is_ok;
}

bool Parser::ConvertRvalueIntoLvalueLayers(Rvalue *expr, ConvertedLvalue *result, bool force)
{
        result->base = 0;
        result->basevar = 0;
        result->first_layer_is_objectref = false;
        result->exprpos = expr->position;

        while (true)
        {
                result->base = expr;
                if (RecordColumnConst *rcc = dynamic_cast< RecordColumnConst * >(expr))
                {
                        result->layers.insert(result->layers.begin(), LvalueLayer(expr->position, rcc->name));
                        expr = rcc->record;
                        continue;
                }
                if (ArrayElementConst *aec = dynamic_cast< ArrayElementConst * >(expr))
                {
                        result->layers.insert(result->layers.begin(), LvalueLayer(expr->position, aec->index));
                        expr = aec->array;
                        continue;
                }
                if (ObjectMemberConst *omc = dynamic_cast< ObjectMemberConst * >(expr))
                {
                        result->layers.insert(result->layers.begin(), LvalueLayer(expr->position, omc->name, omc->via_this, omc->is_member, omc->next_token));
                        result->first_layer_is_objectref = true;
                        expr = omc->object;
                        result->base = expr;

                        // Fallthrough to see if the object is a variable
                }
                if (Variable *v = dynamic_cast< Variable * >(expr))
                {
                        result->basevar = v->symbol;
                        bool var_is_this = v->symbol->name == ":THIS";
                        if (var_is_this && result->layers.empty())
                            lexer.AddErrorAt(v->position, Error::ThisIsConstant);
                        return true;
                }

                if (result->first_layer_is_objectref)
                    return true;

                // Not an lvalue after here
                if (force)
                {
                        lexer.AddErrorAt(expr->position, Error::ExpectedLvalue);
                        result->basevar = coder->ImSafeErrorValueReturn(expr->position)->symbol;
                }
                return false;
        }
}

ExpressionBlock* Parser::BuildLvalueFromLayers(LineColumn const &position, ConvertedLvalue &clvalue, Block* calcblock, Block* workblock, bool old_value_needed)
{
        Block *baseblock = 0;
//        Symbol *basevar;

        if (calcblock)
        {
                baseblock = Adopt(new Block(clvalue.exprpos));
                coder->ImOpenBlock(baseblock);
                coder->DoCodeBlock(calcblock);
                coder->ImCloseBlock();
        }

        if (!clvalue.basevar)
        {
                // Base is not a variable; must be an expression that delivers an object
                if (!clvalue.first_layer_is_objectref)
                    throw std::runtime_error("Missing basevar only allowed when base is an object");

                // Put the object into a variable (within the base block)
                if (!baseblock)
                    baseblock = Adopt(new Block(clvalue.base->position));

                // Copy the expression result into a fresh object variable, and use that as base variable
                clvalue.basevar = context.symboltable->RegisterDeclaredVariable (clvalue.base->position, 0, false, false, VariableTypes::Object);

                coder->ImOpenBlock(baseblock);
                coder->ImExecute(clvalue.base->position,
                    coder->ImAssignment(clvalue.base->position,
                        coder->ImVariable(clvalue.base->position, clvalue.basevar),
                        clvalue.base));

                // Rewrite the base to use the new variable
                clvalue.base = coder->ImVariable(clvalue.base->position, clvalue.basevar);
                coder->ImCloseBlock();
        }

        // Now we have a basevar
        return coder->ImLvalue(position, clvalue, baseblock, workblock, old_value_needed);
}

ExpressionBlock* Parser::Try_Build_Lvalue(Rvalue *expr, Block* calcblock, Block* workblock, bool force, bool old_value_needed)
{
        ConvertedLvalue clvalue;
        if (!ConvertRvalueIntoLvalueLayers(expr, &clvalue, force) && !force)
            return 0;

        return BuildLvalueFromLayers(clvalue.exprpos, clvalue, calcblock, workblock, old_value_needed);
}

void Parser::GotContent()
{
        systemredirectallowed = false;
        if (coder->GetRoot()->scriptproperty_systemredirect)
        {
                coder->GetRoot()->scriptproperty_systemredirect = false;
                lexer.AddError(Error::NoContentWithSystemRedirect);
        }
}

} // End of namespace Compiler
} // End of namespace HareScript
