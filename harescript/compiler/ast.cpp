#include <harescript/compiler/allincludes.h>

#include "ast.h"

namespace HareScript
{
namespace Compiler
{
namespace AST
{

ObjectMethodCall::ObjectMethodCall(LineColumn const &position, Rvalue *_object, std::string const &_membername, bool _via_this, const RvaluePtrs &_parameters, bool _has_passthroughs, std::vector< int32_t > const &_passthrough_parameters)
: Rvalue(position)
, object(_object)
, membername(_membername)
, via_this(_via_this)
, parameters(_parameters)
, has_passthroughs(_has_passthroughs)
, passthrough_parameters(_passthrough_parameters)
, allow_macro(true)
{
}

BaseExpressionVisitor::~BaseExpressionVisitor()
{
}

BaseDeepOperationVisitor::~BaseDeepOperationVisitor()
{
}

BaseStatementVisitor::~BaseStatementVisitor()
{
}

BaseSQLVisitor::~BaseSQLVisitor()
{
}

bool DeepOperation::RequireOldValue()
{
        return true;
}

bool LvalueSet::RequireOldValue()
{
        return !clvalue.layers.empty();
}

bool SQLSources::IsASource(Symbol const *symbol) const
{
        for (std::vector<SQLSource*>::const_iterator itr=sources.begin();itr!=sources.end();++itr)
          if ((*itr)->symbol==symbol)
            return true;

        return false;
}

void TypeInfo::BuildTypeInfoFromSymbol(CompilerContext &context)
{
        // Get typeinfo
        typeinfo = new HareScript::DBTypeInfo;
        context.owner.Adopt(typeinfo);
        if (symbol && symbol->variabledef)
        {
                typeinfo->type = symbol->variabledef->type;
                for (auto &itr: symbol->variabledef->schemadef.tablesdef)
                {
                        DBTypeInfo::Table tbl;
                        tbl.dbase_name = itr.dbase_name;
                        tbl.name = itr.name;
                        std::copy(itr.tabledef.columnsdef.begin(), itr.tabledef.columnsdef.end(), std::back_inserter(tbl.columnsdef));
                        std::copy(itr.tabledef.viewcolumnsdef.begin(), itr.tabledef.viewcolumnsdef.end(), std::back_inserter(tbl.viewcolumnsdef));
                        typeinfo->tablesdef.push_back(tbl);
                }
                std::copy(symbol->variabledef->tabledef.columnsdef.begin(), symbol->variabledef->tabledef.columnsdef.end(),
                        std::back_inserter(typeinfo->columnsdef));
                std::copy(symbol->variabledef->tabledef.viewcolumnsdef.begin(), symbol->variabledef->tabledef.viewcolumnsdef.end(),
                        std::back_inserter(typeinfo->columnsdef));
        }
}

} //end namespace AST

} //end namespace  compiler

} //end namespace harescript






