//---------------------------------------------------------------------------
#include <harescript/compiler/allincludes.h>

//---------------------------------------------------------------------------

#include "parser.h"
#include <blex/lexer.h>
#include <blex/path.h>

#include "parser_tools.h"

/** Parser: other stuff */

using namespace Blex;

namespace HareScript
{
namespace Compiler
{

std::pair</*exists*/bool, /*public*/bool> Parser::P_Visibility_Specifier(bool attoplevel)
{
        PARSERULE("<visibility-specifier> ::= [ ( PUBLIC | PRIVATE ) ] ");
        // Accepts: ( PUBLIC | PRIVATE )*

        bool is_public = false;

        bool got_one = false;
        bool is_error = false;

        while (TokenType() == Lexer::Public || TokenType() == Lexer::Private)
        {
                if (!got_one)
                {
                        if (!attoplevel && !is_error)
                        {
                                lexer.AddError(Error::IllegalUseOfPublicPrivate);
                                is_error = true;
                        }

                        is_public = TokenType() == Lexer::Public && attoplevel;
                        got_one = true;
                }
                else
                {
                        if (!is_error)
                            lexer.AddError(Error::PublicPrivateNoMix);
                        is_error = true;
                }
                NextToken();
        }
        return std::make_pair(got_one, is_public);
}

void Parser::P_Attribute_List(Symbol *sym)
{
        PARSERULE("<function-attribute-list> ::= __ATTRIBUTES__ '(' ( <function-attributes> ) ')'");

        ExpectOpenParenthesis();
        do
        {
                PARSERULE("<function-attributes> ::= <function-attributes> [ ',' <function-attributes> ]");
                PARSERULE("<function-attribute> ::= ( EXTERNAL [ <string-constant> ] | REENTRANT | DEPRECATED [ <string-constant> ] SKIPTRACE )'");

                std::string curattr = lexer.GetTokenSTLString();
                if (Blex::StrCaseCompare(curattr,"EXTERNAL") == 0 && sym->functiondef)
                {
                        SymbolDefs::FunctionDef &def = *sym->functiondef;
                        def.flags |= FunctionFlags::External;
                        def.flags |= FunctionFlags::SkipTrace; //FIXME: Rob, kan dit weg? annoying bij ext. functies die weer functiepointers aanroepen (vaag gat in de trace)
                        NextToken();

                        if (TokenType() == Lexer::ConstantString)
                        {
                                def.dllmodule = Blex::Lexer::ParseTokenString(lexer.GetTokenSTLString()) ;
                                if (def.dllmodule == "" ||
                                        !Blex::IsLowercase(def.dllmodule.begin(),def.dllmodule.end()) ||
                                        std::find(def.dllmodule.begin(),def.dllmodule.end(),'\\') != def.dllmodule.end())
                                    lexer.AddError(Error::IllegalModuleName);

                                NextToken();
                        }
                        else
                            def.dllmodule = "";
                }
                else if (Blex::StrCaseCompare(curattr,"CONSTANT") == 0)
                {
                        SymbolDefs::FunctionDef &def = *sym->functiondef;

                        def.flags |= FunctionFlags::Constant;
                        NextToken();
                        // FIXME: analyse interaction between 'constant', 'NoStateModify' and 'ExecutesHarescript'!!!
                }
                else if (Blex::StrCaseCompare(curattr,"NOSTATEMODIFY") == 0)
                {
                        SymbolDefs::FunctionDef &def = *sym->functiondef;

                        def.flags |= FunctionFlags::NoStateModify;
                        NextToken();
                }
                else if (Blex::StrCaseCompare(curattr,"EXECUTESHARESCRIPT") == 0 && sym->functiondef)
                {
                        SymbolDefs::FunctionDef &def = *sym->functiondef;

                        def.flags |= FunctionFlags::ExecutesHarescript;
                        NextToken();
                }
                else if (Blex::StrCaseCompare(curattr,"DEINITMACRO") == 0 && sym->functiondef)
                {
                        SymbolDefs::FunctionDef &def = *sym->functiondef;

                        def.flags |= FunctionFlags::DeinitMacro;
                        NextToken();
                }
                else if (Blex::StrCaseCompare(curattr,"DEPRECATED") == 0)
                {
                        sym->flags |= SymbolFlags::Deprecated;
                        NextToken();

                        if (TokenType() == Lexer::ConstantString)
                        {
                                sym->deprecation_message = Blex::Lexer::ParseTokenString(lexer.GetTokenSTLString()) ;
                                NextToken();
                        }
                }
                else if (Blex::StrCaseCompare(curattr,"SKIPTRACE") == 0 && sym->functiondef)
                {
                        SymbolDefs::FunctionDef &def = *sym->functiondef;

                        def.flags |= FunctionFlags::SkipTrace;
                        NextToken();
                }
                else if (Blex::StrCaseCompare(curattr,"TERMINATES") == 0 && sym->functiondef)
                {
                        SymbolDefs::FunctionDef &def = *sym->functiondef;

                        if (def.returntype != VariableTypes::NoReturn)
                            lexer.AddError(Error::AttributeTerminatesOnlyForMacro);
                        def.flags |= FunctionFlags::Terminates;
                        NextToken();
                }
                else if (Blex::StrCaseCompare(curattr,"ISCOUNT") == 0 && sym->functiondef)
                {
                        SymbolDefs::FunctionDef &def = *sym->functiondef;

                        if (!(def.flags & FunctionFlags::Aggregate))
                            lexer.AddError(Error::InvalidFunctionDeclaration);
                        def.flags |= FunctionFlags::IsCount;
                        NextToken();
                }
                else if (Blex::StrCaseCompare(curattr,"SPECIAL") == 0 && sym->functiondef)
                {
                        SymbolDefs::FunctionDef &def = *sym->functiondef;
                        def.flags |= FunctionFlags::IsSpecial;
                        NextToken();
                }
                else if (Blex::StrCaseCompare(curattr,"VARARG") == 0 && sym->functiondef)
                {
                        SymbolDefs::FunctionDef &def = *sym->functiondef;
                        def.flags |= FunctionFlags::VarArg;
                        NextToken();

                        /* Arguments to function ptr can be reused for different parameters (eg PTR func(#1, #1, #1)).
                           But we can only legally cast them to their required type within variant arrays; can't insert
                           an integer into a money array and then cast to money. To avoid having to create code to work
                           with intermediates, we just disallow non-variant array vararg arrays.
                        */
                        if (def.arguments.empty() || def.arguments.back().symbol->variabledef->type != VariableTypes::VariantArray)
                          lexer.AddError(Error::VarArgIncorrectSignature);
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

bool Parser::P_Loadlib_Attribute_List()
{
        PARSERULE("<loadlib-attribute-list> ::= __ATTRIBUTES__ '(' ( <loadlib-attributs> ) ')'");

        bool used = false;
        ExpectOpenParenthesis();
        do
        {
                PARSERULE("<loadlib-attributs> ::= <loadlib-attribute> [ ',' <loadlib-attributs> ]");
                PARSERULE("<loadlib-attribute> ::= ( USED )'");

                std::string curattr = lexer.GetTokenSTLString();

                if (Blex::StrCaseCompare(curattr,"USED") == 0)
                {
                        used = true;
                        NextToken();
                }
                else
                {
                        lexer.AddError(Error::InvalidAttributes);
                        break;
                }
        }
        while (TryParse(Lexer::Comma));
        ExpectCloseParenthesis();
        return used;
}


void Parser::P_ExportSymbol_Attribute_List(Symbol *sym)
{
        PARSERULE("<exportsymbol-attribute-list> ::= __ATTRIBUTES__ '(' ( <exportsymbol-attributs> ) ')'");

        ExpectOpenParenthesis();
        do
        {
                PARSERULE("<exportsymbol-attributs> ::= <exportsymbol-attribute> [ ',' <exportsymbol-attributs> ]");
                PARSERULE("<exportsymbol-attribute> ::= ( DEPRECATED [ <string-constant> ] )'");

                std::string curattr = lexer.GetTokenSTLString();

                if (Blex::StrCaseCompare(curattr,"DEPRECATED") == 0)
                {
                        sym->flags |= SymbolFlags::Deprecated;
                        NextToken();

                        if (TokenType() == Lexer::ConstantString)
                        {
                                sym->deprecation_message = Blex::Lexer::ParseTokenString(lexer.GetTokenSTLString()) ;
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

void Parser::P_Table_Like(SymbolDefs::TableDef &tabledef)
{
        if (!TryParse(Lexer::Like))
        {
                lexer.AddError(Error::ExpectLike);
                EatTillClosure(true);
                return;
        }

        Variable *like_var = Try_P_Variable(false);
        if (!like_var || !like_var->symbol->variabledef || (like_var->symbol->variabledef->type != VariableTypes::Table && like_var->symbol->variabledef->type != VariableTypes::Schema))
        {
                lexer.AddError(Error::ExpectedTableName);
                EatTillClosure(true);
                return;
        }

        if (like_var->symbol->variabledef->type == VariableTypes::Table)
            tabledef = like_var->symbol->variabledef->tabledef;
        else
        {
                if (!TryParse(Lexer::OpDot))
                {
                        lexer.AddError(Error::ExpectedTableName);
                        EatTillClosure(true);
                        return;
                }

                LineColumn tname_pos = lexer.GetPosition();
                std::string name = P_Table_Name(true);
                if (name.empty())
                {
                        EatTillClosure(true);
                        return;
                }

                Blex::ToUppercase(name.begin(), name.end());

                bool found = false;
                SymbolDefs::SchemaDef const &schemadef = like_var->symbol->variabledef->schemadef;
                for (SymbolDefs::SchemaDef::TablesDef::const_iterator it = schemadef.tablesdef.begin(); it != schemadef.tablesdef.end(); ++it)
                {
                        if (it->name == name)
                        {
                                found = true;
                                tabledef = it->tabledef;
                        }
                }
                if (!found)
                    lexer.AddErrorAt(tname_pos, Error::TableDoesNotExistInSchema, name);
        }
}


void Parser::P_Schema_Field_Specification(SymbolDefs::SchemaDef::TablesDef &tables)
{
        PARSERULE("<schema-field-specification> ::= '<' <schema-field-list> '>'");

        if (!TryParse(Lexer::OpLessThan))
        {
                lexer.AddErrorAt(lexer.GetPosition(), Error::ExpectedSchemaDef);
                EatTillClosure(true);
                return;
        }

        std::set< std::string > found_names;

        while (true)
        {
                PARSERULE("<schema-field-list> ::= <schema-field> [ ',' <schema-field-list> ]");
                PARSERULE("<schema-field> ::= 'TABLE' <table-field-specification> columnname [ 'AS' identifier ]");

                SymbolDefs::SchemaDef::Table table;

                if (!TryParse(Lexer::Table))
                {
                        lexer.AddErrorAt(lexer.GetPosition(), Error::ExpectedTable);
                        EatTillClosure(true);
                        return;
                }

                bool is_like = TokenType() == Lexer::Identifier;

                if (!is_like)
                    P_Table_Field_Specification(table.tabledef);

                table.dbase_name = P_Table_Name(false);
                if (table.dbase_name.empty())
                {
                        EatTillClosure(true);
                        return;
                }
                if (TryParse(Lexer::OpDot))
                {
                        std::string name = P_Table_Name(false);
                        if (name.empty())
                        {
                                EatTillClosure(true);
                                return;
                        }
                        table.name = name;
                        (table.dbase_name += ".") += name;
                }
                else
                    table.name = table.dbase_name;

                if (TryParse(Lexer::As))
                    table.name = P_Table_Name(true);

                if (table.name.empty())
                {
                        EatTillClosure(true);
                        return;
                }

                Blex::ToUppercase(table.name.begin(), table.name.end());

                if (!found_names.insert(table.name).second)
                    lexer.AddError(Error::TableColNameAlreadyUsed, table.name);

                if (is_like)
                    P_Table_Like(table.tabledef);

                tables.push_back(table);
                if (!TryParse(Lexer::Comma))
                  break;
        }
        if (!TryParse(Lexer::OpGreaterThan))
        {
                lexer.AddError(Error::ExpectedGreaterThan);
                EatTillClosure(true);
        }
}

void Parser::P_Table_Field_Specification(SymbolDefs::TableDef &tabledef)
{
        PARSERULE("<table-field-specification> ::= '<' <table-field-list> '>'");
        // Accepts: * UNTIL ';'

        SymbolDefs::TableDef::ColumnsDef &columns = tabledef.columnsdef;

        if (!TryParse(Lexer::OpLessThan))
        {
                lexer.AddErrorAt(lexer.GetPosition(), Error::ExpectedTableDef);
                EatTillClosure(true);
                return;
        }

        std::set< std::string > found_names;
        std::set< std::string > found_db_names;

        if (TokenType() != Lexer::OpGreaterThan)
        {
                do
                {
                        PARSERULE("<table-field-list> ::= <table-field> [ ',' <table-field-list> ]");
                        PARSERULE("<table-field> ::= <type-specifier> <column-name>");

                        SymbolDefs::TableDef::Column column;
                        column.type = P_Type_Specifier(0);
                        column.dbase_name = P_Column_Name(false);
                        if (TryParse(Lexer::As))
                            column.name = P_Column_Name();
                        else
                            column.name = column.dbase_name;

                        Blex::ToUppercase(column.name.begin(), column.name.end());

                        if (!found_names.insert(column.name).second)
                            lexer.AddError(Error::TableColNameAlreadyUsed, column.name);

                        found_db_names.insert(column.dbase_name);

                        if (TryParse(Lexer::Null))
                        {
                                if (!TryParse(Lexer::OpAssignment))
                                    lexer.AddError(Error::ExpectedAssignmentOperator);

                                Rvalue* value = Try_P_Constant(); // FIXME: allow constant expressions!!!
                                if (value == NULL)
                                {
                                        lexer.AddError(Error::InvalidDefault,column.name); // FIXME better error
                                        if (TokenType() != Lexer::Comma)
                                            EatTillClosure(false);
                                }
                                else
                                {
                                        column.null_default_value = value;
                                }
                                column.flags |= ColumnFlags::TranslateNulls;
                        }

                        if (TryParse(Lexer::__Attributes__))
                        {
                                ExpectOpenParenthesis();
                                do
                                {
                                        std::string curattr = lexer.GetTokenSTLString();

                                        if (Blex::StrCaseCompare(curattr,"READONLY") == 0)
                                        {
                                                column.flags |= ColumnFlags::ReadOnly;
                                                NextToken();
                                        }
                                        else if (Blex::StrCaseCompare(curattr,"WARN_UNINDEXED") == 0)
                                        {
                                                column.flags |= ColumnFlags::WarnUnindexed;
                                                NextToken();
                                        }
                                        else if (Blex::StrCaseCompare(curattr,"BINARY") == 0)
                                        {
                                                column.flags |= ColumnFlags::Binary;
                                                NextToken();
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

                        columns.push_back(column);

                } while (TryParse(Lexer::Comma));

                if (TryParse(Lexer::Semicolon))
                {
                        if (TryParse(Lexer::Key))
                        {
                                std::vector< std::string > keys = P_Column_Name_List();
                                for (std::vector< std::string >::iterator it = keys.begin(); it != keys.end(); ++it)
                                {
                                        Blex::ToUppercase(it->begin(), it->end());
                                        bool found = false;
                                        for (SymbolDefs::TableDef::ColumnsDef::iterator it2 = columns.begin(); it2 != columns.end(); ++it2)
                                            if (it2->name == *it)
                                            {
                                                    found = true;
                                                    it2->flags |= ColumnFlags::Key;
                                            }
                                        if (!found)
                                            lexer.AddError(Error::UnknownColumn, *it);
                                }
                        }
                        else if (TryParse(Lexer::Where))
                        {
                                do
                                {
                                        SymbolDefs::TableDef::ViewColumn column;

                                        column.type = P_Type_Specifier(0);
                                        column.dbase_name = P_Column_Name(false);
                                        column.name = column.dbase_name;

                                        Blex::ToUppercase(column.name.begin(), column.name.end());

                                        if (!found_db_names.insert(column.dbase_name).second)
                                            lexer.AddError(Error::TableColNameAlreadyUsed, column.dbase_name);
                                        else if (!found_names.insert(column.name).second)
                                            lexer.AddError(Error::TableColNameAlreadyUsed, column.name);

                                        if (TryParse(Lexer::OpAssignment))
                                        {
                                                column.view_value_expr = Try_P_Constant(); // FIXME: allow constant expressions!!!
                                                if (column.view_value_expr == NULL)
                                                    lexer.AddError(Error::InvalidDefault,column.dbase_name); // FIXME better error
                                                else
                                                    tabledef.viewcolumnsdef.push_back(column);
                                        }
                                        else
                                            lexer.AddError(Error::ExpectedKeyword,":="); // FIXME: better error
                                }
                                while (TryParse(Lexer::And));
                        }
                        else
                        {
                                lexer.AddError(Error::ExpectedKeyword,"KEY");
                                EatTillClosure(false);
                        }
                }

                if (!TryParse(Lexer::OpGreaterThan))
                {
                        lexer.AddError(Error::ExpectedGreaterThan);
                        EatTillClosure(true);
                }
        }
}

void Parser::P_ObjectType_PropertyAccessor(Symbol *objtype, SymbolDefs::ObjectField &field, bool setter)
{
        SymbolDefs::ObjectDef &objectdef = *objtype->objectdef;

        LineColumn namepos = lexer.GetPosition();

        std::string primary_field;
        std::string result;

        bool check = false;
        if (!TryParse(Lexer::OpSubtract))
        {
                AST::LvalueLayers lvaluelayers;

                if (TryParse(Lexer::This))
                {
                    if (!TryParse(Lexer::OpArrow))
                        lexer.AddError(Error::ExpectedArrowOperator);
                }
                else
                    check = true;

                bool primary_hat = TryParse(Lexer::OpHat);
                if (primary_hat)
                    check = false;

                primary_field = (primary_hat ? "^" : "") + P_Column_Name();
                lvaluelayers.push_back(LvalueLayer(namepos, primary_field, true, false, lexer.GetPosition()));

                while (true)
                {
                        if (TryParse(Lexer::OpArrow))
                        {
                                LineColumn pos = lexer.GetPosition();
                                bool hat = TryParse(Lexer::OpHat);
                                std::string name = (hat ? "^" : "") + P_Column_Name();

                                lvaluelayers.push_back(LvalueLayer(pos, name, false, false, lexer.GetPosition()));
                        }
                        else if (TryParse(Lexer::OpDot))
                        {
                                LineColumn pos = lexer.GetPosition();
                                std::string name = P_Column_Name();

                                lvaluelayers.push_back(LvalueLayer(pos, name));
                        }
                        else
                            break;
                }

                if (lvaluelayers.size() == 1 && check)
                    result = lvaluelayers[0].name;
                else
                {
                        Symbol *accessor_func = coder->ImPropertyAccessFunction(namepos, objtype, field.name, lvaluelayers, setter);

                        SymbolDefs::ObjectField accessor_field(0);
                        accessor_field.declpos = namepos;
                        accessor_field.is_update = true;
                        accessor_field.is_private = true;
                        accessor_field.var_type = VariableTypes::Variant;
                        accessor_field.type = ObjectCellType::Method;
                        accessor_field.name = accessor_func->name;
                        accessor_field.method = accessor_func;

                        result = accessor_field.name;

                        // This can only fail when the field is declared twice. That is detected and errored on earlier.
                        objectdef.AddField(accessor_field);
                }
        }
        Blex::ToUppercase(primary_field.begin(), primary_field.end());
        Blex::ToUppercase(result.begin(), result.end());

        if (setter)
        {
                field.setter_pos = namepos;
                field.setter = result;
                field.setter_check = check;
                if (result != primary_field)
                    field.setter_primary = primary_field;
        }
        else
        {
                field.getter_pos = namepos;
                field.getter = result;
                field.getter_check = check;
                if (result != primary_field)
                    field.getter_primary = primary_field;
        }
}

void Parser::P_ObjectType_Field_Specification(Symbol *objtype)
{
        PARSERULE("<table-field-specification> ::= '<' <object-member-list> '>'");
        // Accepts: * UNTIL ';'

        SymbolDefs::ObjectDef &objectdef = *objtype->objectdef;

        if (!TryParse(Lexer::OpLessThan))
        {
                lexer.AddErrorAt(lexer.GetPosition(), Error::ExpectedObjectDef);
                EatTillClosure(true);
                return;
        }

        AST::Block *constructor_init_block = 0;
        RvaluePtrs base_params;
        LineColumn base_init_pos;
        bool constructor_declared = false;

        // ADDME: support '<>' token.
        if (!TryParse(Lexer::OpGreaterThan))
        {
                while (!TryParse(Lexer::OpGreaterThan) && lexer.GetToken() != Lexer::Eof)
                {
                        PARSERULE("<object-member-list> ::= <object-member> [ ',' <object-member> ]");
                        PARSERULE("<object-member> ::= ( [ PRIVATE ] [ UPDATE ] | UPDATE PRIVATE ) ( PROPERTY <column-name> '(' <column-name> ',' <column-name> ')' | [ PRIVATE ] <type-specifier> <column-name> | ( [ PRIVATE ] [ UPDATE ] | UPDATE PRIVATE ) MACRO | <type-specifier> [ ASYNC ] FUNCTION ) <column-name> <function-argument-list> | NEW <function-argument-list>");

                        if (IsCompStart())
                        {
                                P_CompilerStatement(false);
                                continue;
                        }

                        LineColumn declpos = lexer.GetPosition();

                        SymbolDefs::ObjectField field(0); // Filled in later
                        field.declpos = declpos;
                        std::pair</*exists*/bool, /*public*/bool> visibility = P_Visibility_Specifier(true);
                        LineColumn updpos = lexer.GetPosition();
                        field.is_update = TryParse(Lexer::Update);
                        if (!visibility.first)
                            visibility = P_Visibility_Specifier(true);
                        field.is_private = !visibility.first || !visibility.second;
                        LineColumn namepos;

                        if (TryParse(Lexer::Property))
                        {
                                field.type = ObjectCellType::Property;

                                namepos = lexer.GetPosition();

                                if (TryParse(Lexer::OpHat))
                                    field.name = "^";
                                else
                                {
                                        field.name = P_Column_Name();
                                        Blex::ToUppercase(field.name.begin(), field.name.end());
                                }

                                ExpectOpenParenthesis();

                                // Parse getter
                                P_ObjectType_PropertyAccessor(objtype, field, false);

                                ExpectComma();

                                // Parse setter
                                P_ObjectType_PropertyAccessor(objtype, field, true);

                                ExpectCloseParenthesis();

                                if (!objectdef.AddField(field))
                                    lexer.AddError(Error::MemberDeclaredTwice, field.name);

                                if (TokenType() == Lexer::OpGreaterThan)
                                {
                                        lexer.AddError(Error::ExpectedSemicolon);
                                        break;
                                }
                                ExpectSemicolon();
                        }
                        else
                        {
                                bool has_type = false;
                                VariableTypes::Type type = Try_P_Type_Specifier(0);
                                if (type == VariableTypes::Uninitialized)
                                    type = VariableTypes::NoReturn;
                                else
                                    has_type = true;

                                field.var_type = type;

                                if (TokenType() != Lexer::Macro && TokenType() != Lexer::Function && TokenType() != Lexer::Async)
                                {
                                        namepos = lexer.GetPosition();
                                        field.type = ObjectCellType::Member;
                                        field.name = P_Column_Name();
                                        Blex::ToUppercase(field.name.begin(), field.name.end());
                                        if (field.is_update)
                                            lexer.AddErrorAt(updpos, Error::NoUpdateForVarMembers, field.name);

                                        if (type == VariableTypes::NoReturn)
                                            lexer.AddErrorAt(namepos, Error::ExpectedKeyword,"MACRO");
                                        else if (!objectdef.AddField(field))
                                            lexer.AddError(Error::MemberDeclaredTwice, field.name);

                                        if (TokenType() == Lexer::OpGreaterThan)
                                        {
                                                lexer.AddError(Error::ExpectedSemicolon);
                                                break;
                                        }
                                        ExpectSemicolon();
                                }
                                else
                                {
                                        field.type = ObjectCellType::Method;

                                        /* allowed:
                                           <type> FUNCTION
                                           <type> ASYNC FUNCTION
                                           MACRO
                                           ASYNC FUNCTION
                                           ASYNC MACRO

                                           specific error handling:
                                           NEW -> expect MACRO
                                        */

                                        bool is_async = TryParse(Lexer::Async);
                                        bool is_async_macro = false;
                                        if (has_type)
                                        {
                                                if (!TryParse(Lexer::Function))
                                                {
                                                        if (TryParse(Lexer::Macro))
                                                            lexer.AddErrorAt(declpos, Error::MacroNoReturnValue);
                                                        else
                                                            lexer.AddError(Error::ExpectedKeyword,"FUNCTION");
                                                }
                                        }
                                        else
                                        {
                                                if (TokenType() == Lexer::New)
                                                    lexer.AddError(Error::ExpectedKeyword,"MACRO");
                                                else if (TokenType() == Lexer::Function)
                                                {
                                                        if (!is_async)
                                                        {
                                                                Lexer::State prefunctionstate;
                                                                lexer.SaveState(&prefunctionstate);

                                                                NextToken();
                                                                if (TokenType() != Lexer::OpMultiply)
                                                                {
                                                                        lexer.RestoreState(&prefunctionstate);
                                                                        lexer.AddError(Error::ExpectedKeyword, "MACRO");
                                                                        NextToken();
                                                                }
                                                                else
                                                                    type = VariableTypes::Object;
                                                        }
                                                        else
                                                        {
                                                                type = VariableTypes::Object;
                                                                NextToken();
                                                        }
                                                }
                                                else if (!TryParse(Lexer::Macro))
                                                    lexer.AddError(Error::ExpectedKeyword,"MACRO");
                                                else if (is_async)
                                                {
                                                        type = VariableTypes::Object;
                                                        is_async_macro = true;
                                                }
                                        }

                                        namepos = lexer.GetPosition();
                                        bool is_constructor = TryParse(Lexer::New);
                                        std::string func_name;
                                        bool is_generator = false;
                                        if (is_constructor)
                                        {
                                                field.name = "NEW";
                                                func_name = objtype->name + "#NEW";
                                                if (field.is_update)
                                                    lexer.AddError(Error::NoUpdateOnMacroNew);
                                        }
                                        else
                                        {
                                                is_generator = TryParse(Lexer::OpMultiply);
                                                field.name = P_Column_Name();
                                                func_name = field.name;
                                                Blex::ToUppercase(field.name.begin(), field.name.end());
                                        }

                                        Symbol *symbol = 0;
                                        if (is_constructor)
                                        {
                                                symbol = symboltable.ResolveSymbolInScope(declpos, symboltable.GetRootScope(), func_name);
                                                base_init_pos = namepos;
                                        }
                                        if (!symbol)
                                        {
                                                symboltable.EnterCustomScope(&objectdef, declpos); // FIXME: right position
                                                symbol = symboltable.RegisterNewCalledFunction(declpos, func_name, !is_constructor);
                                                symboltable.LeaveScope(declpos);
                                        }
                                        SymbolDefs::FunctionDef *def = Adopt(new SymbolDefs::FunctionDef);
                                        symbol->functiondef = def;
                                        symbol->state = SymbolState::Declared;
                                        symbol->definitionposition = namepos;
                                        field.method = symbol;

                                        if (is_constructor)
                                        {
                                        //      if (objectdef.constructor)
                                        //        lexer.AddErrorAt(namepos, Error::MemberDeclaredTwice, field.name);
                                                objectdef.constructor = symbol;
                                                objectdef.constructor_is_generated = false;
                                        }

                                        symboltable.EnterScope(lexer.GetPosition());

                                        SymbolDefs::FunctionDef::Argument mem_arg;
                                        mem_arg.symbol = symboltable.RegisterForwardSymbol(declpos, ":THIS", SymbolType::Variable, true, false);
                                        mem_arg.symbol->variabledef->type = VariableTypes::Object;
                                        mem_arg.symbol->variabledef->objectdef = objtype->objectdef;
                                        mem_arg.value = 0;
                                        symbol->functiondef->arguments.push_back(mem_arg);
                                        symboltable.RegisterDeclaredVariable(LineColumn(), mem_arg.symbol, false, false, VariableTypes::Object);

                                        symbol->functiondef->flags = FunctionFlags::None;
                                        symbol->functiondef->returntype = type;
                                        symbol->functiondef->isasyncmacro = is_async_macro;

                                        P_Function_Body(
                                            namepos,
                                            symbol,
                                            false,
                                            true,
                                            true,
                                            true,
                                            is_generator,
                                            is_async,
                                            (is_constructor ? objtype : 0),
                                            &constructor_init_block,
                                            &base_params,
                                            &base_init_pos
                                        );

                                        symboltable.LeaveScope(lexer.GetPosition());

                                        if (is_constructor)
                                        {
                                                if (constructor_declared)
                                                    lexer.AddErrorAt(namepos, Error::MemberDeclaredTwice, "NEW");
                                                constructor_declared = true;
                                        }
                                        else
                                        {
                                                if (!objectdef.AddField(field))
                                                    lexer.AddErrorAt(namepos, Error::MemberDeclaredTwice, field.name);
                                        }
                                }
                        }
                }
//                symboltable.LeaveScope();
/*
                if (!TryParse(Lexer::OpGreaterThan))
                {
                        lexer.AddError(Error::ExpectedGreaterThan);
                        EatTillClosure(true);
                }
*/
        }

        if (constructor_init_block)
        {
                coder->ImOpenBlock(constructor_init_block);
                Symbol *symbol = objectdef.constructor;
                coder->ImCodeObjectInit(symbol->definitionposition, objtype, symbol->functiondef->arguments[0].symbol, base_params, base_init_pos);
                coder->ImCloseBlock();
        }

}

void Parser::P_Function_Argument_List(SymbolDefs::FunctionDef *def)
{
        PARSERULE("<function-argument-list> ::= '(' [ <function-argument> [ ( ',' <function-argument> ) * ] ] ')'");

        bool has_rest_argument = false;
        if (ExpectOpenParenthesis())
        {
                if (TokenType()!=Lexer::CloseParenthesis)
                {
                        std::vector<Symbol *> argsymbols;
                        while (true)
                        {
                                SymbolDefs::FunctionDef::Argument arg;
                                if (P_Function_Argument(arg, &has_rest_argument))
                                {
                                        argsymbols.push_back(arg.symbol);
                                        def->arguments.push_back(arg);
                                }

                                if (TokenType()!=Lexer::Comma)
                                    break; //no more arguments

                                if (has_rest_argument)
                                    lexer.AddErrorAt(arg.symbol->definitionposition, Error::VarArgIncorrectSignature);

                                NextToken(); //eat the comma
                        }
                        // Finalize parameters
                        for (std::vector<Symbol *>::iterator it = argsymbols.begin(); it != argsymbols.end(); ++it)
                            symboltable.RegisterDeclaredVariable((*it)->definitionposition, *it, false, false, (*it)->variabledef->type);
                }
                ExpectCloseParenthesis();
        }
        else if (TokenType() != Lexer::OpenSubscript && TokenType() != Lexer::OpGreaterThan)
            EatTillClosure(true);

        if (has_rest_argument)
        {
                def->flags |= FunctionFlags::VarArg;

                // Allow only VARIANT ARRAY varargs, typing is not implemented yet throughout the system
                if (def->arguments.empty() || def->arguments.back().symbol->variabledef->type != VariableTypes::VariantArray)
                  lexer.AddError(Error::VarArgIncorrectSignature);

        }
}

bool Parser::P_Function_Argument(SymbolDefs::FunctionDef::Argument &arg, bool *is_rest_argument)
{
        PARSERULE("<function-argument> ::= <type-specifier> [ ... ] <identifier> [ ( 'DEFAULT' | ':=' ) <constant-expression> ]");

        // Allow VARIANT in function arguments
        VariableTypes::Type type = P_Type_Specifier(0);

        if (type == VariableTypes::Uninitialized)
        {
                EatTillClosure(false);
                return false;
        }

        *is_rest_argument = TryParse(Lexer::OpEllipsis);

        std::string name = ExpectName();
        if (name.empty())
        {
                lexer.AddError(Error::MayNotBeUsedAsName,lexer.GetTokenSTLString());
                NextToken();
        }

        LineColumn namepos = lexer.GetPosition();

        Symbol *shadowsymbol = symboltable.ResolveVariableInParentScope(namepos, name);
        if (shadowsymbol)
        {
                lexer.AddWarningAt(namepos, Warning::ShadowingVariable, name);
                lexer.AddWarningAt(shadowsymbol->definitionposition, Warning::ShadowedVariable, name);
        }

        arg.symbol = symboltable.RegisterForwardSymbol(namepos, name, SymbolType::Variable, true, false);
        arg.symbol->variabledef->type = type;
        arg.value = 0;

        NextToken(); //eat the name
        if (TokenType()==Lexer::DefaultsTo)
        {
                NextToken(); //eat the assignment token
                arg.value = P_Expression(false);
                if (arg.value == NULL)
                {
                        lexer.AddError(Error::InvalidDefault,arg.symbol->name);
                        EatTillClosure(false);
                }
        }
        return true;
}

std::vector< std::string > Parser::P_Column_Name_List()
{
        PARSERULE("<column-name-list> ::= <column-name> [ ','  <column-name-list> ]");

        std::vector< std::string > retval;

        do
        {
            retval.push_back(P_Column_Name());
        } while (TryParse(Lexer::Comma));

        return retval;
}

std::string Parser::P_Column_Name(bool force_uppercase)
{
        PARSERULE("<column-name> ::= <identifier> | <string-constant>");

        if (TokenType() == Lexer::Identifier)
        {
                std::string colname = lexer.GetTokenSTLString();
                if (force_uppercase)
                    Blex::ToUppercase(colname.begin(), colname.end());
                else
                    Blex::ToLowercase(colname.begin(), colname.end());
                NextToken();
                return colname;
        }
        if (TokenType() == Lexer::ConstantString)
        {
                std::string colname = Blex::Lexer::ParseTokenString(lexer.GetTokenSTLString());
                if (force_uppercase)
                    Blex::ToUppercase(colname.begin(), colname.end());
                NextToken();
                if (colname == "")
                    lexer.AddError(Error::ExpectedColumnName);
                return colname;
        }
        if (TokenType() > Lexer::FakeReservedWordsStart)
        {
            lexer.AddError(Error::NoReservedWordAsColumnName, lexer.GetTokenIdentifier());
        }
        else
            lexer.AddError(Error::ExpectedColumnName);
        NextToken();
        return "";
}

std::string Parser::P_Table_Name(bool force_uppercase)
{
        PARSERULE("<table-name> ::= <identifier> | <string-constant>");

        if (TokenType() == Lexer::Identifier)
        {
                std::string colname = lexer.GetTokenSTLString();
                if (force_uppercase)
                    Blex::ToUppercase(colname.begin(), colname.end());
                else
                    Blex::ToLowercase(colname.begin(), colname.end());
                NextToken();
                return colname;
        }
        if (TokenType() == Lexer::ConstantString)
        {
                std::string colname = Blex::Lexer::ParseTokenString(lexer.GetTokenSTLString());
                if (force_uppercase)
                    Blex::ToUppercase(colname.begin(), colname.end());
                NextToken();
                if (colname == "")
                    lexer.AddError(Error::ExpectedTableName);
                return colname;
        }
        lexer.AddError(Error::ExpectedTableName);
        NextToken();
        return "";
}

ArrayLocation Parser::Try_P_Delete_Location()
{
        if (TokenType() == Lexer::At)
        {
                NextToken();
                return ArrayLocation(ArrayLocation::Index, P_Expression(false));
        }
        else if (TokenType() == Lexer::All)
        {
                NextToken();
                return ArrayLocation(ArrayLocation::All);
        }
        return ArrayLocation(ArrayLocation::Missing);
}

ArrayLocation Parser::Try_P_Where()
{
        if (TokenType() == Lexer::Where)
        {
                NextToken();
                return ArrayLocation(ArrayLocation::Where, P_Expression(false));
        }
        else
            return ArrayLocation(ArrayLocation::Missing);
}

std::pair < std::string, Rvalue* > Parser::P_Set_Expression(bool allow_shorthand, bool *has_error)
{
        PARSERULE("<set-expression> ::= <column-name> ':=' <expression>");
        LineColumn pos = lexer.GetPosition();

        if (has_error)
            *has_error = false;

        bool found_candidate_name = false;
        LineColumn afternamepos = pos;

        std::string name;
        if (!allow_shorthand || TokenType() == Lexer::Identifier || TokenType() == Lexer::ConstantString)
        {
                Lexer::State namestate;
                lexer.SaveState(&namestate);

                name = P_Column_Name();

                if (TryParse(Lexer::OpAssignment))
                    return std::make_pair(name, P_Expression(false));

                if (!allow_shorthand)
                {
                        if (TokenType() == Lexer::OpEquality)
                        {
                                lexer.AddError(Error::ExpectedAssignmentOperator);
                                NextToken();
                                return std::make_pair(name, P_Expression(false));
                        }

                        if (has_error)
                            *has_error = true;

                        lexer.AddError(Error::ExpectedAssignmentOperator);
                        return std::make_pair(name, coder->ImConstantInteger(pos, 0));
                }

                // List of all positions that end the expression at the call sites. If none of these are found, the expression continues beyond this token
                if (TokenType() != Lexer::Comma && TokenType() != Lexer::CloseSubscript && TokenType() != Lexer::Into)
                {
                        name.clear();
                        found_candidate_name = true;
                        afternamepos = lexer.GetPosition();
                }


                // reparse the name as expression
                lexer.RestoreState(&namestate);
        }


        Rvalue *expr = P_Expression(false);
        if (name.empty())
        {
                auto *recordco = dynamic_cast< AST::RecordColumnConst * >(expr);
                auto *objectmem = dynamic_cast< AST::ObjectMemberConst * >(expr);
                if (recordco)
                    name = recordco->name;
                else if (objectmem)
                    name = objectmem->name;
                else if (found_candidate_name)
                    lexer.AddErrorAt(afternamepos, Error::ExpectedAssignmentOperator);
                else
                    lexer.AddErrorAt(pos, Error::ExpectedColumnName);
        }

        return std::make_pair(name, expr);

/*
        // List of all positions that end the expression at the call sites
        if (allow_shorthand && (TokenType() == Lexer::Comma || TokenType() == Lexer::CloseSubscript || TokenType() == Lexer::Into))
        {
                // reparse the name as expression
                lexer.RestoreState(&namestate);
        }
        else
        {
                if (TokenType()==Lexer::OpAssignment || TokenType()==Lexer::OpEquality)
                {
                        if (TokenType()==Lexer::OpEquality)
                            lexer.AddError(Error::ExpectedAssignmentOperator);

                        NextToken();
                }
                else
                {
                        if (has_error) *has_error = false;
                       lexer.AddError(Error::ExpectedAssignmentOperator);
                       return std::make_pair(name, coder->ImConstantInteger(pos, 0));
                }
        }

        return std::make_pair(name, P_Expression(false));
*/
}

bool Parser::P_Set_Expression_List(SQLDataModifier* modifier)
{
        if (TokenType() == Lexer::Record)
        {
                PARSERULE("<set-expression-list> ::= RECORD <expression>");

                NextToken();
                modifier->columns.push_back("");
                modifier->values.push_back(P_Expression(false));
        }
        else
        {
                while (true)
                {
                        PARSERULE("<set-expression-list> ::= <set-expression> [ ',' <set-expression-list> ]");

                        if (TokenType() != Lexer::Identifier && TokenType() != Lexer::ConstantString)
                        {
                                lexer.AddError(Error::ExpectedColumnName);
                                break;
                        }

                        bool error;
                        std::pair < std::string, Rvalue* > pair = P_Set_Expression(false, &error);
                        if (error)
                            return false;
                        modifier->columns.push_back(pair.first);
                        modifier->values.push_back(pair.second);
                        if (!TryParse(Lexer::Comma))
                            break;
                }
        }
        return true;
}

// Returns table substitute symbol if a table substitute found
Symbol * Parser::P_Single_Select_Expression(SQLSelect *select, SQLSelect::SelectItem &item)
{
        item.is_star = false;
        item.from_star = false;
        item.expr = 0;

        Lexer::State exprstate;
        lexer.SaveState(&exprstate);

        if (TokenType() == Lexer::OpMultiply)
        {
                if (select->sources->sources.size() != 1)
                    lexer.AddError(Error::ColumnsMustBeExplicit);

                Symbol *symbol = select->sources->sources[0]->symbol;

                item.is_star = true;
                item.expr = coder->ImVariable(select->position, symbol);
                NextToken();

                return symbol;
        }

        Variable *expr = Try_P_Variable(false);

        if (expr && expr->symbol->variabledef->is_substitute && TokenType() == Lexer::OpDot)
        {
                NextToken();
                if (TokenType() == Lexer::OpMultiply)
                {
                        item.is_star = true;
                        item.expr = expr;
                        NextToken();

                        return expr->symbol;
                }
        }

        lexer.RestoreState(&exprstate);

        item.expr = P_Expression(false);
        return 0;
}

void Parser::P_Renamed_Expression_List(SQLSelect *select)
{
        do
        {
                LineColumn pos = lexer.GetPosition();

                SQLSelect::SelectItem item;
                item.is_delete = false;
                item.is_spread = false;
                item.is_star = false;
                item.expr = 0;
                item.from_star = false;

                if (TryParse(Lexer::Delete))
                {
                        item.is_delete = true;
                        item.deletecolumnpos = pos;
                        item.name = P_Column_Name();

                        select->namedselects.push_back(item);
                        continue;
                }

                if (TryParse(Lexer::OpEllipsis))
                {
                        Rvalue *expr = P_Expression(false);
                        item.is_spread = true;
                        item.expr = coder->ImCast(expr->position, expr, VariableTypes::Record, false, false);
                        select->namedselects.push_back(item);
                        continue;
                }

                bool is_assignment_column_rename = false;

                //Try a <columnname> := single-select-expr
                Lexer::State selectstate;
                lexer.SaveState(&selectstate);
                if (TokenType() == Lexer::Identifier || TokenType() == Lexer::ConstantString)
                {
                        NextToken();
                        bool is_assignment_column_rename = TokenType() == Lexer::OpAssignment;
                        lexer.RestoreState(&selectstate);

                        if (is_assignment_column_rename)
                        {
                                item.name = P_Column_Name();
                                NextToken(); //eat the Assignment
                        }
                }

                // Get the expression
                Symbol *star_tablesymbol = P_Single_Select_Expression(select, item);

                // If not <column-name> ':=' single-select-expr, try single-select-expr 'AS' <column-name>
                if (!is_assignment_column_rename && TryParse(Lexer::As))
                    item.name = P_Column_Name();
                else if (!item.is_star && item.name.empty())
                {
                        AST::RecordColumnConst *co = dynamic_cast<AST::RecordColumnConst *>(item.expr);
                        if (co)
                        {
                                AST::Variable *var= dynamic_cast<AST::Variable*>(co->record);
                                if (var && select->sources->IsASource(var->symbol))
                                    item.name = co->name;
                        }
                }

                if (item.name.empty() && !item.is_star)
                    lexer.AddErrorAt(pos, Error::SelectExprMustHaveName);
                else if (!item.name.empty() && item.is_star)
                    lexer.AddErrorAt(pos, Error::SelectStarMayHaveNoName);

                // FIXME: doing this might not be good for optimization. Look at it.
                if (star_tablesymbol && star_tablesymbol->variabledef->substitutedef)
                {
                        for (SymbolDefs::TableDef::ColumnsDef::const_iterator it = star_tablesymbol->variabledef->substitutedef->columnsdef.begin();
                                it != star_tablesymbol->variabledef->substitutedef->columnsdef.end(); ++it)
                        {
                                SQLSelect::SelectItem newitem;
                                newitem.expr = coder->ImColumnOf(pos,
                                        coder->ImVariable(pos, star_tablesymbol),
                                        it->name);
                                newitem.name = it->name;
                                newitem.is_delete = false;
                                newitem.is_spread = false;
                                newitem.is_star = false;
                                newitem.from_star = true;
                                select->namedselects.push_back(newitem);
                        }
                }
                else
                   select->namedselects.push_back(item);
        } while (TryParse(Lexer::Comma));
}

void Parser::P_Select_Ordering_List(SQLSelect* select)
{
        PARSERULE("<select-ordering-list> ::= <expression> [ ASC | DESC ] ( ',' <select-ordering-list> ) *");

        while (true) //right-recursive
        {
                Rvalue* newsort=P_Expression(false);

                bool sort_asc = true;
                if (TokenType()==Lexer::Desc)
                {
                        NextToken(); //Eat 'Desc'
                        sort_asc = false;
                }
                else
                {       if (TokenType()==Lexer::Asc)
                            NextToken(); //eat 'Asc', but it is optional
                }

                select->orderings.push_back(std::make_pair(newsort, sort_asc));

                if (TokenType()==Lexer::Comma) //more fields?
                    NextToken();
                else
                    return;
        }
}

} // End of namespace Compiler
} // End of namespace HareScript
