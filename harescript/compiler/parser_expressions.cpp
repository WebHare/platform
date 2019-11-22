//---------------------------------------------------------------------------
#include <harescript/compiler/allincludes.h>

//---------------------------------------------------------------------------

#include "parser.h"
#include <blex/lexer.h>
#include <blex/path.h>

#include "parser_tools.h"
#include "../vm/hsvm_varmemory.h"

/** Parser base file. Contains support functions, and root parse functions. */

using namespace Blex;

namespace HareScript
{
namespace Compiler
{

using namespace AST;

ConstantRecord* Parser::P_Record_Constant()
{
        AST::ConstantRecord* rec = coder->ImConstantRecord(lexer.GetPosition());
        PARSERULE("<record-constant> ::= CELL? *'[' <set-expression> ( ',' <set-expression ) * ']'");

        bool have_cell = TryParse(Lexer::Cell);
        NextToken(); // Eat the '['

        if (!have_cell || TokenType() != Lexer::CloseSubscript)
        {
                bool have_normal_elt = false;
                do
                {
                        if (TryParse(Lexer::OpEllipsis))
                        {
                                Rvalue* expr = P_Expression(false);

                                rec->columns.push_back(std::make_tuple(AST::ConstantRecord::Ellipsis, "", expr));
                        }
                        else if (TryParse(Lexer::Delete))
                        {
                                LineColumn namepos = lexer.GetPosition();
                                std::string name = P_Column_Name();
                                rec->columns.push_back(std::make_tuple(AST::ConstantRecord::Delete, name, coder->ImConstantString(namepos, name)));
                        }
                        else
                        {
                                have_normal_elt = true;
                                bool iserror;
                                std::pair < std::string, Rvalue* > pair = P_Set_Expression(have_cell, &iserror);

                                if (!iserror)
                                    rec->columns.push_back(std::make_tuple(AST::ConstantRecord::Item, pair.first, pair.second));
                        }

                } while (TryParse(Lexer::Comma));

                if (!have_cell && !have_normal_elt)
                    lexer.AddError(Error::OneNonEllipsisElementRequired);
        }

        ExpectCloseSubscript();
        return rec;
}

ConstantArray* Parser::P_Array_Constant(VariableTypes::Type elttype)
{
        PARSERULE("<array-constant> ::= type? (here) '[' <expression> ( ',' <expression ) * ']'");

        LineColumn typepos = lexer.GetPosition();

        VariableTypes::Type type = VariableTypes::Uninitialized;
        if (elttype & VariableTypes::Array)
        {
               context.errorhandler.AddErrorAt(typepos, Error::NoMultiLevelArrays);
               type = ToNonArray(elttype);
        }
        else if (elttype != VariableTypes::Uninitialized)
            type = ToArray(elttype);

        NextToken(); // Eat the '['

        ConstantArray* arr = coder->ImConstantArray(lexer.GetPosition(), type);

        if (type == VariableTypes::Uninitialized || TokenType() != Lexer::CloseSubscript)
        {
                bool have_normal_elt = false;
                do
                {
                        LineColumn pos = lexer.GetPosition();

                        if (TryParse(Lexer::OpEllipsis))
                        {
                                Rvalue* expr = P_Expression(false);
                                arr->values.push_back(std::make_tuple(pos, expr, true));
                        }
                        else
                        {
                                have_normal_elt = true;
                                Rvalue* expr = P_Expression(false);

                                arr->values.push_back(std::make_tuple(pos, expr, false));
                        }
                } while (TryParse(Lexer::Comma));

                if (type == VariableTypes::Uninitialized && !have_normal_elt)
                    lexer.AddError(Error::OneNonEllipsisElementRequired);
        }

        ExpectCloseSubscript();

        return arr;
}

bool Parser::SkipExpressionUntilComma()
{
        unsigned level = 0;
        bool with_blocks = false;
        while (TokenType() != Lexer::Eof)
        {
                if (TokenType() >= Lexer::FakeStartClosures && TokenType() <= Lexer::FakeEndFinalClosures && (!with_blocks || TokenType() != Lexer::CloseBlock))
                    break;

                if (TokenType() == Lexer::Comma)
                {
                        if (level == 0)
                            return true;
                        else
                            --level;
                }

                if (TokenType() == Lexer::OpenParenthesis || TokenType() == Lexer::OpenSubscript || TokenType() == Lexer::TemplatePlaceholderBlock)
                {
                        ++level;
                        if (TokenType() == Lexer::TemplatePlaceholderBlock)
                            with_blocks = true;
                }
                else if (TokenType() == Lexer::CloseParenthesis || TokenType() == Lexer::CloseSubscript || (with_blocks && TokenType() == Lexer::CloseBlock))
                {
                        if (level == 0)
                            break;

                        --level;
                        if (!level)
                            with_blocks = false;
                }
                else if (TokenType() == Lexer::Select)
                    ++level;

                NextToken();
        }
        return TokenType() == Lexer::Comma;
}


Rvalue* Parser::Try_P_Constant()
{
        LineColumn start_pos = lexer.GetPosition();

        VarId var = context.stackm.NewHeapVariable();

        //ADDME: Update ParseRules for the moved negator
        //try to eat a '-', because it influenced our overflow handling ( - INTEGER_MAX is okay, - (INTEGER_MAX) is not )
        bool negate=false;
        if (TokenType()==Lexer::OpSubtract)
        {
                Lexer::State state;
                lexer.SaveState(&state);
                NextToken();
                if (TokenType() != Lexer::ConstantNumber)
                {
                        //rollback, this is not a <neg> <constant> token
                        lexer.RestoreState(&state);
                        return NULL;
                }
                negate=true;
        }

        switch (TokenType())
        {
        case Lexer::Default: //ADDME: Update parserules with this new option
                {
                        PARSERULE("<constant> ::= DEFAULT <type>");
                        NextToken();

                        LineColumn type_pos = lexer.GetPosition();
                        VariableTypes::Type type = P_Type_Specifier(0);

                        if (type==VariableTypes::Table)
                        {
                                lexer.AddErrorAt(type_pos,Error::UnexpectedToken,"TABLE");
                        }
                        else if (type != VariableTypes::Uninitialized)
                        {
                                try
                                {
                                        context.stackm.InitVariable(var, type);
                                }
                                catch (VMRuntimeError &e)
                                {
                                        lexer.AddMessageAt(type_pos, e);
                                }
                        }
                        break;
                }

        case Lexer::True:
                {
                        PARSERULE("<constant> ::= TRUE");
                        context.stackm.SetBoolean(var, true);
                        NextToken();
                } break;
        case Lexer::False:
                {
                        PARSERULE("<constant> ::= FALSE");
                        context.stackm.SetBoolean(var, false);
                        NextToken();
                } break;
        case Lexer::ConstantString:
                {
                        PARSERULE("<constant> ::= <constant-string>");
                        context.stackm.SetSTLString(var, Blex::Lexer::ParseTokenString (lexer.GetTokenSTLString()));
                        NextToken();
                } break;
        case Lexer::ConstantNumber:
                {
                        /** Parse the number */
                        std::pair<DecimalFloat, char> number = lexer.GetTokenNumber();
                        //number can be ' ', 'I', 'M', 'F' or '.' (float/money without qualification)
                        if (negate)
                            number.first.Negate();

                        if (number.second == ' ' && number.first.ConvertableToS32())
                            number.second = 'I';

                        if (number.second == ' ' || number.second == '.')
                        {
                                if (number.first.ConvertableToMoney(false))
                                    number.second = 'M';
                                else
                                    number.second = 'F';
                        }

                        switch (number.second)
                        {
                        case 'I':       {
                                                PARSERULE("<constant> ::= <integer-constant>");
                                                if (!number.first.ConvertableToS32())
                                                    lexer.AddError(Error::IntegerOverflow);
                                                context.stackm.SetInteger(var, number.first.ToS32());
                                        } break;
                        case '6':       {
                                                PARSERULE("<constant> ::= <integer64-constant>");
                                                if (!number.first.ConvertableToS64())
                                                    lexer.AddError(Error::Integer64Overflow);
                                                context.stackm.SetInteger64(var, number.first.ToS64());
                                        } break;
                        case 'M':       {
                                                PARSERULE("<constant> ::= <money-constant>");
                                                if (!number.first.ConvertableToMoney(false))
                                                    lexer.AddError(Error::MoneyOverflow);
                                                context.stackm.SetMoney(var, number.first.ToMoney());
                                        } break;
                        case 'F':       {
                                                PARSERULE("<constant> ::= <float-constant>");
                                                if (!number.first.ConvertableToFloat())
                                                    lexer.AddError(Error::FloatOverflow);
                                                context.stackm.SetFloat(var, number.first.ToFloat());
                                        } break;
                        default:
                            if (!number.first.ConvertableToFloat())
                                lexer.AddError(Error::UnknownToken, lexer.GetTokenSTLString());
                            context.stackm.SetInteger(var, -1);
                        }
                        NextToken();
                } break;
        case Lexer::Cell: // CELL[ contents ]
                {
                        return P_Record_Constant();
                } break;
        case Lexer::OpenSubscript:
                {
                        // [ column := blaat, ... OR [ value, value, OR [ [ ... ], [ ... ]

                        Lexer::State state;
                        lexer.SaveState(&state);

                        // Eat the '['
                        NextToken();

                        bool is_record = false;
                        while (TokenType() != Lexer::Eof)
                        {
                                if (TryParse(Lexer::OpEllipsis))
                                {
                                        SkipExpressionUntilComma();

                                        // Must have at least one non-ellipsis argument - but will generate that error in the record/array constant parser
                                        if (!TryParse(Lexer::Comma))
                                            break;
                                }

                                if (TokenType() == Lexer::Identifier || TokenType() == Lexer::ConstantString)
                                {
                                        NextToken();
                                        is_record = TokenType() == Lexer::OpAssignment;
                                }
                                break;
                        }

                        lexer.RestoreState(&state);

                        if (is_record)
                            return P_Record_Constant();
                        else
                            return P_Array_Constant(VariableTypes::Uninitialized);
                }
        default:
            return NULL;
        }
        Constant* retval = coder->ImConstant(start_pos, var);
        return retval;
}


Rvalue* Parser::Try_P_TemplateString()
{
        if (TokenType()!=Lexer::TemplateString)
            return NULL;

        LineColumn pos = lexer.GetPosition();

        VarId var = context.stackm.NewHeapVariable();

        // <template-string> ::= <constant-string> [<template-placeholder-block> <template-string>]?

        // The return value is the starting constant string
        context.stackm.SetSTLString(var, Blex::Lexer::ParseTokenString(lexer.GetTokenSTLString()));
        Rvalue* retval = coder->ImConstant(pos, var);
        NextToken(); //skip over template string constant

        if (TokenType()==Lexer::TemplatePlaceholderBlock)
        {
                NextToken(); //skip over TemplatePlaceholderBlock
                pos = lexer.GetPosition();
                // There must be an expression
                if (TokenType()==Lexer::CloseBlock)
                {
                        lexer.AddErrorAt(pos, Error::ExpectedTemplateExpression);
                        return NULL;
                }
                // Read the placeholder expression
                Rvalue* expr_placeholder = P_Expression(false);
                if (expr_placeholder == NULL)
                {
                        lexer.AddErrorAt(pos, Error::ExpectedTemplateExpression);
                        return NULL;
                }
                if (TokenType()!=Lexer::CloseBlock)
                {
                        lexer.AddErrorAt(lexer.GetPosition(), Error::ExpectedClosingCurlyBrace);
                        return NULL;
                }
                // Merge the placeholder expression with the return value
                retval = coder->ImBinaryOperator(pos, BinaryOperatorType::OpMerge, retval, expr_placeholder);
                NextToken(); //skip over CloseBlock
                pos = lexer.GetPosition();
                // Read the rest of the template string
                Rvalue *template_rest = Try_P_TemplateString();
                if (!template_rest)
                {
                        lexer.AddErrorAt(lexer.GetPosition(), Error::UnexpectedEndOfString);
                        return NULL;
                }
                // Merge the rest of the template string with the return value
                retval = coder->ImBinaryOperator(pos, BinaryOperatorType::OpMerge, retval, template_rest);
        }

        return retval;
}

//ADDME: Document 'workblock'
ExpressionBlock* Parser::Try_P_Lvalue(Block* workblock, bool force, bool old_value_needed, Rvalue **org_expr)
{
        Rvalue *expr = P_Expression(true);
        if (org_expr)
            *org_expr = expr;

        return Try_Build_Lvalue(expr, 0, workblock, force, old_value_needed);
}


/** Try specific lvalue of the form x->b[3].a(column1, column2, column3), for SQL INSERT INTO.
*/
ExpressionBlock* Parser::Try_P_Lvalue_old(Block* workblock, bool force, bool old_value_needed)
{
        LineColumn varpos = lexer.GetPosition();

        Variable* var = 0;
        bool is_this = TryParse(Lexer::This);
        if (is_this)
        {
                Symbol* symbol = context.symboltable->ResolveSymbol(varpos, ":THIS", NULL, false);
                if (!symbol)
                    lexer.AddErrorAt(varpos, Error::ThisOnlyInMemberFunctions);
                else
                {
                        if (within_base_constructor_call)
                                lexer.AddErrorAt(varpos, Error::ThisNotAllowedInBaseConstructorParameters);
                        var = coder->ImVariable(varpos, symbol);
                }
        }
        else
            var = Try_P_Variable_Name(false);
        if (var == NULL)
        {
                if (!force)
                    return NULL;
                else
                {
                        if (TokenType() == Lexer::UnknownToken)
                            lexer.AddErrorUnknown();
                        else
                            lexer.AddError(Error::UnexpectedToken, std::string(lexer.RawTokenData(), lexer.RawTokenLength()));
                        var = coder->ImSafeErrorValueReturn(varpos);
                }
        }

        Rvalue *expr = var;

        // Parse the lvalue layers
        while ((TokenType()==Lexer::OpenSubscript) || (TokenType()==Lexer::OpDot) || (TokenType()==Lexer::OpArrow
        // && layers.size()<1
        ))
        {
                LineColumn pos = lexer.GetPosition();

                if (TokenType()==Lexer::OpenSubscript) // Array subscript
                {
                        NextToken(); //Eat '['

                        Rvalue* subscript_expr = P_Expression(true);
                        if (!subscript_expr)
                        {
                                NextToken();
                                return NULL;
                        }
                        ExpectCloseSubscript();
                        expr = coder->ImArrayElementConst(pos, expr, subscript_expr);
                        is_this = false;
                }
                else
                {
                        bool isdot = TokenType()==Lexer::OpDot;
                        NextToken(); //Eat '.' or '->'
                        bool ishat = !isdot && TryParse(Lexer::OpHat);

                        std::string colname = (ishat ? "^" : "") + P_Column_Name();

                        if (isdot)
                            expr = coder->ImColumnOf(pos, expr, colname);
                        else
                            expr = coder->ImMemberOf(pos, expr, colname, is_this, lexer.GetPosition());
                        is_this = false;
                }
        }
        if (is_this && TokenType() == Lexer::OpAssignment)
            lexer.AddErrorAt(varpos, Error::ThisIsConstant);

        return Try_Build_Lvalue(expr, 0, workblock, force, old_value_needed);
}

ExpressionBlock* Parser::P_Lvalue(Block* workblock, bool old_value_needed)
{
        return Try_P_Lvalue(workblock, true, old_value_needed, 0);
}

Rvalue* Parser::P_Assignment_Expression()
{
        LineColumn varpos = lexer.GetPosition();
        Rvalue *expr = P_Expression(true);

        if (TokenType()==Lexer::OpAssignment)
        {
                PARSERULE("<assignment-expression> ::= <lvalue> ':=' <expression>");
                LineColumn assignpos = lexer.GetPosition();

                NextToken(); // Eat ':='
                Rvalue* right(P_Expression(false));

                Variable *quick_var = dynamic_cast< Variable * >(expr);
                if (quick_var)
                {
                        Block* workblock = Adopt(new Block(lexer.GetPosition()));
                        ExpressionBlock *lvalue = Try_Build_Lvalue(expr, 0, workblock, true, false);

                        coder->ImOpenBlock(workblock);

                        if (quick_var->symbol->variabledef->type == VariableTypes::Table)
                        {
                                Symbol *f_rebind = context.symboltable->ResolveSymbol(assignpos, "__HS_SQL_REBINDTABLEWITHTYPEINFO", NULL, false);
                                if (!f_rebind)
                                    throw Message(true, Error::InternalError, "Cannot locate function __HS_SQL_REBINDTABLEWITHTYPEINFO");

                                RvaluePtrs params;
                                params.push_back(right);
                                params.push_back(coder->ImTypeInfo(assignpos, quick_var->symbol, nullptr, false));

                                right = coder->ImFunctionCall(assignpos, f_rebind, params);
                        }
                        else if (quick_var->symbol->variabledef->type == VariableTypes::Schema)
                        {
                                Symbol *f_rebind = context.symboltable->ResolveSymbol(assignpos, "__HS_SQL_REBINDSCHEMAWITHTYPEINFO", NULL, false);
                                if (!f_rebind)
                                    throw Message(true, Error::InternalError, "Cannot locate function __HS_SQL_REBINDSCHEMAWITHTYPEINFO");

                                RvaluePtrs params;
                                params.push_back(right);
                                params.push_back(coder->ImTypeInfo(assignpos, quick_var->symbol, nullptr, false));

                                right = coder->ImFunctionCall(assignpos, f_rebind, params);
                        }

                        // Quick path: variable := expression
                        coder->ImExecute(assignpos,
                            coder->ImAssignment(assignpos,
                                coder->ImVariable(lvalue->returnvar->position, lvalue->returnvar->symbol),
                                right));

                        coder->ImCloseBlock(); // workblock

                        return lvalue;
                }
                else
                {
                        // More complicated paths a.b := c, a[4] := d, f(10)->wow := 25;
                        Block* calcblock = Adopt(new Block(lexer.GetPosition()));
                        coder->ImOpenBlock(calcblock);

                        // First calculate the value to assign
                        Symbol *assign_val = context.symboltable->RegisterDeclaredVariable(varpos, 0, false, false, VariableTypes::Uninitialized); // Copy the type from the first assignment
                        coder->ImExecute(varpos,
                                coder->ImAssignment(varpos,
                                        coder->ImVariable(varpos, assign_val),
                                        right));
                        coder->ImCloseBlock(); // calcblock

                        Block* workblock = Adopt(new Block(lexer.GetPosition()));
                        ExpressionBlock *lvalue = Try_Build_Lvalue(expr, calcblock, workblock, true, false);

                        coder->ImOpenBlock(workblock);
                        coder->ImExecute(assignpos,
                            coder->ImAssignment(assignpos,
                                coder->ImVariable(lvalue->returnvar->position, lvalue->returnvar->symbol),
                                coder->ImVariable(varpos, assign_val)));
                        coder->ImCloseBlock(); // workblock

                        return lvalue;
                }
        }
        PARSERULE("<assignment-expression> ::= <expression>");

        return coder->ImDiscardableRvalue(lexer.GetPosition(), expr);
}

Rvalue* Parser::P_Expression(bool toplevel)
{
        PARSERULE("<expression> ::= <logical-expression> ? <expression> : <expression>");

        bool has_parentheses = TokenType() == Lexer::OpenParenthesis;

        LineColumn condprepos = lexer.GetPosition();
        Rvalue* condition = P_Logical_Expression(toplevel);

        if (TokenType()!=Lexer::OpCond && TokenType() != Lexer::OpNullCoalesce)
            return condition; //no need to recurse

        LineColumn oprpos = lexer.GetPosition();

        if (TokenType() == Lexer::Lexer::OpCond)
        {
                if (!has_parentheses && lexer.GetWhitespaceCommentPosition().line != condprepos.line)
                {
                        if (BinaryOperator *binop = dynamic_cast< BinaryOperator * >(condition))
                        {
                                if (binop->operation == BinaryOperatorType::OpAnd || binop->operation == BinaryOperatorType::OpOr)
                                    lexer.AddWarningAt(oprpos, Warning::SuggestParentheses);
                        }
                }

                NextToken(); //eat the conditional operator
                Rvalue* expr_true = P_Expression(false);
                if (expr_true == NULL)
                    return condition;

                if (TokenType()!=Lexer::OpColon)
                    lexer.AddError(Error::ExpectedColon);
                else
                    NextToken(); //eat the conditional seperator

                bool has_subparentheses = TokenType() == Lexer::OpenParenthesis;

                Rvalue* expr_false = P_Expression(false);
                if (expr_false == NULL)
                    return condition;

                // If the true and false case are on the same line, the ?? might be misread
                if (!has_subparentheses && expr_false->position.line == expr_true->position.line)
                {
                        if (BinaryOperator *binop = dynamic_cast< BinaryOperator * >(expr_false))
                            if (binop->operation == BinaryOperatorType::OpNullCoalesce)
                                lexer.AddWarningAt(binop->position, Warning::SuggestParentheses);
                }

                return coder->ImConditionalOperator(oprpos, condition, expr_true, expr_false);
        }
        else
        {
                NextToken(); //eat the nullcoalesce operator

                Rvalue* expr_false = P_Expression(false);
                if (expr_false == NULL)
                    return condition;

                return coder->ImBinaryOperator(oprpos, BinaryOperatorType::OpNullCoalesce, condition, expr_false);
        }
}

Rvalue* Parser::P_Logical_Expression(bool toplevel)
{
        std::list<Rvalue*> valuestack;
        std::list<OperatorDescription> opstack;

        bool emitted_warning = false;
        bool go_on = true;
        while (go_on)
        {
                valuestack.push_back(P_Prefix_Expression());

                switch (TokenType())
                {
                case Lexer::OpEquality:
                        if (toplevel)
                            lexer.AddError(Error::EqualityMayBeAssignment);
                        //fallthrough
                case Lexer::And:
                case Lexer::Or:
                case Lexer::Xor:
                case Lexer::OpLessThan:
                case Lexer::OpLessThanOrEqual:
                case Lexer::OpInequality:
                case Lexer::OpGreaterThan:
                case Lexer::OpGreaterThanOrEqual:
                case Lexer::OpMerge:
                case Lexer::Concat:
                case Lexer::BitAnd:
                case Lexer::BitOr:
                case Lexer::BitXor:
                case Lexer::BitLShift:
                case Lexer::BitRShift:
                case Lexer::OpAdd:
                case Lexer::OpSubtract:
                case Lexer::OpMultiply:
                case Lexer::OpDivide:
                case Lexer::OpDivideRemainder:
                case Lexer::Like:
                case Lexer::In:
                        {
                                opstack.push_back(ConvertToBinaryOperator());
                                NextToken();
                        } break;
                case Lexer::Not:
                        {
                                NextToken();
                                if (TokenType() == Lexer::Like || TokenType() == Lexer::In)
                                {
                                        opstack.push_back(ConvertToInvertedBinaryOperator());
                                        NextToken();
                                }
                                else
                                {
                                        // This expression is unparsable; skip current statement
                                        lexer.AddError(Error::ExpectedLikeOrInAfterNot);
                                        EatTillClosure(false);
                                        go_on = false;
                                        opstack.push_back(OperatorDescription());
                                        break;
                                }
                        } break;
                case Lexer::UnknownToken:
                        {
                                lexer.AddErrorUnknown();
                                EatTillClosure(false);
                        } // Fallthrough
                default:
                    go_on = false;
                    opstack.push_back(OperatorDescription());
                    break;
                }

                while (opstack.size() > 1)
                {
                        std::list<OperatorDescription>::iterator it = opstack.end();
                        OperatorDescription &new_op = *--it;
                        OperatorDescription &op = *--it;

                        if (new_op.priority > op.priority)
                            break;

                        if (op.bindingclarity != OperatorDescription::Clear || new_op.bindingclarity != OperatorDescription::Clear)
                            if (op.priority == new_op.priority)
                                if (op.op != new_op.op || op.bindingclarity == OperatorDescription::DiffCategoryOk || new_op.bindingclarity == OperatorDescription::DiffCategoryOk)
                                    if (!emitted_warning)
                                    {
                                            lexer.AddWarningAt(new_op.pos, Warning::SuggestParentheses);
                                            emitted_warning = true;
                                    }

                        Rvalue* rhs = valuestack.back(); valuestack.pop_back();
                        Rvalue* lhs = valuestack.back(); valuestack.pop_back();

                        Rvalue *result = coder->ImBinaryOperator(op.pos, op.op, lhs, rhs);
                        if (op.inverted)
                            result = coder->ImUnaryOperator(op.pos, UnaryOperatorType::OpNot, result);
                        valuestack.push_back(result);
                        opstack.erase(it);
                }
                toplevel = false;
        }
        return valuestack.front();
}

Rvalue* Parser::P_Prefix_Expression()
{
        std::stack< std::pair< LineColumn, UnaryOperatorType::Types > > ops;

        Rvalue* value(0);

        while (!value)
        {
                LineColumn pos = lexer.GetPosition();
                switch (TokenType())
                {
                case Lexer::OpSubtract:
                        value = Try_P_Constant();
                        if (value)
                            break;

                        //intentional fallthrough

                case Lexer::Not:
                case Lexer::BitNeg:
                case Lexer::OpAdd:
                        ops.push(std::make_pair(pos, ConvertToUnaryOperator(TokenType())));
                        NextToken();
                        break;
                default:
                        value = P_Postfix_Expression();
                }
        }

        while (!ops.empty())
        {
                value = coder->ImUnaryOperator(ops.top().first, ops.top().second, value);
                ops.pop();
        }
        return value;
}

Rvalue* Parser::P_Postfix_Expression()
{
        Rvalue* expr = P_Simple_Object();

        while(true)
        {
                if (TokenType()==Lexer::OpenSubscript) //( `[` Rvalue `]` )*
                {
                        LineColumn subscrpos = lexer.GetPosition();
                        NextToken(); //Eat '['

                        Rvalue* subscriptexpr = P_Expression(false);
                        if (subscriptexpr == NULL)
                            return NULL;

                        expr = coder->ImArrayElementConst(subscrpos, expr,subscriptexpr);
                        ExpectCloseSubscript();
                }
                else if (TokenType()==Lexer::OpDot) //Handle the common [ . Elementname ] part
                {
                        LineColumn dotpos = lexer.GetPosition();
                        NextToken(); //Eat '.'

                        if (Variable *var = dynamic_cast< Variable * >(expr))
                        {
                                if (var->symbol->variabledef) // Is this really a variable?
                                {
                                        if (var->symbol->variabledef->type == VariableTypes::Schema)
                                        {
                                                std::string tabname = P_Table_Name(true);
                                                expr = coder->ImSchemaTableOf(dotpos, var, tabname);
                                        }
                                        else
                                        {
                                                std::string colname = P_Column_Name();
                                                expr=coder->ImColumnOf(dotpos, expr, colname);
                                        }
                                }
                        }
                        else
                        {
                                std::string colname = P_Column_Name();
                                expr=coder->ImColumnOf(dotpos, expr, colname);
                        }
                }
                else if (TokenType()==Lexer::OpArrow)
                {
                        NextToken(); //Eat '->'
                        LineColumn dotpos = lexer.GetPosition();

                        Variable *source = dynamic_cast< Variable * >(expr);
                        bool via_this = source && source->symbol->name == ":THIS";
                        bool ishat = TryParse(Lexer::OpHat);

                        std::string colname = (ishat ? "^" : "") + P_Column_Name();

                        if (!TryParse(Lexer::OpenParenthesis))
                        {
                                LineColumn nextpos = lexer.GetPosition();
                                expr=coder->ImMemberOf(dotpos, expr, colname, via_this, nextpos);
                        }
                        else
                        {
                                RvaluePtrs params;
                                std::vector<int32_t> passthrough_parameters;
                                bool any_passthrough = false;

                                P_Function_Call_Parameters(&params, &passthrough_parameters, &any_passthrough);

                                expr = coder->ImObjectMethodCall(dotpos,
                                        expr,
                                        colname,
                                        via_this,
                                        params,
                                        any_passthrough,
                                        passthrough_parameters);
                        }
                }
                else if (TokenType()==Lexer::OpenParenthesis)
                {
                        LineColumn callpos = lexer.GetPosition();

                        RvaluePtrs params;
                        NextToken(); // Eat '('

//*                      // FIXME: this code is for the rebinding of function pointers, but it doesn't work good enough
                        // It also accepts FUNCTION PTR a,b; b := a(#1, #2);

                        std::vector<int32_t> passthrough_parameters;
                        bool any_passthrough = false;

                        P_Function_Call_Parameters(&params, &passthrough_parameters, &any_passthrough);

                        if (any_passthrough)
                            expr = coder->ImFunctionPtrRebind(callpos, expr, passthrough_parameters, params, true);
                        else
                            expr = coder->ImFunctionPtrCall(callpos, expr, params);
/*/
                        //someone just forgot a () here..
                        if (TokenType() != Lexer::CloseParenthesis)
                        {
                                PARSERULE("<function-parameter-list> ::= <expression> [ ',' <function-parameter-list> ]");

                                //Parse remainder: Rvalue (,Rvalue)*
                                while (true)
                                {
                                        Rvalue* paramexpr = P_Expression(false);
                                        params.push_back(paramexpr);

                                        if (TokenType()!=Lexer::Comma)
                                            break; //abort parser

                                        NextToken(); //eat `,`
                                }
                        }
                        ExpectCloseParenthesis();

                        expr = coder->ImFunctionPtrCall(callpos, expr, params);
//*/
                }
                else if (TokenType()==Lexer::Not || TokenType()==Lexer::ExtendsFrom) //( NOT? EXTENDSFROM objecttype-name )*
                {
                        // See if we have a NOT followed by an EXTENDSFROM
                        bool negate=false;
                        if (TokenType()==Lexer::Not)
                        {
                                Lexer::State state;
                                lexer.SaveState(&state);
                                NextToken(); // Eat 'NOT'
                                if (TokenType() != Lexer::ExtendsFrom)
                                {
                                        //rollback, this is not a NOT EXTENDSFROM token
                                        lexer.RestoreState(&state);
                                        break;
                                }
                                negate=true;
                        }

                        NextToken(); // Eat 'EXTENDSFROM'

                        LineColumn namepos = lexer.GetPosition();
                        if (ExpectName().empty())
                        {
                                lexer.AddError(Error::MayNotBeUsedAsName,lexer.GetTokenSTLString());
                                NextToken();
                                return coder->ImSafeErrorValueReturn(namepos);
                        }

                        std::string name = lexer.GetTokenIdentifier();
                        NextToken();

                        Symbol *obj = symboltable.ResolveSymbolEx(namepos, name, SymbolLookupType::ObjectTypes, false, false).first;
                        if (!obj)
                        {
                                // Keep in sync with code that parses NEW object
                                obj = symboltable.RegisterForwardSymbol(namepos, name, SymbolType::ObjectType, false, false);
                                obj->state = SymbolState::Forward;

                                Symbol *constructor = context.symboltable->RegisterForwardSymbol(LineColumn(), name + "#NEW", SymbolType::Function, false, false);
                                constructor->state = SymbolState::Forward;
                                obj->objectdef->constructor = constructor;
                                constructor->functiondef->object = obj;
                        }

                        // Extra cast, to hide call to __HS_OBJECTMATCHESOUID
                        expr = coder->ImCast(expr->position, expr, VariableTypes::Object, false, false);
                        Rvalue* result = coder->ImObjectIsOfType(namepos, expr, obj);
                        if (negate)
                            result = coder->ImUnaryOperator(namepos, UnaryOperatorType::OpNot, result);
                        return result;
                }
                else break;
        }
        return expr;
}

Rvalue* Parser::P_TypeId()
{
        LineColumn pos = lexer.GetPosition();
        NextToken();
        ExpectOpenParenthesis();

        VariableTypes::Type vartype = Try_P_Type_Specifier(0);
        if (vartype != VariableTypes::Uninitialized)
        {
                LineColumn pos = lexer.GetPosition();

                ExpectCloseParenthesis();
                return coder->ImConstantInteger(pos, vartype);
        }
        else
        {
                std::string const &name = "__HS_TYPEID";
                Symbol* symbol = context.symboltable->ResolveSymbol(pos, name, NULL, false);
                if (!symbol)
                    symbol = symboltable.RegisterNewCalledFunction(pos, name, false);

                RvaluePtrs exprs;
                exprs.push_back(P_Expression(false));

                ExpectCloseParenthesis();
                return coder->ImFunctionCall(pos, symbol, exprs);
        }
}

Rvalue* Parser::P_Yield()
{
        LineColumn pos = lexer.GetPosition();

        bool is_yield = TokenType() == Lexer::Yield;
        NextToken();

        bool star = false;
        if (currentfunction && is_yield && !currentfunction->functiondef->isasync) // no yield* in async function for now
          star = TryParse(Lexer::OpMultiply);

        Rvalue *retval;
        if (!currentfunction || !currentfunction->functiondef->generator || (!is_yield && !currentfunction->functiondef->isasync))
        {
                if (is_yield)
                    lexer.AddErrorAt(pos, Error::YieldOnlyInGeneratorFunction);
                else
                    lexer.AddErrorAt(pos, Error::AwaitOnlyInAsyncFunction);
                P_Expression(false);
                retval = coder->ImSafeErrorValueReturn(pos);
        }
        else
        {
                Rvalue *expr = is_yield ? P_Expression(false) : P_Postfix_Expression();

                retval = coder->ImYield(
                        pos,
                        coder->ImVariable(pos, currentfunction->functiondef->generator), expr,
                        currentfunction->functiondef->isasync,
                        !is_yield,
                        is_yield && !currentfunction->functiondef->isasync,
                        star);
        }

        return retval;
}

Rvalue* Parser::P_Simple_Object()
{
        LineColumn pos = lexer.GetPosition();

        // New object?
        if (TryParse(Lexer::New))
        {
                LineColumn namepos = lexer.GetPosition();
                if (ExpectName().empty())
                {
                        lexer.AddError(Error::MayNotBeUsedAsName,lexer.GetTokenSTLString());
                        NextToken();
                        return coder->ImSafeErrorValueReturn(pos);
                }

                std::string name = lexer.GetTokenIdentifier();
                NextToken();

                RvaluePtrs params;
                if (TryParse(Lexer::OpenParenthesis) && !TryParse(Lexer::CloseParenthesis))
                {
                        params = P_Expression_List();
                        ExpectCloseParenthesis();
                }

                Symbol *obj = symboltable.ResolveSymbolEx(namepos, name, SymbolLookupType::ObjectTypes, false, false).first;
                if (!obj)
                {
                        // Keep in sync with code that parses EXTEND/EXTENDSFROM oject
                        obj = symboltable.RegisterForwardSymbol(namepos, name, SymbolType::ObjectType, false, false);
                        obj->state = SymbolState::Forward;

                        Symbol *constructor = context.symboltable->RegisterForwardSymbol(LineColumn(), name + "#NEW", SymbolType::Function, false, false);
                        constructor->state = SymbolState::Forward;
                        obj->objectdef->constructor = constructor;
                        constructor->functiondef->object = obj;
                }

                return coder->ImCodeNew(namepos, obj, 0, params);
        }

        // Try a template string
        Rvalue* value = Try_P_TemplateString();
        if (value)
        {
                PARSERULE("<simple-object> ::= <template-string>");
                return value;
        }

        // Try a constant
        value = Try_P_Constant();
        if (value)
        {
                PARSERULE("<simple-object> ::= <constant>");
                return value;
        }

        if (TokenType() == Lexer::OpenParenthesis)
        {
                Lexer::State state;
                lexer.SaveState(&state);
                NextToken();
                bool is_closure = TokenType() == Lexer::CloseParenthesis;
                if (!is_closure && TokenType() != Lexer::Ptr)
                {
                        VariableTypes::Type type = Try_P_Type_Specifier(nullptr);
                        if (type != VariableTypes::Uninitialized)
                            is_closure = TokenType() == Lexer::Identifier;
                }
                lexer.RestoreState(&state);
// For now, closures are disabled. Remove this comment to enable
//                if (is_closure)
//                    return P_Closure();

                NextToken();
                Rvalue *value = P_Expression(false);
                ExpectCloseParenthesis();
                return value;
        }

        if (TokenType() == Lexer::Ptr)
            return P_Bind_Expression();

        if (TokenType() == Lexer::End) //END expression
        {
                NextToken();
                return coder->ImEnd(pos);
        }

        if (TokenType() == Lexer::OpHat)
        {
                LineColumn hatpos = lexer.GetPosition();
                NextToken();
                LineColumn namepos = lexer.GetPosition();
                std::string colname = "^" + P_Column_Name();

                Symbol* symbol = context.symboltable->ResolveSymbol(hatpos, ":THIS", NULL, false);
                if (!symbol)
                {
                        lexer.AddErrorAt(hatpos, Error::ThisOnlyInMemberFunctions);
                        return coder->ImConstant(pos, 0); // Do NOT return 0. // ADDME: variant error node?
                }
                else
                {
                        if (within_base_constructor_call)
                            lexer.AddErrorAt(hatpos, Error::ThisNotAllowedInBaseConstructorParameters);
                }
                Rvalue *expr = coder->ImVariable(hatpos, symbol);

                if (!TryParse(Lexer::OpenParenthesis))
                {
                        LineColumn nextpos = lexer.GetPosition();
                        expr=coder->ImMemberOf(namepos, expr, colname, true, nextpos);
                }
                else
                {
                        RvaluePtrs params;
                        std::vector<int32_t> passthrough_parameters;
                        bool any_passthrough = false;

                        P_Function_Call_Parameters(&params, &passthrough_parameters, &any_passthrough);

                        expr = coder->ImObjectMethodCall(namepos,
                                expr,
                                colname,
                                true,
                                params,
                                any_passthrough,
                                passthrough_parameters);
                }
                return expr;
        }

        // [ 'private' ] 'This' pointer?
        bool is_private_this = false;
        if (TokenType() == Lexer::Private)
        {
                Lexer::State state;
                lexer.SaveState(&state);
                NextToken();
                is_private_this = TokenType() == Lexer::This;
                if (!is_private_this)
                    lexer.RestoreState(&state);
        }
        if (TokenType() == Lexer::This)
        {
                LineColumn thispos = lexer.GetPosition();
                NextToken();
                Symbol* symbol = context.symboltable->ResolveSymbol(thispos, ":THIS", NULL, false);
                if (!symbol)
                {
                        lexer.AddErrorAt(thispos, Error::ThisOnlyInMemberFunctions);
                        return coder->ImConstant(pos, 0); // Do NOT return 0. // ADDME: variant error node?
                }
                else
                {
                        if (within_base_constructor_call)
                            lexer.AddErrorAt(thispos, Error::ThisNotAllowedInBaseConstructorParameters);
                }
                Rvalue *expr = coder->ImVariable(thispos, symbol);
                if (is_private_this)
                    expr = coder->ImMakePrivilegedObjectReference(pos, expr);
                return expr;
        }

        VariableTypes::Type vartype = Try_P_Type_Specifier(0);
        if (vartype != VariableTypes::Uninitialized)
        {
                if (TokenType() == Lexer::OpenSubscript) // TYPE[] (array)
                    return P_Array_Constant(vartype);

                // Explicit cast
                ExpectOpenParenthesis();
                value = P_Expression(false);
                value = coder->ImCast(pos, value, vartype, true, false);
                ExpectCloseParenthesis();
                return value;
        }

        // Parse COLUMNs and VARs, retain the first, error at multiple
        bool has_column;
        bool has_var = false;
        if (((has_column = TryParse(Lexer::Column)) != 0) || ((has_var = TryParse(Lexer::Var)) != 0))
        {
                LineColumn pos = lexer.GetPosition();
                if (TryParse(Lexer::Var) || TryParse(Lexer::Column))
                    lexer.AddErrorAt(pos, Error::VarColumnOnlyOnce);

                // Eat the rest of 'm VARs and COLUMNs
                while (TryParse(Lexer::Column) || TryParse(Lexer::Var)) { }
        }

        if (TokenType() == Lexer::TypeId)
        {
                // ADDME: issue error if has_var or has_column
                value = P_TypeId();
                return value;
        }

        if (TokenType() == Lexer::Yield || TokenType() == Lexer::Await)
        {
                value = P_Yield();
                return value;
        }

        if (TokenType() == Lexer::Select)
        {
                // ADDME: issue error if has_var or has_column
                value = P_Select_Expression();
                return value;
        }

        if (!has_column)
        {
                // Is it a possibly a function-call?
                value = Try_P_Function_Call();
                if (value)
                {
                        PARSERULE("<simple-object> ::= [ VAR ] <function-call>");

                        // ADDME: warning for ignored VAR if has_var.
                        return value;
                }
        }

        std::pair<Symbol *, bool> res;

        if (!has_var && (TokenType() == Lexer::Identifier || has_column))
        {
                // Possible: <restricted-column-name>,  <variable>, COLUMN <column-name>
                LineColumn pos = lexer.GetPosition();

                std::string name;
                if (has_column)
                {
                        PARSERULE("<simple-object> ::= COLUMN <column-name>");

                        // Issues error if missing column name
                        name = P_Column_Name();
                        res = symboltable.ResolveSymbolEx(pos, name, SymbolLookupType::Columns, false, true);
                }
                else
                {
                        name = lexer.GetTokenIdentifier();
                        res = symboltable.ResolveSymbolEx(pos, name, SymbolLookupType::ColumnsAndVars, false, true);
                        NextToken();

                        if (res.first && res.first->type == SymbolType::Function)
                        {
                                if (in_bind_expression)
                                {
                                        // Return an implicit function ptr.
                                        std::vector<int32_t> passthrough_parameters;
                                        RvaluePtrs bound_parameters;
                                        bool paramsspecified=false;
                                        FunctionPtr *ptr = coder->ImFunctionPtr(pos, res.first, paramsspecified, passthrough_parameters, bound_parameters);
                                        ptr->outside_ptr = true;
                                        return ptr;
                                }
                                lexer.AddError(Error::ExpectedFunctionOpenParen, res.first->name);
                                return coder->ImSafeErrorValueReturn(pos);
                        }
                }
                if (TryParse(Lexer::ScopeResolution))
                {
                        LineColumn namepos = lexer.GetPosition();
                        std::string cname = P_Column_Name();

                        RvaluePtrs expr;
                        ExpectOpenParenthesis(); // ADDME: Use ExpectFunctionOpeningParenthesis
                        if (TokenType()!=Lexer::CloseParenthesis)
                        {
                                //Parse remainder: Rvalue (,Rvalue)*
                                while (true)
                                {
                                        Rvalue *paramexpr = P_Expression(false);
                                        expr.push_back(paramexpr);

                                        if (TokenType()!=Lexer::Comma)
                                            break; //abort parser

                                        NextToken(); //eat `,`
                                }
                        }
                        ExpectCloseParenthesis();

                        if (!res.first || res.first->type != SymbolType::ObjectType)
                        {
                                lexer.AddErrorAt(pos, Error::UnknownObjectType, name);
                                return coder->ImSafeErrorValueReturn(pos);
                        }

                        SymbolDefs::ObjectDef *parent_objdef = res.first->objectdef;
                        SymbolDefs::ObjectField *field = parent_objdef->FindField(cname, true);
                        if (!field)
                        {
                                lexer.AddErrorAt(namepos, Error::FunctionIsNotAMember, cname, name);
                        }
                        else
                        {
                                if (field->type != ObjectCellType::Method)
                                    lexer.AddErrorAt(namepos, Error::BaseMemberOnlyForFunctions);
                                else if (!field->method)
                                    lexer.AddErrorAt(namepos, Error::InternalError, "Member has no function symbol");
                                else
                                {
                                        res = symboltable.ResolveSymbolEx(pos, ":THIS", SymbolLookupType::Variables, false, true);
                                        if (!res.first)
                                            lexer.AddErrorAt(namepos, Error::ParentCallOnlyInMemberFunctions);
                                        else
                                        {
                                                Symbol *this_symbol = res.first;
                                                SymbolDefs::ObjectDef *curr_objdef = 0;
                                                if (this_symbol->variabledef->objectdef->base)
                                                    curr_objdef = this_symbol->variabledef->objectdef->base->objectdef;

                                                if (curr_objdef)
                                                {
                                                        while (parent_objdef != curr_objdef && curr_objdef->base)
                                                            curr_objdef = curr_objdef->base->objectdef;
                                                }

                                                if (parent_objdef != curr_objdef)
                                                    lexer.AddErrorAt(namepos, Error::ParentCallToKnownBaseOnly);
                                                expr.insert(expr.begin(), coder->ImVariable(namepos, res.first));
                                                return coder->ImFunctionCallUser(namepos, field->method, expr);
                                        }
                                }
                        }
                        return coder->ImSafeErrorValueReturn(pos);
                }

                if (res.first && res.first->type == SymbolType::ObjectType)
                {
                        lexer.AddErrorAt(pos, Error::NoObjectTypeHere);
                        res.first = 0;
                }

                if (!res.first) // Lookup error?
                {
                        // Error has already been issued
                        value = coder->ImConstant(pos, 0);
                        return value;
                }
                else
                {
                        // Found a variable
                        value = coder->ImVariable(pos, res.first);
                        if (!has_column)
                        {
                                if (res.second)
                                {
                                        PARSERULE("<simple-object> ::= <restricted-column-name>");
                                }
                                else
                                {
                                        PARSERULE("<simple-object> ::= <variable>"); // Specific: '<simple-object> ::= <variable-name>'
                                }
                        }

                        if (res.second) // Found a column reference?
                            value = coder->ImColumnOf(lexer.GetPosition(), coder->ImVariable(pos, res.first), name);
                        return value;
                }
        }

        // case '<simple-object> ::= <variable-name>' has been already been handled
        PARSERULE("<simple-object> ::= [ VAR ] <variable>");

        // Remaining case: it must be a variable (also preferred as default option for error reporting)
        value = Try_P_Variable(has_var);

        // If error: fill with variant constant; we cannot return 0.
        if (!value)
        {
                lexer.AddErrorUnknown();
                EatTillClosure(false);
                value = coder->ImSafeErrorValueReturn(pos);
        }
        return value;
}

Rvalue* Parser::Try_P_Function_Call()
{
        Lexer::State prefuncstate;
        lexer.SaveState(&prefuncstate);

        if (TokenType() != Lexer::Identifier)
            return 0;

        LineColumn pos = lexer.GetPosition();

        std::string name = lexer.GetTokenIdentifier();
        LineColumn namepos = lexer.GetPosition();

        NextToken(); //Eat function name

        if (TokenType() == Lexer::OpenSubscript)
        {
                Lexer::State subscriptstate;
                lexer.SaveState(&subscriptstate);

                NextToken();
                bool isfunc = TryParse(Lexer::CloseSubscript) && TokenType() == Lexer::OpenParenthesis;
                lexer.RestoreState(&subscriptstate);

                if (!isfunc)
                {
                        lexer.RestoreState(&prefuncstate);
                        return 0;
                }
        }
        else if (TokenType() != Lexer::OpenParenthesis)
        {
                // No function call, return
                lexer.RestoreState(&prefuncstate);
                return 0;
        }

        Symbol *symbol = symboltable.ResolveSymbol(pos, name, NULL, true);
        if (symbol && symbol->type != SymbolType::Function)
        {
                // No function call, return
                lexer.RestoreState(&prefuncstate);
                return 0;
        }

        PARSERULE("<function-call> ::= <function-name> '(' <function-parameter-list> ')'");

        if (!symbol)
            symbol = symboltable.RegisterNewCalledFunction(pos, name, false);

        bool is_count = symbol->functiondef && (symbol->functiondef->flags & FunctionFlags::IsCount);

        RvaluePtrs expr;
        std::vector<int32_t> passthrough_parameters; //Hold the input parameter number for passthrough parameters. 0 if a constant
        bool has_passthroughs=false;
        bool inhibit_aggregate=false;
        if (TryParse(Lexer::OpenSubscript))
        {
                if (!TryParse(Lexer::CloseSubscript))
                    lexer.AddError(Error::ExpectedClosingSquareBracket);
                inhibit_aggregate = true;
        }

        if (symbol->functiondef)
            ExpectFunctionOpenParenthesis(symbol);
        else
            ExpectOpenParenthesis();

        if (is_count)
        {
                expr.push_back(coder->ImConstantInteger(pos, 1));
                if (TokenType() != Lexer::OpMultiply)
                    lexer.AddError(Error::ExpectedAsterisk);
                else
                    NextToken();

                ExpectCloseParenthesis();
        }
        else
            P_Function_Call_Parameters(&expr, &passthrough_parameters, &has_passthroughs);

        if (has_passthroughs)
        {
                AST::FunctionPtr *fptr = coder->ImFunctionPtr(namepos, symbol, true, passthrough_parameters, expr);
                fptr->inhibit_aggregate = inhibit_aggregate;
                return fptr;
        }
        else
        {
                AST::FunctionCall *call = coder->ImFunctionCallUser(namepos, symbol, expr);
                call->inhibit_aggregate = inhibit_aggregate;
                return call;
        }
}

Variable* Parser::Try_P_Opcount_Variable()
{
        LineColumn pos = lexer.GetPosition();
        Variable* ptr = Try_P_Variable_Name(false);

        if (ptr)
        {
                if (ptr->symbol && ptr->symbol->variabledef && ptr->symbol->variabledef->countersymbol)
                {
                        ptr->symbol = ptr->symbol->variabledef->countersymbol;
                }
                else
                {
                        // No counter symbol. Resolution: return variable itself

                        if (ptr->symbol && ptr->symbol->variabledef->is_substitute)
                            lexer.AddErrorAt(pos, Error::NoCounterForTable);
                        else if (ptr->symbol)
                            lexer.AddErrorAt(pos, Error::NoCounterAvailable, ptr->symbol->name);
                        else
                            lexer.AddErrorAt(pos, Error::NoCounterAvailable, lexer.GetTokenIdentifier());
                }
        }
        return ptr;
}

Variable* Parser::Try_P_Variable(bool has_var_qualifier)
{
        if (TokenType()==Lexer::OpCount)
        {
                NextToken();
                return Try_P_Opcount_Variable();
        }
        return Try_P_Variable_Name(has_var_qualifier);
}

Variable* Parser::Try_P_Variable_Name(bool has_var_qualifier)
{
        SymbolLookupType::Types lookuptype =
                has_var_qualifier ? SymbolLookupType::Variables : SymbolLookupType::ColumnsAndVars;

        if (TokenType() != Lexer::Identifier)
        {
                if (has_var_qualifier)
                {
                        lexer.AddError(Error::ExpectedVariable);
                        NextToken();
                }
                return 0;
        }

        std::string name = lexer.GetTokenIdentifier();
        LineColumn pos = lexer.GetPosition();

        Lexer::State state;
        lexer.SaveState(&state);

        std::pair<Symbol *, bool> res = symboltable.ResolveSymbolEx(pos, name, lookuptype, true, true);
        NextToken();

        if (res.first && res.first->type!=SymbolType::Function && !res.second/*found a colum name*/ && res.first->variabledef)
            return coder->ImVariable(pos, res.first);

        lexer.RestoreState(&state);
        return 0;
}

std::vector< Rvalue* > Parser::P_Expression_List()
{
        PARSERULE("<expression-list> ::= <expression> [ ','  <expression-list> ]");

        std::vector< Rvalue* > retval;

        do
        {
            retval.push_back(P_Expression(false));
        } while (TryParse(Lexer::Comma));

        return retval;
}

Rvalue* Parser::P_Bind_Expression()
{
        LineColumn pos = lexer.GetPosition();
        bool old_in_expr = in_bind_expression;
        in_bind_expression = true;

        NextToken(); // Eat PTR

        LineColumn namepos = lexer.GetPosition();

        if (TokenType() == Lexer::Identifier)
        {
                std::string name = lexer.GetTokenIdentifier();
                Symbol* symbol = context.symboltable->ResolveSymbol(namepos, name, NULL, false);

                if (!symbol)
                {
                        Lexer::State state;
                        lexer.SaveState(&state);
                        NextToken(); // Eat identifier
                        if (!symbol && TokenType() != Lexer::OpArrow && TokenType() != Lexer::OpDot)
                        {
                                // If we don't know the first identifier, register it as a function.
                                symboltable.RegisterNewCalledFunction(pos, name, false);
                        }

                        lexer.RestoreState(&state);
                }
        }

        Rvalue *expr = P_Expression(false);

        in_bind_expression = old_in_expr;

        if (ObjectMethodCall *ocall = dynamic_cast< ObjectMethodCall * >(expr))
        {
                expr = ocall->object;
                std::string membername = ocall->membername;

                Symbol *f_mfptr = context.symboltable->ResolveSymbol(pos, "GETOBJECTMETHODPTR", NULL, false);
                if (!f_mfptr)
                    throw Message(true, Error::InternalError, "Cannot locate function GETOBJECTMETHODPTR");

                Variable *thisvar = dynamic_cast< Variable * >(expr);
                if (thisvar && thisvar->symbol->name == ":THIS")
                    expr = coder->ImMakePrivilegedObjectReference(ocall->position, expr);

                RvaluePtrs params;
                params.push_back(expr);
                params.push_back(coder->ImConstantString(ocall->position, membername));

                FunctionCall *fptr = coder->ImFunctionCall(ocall->position, f_mfptr, params);
                return coder->ImFunctionPtrRebind(ocall->position, fptr, ocall->passthrough_parameters, ocall->parameters, false);
        }
        else if (ObjectMemberConst *omem = dynamic_cast< ObjectMemberConst * >(expr))
        {
                expr = omem->object;
                std::string membername = omem->name;

                Symbol *f_mfptr = context.symboltable->ResolveSymbol(pos, "GETOBJECTMETHODPTR", NULL, false);
                if (!f_mfptr)
                    throw Message(true, Error::InternalError, "Cannot locate function GETOBJECTMETHODPTR");

                Variable *thisvar = dynamic_cast< Variable * >(expr);
                if (thisvar && thisvar->symbol->name == ":THIS")
                    expr = coder->ImMakePrivilegedObjectReference(omem->position, expr);

                RvaluePtrs params;
                params.push_back(expr);
                params.push_back(coder->ImConstantString(omem->position, membername));

                FunctionCall *call = coder->ImFunctionCall(pos, f_mfptr, params);
                return call;
        }
        else if (FunctionPtrCall *fptrcall = dynamic_cast< FunctionPtrCall * >(expr))
        {
                std::vector< int32_t > passthroughs(fptrcall->params.size(), 0);

                return coder->ImFunctionPtrRebind(fptrcall->position, fptrcall->functionptr, passthroughs, fptrcall->params, false);
        }
        else if (FunctionPtr *fptr = dynamic_cast< FunctionPtr * >(expr))
        {
                fptr->outside_ptr = false;
                return fptr;
        }
        else if (FunctionCall *fcall = dynamic_cast< FunctionCall * >(expr))
        {
                std::vector< int32_t > passthroughs(fcall->parameters.size(), 0);

                FunctionPtr *fptr = coder->ImFunctionPtr(pos,
                        fcall->symbol,
                        true,
                        passthroughs,
                        fcall->parameters);
                fptr->inhibit_aggregate = fcall->inhibit_aggregate;
                fptr->outside_ptr = false;
                return fptr;
        }
        else if (FunctionPtrRebind *frebind = dynamic_cast< FunctionPtrRebind * >(expr))
        {
                frebind->outside_ptr = false;
                return frebind;
        }

        lexer.AddErrorAt(expr->position, Error::IllegalBindExpression);
        return coder->ImSafeErrorValueReturn(expr->position);

/*

        // Next token should be a function name
        Symbol *symbol(0);
        if (TokenType() == Lexer::Identifier)
        {
                std::string name = lexer.GetTokenIdentifier();
                symbol = symboltable.ResolveSymbol(namepos, name, NULL, true);
                if (!symbol)
                    symbol = symboltable.RegisterNewCalledFunction(pos, name, false);
        }
        else if (TokenType() == Lexer::This)
        {
                symbol = context.symboltable->ResolveSymbol(namepos, ":THIS", NULL, false);
                if (!symbol)
                    lexer.AddErrorAt(namepos, Error::ThisOnlyInMemberFunctions);
        }

        if (symbol && symbol->type == SymbolType::Variable)
        {
                NextToken();
                if (!TryParse(Lexer::OpArrow))
                {
                        lexer.AddError(Error::ExpectedArrowOperator);
                        return coder->ImSafeErrorValueReturn(lexer.GetPosition());
                }

                LineColumn cpos = lexer.GetPosition();
                std::string name = P_Column_Name();

                Symbol *f_mfptr = context.symboltable->ResolveSymbol(pos, "GETOBJECTMETHODPTR", NULL, false);
                if (!f_mfptr)
                    throw Message(true, Error::InternalError, "Cannot locate function GETOBJECTMETHODPTR");

                RvaluePtrs params;
                params.push_back(coder->ImVariable(pos, symbol));
                params.push_back(coder->ImConstantString(cpos, name));

                return coder->ImFunctionCall(pos, f_mfptr, params);
        }

        if (!symbol || symbol->type != SymbolType::Function)
        {
                lexer.AddError(Error::ExpectedFunctionMacroName);
                return 0;
        }

        // Parse the PTR definition itself
        std::vector<int32_t> passthrough_parameters; //Hold the input parameter number for passthrough parameters. 0 if a constant
        RvaluePtrs bound_parameters;
        bool paramsspecified=false;

        NextToken(); //Eat function name
        if (TokenType() == Lexer::OpenParenthesis)
        {
                paramsspecified=true;
                NextToken(); //skip open parenthesis
                if (TokenType() != Lexer::CloseParenthesis)
                {
                        //This is an argument specification
                        do
                        {
                                int32_t passthrough_id = 0;

                                Lexer::State state;
                                lexer.SaveState(&state);
                                if (TokenType() == Lexer::OpCount) //a reference to a parameter, perhaps
                                {
                                        NextToken();
                                        if (TokenType() == Lexer::ConstantNumber) //definately a parameter reference
                                        {
                                                std::pair<DecimalFloat, char> number = lexer.GetTokenNumber();
                                                if (!number.first.ConvertibleToS32() || number.first.ToS32() == 0) // FIXME : reasonable upper limit?
                                                {
                                                        lexer.AddError(Error::IllegalIntegerConstant);
                                                        passthrough_id=1; //force it to #1 to allow us to continue parsing
                                                }
                                                else
                                                {
                                                        passthrough_id = number.first.ToS32();
                                                }
                                                NextToken();
                                        }
                                        else
                                        {
                                                lexer.RestoreState(&state);
                                        }
                                }
                                passthrough_parameters.push_back(passthrough_id);
                                if (passthrough_id == 0) //didn't get a proper passthrough
                                    bound_parameters.push_back(P_Expression(false)); //FIXME: Type casting checks ?!!
                                else
                                    bound_parameters.push_back(NULL);
                        }
                        while (TryParse(Lexer::Comma));
                }
                ExpectCloseParenthesis();
        }

        return coder->ImFunctionPtr(pos, symbol, paramsspecified, passthrough_parameters, bound_parameters);
*/
}

void Parser::P_Function_Call_Parameters(RvaluePtrs *params, std::vector< int32_t > *passthrough_parameters, bool *any_passthrough)
{
        //RvaluePtrs params;
        //std::vector<int32_t> passthrough_parameters;
        //bool any_passthrough = false;

        //someone just forgot a () here..
        if (TokenType() != Lexer::CloseParenthesis)
        {
                PARSERULE("<function-parameter-list> ::= <expression> [ ',' <function-parameter-list> ]");

                //Parse remainder: Rvalue (,Rvalue)*
                while (true)
                {
                        int32_t passthrough_id = 0;
                        Lexer::State state;
                        lexer.SaveState(&state);

                        bool have_ref = false;
                        if (TokenType() == Lexer::OpCount) //a reference to a parameter, perhaps
                        {
                                NextToken();
                                if (TokenType() == Lexer::ConstantNumber) //definately a parameter reference
                                {
                                        *any_passthrough = true;
                                        std::pair<DecimalFloat, char> number = lexer.GetTokenNumber();
                                        if (!number.first.ConvertableToS32() || number.first.ToS32() == 0) // FIXME : reasonable upper limit?
                                        {
                                                lexer.AddError(Error::IllegalIntegerConstant);
                                                passthrough_id=1; //force it to #1 to allow us to continue parsing
                                        }
                                        else
                                        {
                                                passthrough_id = number.first.ToS32();
                                        }
                                        NextToken();
                                        have_ref = true;
                                }
                                else
                                {
                                        lexer.RestoreState(&state);
                                }
                        }

                        Rvalue* paramexpr = 0;
                        if (!have_ref)
                            paramexpr = P_Expression(false);

                        params->push_back(paramexpr);
                        passthrough_parameters->push_back(passthrough_id);

                        if (TokenType()!=Lexer::Comma)
                            break; //abort parser

                        NextToken(); //eat `,`
                }
        }
        ExpectCloseParenthesis();
}

AST::Rvalue* Parser::P_Closure()
{
        // Save parser state
        Symbol *old_currentfunction = currentfunction;
        unsigned old_loopdepth = loopdepth;
        bool old_parserattoplevel = parserattoplevel;
        bool old_withinfunction = withinfunction;
        Symbol *old_currentcatchobj = currentcatchobj;
        bool old_in_bind_expression = in_bind_expression;
        bool old_within_base_constructor_call = within_base_constructor_call;

        std::string name = ":inlinefunc" + Blex::AnyToString(++closure_counter);

        LineColumn declpos = lexer.GetPosition();

        Symbol *symbol = symboltable.RegisterForwardSymbol(declpos, name, SymbolType::Function, false, false);
        symbol->functiondef->returntype = VariableTypes::Variant;

        Function *func = coder->ImOpenFunction(declpos, symbol);

        SymbolTable::SavedState symboltablestate;
        symboltable.ResetToLibraryScope(&symboltablestate);
        symboltable.EnterScope(declpos);

        SymbolDefs::FunctionDef &mem_def = *symbol->functiondef;
        P_Function_Argument_List(&mem_def);

        if (!TryParse(Lexer::FunctionArrow))
            lexer.AddError(Error::ExpectedToken, "=>");

        // Set parser state
        currentfunction = symbol;
        loopdepth = 0;
        parserattoplevel = false;
        withinfunction = true;
        currentcatchobj = 0;
        in_bind_expression = false;
        within_base_constructor_call = false;

        if (TokenType() == Lexer::OpenBlock)
            P_Statement_Block(&func->blockcloseposition);
        else
        {
                Rvalue *retval = P_Expression(false);
                coder->ImReturn(declpos, retval);
        }

        coder->ImCloseFunction(lexer.GetPosition());

        // Restore parser state
        symboltable.RestoreState(symboltablestate);
        currentfunction = old_currentfunction;
        loopdepth = old_loopdepth;
        parserattoplevel = old_parserattoplevel;
        withinfunction = old_withinfunction;
        currentcatchobj = old_currentcatchobj;
        in_bind_expression = old_in_bind_expression;
        within_base_constructor_call = old_within_base_constructor_call;

        FunctionPtr *ptr = coder->ImFunctionPtr(declpos, symbol, false, std::vector< int32_t >(), AST::RvaluePtrs());
        ptr->outside_ptr = false;
        return ptr;
}

} // End of namespace Compiler
} // End of namespace HareScript






