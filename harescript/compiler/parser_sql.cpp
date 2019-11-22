//---------------------------------------------------------------------------
#include <harescript/compiler/allincludes.h>

//---------------------------------------------------------------------------

#include "parser.h"
#include <blex/lexer.h>
#include <blex/path.h>

#include "parser_tools.h"

/** Parser: record manipulating statements */

using namespace Blex;

namespace HareScript
{
namespace Compiler
{

void Parser::P_Insert_Statement()
{
        LineColumn insert_pos = lexer.GetPosition();
        NextToken(); //eat the 'INSERT'

        switch(TokenType())
        {
        case Lexer::Cell:
                {
                        PARSERULE ("<insert-statement> ::= <insert-statement-record>");

                        Lexer::State pre_cell;
                        lexer.SaveState(&pre_cell);

                        NextToken();
                        bool is_cell_expression = TokenType() == Lexer::OpenSubscript;

                        lexer.RestoreState(&pre_cell);

                        if (is_cell_expression)
                            P_Insert_Statement_Array(insert_pos);
                        else
                            P_Insert_Statement_Record(insert_pos);
                } break;
        case Lexer::Member:
                PARSERULE ("<insert-statement> ::= <insert-statement-member>");
                P_Insert_Statement_Member(insert_pos);
                break;
        case Lexer::Public:
        case Lexer::Private:
                {
                        /* Need to lookahead, ambiguity here between
                           INSERT PRIVATE CELL a := b INTO obj
                           and INSERT PRIVATE THIS INTO arr (equivalent to INSERT (PRIVATE THIS) INTO arr)
                        */

                        Lexer::State pre_visispec;
                        lexer.SaveState(&pre_visispec);
                        NextToken();
                        bool is_this = TokenType() == Lexer::This;
                        lexer.RestoreState(&pre_visispec);

                        if (is_this)
                        {
                                PARSERULE ("<insert-statement> ::= <insert-statement-array>");
                                P_Insert_Statement_Array(insert_pos);
                        }
                        else
                        {
                                PARSERULE ("<insert-statement> ::= <insert-statement-member>");
                                P_Insert_Statement_Member(insert_pos);
                        }
                } break;
        case Lexer::Into:
                PARSERULE ("<insert-statement> ::= <insert-statement-sql>");
                P_Insert_Statement_SQL(insert_pos);
                break;
        default:
                PARSERULE ("<insert-statement> ::= <insert-statement-array>");
                P_Insert_Statement_Array(insert_pos);
                break;
        }
}

void Parser::P_Insert_Statement_Record(LineColumn insert_pos)
{
        PARSERULE("<insert-statement> ::= INSERT CELL <set-expression> INTO <lvalue> ';'");

        ExpectSQLToken(Lexer::Cell, "CELL");

        typedef std::vector< std::pair< std::string, Rvalue * > > Assignments;
        Assignments assignments;

        std::set< std::string > names;

        do
        {
                bool iserror;
                LineColumn pos = lexer.GetPosition();
                std::pair < std::string, Rvalue* > assignment = P_Set_Expression(false, &iserror);
                if (iserror)
                {
                        EatTillClosure(true);
                        ExpectSemicolon();
                        return;
                }

                Blex::ToUppercase(assignment.first.begin(), assignment.first.end());
                if (!names.insert(assignment.first).second)
                    lexer.AddErrorAt(pos, Error::ColumnNameAlreadyExists, assignment.first);

                assignments.push_back(assignment);
        }
        while (TryParse(Lexer::Comma));

        if (TokenType()==Lexer::Into)
        {
                NextToken();
        }
        else
        {
                lexer.AddError(Error::ExpectedIntoAfterInsert);
                EatTillClosure(true);
                ExpectSemicolon();
                return;
        }

        LineColumn pos = lexer.GetPosition();

        // First calculate the values to insert
        for (Assignments::iterator it = assignments.begin(); it != assignments.end(); ++it)
        {
                // First calculate the value to insert
                Symbol *insert_val = context.symboltable->RegisterDeclaredVariable(pos, 0, false, false, VariableTypes::Uninitialized); // Copy the type from the first assignment
                coder->ImExecute(pos,
                        coder->ImAssignment(pos,
                                coder->ImVariable(pos, insert_val),
                                it->second));

                it->second = coder->ImVariable(pos, insert_val);
        }

        Block* workblock = Adopt(new Block(pos));
        ExpressionBlock* record = P_Lvalue(workblock, true);

        coder->ImExecute(insert_pos, record);
        coder->ImOpenBlock(workblock);

        for (Assignments::iterator it = assignments.begin(); it != assignments.end(); ++it)
        {
                coder->ImExecute(insert_pos,
                    coder->ImRecordCellSet(insert_pos,
                        coder->ImVariable(record->returnvar->position, record->returnvar->symbol),
                        it->first,
                        it->second,
                        /*cancreate=*/true,
                        /*check_type=*/true));
        }

        coder->ImCloseBlock(); // workblock

        ExpectSemicolon();
}

void Parser::P_Insert_Statement_Member(LineColumn insert_pos)
{
        PARSERULE("<insert-statement> ::= INSERT ([ PUBLIC|PRIVATE ] MEMBER) <set-expression> INTO <rvalue> ';'");

        std::pair</*exists*/bool, /*public*/bool> visibility = P_Visibility_Specifier(true);

        ExpectSQLToken(Lexer::Member, "MEMBER");

        typedef std::vector< std::pair< std::string, Rvalue * > > Assignments;
        Assignments assignments;

        std::set< std::string > names;

        do
        {
                bool iserror;
                LineColumn pos = lexer.GetPosition();
                std::pair < std::string, Rvalue* > assignment = P_Set_Expression(false, &iserror);
                if (iserror)
                {
                        EatTillClosure(true);
                        ExpectSemicolon();
                        return;
                }

                Blex::ToUppercase(assignment.first.begin(), assignment.first.end());
                if (!names.insert(assignment.first).second)
                    lexer.AddErrorAt(pos, Error::MemberAlreadyExists, assignment.first);

                assignments.push_back(assignment);
        }
        while (TryParse(Lexer::Comma));

        if (TokenType()==Lexer::Into)
        {
                NextToken();
        }
        else
        {
                lexer.AddError(Error::ExpectedIntoAfterInsert);
                EatTillClosure(true);
                ExpectSemicolon();
                return;
        }

        LineColumn pos = lexer.GetPosition();

        Rvalue *object = P_Expression(false);

        Variable *source = dynamic_cast< Variable * >(object);
        bool via_this = source && source->symbol->name == ":THIS";

        for (Assignments::iterator it = assignments.begin(); it != assignments.end(); ++it)
        {
                // First calculate the value to insert
                Symbol *insert_val = context.symboltable->RegisterDeclaredVariable(pos, 0, false, false, VariableTypes::Uninitialized); // Copy the type from the first assignment
                coder->ImExecute(pos,
                        coder->ImAssignment(pos,
                                coder->ImVariable(pos, insert_val),
                                it->second));
                it->second = coder->ImVariable(pos, insert_val);
        }

        Variable *objtemp = coder->ImStoreInVariable(object->position, object);

        for (Assignments::iterator it = assignments.begin(); it != assignments.end(); ++it)
        {
                coder->ImObjectMemberInsert(insert_pos,
                    coder->ImVariable(object->position, objtemp->symbol),
                    it->first,
                    it->second,
                    !visibility.first || !visibility.second,
                    via_this);
        }

        ExpectSemicolon();
}

void Parser::P_Insert_Statement_Array(LineColumn insert_pos)
{
        PARSERULE ("<insert-statement-array> ::= INSERT <expression> INTO <lvalue> <insert-position> ';'");

        // Parse expression
        Rvalue* elementexpr = P_Expression(false);

        if (TokenType()==Lexer::Into)
            NextToken();
        else
        {
                lexer.AddError(Error::ExpectedIntoAfterInsert);
                EatTillClosure(true);
                ExpectSemicolon();
                return;
        }

        // Parse the lvalue to insert into
        AST::Rvalue *lvalue = P_Expression(false);

        // Detect if it's a table variable or schema.table expression
        AST::Rvalue *sqltable = 0;
        if (auto *var = dynamic_cast< Variable * >(lvalue))
        {
                if (var->symbol->variabledef->type == VariableTypes::Table)
                    sqltable = var;
        }
        if (!sqltable)
            sqltable = dynamic_cast< SchemaTable * >(lvalue);

        // Parse the location
        ArrayLocation loc(ArrayLocation::Missing);
        if (TokenType() == Lexer::At)
        {
                NextToken();
                loc = ArrayLocation(ArrayLocation::Index, P_Expression(false));
        }
        else if (!sqltable)
            lexer.AddError(Error::ExpectedAtOrEnd);

        // Cache the insert expression if present
        //if (loc.expr)
          //  loc.expr = coder->ImStoreInVariable(loc.expr->position, loc.expr);

        if (sqltable)
        {
                SQLSource *sqlsource = coder->ImSQLSource(sqltable->position, sqltable, sqltable, 0);
                SQLDataModifier *expr = coder->ImGetSQLDataModifier(elementexpr->position);
                expr->source = sqlsource;
                expr->columns.push_back("");
                expr->values.push_back(elementexpr);
                coder->ImSQLInsert(sqltable->position, sqlsource, expr, loc);
        }
        else
        {
                // Make a copy of the element to insert and the insert position
                Symbol *insert_val = context.symboltable->RegisterDeclaredVariable(elementexpr->position, 0, false, false, VariableTypes::Uninitialized); // Copy the type from the first assignment
                coder->ImExecute(elementexpr->position,
                        coder->ImAssignment(elementexpr->position,
                                coder->ImVariable(elementexpr->position, insert_val),
                                elementexpr));

                // Don't care for failure, error will be reported and safe stuff will be given back in base and basevar
                ConvertedLvalue clvalue;
                ConvertRvalueIntoLvalueLayers(lvalue, &clvalue, true);

                coder->ImDeepArrayInsert(
                    insert_pos,
                    clvalue,
                    loc,
                    coder->ImVariable(elementexpr->position, insert_val));
        }

        ExpectSemicolon();
}

void Parser::P_Insert_Statement_SQL(LineColumn pos)
{
        PARSERULE ("<insert-statement-sql> ::= INSERT INTO <expression> '(' [ <column-name-list> ] ')' VALUES '(' <expression-list> ')' [ <insert-position> ] ';'");

        SQLDataModifier* expr = coder->ImGetSQLDataModifier(lexer.GetPosition());

        ExpectSQLToken(Lexer::Into,"INTO");

        SQLWorkBlock workblock;
        SQLSource *sqlsource = P_SQLSource(&workblock, true);

        if (!sqlsource)
        {
                EatTillClosure(true);
                ExpectSemicolon();
                return;
        }

        symboltable.EnterScope(lexer.GetPosition());

        // Set a symbol in the source to check types
        if (workblock.expr_block)
            sqlsource->symbol = workblock.expr_block->returnvar->symbol;
        expr->source = sqlsource;

        std::vector< std::string > columns;
        std::vector< Rvalue* > expression;

        if (!ExpectOpenParenthesis())
        {
                symboltable.LeaveScope(lexer.GetPosition());
                EatTillClosure(true);
                ExpectSemicolon();
                return;
        }

        if (TokenType() != Lexer::CloseParenthesis)
            expr->columns = P_Column_Name_List();

        if (!ExpectCloseParenthesis())
        {
                symboltable.LeaveScope(lexer.GetPosition());
                EatTillClosure(true);
                ExpectSemicolon();
                return;
        }

        ExpectSQLToken(Lexer::Values,"VALUES");

        if (!ExpectOpenParenthesis())
        {
                symboltable.LeaveScope(lexer.GetPosition());
                EatTillClosure(true);
                ExpectSemicolon();
                return;
        }

        if (TokenType() != Lexer::CloseParenthesis)
            expr->values = P_Expression_List();

        if (!ExpectCloseParenthesis())
        {
                symboltable.LeaveScope(lexer.GetPosition());
                EatTillClosure(true);
                ExpectSemicolon();
                return;
        }

        if (TokenType() != Lexer::Semicolon)
            pos = lexer.GetPosition();

        ArrayLocation loc(ArrayLocation::Missing);
        if (TokenType() == Lexer::At)
        {
                NextToken();
                loc=ArrayLocation(ArrayLocation::Index, P_Expression(false));
        }

        coder->ImOpenBlock(workblock.sql_block);
        coder->ImSQLInsert(pos, sqlsource, expr, loc);
        coder->ImCloseBlock();

        ExecuteSQLBlock(pos, workblock);

        ExpectSemicolon();
        symboltable.LeaveScope(lexer.GetPosition());
}

void Parser::P_Delete_Statement()
{
        LineColumn delete_pos = lexer.GetPosition();
        NextToken(); //eat the 'DELETE'

        switch (TokenType())
        {
        case Lexer::Cell:
                {
                        PARSERULE ("<delete-statement> ::= <delete-statement-record>");
                        P_Delete_Statement_Record(delete_pos);
                        return;
                }
        case Lexer::Member:
                {
                        PARSERULE ("<delete-statement> ::= <delete-statement-member>");
                        P_Delete_Statement_Member(delete_pos);
                        return;
                }
        case Lexer::From:
                {
                        // Ambiguity between sql and array delete ...
                        NextToken();

                        SQLWorkBlock workblock;
                        SQLSource *sqlsource = P_SQLSource(&workblock, false);

                        if (TokenType() == Lexer::All || TokenType() == Lexer::At)
                        {
                                PARSERULE ("<delete-statement> ::= <delete-statement-array>");
                                P_Delete_Statement_Array(delete_pos, sqlsource, workblock);
                        }
                        else
                        {
                                PARSERULE ("<delete-statement> ::= <delete-statement-sql>");
                                P_Delete_Statement_SQL(delete_pos, sqlsource, workblock);
                        }
                        return;
                }
        default:
            // code to put in this place when P_Insert_Statement_Record_Old is removed
            lexer.AddError(Error::ExpectedCellOrFrom);
            EatTillClosure(true);
            ExpectSemicolon();
        }
        return;
}

void Parser::P_Delete_Statement_Record(LineColumn delete_pos)
{
        PARSERULE("<delete-statement-record> ::= DELETE CELL <cell-name> FROM <lvalue> ';'");

        NextToken(); // Eat CELL

        std::vector< std::string > names;
        do
        {
                std::string columnname = P_Column_Name();

                names.push_back(columnname);
        }
        while (TryParse(Lexer::Comma));

        ExpectSQLToken(Lexer::From,"FROM");

        Block* workblock = Adopt(new Block(delete_pos));
        ExpressionBlock* lvalue = P_Lvalue(workblock, true);

        coder->ImExecute(delete_pos, lvalue);
        coder->ImOpenBlock(workblock);
        for (std::vector< std::string >::iterator it = names.begin(); it != names.end(); ++it)
        {
                coder->ImExecute(delete_pos,
                    coder->ImRecordCellDelete(delete_pos,
                        coder->ImVariable(lvalue->returnvar->position, lvalue->returnvar->symbol),
                        *it));
        }
        coder->ImCloseBlock(); // workblock

        ExpectSemicolon();
}

void Parser::P_Delete_Statement_Member(LineColumn delete_pos)
{
        PARSERULE("<delete-statement-record> ::= DELETE MEMBER <cell-name> FROM <lvalue> ';'");

        NextToken(); // Eat MEMBER

        std::vector< std::string > names;
        do
        {
                std::string columnname = P_Column_Name();

                names.push_back(columnname);
        }
        while (TryParse(Lexer::Comma));

        ExpectSQLToken(Lexer::From,"FROM");

        Rvalue *object = P_Expression(false);

        Variable *source = dynamic_cast< Variable * >(object);
        bool via_this = source && source->symbol->name == ":THIS";

        Variable *objtemp = coder->ImStoreInVariable(delete_pos, object);

        for (std::vector< std::string >::iterator it = names.begin(); it != names.end(); ++it)
        {
                coder->ImObjectMemberDelete(delete_pos,
                    coder->ImVariable(object->position, objtemp->symbol),
                    *it,
                    via_this);
        }

        ExpectSemicolon();
}

void Parser::P_Delete_Statement_Array(LineColumn delete_pos, SQLSource* sqlsource, SQLWorkBlock &workblock)
{
        PARSERULE("<delete-statement-array> ::= DELETE FROM <lvalue> <delete-location> ';'");

        LineColumn pos = lexer.GetPosition();
        ArrayLocation loc = Try_P_Delete_Location();
        if (loc.type == ArrayLocation::Missing)
        {
                lexer.AddErrorAt(pos, Error::ExpectedAtOrAll);
                loc.type = ArrayLocation::All;
        }

        if (!workblock.expr_block)
        {
                lexer.AddErrorAt(sqlsource->expression->position, Error::TypeNotArray);
                EatTillClosure(true);
                ExpectSemicolon();
                return;
        }

        if (loc.type == ArrayLocation::Index)
        {
                ConvertedLvalue clvalue;
                ConvertRvalueIntoLvalueLayers(sqlsource->org_expression, &clvalue, true);

                coder->ImDeepArrayDelete(
                    delete_pos,
                    clvalue,
                    loc);
        }
        else
        {
                coder->ImOpenBlock(workblock.sql_block);
                coder->ImArrayDelete(delete_pos,
                    coder->ImVariable(workblock.expr_block->returnvar->position, workblock.expr_block->returnvar->symbol),
                    loc);
                coder->ImCloseBlock(); // workblock

                ExecuteSQLBlock(delete_pos, workblock);
        }

        ExpectSemicolon();
}

void Parser::P_Delete_Statement_SQL(LineColumn delete_pos, SQLSource *sqlsource, SQLWorkBlock &workblock)
{
        PARSERULE("<delete-statement-sql> ::= DELETE FROM <lvalue> [ WHERE <expression> ] ';'");

        symboltable.EnterScope(lexer.GetPosition());

        if (TryParse(Lexer::As))
            sqlsource->subst_name = P_Column_Name();

        CreateSubstituteRecord(sqlsource, sqlsource->subst_name, true);

        ArrayLocation location = Try_P_Where();
//        if (location.type == ArrayLocation::Missing)
//            lexer.AddWarning(Warning::NoWhereInUpdateOrDelete);

        symboltable.LeaveScope(lexer.GetPosition());

        coder->ImOpenBlock(workblock.sql_block);
        coder->ImSQLDelete(delete_pos, sqlsource, location);
        coder->ImCloseBlock(); // workblock

        ExecuteSQLBlock(delete_pos, workblock);

        ExpectSemicolon();
}

void Parser::P_Update_Statement()
{
        PARSERULE("<update-statement> ::= UPDATE <lvalue> SET <set-expression-list> [ WHERE <expression> ]");

        LineColumn updatepos = lexer.GetPosition();
        NextToken(); // eat the UPDATE

        SQLWorkBlock workblock;
        SQLSource *sqlsource = P_SQLSource(&workblock, false);

        if (TryParse(Lexer::As))
            sqlsource->subst_name = P_Column_Name();

        //To deal with the fields, we need to locally generate the table variables
        symboltable.EnterScope(lexer.GetPosition());

        // Build an empty data modifier
        SQLDataModifier* expr = coder->ImGetSQLDataModifier(lexer.GetPosition());
        expr->source = sqlsource;
        ExpectSQLToken(Lexer::Set,"SET");

        /* For UPDATE SET RECORD x, the record to update may not be dependent on the substitution records, because
           we need to know the updated columns beforehand (ODBC requires pre-binding of columns)
        */
        bool allow_subst_record_use = TokenType() != Lexer::Record;
        Symbol *subst_record = CreateSubstituteRecord(sqlsource, sqlsource->subst_name, allow_subst_record_use);

        if (!P_Set_Expression_List(expr))
        {
                symboltable.LeaveScope(lexer.GetPosition());
                EatTillClosure(true);
                ExpectSemicolon();
                return;
        }

        // The rest of the update may use the substitution variable
        subst_record->variabledef->allow_substitute_use = true;

        ArrayLocation location = Try_P_Where();
//        if (location.type == ArrayLocation::Missing)
//            lexer.AddWarning(Warning::NoWhereInUpdateOrDelete);

        symboltable.LeaveScope(lexer.GetPosition());

        coder->ImOpenBlock(workblock.sql_block);
        coder->ImSQLUpdate(updatepos, sqlsource, expr, location);
        coder->ImCloseBlock();

        ExecuteSQLBlock(updatepos, workblock);

        ExpectSemicolon();
}

bool Parser::SkipToFrom(std::map< std::string, Symbol * > *temporaries)
{
        unsigned level = 0;
        bool with_blocks = false;
        while (TokenType() != Lexer::Eof)
        {
                if (TokenType() >= Lexer::FakeStartClosures && TokenType() <= Lexer::FakeEndFinalClosures && (!with_blocks || TokenType() != Lexer::CloseBlock))
                {
                        ExpectSQLToken(Lexer::From, "FROM");
                        EatTillClosure(true);
                        return false;
                }

                if (TokenType() == Lexer::From)
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
                        {
                                ExpectSQLToken(Lexer::From, "FROM");
                                EatTillClosure(true);
                                return false;
                        }
                        --level;
                        if (!level)
                            with_blocks = false;
                }
                else if (TokenType() == Lexer::Select)
                    ++level;

                if (level == 0 && TryParse(Lexer::Temporary))
                {
                        // Eat optional type, not using it here
                        Try_P_Type_Specifier(0);

                        // Register temporary as forward symbol
                        if (TokenType() == Lexer::Identifier)
                        {
                                Symbol *symbol = symboltable.RegisterForwardSymbol(lexer.GetPosition(), lexer.GetTokenIdentifier(), SymbolType::Variable, false, false);
                                if (!symbol)
                                    lexer.AddError(Error::VarAlreadyDefinedInScope, lexer.GetTokenIdentifier());
                                else
                                {
                                        symbol->state = SymbolState::SelectTemporary;
                                        (*temporaries)[lexer.GetTokenIdentifier()] = symbol;
                                }
                        }
                }

                NextToken();
        }
        return false;
}

void Parser::P_Select_Source_List(SQLSources *sources)
{
        do
        {
                if (TryParse(Lexer::Table))
                    lexer.AddWarning(Warning::IgnoringToken, "TABLE");

                SQLSource* sqlsource = P_SQLSource(0, false);

                if (TryParse(Lexer::As))
                    sqlsource->subst_name = P_Column_Name();

                sources->sources.push_back(sqlsource);
        } while (TryParse(Lexer::Comma));

        for (std::vector<SQLSource *>::iterator it = sources->sources.begin(); it != sources->sources.end(); ++it)
          CreateSubstituteRecord(*it, (*it)->subst_name, true);
}

SQLSource * Parser::P_SQLSource(SQLWorkBlock *workblock, bool is_insert_into)
{
        LineColumn pos = lexer.GetPosition();

        // First parse as normal expression, to catch schema.table case
        if (!workblock)
        {
                Rvalue *expr = P_Expression(false);

                return coder->ImSQLSource(pos, expr, expr, 0);
        }
        else
        {
                workblock->sql_block = Adopt(new Block(pos));

                Lexer::State pre_source;
                lexer.SaveState(&pre_source);

                Variable *first_var = Try_P_Variable(false);
                if (TokenType() == Lexer::OpDot && first_var && first_var->symbol->variabledef->type == VariableTypes::Schema)
                {
                        NextToken();

                        std::string name = P_Table_Name(true);

                        Rvalue *schematable = coder->ImSchemaTableOf(pos, first_var, name);

                        SQLSource *sqlsource = coder->ImSQLSource(
                                pos,
                                schematable,
                                schematable,
                                0);

                        return sqlsource;
                }

                lexer.RestoreState(&pre_source);

                Rvalue *org_expr = 0;
                if (is_insert_into)
                {
                        workblock->expr_block = Try_P_Lvalue_old(workblock->sql_block, true, true);
                }
                else
                {
                        workblock->expr_block = Try_P_Lvalue(workblock->sql_block, true, true, &org_expr);
                }

                Rvalue *expr = coder->ImVariable(workblock->expr_block->returnvar->position, workblock->expr_block->returnvar->symbol);
                Variable *reassign = coder->ImVariable(workblock->expr_block->returnvar->position, workblock->expr_block->returnvar->symbol);
                if (!org_expr)
                    org_expr = expr;

                SQLSource *sqlsource = coder->ImSQLSource(
                        pos,
                        expr,
                        org_expr,
                        reassign);

                return sqlsource;
        }
}

bool Parser::P_Select_Temporaries(SQLSelect *select, std::map< std::string, Symbol * > const &temporaries)
{
        Lexer::State precommastate;
        lexer.SaveState(&precommastate);

        bool have_temporary = false;

        while (TryParse(Lexer::Temporary))
        {
                // Get type of variable (optional)
                VariableTypes::Type type = Try_P_Type_Specifier(0);
                if (type == VariableTypes::Uninitialized)
                    type = VariableTypes::Variant;

                LineColumn namepos = lexer.GetPosition();

                SQLSelect::Temporary temporary;

                std::string name = ExpectName();
                if (name.empty())
                    lexer.AddError(Error::MayNotBeUsedAsName,lexer.GetTokenSTLString());
                else
                {
                        NextToken();
                        temporary.assignpos = lexer.GetPosition();

                        std::map< std::string, Symbol * >::const_iterator it = temporaries.find(name);
                        if (it != temporaries.end())
                            it->second->state = SymbolState::Declaring;

                        if (TokenType() == Lexer::OpAssignment)
                            NextToken();
                        else
                            lexer.AddError(Error::ExpectedAssignmentOperator);
                }

                temporary.expr = P_Expression(false);

                std::map< std::string, Symbol * >::const_iterator it = temporaries.find(name);
                if (it != temporaries.end())
                {
                        temporary.symbol = it->second;
                        if (temporary.symbol)
                        {
                                symboltable.RegisterDeclaredVariable(namepos, temporary.symbol, false, false, type);
                                select->temporaries.push_back(temporary);
                        }
                }

                have_temporary = true;

                lexer.SaveState(&precommastate);
                if (!TryParse(Lexer::Comma))
                    return true;
        }

        lexer.RestoreState(&precommastate);
        return have_temporary;
}


Rvalue* Parser::P_Select_Expression()
{
        PARSERULE("P_SelectQuery: SELECT [ ( `*` | <renamed-expression-list> ) ] FROM <renamed-expression-list> [ WHERE <expression> ] [ ORDER [ BY ] <ordering-list> ]");

        // Noooooooooooo....

        // Idea:
        // Skip select
        // parse 'from'; create substitution records
        // parse 'where'; create filter
        // parse 'group by';
        // parse 'having';
        // parse select (declaring variables for temporaries)
        // skip 'ordering';

        LineColumn selectpos = lexer.GetPosition();
        NextToken(); // Eat the SELECT

        symboltable.EnterScope(selectpos);

        Lexer::State selectstate;
        lexer.SaveState(&selectstate);

        std::map< std::string, Symbol * > temporaries;

        if (!SkipToFrom(&temporaries))
        {
               symboltable.LeaveScope(lexer.GetPosition());
               return coder->ImConstant(selectpos, 0);
        }

        NextToken();

        SQLSelect* select = coder->ImGetSQLSelect(selectpos);

        select->sources = coder->ImSQLSources(lexer.GetPosition());
        P_Select_Source_List(select->sources);

        select->location = Try_P_Where();
        if (select->location.type == ArrayLocation::Missing)
        {
                select->location.type = ArrayLocation::All;
        }

        if (TokenType() == Lexer::Group)
        {
                P_SQL_GroupBy(select);

                if (TryParse(Lexer::Having))
                    select->having_expr = P_Expression(false);
        }

        Lexer::State donestate;
        lexer.SaveState(&donestate);
        lexer.RestoreState(&selectstate);

        bool require_expression = false;
        if (TokenType() == Lexer::As)
        {
                // Parse AS <type> expression. Put data into the column 'data'
                NextToken(); // Eat the AS

                VariableTypes::Type type = P_Type_Specifier(0);
                select->result_type = type;

                if (type == VariableTypes::Variant)
                     lexer.AddError(Error::VariantNotAllowed);

                select->has_distinct = TryParse(Lexer::Distinct);

                if (P_Select_Temporaries(select, temporaries))
                    ExpectComma();

                SQLSelect::SelectItem item;
                item.expr = P_Expression(false);
                item.is_delete = false;
                item.is_star = false;
                item.is_spread = false;
                item.name = "data";
                item.from_star = false;

                select->namedselects.push_back(item);
        }
        else
        {
                select->has_distinct = TryParse(Lexer::Distinct);

                bool got_temporary = P_Select_Temporaries(select, temporaries);
                if (got_temporary && TokenType() != Lexer::From)
                {
                        require_expression = true;
                        ExpectComma();
                }

                if (require_expression || TokenType() != Lexer::From)
                    P_Renamed_Expression_List(select);
        }

        ExpectSQLToken(Lexer::From, "FROM");

        lexer.RestoreState(&donestate);

        if (TryParse(Lexer::Order))
        {
                TryParse(Lexer::By);

                P_Select_Ordering_List(select);
        }

        //Destroy the temporarily generated tables; do this before processing limit
        symboltable.LeaveScope(lexer.GetPosition());

        if (TryParse(Lexer::Limit) && !TryParse(Lexer::All))
            select->limit_expr = P_Expression(false);

        return select;
}

void Parser::P_SQL_GroupBy(SQLSelect *select)
{
        PARSERULE("P_SQL_GroupBy: GROUP BY [ <variable> '.' ] <column-name> ( ',' [ <variable> '.' ] <column-name> )*");

        NextToken(); // Eat the GROUP
        TryParse(Lexer::By); // Optional BY
        select->is_grouped = true;

        while (true)
        {
                Rvalue *expr = P_Expression(false);
                RecordColumnConst *rcc = dynamic_cast< RecordColumnConst * >(expr);
                Variable *var = rcc ? dynamic_cast< Variable * >(rcc->record) : 0;
                if (var)
                {
                        if (!select->sources->IsASource(var->symbol))
                            lexer.AddError(Error::OnlyColumnsAllowedInGroupBy);
                        else
                            var->symbol->variabledef->group_cols.insert(rcc->name);
                }
                select->groupings.push_back(expr);

                if (!TryParse(Lexer::Comma))
                    break;
        }
}



} // End of namespace Compiler
} // End of namespace HareScript
