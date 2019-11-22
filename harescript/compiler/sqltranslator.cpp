//---------------------------------------------------------------------------
#include <harescript/compiler/allincludes.h>

//---------------------------------------------------------------------------

#include "sqltranslator.h"

#include "symboltable.h"
#include "utilities.h"
#include "debugprints.h"
#include "ast_code_printer.h"

//#define SHOWQUERYBUILD

#ifdef SHOWQUERYBUILD
 #define QUERYBUILDPRINT(a) DEBUGPRINT(a)
 #define QUERYBUILDONLY(a) DEBUGONLY(a)
#else
 #define QUERYBUILDPRINT(a) (void)0
 #define QUERYBUILDONLY(a) (void)0
#endif

namespace HareScript
{
namespace Compiler
{

using namespace AST;

namespace
{

unsigned FindColumnInTypeInfo(AST::TypeInfo *typeinfo, std::string name, bool add)
{
        Blex::ToUppercase(name.begin(), name.end());

        unsigned idx = 0;
        for (auto it = typeinfo->typeinfo->columnsdef.begin();
                it != typeinfo->typeinfo->columnsdef.end(); ++it, ++idx)
            if (name == it->name)
                return idx;

        if (!add)
            throw Message(true, Error::InternalError, "Unknown column name slipped through semantic check");

        HareScript::DBTypeInfo::Column col;
        col.name = name;
        col.dbase_name = name;
        col.type = VariableTypes::Uninitialized;
        typeinfo->typeinfo->columnsdef.push_back(col);
        return idx;
}

void AddFlagToTypeInfo(AST::TypeInfo *typeinfo, std::string const &name, ColumnFlags::_type flag)
{
        unsigned idx = FindColumnInTypeInfo(typeinfo, name, typeinfo->typeinfo->type == VariableTypes::RecordArray);
        typeinfo->typeinfo->columnsdef[idx].flags |= flag;
}

} // End of anonymous namespace

struct SQLTranslator::TreeLevel
{
        // List of all single conditions at this level
        std::vector< DBSingleCondition > directives;

        // Relations at this level
        std::vector< DBRelationCondition > relations;

        struct Conditional
        {
                Rvalue *condition;
                std::shared_ptr< TreeLevel > subs[2];
        };

        // List of conditionals at this level
        std::vector< Conditional > conditionals;

        // Not optimizable stuff at this level
        RvaluePtrs rest_conditions;

        // Fully optimized
        bool fully_optimized;

        bool HaveDBConditions();
        void Dump(CompilerContext &context, unsigned indent);
};

bool SQLTranslator::TreeLevel::HaveDBConditions()
{
        if (!directives.empty() || !relations.empty())
            return true;
        for (std::vector< Conditional >::iterator it = conditionals.begin(); it != conditionals.end(); ++it)
        {
                if (it->subs[0].get() && it->subs[0]->HaveDBConditions())
                    return true;
                if (it->subs[1].get() && it->subs[1]->HaveDBConditions())
                    return true;
        }
        return false;
}

void SQLTranslator::TreeLevel::Dump(CompilerContext &context, unsigned indent)
{
        AstCodePrinter printer(context);

        QUERYBUILDPRINT(std::string(indent, ' ') << "Directives:");
        for (std::vector< DBSingleCondition >::iterator it = directives.begin(); it != directives.end(); ++it)
        {
                std::cout << std::string(indent, ' ') << "- " << it->source->symbol->name << ".'" << it->columnname << "' " << GetName(it->condition) << " ";
                printer.DumpExpression(std::cout, it->value);
                std::cout << std::endl;
        }
        std::cout << std::string(indent, ' ') << "Relations:" << std::endl;
        for (std::vector< DBRelationCondition >::iterator it = relations.begin(); it != relations.end(); ++it)
        {
                std::cout << std::string(indent, ' ') << "- " << it->source1->symbol->name << ".'" << it->columnname1 << "' " << GetName(it->condition) << " "<< it->source2->symbol->name << ".'" << it->columnname2 << "'" << std::endl;
        }
        std::cout << std::string(indent, ' ') << "Conditionals:" << std::endl;
        for (std::vector< Conditional >::iterator it = conditionals.begin(); it != conditionals.end(); ++it)
        {
                std::cout << std::string(indent, ' ') << "- ";
                printer.DumpExpression(std::cout, it->condition);
                std::cout << std::endl;
                std::cout << std::string(indent + 2, ' ') << "- TRUE" << std::endl;
                if (it->subs[0].get())
                    it->subs[0]->Dump(context, indent + 4);
                std::cout << std::string(indent + 2, ' ') << "- FALSE" << std::endl;
                if (it->subs[1].get())
                    it->subs[1]->Dump(context, indent + 4);
        }
        std::cout << std::string(indent, ' ') << "Rest:" << std::endl;
        for (RvaluePtrs::iterator it = rest_conditions.begin(); it != rest_conditions.end(); ++it)
        {
                std::cout << std::string(indent, ' ') << "- ";
                printer.DumpExpression(std::cout, *it);
                std::cout << std::endl;
        }
}

struct SQLTranslator::TreeDecomposeResult
{
        TreeDecomposeResult(
            SQLTranslator &_translator,
            CompilerContext &_context,
            SQLSources &_sources,
            TypeStorage &typestorage);

        SQLTranslator &translator;
        CompilerContext &context;
        SQLSources &sources;

        // List of all the database sources (sublist of all sources)
        std::vector<SQLSource *> db_sources;

        // List of all the RECORD ARRAY sources (sublist of all sources)
        std::vector<SQLSource *> expr_sources;

        // Map from subsitution symbol to source
        std::map<Symbol *, SQLSource *> subst_map;

        // Root condition level
        std::shared_ptr< TreeLevel > root;

        std::shared_ptr< TreeLevel > ConvertTree(Rvalue *tree, bool optimizable);
        bool ConvertToDBCondition(std::shared_ptr< TreeLevel > level, Rvalue *elt, bool optimizable);
        bool HaveDBConditions() { return root.get() && root->HaveDBConditions(); }
        Rvalue * GetConditions(LineColumn pos, AstCoder *coder, TreeLevel *level);
        Rvalue * GetRestWhere(LineColumn pos, AstCoder *coder, TreeLevel *level);

        void Dump() { if (root.get()) root->Dump(context, 0); }

        std::map<SQLSource *, TypeInfo *> where_selectinfo;
};

SQLTranslator::TreeDecomposeResult::TreeDecomposeResult(
            SQLTranslator &_translator,
            CompilerContext &_context,
            SQLSources &_sources,
            TypeStorage &typestorage)
: translator(_translator)
, context(_context)
, sources(_sources)
{
        // Create the subst map
        for (std::vector<SQLSource *>::const_iterator it = sources.sources.begin(); it != sources.sources.end(); ++it)
            subst_map[(*it)->symbol] = *it;

        for (std::vector< SQLSource * >::iterator it = sources.sources.begin(); it != sources.sources.end(); ++it)
        {
                if (typestorage[(*it)->expression] == VariableTypes::Table)
                    db_sources.push_back(*it);
                else // Record array
                    expr_sources.push_back(*it);
        }

        // Set the table nrs
        unsigned table_nr = 0;
        for (std::vector<SQLSource *>::iterator it = db_sources.begin(); it != db_sources.end(); ++it)
            (*it)->tablenr = table_nr++;
        for (std::vector<SQLSource *>::iterator it = expr_sources.begin(); it != expr_sources.end(); ++it)
            (*it)->tablenr = table_nr++;
}

std::shared_ptr< SQLTranslator::TreeLevel > SQLTranslator::TreeDecomposeResult::ConvertTree(Rvalue *tree, bool optimizable)
{
        std::shared_ptr< TreeLevel > level(new TreeLevel);
        TreeCopyingVisitor copier(context);

        std::list< Rvalue * > worklist(1, tree);

        while (!worklist.empty())
        {
                Rvalue *elt = worklist.front();
                worklist.pop_front();

                ConditionalOperator* condop = dynamic_cast<ConditionalOperator*>(elt);
                if (condop)
                {
                          if (!translator.IsDependent(condop->condition, sources))
                          {
                                  TreeLevel::Conditional cond;
                                  cond.condition = copier.GetCopy(condop->condition);
                                  translator.semanticchecker.Visit(cond.condition, true);

                                  cond.subs[0] = ConvertTree(condop->expr_true, optimizable);
                                  cond.subs[1] = ConvertTree(condop->expr_false, optimizable);
                                  level->conditionals.push_back(cond);
                                  if (cond.subs[0].get())
                                      optimizable &= cond.subs[0]->fully_optimized;
                                  if (cond.subs[1].get())
                                      optimizable &= cond.subs[1]->fully_optimized;
                                  continue;
                          }

                          // No way it is optimizable (ADDME hmm, unless lhs and/or rhs are independent, think about it)
                          optimizable = false;
                          level->rest_conditions.push_back(elt);
                          continue;
                }

                BinaryOperator* bop = dynamic_cast<BinaryOperator*>(elt);
                if (bop)
                {
                        if (bop->operation == BinaryOperatorType::OpAnd)
                        {
                                worklist.push_front(bop->rhs);
                                worklist.push_front(bop->lhs);
                                continue;
                        }
                        else if (bop->operation == BinaryOperatorType::OpOr)
                        {
                                Rvalue *lhs = bop->lhs, *rhs = bop->rhs;

                                bool can_optimize = !translator.IsDependent(lhs, sources);
                                if (!can_optimize)
                                {
                                        can_optimize = !translator.IsDependent(rhs, sources);
                                        if (can_optimize)
                                            std::swap(lhs, rhs);
                                }
                                if (can_optimize)
                                {
                                        TreeLevel::Conditional cond;
                                        cond.condition = copier.GetCopy(lhs);
                                        cond.subs[1] = ConvertTree(rhs, optimizable);
                                        if (cond.subs[1])
                                            optimizable &= cond.subs[1]->fully_optimized;
                                        level->conditionals.push_back(cond);
                                        continue;
                                }

                                // Otherwise, a dependent or is not optimizable
                                optimizable = false;
                                level->rest_conditions.push_back(elt);
                                continue;
                        }
                }

                // Minimal element (no condition/and/or, see what we can do with it
                if (!ConvertToDBCondition(level, elt, optimizable))
                {
                        optimizable = false;
                        level->rest_conditions.push_back(elt);
                }
        }

        level->fully_optimized = optimizable;
        return level;
}


bool SQLTranslator::TreeDecomposeResult::ConvertToDBCondition(std::shared_ptr< TreeLevel > level, Rvalue *expr, bool optimizable)
{
        // Check for TRUE
        {
                Constant *co = dynamic_cast< Constant * >(expr);
                if (co && co->type == VariableTypes::Boolean)
                {
                        if (translator.context.stackm.GetBoolean(co->var) == true)
                        {
                                return true;
                        }
                }
        }

        // Check for [NOT] [CAST->BOOLEAN] rec.col
        {
                Rvalue *current = expr;
                bool got_not = false;
                UnaryOperator *uo = dynamic_cast< UnaryOperator * >(current);
                if (uo)
                {
                        if (uo->operation != UnaryOperatorType::OpNot)
                            current = 0;
                        else
                        {
                                current = uo->lhs;
                                got_not = true;
                        }
                }

                Cast *cast = dynamic_cast<Cast *>(current);
                if (cast && cast->to_type == VariableTypes::Boolean)
                    current = cast->expr;

                SourceColumn lhs;
                translator.TryTableColumn(current, lhs, sources, subst_map);

                if (lhs.is_sc) // Left is subst.column?
                {
                        if (!optimizable)
                        {
                                context.errorhandler.AddWarningAt(expr->position, Warning::PartlyUnoptimizedWhere);
                                return false;
                        }

                        DBSingleCondition cond;
                        cond.precondition = 0;
                        cond.source = lhs.source;
                        cond.columnname = lhs.columnname;
                        cond.value = translator.coder->ImConstantBoolean(expr->position, !got_not);
                        cond.condition = DBConditionCode::Equal;
                        cond.hs_condition = BinaryOperatorType::OpEqual;
                        cond.casesensitive = !lhs.has_touppercase;
                        cond.expr = expr;

                        level->directives.push_back(cond);
                        return true;
                }
        }

        //Check for binary operators
        BinaryOperator *bop = dynamic_cast<BinaryOperator *>(expr);
        if (!bop)
            return false;

        std::pair<bool, DBConditionCode::_type> valid_condition = IsCondition(bop->operation);
        if (!valid_condition.first)
            return false;

        if (valid_condition.second == DBConditionCode::In)
        {
                if (translator.IsDependent(bop->rhs, sources))
                    return false; //a dependent RHS is not constant and cannot be optimized
//                // Only accept integer arrays for an IN.
//                if (translator.typestorage[bop->rhs] != VariableTypes::IntegerArray)
//                    return false;
        }

        SourceColumn lhs;
        SourceColumn rhs;

        // Get the table column-stuff
        translator.TryTableColumn(bop->lhs, lhs, sources, subst_map);
        translator.TryTableColumn(bop->rhs, rhs, sources, subst_map);

        Rvalue *rhsexpr = bop->rhs;

        if (!lhs.is_sc) // Left is not subst.column?
        {
                if (!rhs.is_sc) // Right is not subst.column?
                    return false; // Can't optimize

                std::pair<bool, DBConditionCode::_type> swapped = SwappedCondition(valid_condition.second);
                if (!swapped.first)
                    return false; // Can't swap

                // This one is of type "value op subst.column". Swap!
                std::swap(lhs, rhs);
                valid_condition.second = swapped.second;
                rhsexpr = bop->lhs;
        }
        else
            if (rhs.is_sc)
            {
                    // Joins require touppercase on both sides.
                    if (lhs.has_touppercase != rhs.has_touppercase)
                        return false;

                    if (!optimizable)
                    {
                            context.errorhandler.AddWarningAt(expr->position, Warning::PartlyUnoptimizedWhere);
                            return false;
                    }

                    // this is a relation (aka join)
                    DBRelationCondition cond;
                    cond.precondition = 0;
                    cond.source1 = lhs.source;
                    cond.columnname1 = lhs.columnname;
                    cond.source2 = rhs.source;
                    cond.columnname2 = rhs.columnname;
                    cond.condition = valid_condition.second;
                    cond.hs_condition = GetHSConditionFromDBCondition(valid_condition.second);
                    cond.casesensitive = !lhs.has_touppercase;
                    cond.expr = expr;

                    level->relations.push_back(cond);
                    return true;
            }

        //Is the RHS dependent?
        if (translator.IsDependent(rhsexpr, sources))
            return false; //a dependent RHS is not constant and cannot be optimized

        if (lhs.has_touppercase)
        {
                Constant *rhs_constant = dynamic_cast<Constant *>(rhs.expr);
                if (rhs_constant && rhs_constant->type == VariableTypes::String)
                {
                        Blex::StringPair str = context.stackm.GetString(rhs_constant->var);
                        rhs.has_touppercase = Blex::IsUppercase(str.begin, str.end);
                        if (!rhs.has_touppercase)
                        {
                               context.errorhandler.AddWarningAt(bop->position, Warning::ConditionAlwaysFalse);
                               return false;
                        }
                        // now, rhs is proven uppercase
                }
                if (!rhs.has_touppercase)
                {
                        // rhs is not proven uppercase. Lhs is, so using case insensitive compare is forbidden
                        // (would fail to return false if rhs was actually lower case)
                        return false;
                }
        }

//        if (lhs.has_touppercase != rhs.has_touppercase)
//            return false;

        if (!optimizable)
        {
                context.errorhandler.AddWarningAt(expr->position, Warning::PartlyUnoptimizedWhere);
                return false;
        }

        DBSingleCondition cond;
        cond.precondition = 0;
        cond.source = lhs.source;
        cond.columnname = lhs.columnname;
        cond.value = rhs.expr;
        cond.condition = valid_condition.second;
        cond.hs_condition = GetHSConditionFromDBCondition(valid_condition.second);
        cond.casesensitive = !lhs.has_touppercase;
        cond.expr = expr;

        level->directives.push_back(cond);
        return true;
}

Rvalue * SQLTranslator::TreeDecomposeResult::GetConditions(LineColumn pos, AstCoder *coder, TreeLevel *level)
{
        AST::ConstantArray *conditions = coder->ImConstantArray(pos, VariableTypes::RecordArray);

        for (std::vector< DBSingleCondition >::iterator it = level->directives.begin(); it != level->directives.end(); ++it)
        {
                AST::ConstantRecord *rec = coder->ImConstantRecord(pos);
                conditions->values.push_back(std::make_tuple(pos, rec, false));

                unsigned tablenr = it->source->tablenr;
                unsigned typeinfo_idx = FindColumnInTypeInfo(it->source->typeinfo, it->columnname, tablenr >= db_sources.size());

                // Mark as used so the record optimizer knows which columns are needed
                AddFlagToTypeInfo(it->source->typeinfo, it->columnname, ColumnFlags::InternalUsedInCondition);

                rec->columns.push_back(std::make_tuple(AST::ConstantRecord::Item, "SINGLE", coder->ImConstantBoolean(pos, true)));
                rec->columns.push_back(std::make_tuple(AST::ConstantRecord::Item, "TABLENR", coder->ImConstantInteger(pos, tablenr)));
                rec->columns.push_back(std::make_tuple(AST::ConstantRecord::Item, "TYPEINFONR", coder->ImConstantInteger(pos, typeinfo_idx)));
                rec->columns.push_back(std::make_tuple(AST::ConstantRecord::Item, "VALUE", it->value));
                rec->columns.push_back(std::make_tuple(AST::ConstantRecord::Item, "CASESENSITIVE", coder->ImConstantBoolean(pos, it->casesensitive)));
                rec->columns.push_back(std::make_tuple(AST::ConstantRecord::Item, "CONDITION", coder->ImConstantInteger(pos, it->condition)));
        }

        for (std::vector< DBRelationCondition >::iterator it = level->relations.begin(); it != level->relations.end(); ++it)
        {
                AST::ConstantRecord *rec = coder->ImConstantRecord(pos);
                conditions->values.push_back(std::make_tuple(pos, rec, false));

                unsigned tablenr1 = it->source1->tablenr;
                unsigned typeinfo_idx1 = FindColumnInTypeInfo(it->source1->typeinfo, it->columnname1, tablenr1 >= db_sources.size());
                unsigned tablenr2 = it->source2->tablenr;
                unsigned typeinfo_idx2 = FindColumnInTypeInfo(it->source2->typeinfo, it->columnname2, tablenr2 >= db_sources.size());

                // Mark as used so the record optimizer knows which columns are needed
                AddFlagToTypeInfo(it->source1->typeinfo, it->columnname1, ColumnFlags::InternalUsedInCondition);
                AddFlagToTypeInfo(it->source2->typeinfo, it->columnname2, ColumnFlags::InternalUsedInCondition);

                rec->columns.push_back(std::make_tuple(AST::ConstantRecord::Item, "SINGLE", coder->ImConstantBoolean(pos, false)));
                rec->columns.push_back(std::make_tuple(AST::ConstantRecord::Item, "TABLENR1", coder->ImConstantInteger(pos, tablenr1)));
                rec->columns.push_back(std::make_tuple(AST::ConstantRecord::Item, "TYPEINFONR1", coder->ImConstantInteger(pos, typeinfo_idx1)));
                rec->columns.push_back(std::make_tuple(AST::ConstantRecord::Item, "TABLENR2", coder->ImConstantInteger(pos, tablenr2)));
                rec->columns.push_back(std::make_tuple(AST::ConstantRecord::Item, "TYPEINFONR2", coder->ImConstantInteger(pos, typeinfo_idx2)));
                rec->columns.push_back(std::make_tuple(AST::ConstantRecord::Item, "CASESENSITIVE", coder->ImConstantBoolean(pos, it->casesensitive)));
                rec->columns.push_back(std::make_tuple(AST::ConstantRecord::Item, "CONDITION", coder->ImConstantInteger(pos, it->condition)));
        }

        AST::Rvalue *result = conditions;
        for (std::vector< TreeLevel::Conditional >::iterator it = level->conditionals.begin(); it != level->conditionals.end(); ++it)
        {
                  AST::Rvalue *expr_true = it->subs[0].get() ? GetConditions(pos, coder, it->subs[0].get()) : coder->ImConstantArray(pos, VariableTypes::RecordArray);
                  AST::Rvalue *expr_false = it->subs[1].get() ? GetConditions(pos, coder, it->subs[1].get()) : coder->ImConstantArray(pos, VariableTypes::RecordArray);

                  result = coder->ImBinaryOperator(
                      pos,
                      BinaryOperatorType::OpConcat,
                      result,
                      coder->ImConditionalOperator(pos, it->condition, expr_true, expr_false));
        }

        return result;
}

Rvalue * SQLTranslator::TreeDecomposeResult::GetRestWhere(LineColumn pos, AstCoder *coder, TreeLevel *level)
{
        QUERYBUILDPRINT("GetRestWhere, conditionals: " << level->conditionals.size());
        Rvalue *result = 0;
        for (std::vector< TreeLevel::Conditional >::iterator it = level->conditionals.begin(); it != level->conditionals.end(); ++it)
        {
                Rvalue *expr_true = it->subs[0].get() ? GetRestWhere(pos, coder, it->subs[0].get()) : 0;
                Rvalue *expr_false = it->subs[1].get() ? GetRestWhere(pos, coder, it->subs[1].get()) : 0;

                if (expr_true || expr_false)
                {
                        if (!expr_true)
                            expr_true = coder->ImConstantBoolean(pos, true);
                        if (!expr_false)
                            expr_false = coder->ImConstantBoolean(pos, true);

                        Rvalue *cond = coder->ImConditionalOperator(pos, it->condition, expr_true, expr_false);
                        if (result)
                            result = coder->ImBinaryOperator(pos, BinaryOperatorType::OpAnd, result, cond);
                        else
                            result = cond;
                    QUERYBUILDPRINT("- conditional added");
                }
                else
                    QUERYBUILDPRINT("- conditional skipped");
        }

        for (RvaluePtrs::iterator it = level->rest_conditions.begin(); it != level->rest_conditions.end(); ++it)
        {
                if (result)
                {
                        QUERYBUILDPRINT("- restcondition anded");
                        result = coder->ImBinaryOperator(pos, BinaryOperatorType::OpAnd, result, *it);
                }
                else
                {
                        QUERYBUILDPRINT("- restcondition assigned");
                        result = *it;
                }
        }
        QUERYBUILDONLY(
            std::cout << "GetRestWhere, result: ";
            AstCodePrinter printer(context);
            printer.DumpExpression(std::cout, result);
            std::cout << std::endl;);
        return result;
}


std::pair<bool, DBConditionCode::_type> SQLTranslator::IsCondition(BinaryOperatorType::Types op)
{
        switch (op)
        {
        case BinaryOperatorType::OpEqual:       return std::make_pair(true, DBConditionCode::Equal);
        case BinaryOperatorType::OpUnEqual:     return std::make_pair(true, DBConditionCode::UnEqual);
        case BinaryOperatorType::OpLessEqual:   return std::make_pair(true, DBConditionCode::LessEqual);
        case BinaryOperatorType::OpLess:        return std::make_pair(true, DBConditionCode::Less);
        case BinaryOperatorType::OpGreaterEqual:return std::make_pair(true, DBConditionCode::BiggerEqual);
        case BinaryOperatorType::OpGreater:     return std::make_pair(true, DBConditionCode::Bigger);
        case BinaryOperatorType::OpLike:        return std::make_pair(true, DBConditionCode::Like);
        case BinaryOperatorType::OpIn:          return std::make_pair(true, DBConditionCode::In);
        default: ;
        }
        return std::make_pair(false, DBConditionCode::Equal);
}

BinaryOperatorType::Types SQLTranslator::GetHSConditionFromDBCondition(DBConditionCode::_type op)
{
        switch (op)
        {
        case DBConditionCode::Equal:            return BinaryOperatorType::OpEqual;
        case DBConditionCode::UnEqual:          return BinaryOperatorType::OpUnEqual;
        case DBConditionCode::LessEqual:        return BinaryOperatorType::OpLessEqual;
        case DBConditionCode::Less:             return BinaryOperatorType::OpLess;
        case DBConditionCode::BiggerEqual:      return BinaryOperatorType::OpGreaterEqual;
        case DBConditionCode::Bigger:           return BinaryOperatorType::OpGreater;
        case DBConditionCode::Like:             return BinaryOperatorType::OpLike;
        case DBConditionCode::In:               return BinaryOperatorType::OpIn;
        default: ;
        }
        return BinaryOperatorType::OpEqual;
}

std::pair<bool, DBConditionCode::_type> SQLTranslator::SwappedCondition(DBConditionCode::_type cond)
{
        switch (cond)
        {
        case DBConditionCode::LessEqual:  cond = DBConditionCode::BiggerEqual; break;
        case DBConditionCode::Less:       cond = DBConditionCode::Bigger; break;
        case DBConditionCode::BiggerEqual:cond = DBConditionCode::LessEqual; break;
        case DBConditionCode::Bigger:     cond = DBConditionCode::Less; break;
        default: ;
        }
        return std::make_pair(cond != DBConditionCode::Like, cond);
}


/* Arnold: Dealing with SQL update/delete:

   Some database implementations require the ability to re-test the WHERE clause
   on a given record. Being able to pass a function to the SQL Delete would be
   the nicest solution, but I'm not sure whether that's doable...

   To support UPDATE/DELETE on external ODBC data, we will demand the user to
   tell us the primary keys for every table. Then we can use that as a criteria
   for delete.

   The UPDATE/DELETE functions may require us to re-test the complete WHERE
   query. To support this, we will generate code similair to the following:

   currecord := __HS_SQL_CURSOR_DELETE(cursorid);
   IF (RecordExists(currecord) AND StillMatchesWhere(currecord))
     __HS_SQL_CURSOR_DELETERETRY(cursorid, currecord);

 */


/** The VariableUseFinder returns the set of substitution variables
    used in an expression */
class VariableUseFinder : protected AST::AllNodeVisitor
{
    public:
        VariableUseFinder()
        : uses_count(false)
        , uses_function(false)
        {
        }

        /** Fills the used array with all used substitute variables in the given sources */
        void Clear();
        bool Add(AST::Node *obj, SQLSources const &sources, SQLSelect *select);
        bool Execute(AST::Node *obj, SQLSources const &sources, SQLSelect *select);

        std::set<Symbol *> used;
        bool uses_count;
        bool uses_function;

    private:
        std::set<Symbol *> substparam;

        virtual void V_FunctionCall(AST::FunctionCall *obj, Empty)
        {
                if (obj->symbol && obj->symbol->functiondef->flags & FunctionFlags::IsCount)
                    uses_count = true;
                uses_function = true;

                AllNodeVisitor::V_FunctionCall(obj, Empty());
        }

        virtual void V_Variable(AST::Variable *obj, Empty)
        {
                if (substparam.find(obj->symbol) != substparam.end())
                    used.insert(obj->symbol);
        }
};

void VariableUseFinder::Clear()
{
        used.clear();
        substparam.clear();
}

bool VariableUseFinder::Execute(AST::Node *obj, SQLSources const &sources, SQLSelect *select)
{
        Clear();
        return Add(obj, sources, select);
}

bool VariableUseFinder::Add(AST::Node *obj, SQLSources const &sources, SQLSelect *select)
{
        for (std::vector<SQLSource*>::const_iterator it = sources.sources.begin(); it != sources.sources.end(); ++it)
        {
                substparam.insert((*it)->symbol);
                if ((*it)->symbol->variabledef->countersymbol)
                    substparam.insert((*it)->symbol->variabledef->countersymbol);
        }
        if (select)
        {
            for (std::vector< SQLSelect::Temporary >::const_iterator it = select->temporaries.begin(); it != select->temporaries.end(); ++it)
                substparam.insert(it->symbol);
        }

        Visit(obj, Empty());
        return !used.empty();
}

class SchemaTableConverter : protected AST::AllNodeVisitor
{
    public:
        inline SchemaTableConverter(CompilerContext &context, AstCoder *coder) : context(context), coder(coder), f_bindschematotable(0) {}
        void Execute(AST::Node *obj);

    private:
        CompilerContext &context;
        AstCoder *coder;
        Symbol *f_bindschematotable;

        virtual void V_SchemaTable(AST::SchemaTable *obj, Empty);
};

void SchemaTableConverter::Execute(AST::Node *obj)
{
        Visit(obj, Empty());
}

void SchemaTableConverter::V_SchemaTable(AST::SchemaTable *obj, Empty)
{
        // Lazy binding, don't lookup if not needed (otherwise wh:: libraries will fail)
        if (!f_bindschematotable)
            f_bindschematotable = context.symboltable->RetrieveExternalFunction(obj->position, "BINDSCHEMATOTABLE");

        RvaluePtrs parameters;
        parameters.push_back(obj->schema);

        std::string dbase_name;
        SymbolDefs::SchemaDef const &schemadef = obj->schema->symbol->variabledef->schemadef;
        for (SymbolDefs::SchemaDef::TablesDef::const_iterator it = schemadef.tablesdef.begin(); it != schemadef.tablesdef.end(); ++it)
        {
                if (Blex::StrCaseCompare(it->name, obj->name) == 0)
                    dbase_name = it->dbase_name;
        }

        parameters.push_back(coder->ImConstantString(obj->position, dbase_name));

        Rvalue *repl = coder->ImFunctionCall(obj->position, f_bindschematotable, parameters);

        ReplacePtr(repl);
}

/** All the rewrite data that is needed to rewrite a GROUP BY select */
struct GroupRewriteData
{
        /// Symbol that describes record from which cells can be gotten in rebuilding fase.
        Symbol *result_symbol;

        typedef std::map< std::pair< Symbol *, std::string >, std::string > GroupedCols;

        /// Group columns
        GroupedCols grouped_cols;

        typedef std::vector< std::pair< std::string, Rvalue * > > Aggregates;

        /** List of aggregate functions.
            first: cell in group structure
            second: aggregate function argument */
        Aggregates aggregates;
};

class GroupExprRewriter : protected AST::AllNodeVisitor
{
    public:
        inline GroupExprRewriter(CompilerContext &context, TypeStorage &typestorage, AstCoder *coder, GroupRewriteData &rewrite_data) : context(context), typestorage(typestorage), coder(coder), rewrite_data(rewrite_data) {}
        inline void Execute(AST::Node *obj) { Visit(obj, Empty()); }

    private:
        CompilerContext &context;
        TypeStorage &typestorage;
        AstCoder *coder;
        GroupRewriteData &rewrite_data;

        virtual void V_RecordColumnConst(AST::RecordColumnConst *obj, Empty);
        virtual void V_FunctionCall(AST::FunctionCall *obj, Empty);
};

void GroupExprRewriter::V_RecordColumnConst(AST::RecordColumnConst *obj, Empty)
{
        Variable *var = dynamic_cast< Variable * >(obj->record);
        if (var)
        {
                GroupRewriteData::GroupedCols::const_iterator it = rewrite_data.grouped_cols.find(std::make_pair(var->symbol, obj->name));
                if (it != rewrite_data.grouped_cols.end())
                {
                        obj->record = coder->ImVariable(obj->position, rewrite_data.result_symbol);
                        obj->name = it->second;
                }
        }
        else
            Visit(obj->record, Empty());
}

void GroupExprRewriter::V_FunctionCall(AST::FunctionCall *obj, Empty)
{
        if ((!(obj->symbol->functiondef->flags & FunctionFlags::Aggregate) && !obj->inhibit_aggregate) || obj->as_aggregate)
        {
                // Delegate to code of allnodevisitor.
                AST::AllNodeVisitor::V_FunctionCall(obj, Empty());
                return;
        }

        GroupRewriteData::Aggregates::value_type data;
        data.first = "a_" + Blex::AnyToString(rewrite_data.aggregates.size());
        data.second = obj->parameters[0];

        obj->parameters[0] = coder->ImColumnOf(
                obj->position,
                coder->ImVariable(obj->position, rewrite_data.result_symbol),
                data.first);

        rewrite_data.aggregates.push_back(data);

        typestorage[obj->parameters[0]] = typestorage[data.second];
        obj->as_aggregate = true;
}

SQLTranslator::SQLTranslator(CompilerContext &context, AstCoder *coder, TypeStorage &typestorage, SemanticChecker &semanticchecker)
: context(context)
, coder(coder)
, typestorage(typestorage)
, semanticchecker(semanticchecker)
, carim(coder, typestorage, context)
, skip_schema_trans_replacement(0)
{
}

SQLTranslator::~SQLTranslator()
{
}

void SQLTranslator::Execute(AST::Node *obj)
{
        Visit(obj, Empty());
        SchemaTableConverter(context, coder).Execute(obj);
}

bool SQLTranslator::IsDependent(AST::Rvalue* expr, AST::SQLSources const &sources)
{
        VariableUseFinder finder;
        finder.Execute(expr, sources, 0);
        return !finder.used.empty();
}

void SQLTranslator::SplitWhere(Rvalue* where, std::list<WhereElement> &andedelements, SQLSources const &sources)
{
        // decomposes the where into minimal elements (gather children of all &&, and ?: with constant condition)
        /* This is a lists of where-condition, precondition for that condition
           'a && ( x ? b : c)' is represented as [(a,0), (b, x), (c, NOT(x))] */
        std::stack< std::pair<Rvalue*, Rvalue*> > worklist;
        VariableUseFinder finder;

        andedelements.clear();

        if (where)
            worklist.push(std::make_pair(where, (Rvalue*)NULL));

        while (!worklist.empty())
        {
                std::pair<Rvalue*, Rvalue*> elt = worklist.top();
                worklist.pop();

                ConditionalOperator* condop = dynamic_cast<ConditionalOperator*>(elt.first);
                if (condop)
                {
                        // Gather list of all used subst variables in the condition. Empty => expression is constant within loop
                        finder.Execute(condop->condition, sources, 0);
                        if (!finder.used.empty())
                        {
                                finder.Execute(elt.first, sources, 0);
                                WhereElement e;
                                e.cond = elt.second;
                                e.expr = elt.first;
                                e.used = finder.used;
                                andedelements.push_back(e);
                        }
                        else
                        {
                                TreeCopyingVisitor copier(context);
                                // Use the original and a copy (to avoid reuse)

                                Rvalue* cond_true = !elt.second ? condop->condition :
                                        coder->ImBinaryOperator(condop->position,
                                                BinaryOperatorType::OpAnd,
                                                elt.second,
                                                condop->condition);

                                Rvalue* not_cond = coder->ImUnaryOperator(condop->position,
                                                        UnaryOperatorType::OpNot,
                                                        copier.GetCopy(condop->condition));
                                Rvalue* cond_false = !elt.second ? not_cond :
                                        coder->ImBinaryOperator(condop->position,
                                                BinaryOperatorType::OpAnd,
                                                copier.GetCopy(elt.second),
                                                not_cond);

                                worklist.push(std::make_pair(condop->expr_false, cond_false));
                                worklist.push(std::make_pair(condop->expr_true, cond_true));
                        }
                }
                else
                {
                        BinaryOperator* bop = dynamic_cast<BinaryOperator*>(elt.first);
                        bool is_processed(false);
                        if (bop)
                        {
                                if (bop->operation == BinaryOperatorType::OpAnd)
                                {
                                        worklist.push(std::make_pair(bop->rhs, elt.second));
                                        worklist.push(std::make_pair(bop->lhs, elt.second));

                                        is_processed = true;
                                }
                                else if (bop->operation == BinaryOperatorType::OpOr)
                                {
                                        bool can_optimize = !IsDependent(bop->lhs, sources);
                                        if (!can_optimize)
                                        {
                                                can_optimize = !IsDependent(bop->rhs, sources);
                                                if (can_optimize)
                                                    std::swap(bop->lhs, bop->rhs);
                                        }
                                        if (can_optimize)
                                        {
                                                Rvalue* not_cond = coder->ImUnaryOperator(bop->position,
                                                        UnaryOperatorType::OpNot,
                                                        bop->lhs);
                                                Rvalue* and_cond = !elt.second ? not_cond :
                                                        coder->ImBinaryOperator(bop->position,
                                                                BinaryOperatorType::OpAnd,
                                                                elt.second,
                                                                not_cond);

                                                worklist.push(std::make_pair(bop->rhs, and_cond));
                                                is_processed = true;
                                        }
                                }
                        }
                        if (!is_processed)
                        {
                                finder.Execute(elt.first, sources, 0);
                                WhereElement e;
                                e.cond = elt.second;
                                e.expr = elt.first;
                                e.used = finder.used;
                                andedelements.push_back(e);
                        }
                }

        }
}
/*
void SQLTranslator::DecomposeResult::CreateSourcesList(SQLSources const &origsources, TypeStorage &typestorage)
{
        for (std::vector<SQLSource*>::const_iterator it = origsources.sources.begin(); it != origsources.sources.end(); ++it)
        {
                if (typestorage[(*it)->expression] == VariableTypes::Table)
                    db_sources.push_back(*it);
                else // Record array
                    expr_sources.push_back(*it);

                sources.push_back(*it);
        }
}


bool SQLTranslator::DecomposeResult::ConvertToDBCondition(WhereElement &where_element, SQLSources const &sources, std::map<Symbol *, SQLSource *> const &subst_map, bool &ignored)
{
        ignored = false;
        // Check for TRUE
        {
                Constant *co = dynamic_cast< Constant * >(where_element.expr);
                if (co && co->type == VariableTypes::Boolean)
                {
                        if (translator.context.stackm.GetBoolean(co->var) == true)
                        {
                                ignored = true;
                                return true;
                        }
                }
        }

        // Check for [NOT] [CAST->BOOLEAN] rec.col
        {
                Rvalue *current = where_element.expr;
                bool got_not = false;
                UnaryOperator *uo = dynamic_cast< UnaryOperator * >(current);
                if (uo)
                {
                        if (uo->operation != UnaryOperatorType::OpNot)
                            current = 0;
                        else
                        {
                                current = uo->lhs;
                                got_not = true;
                        }
                }

                Cast *cast = dynamic_cast<Cast *>(current);
                if (cast && cast->to_type == VariableTypes::Boolean)
                    current = cast->expr;

                SourceColumn lhs;
                translator.TryTableColumn(current, lhs, sources, subst_map);

                if (lhs.is_sc) // Left is subst.column?
                {
                        DBSingleCondition cond;
                        cond.precondition = where_element.cond;
                        cond.source = lhs.source;
                        cond.columnname = lhs.columnname;
                        cond.value = translator.coder->ImConstantBoolean(where_element.expr->position, !got_not);
                        cond.condition = DBConditionCode::Equal;
                        cond.hs_condition = BinaryOperatorType::OpEqual;
                        cond.casesensitive = !lhs.has_touppercase;
                        cond.expr = where_element.expr;

                        directives.push_back(cond);
                        return true;
                }
        }

        //Check for binary operators
        BinaryOperator *bop = dynamic_cast<BinaryOperator *>(where_element.expr);
        if (!bop)
            return false;

        std::pair<bool, DBConditionCode::_type> valid_condition = IsCondition(bop->operation);
        if (!valid_condition.first)
            return false;
        if (valid_condition.second == DBConditionCode::In)
        {
                // Only accept integer arrays for an IN.
                if (translator.typestorage[bop->rhs] != VariableTypes::IntegerArray)
                    return false;
        }

        SourceColumn lhs;
        SourceColumn rhs;

        // Get the table column-stuff
        translator.TryTableColumn(bop->lhs, lhs, sources, subst_map);
        translator.TryTableColumn(bop->rhs, rhs, sources, subst_map);

        Rvalue *rhsexpr = bop->rhs;

        if (!lhs.is_sc) // Left is not subst.column?
        {
                if (!rhs.is_sc) // Right is not subst.column?
                    return false; // Can't optimize

                std::pair<bool, DBConditionCode::_type> swapped = SwappedCondition(valid_condition.second);
                if (!swapped.first)
                    return false; // Can't swap

                // This one is of type "value op subst.column". Swap!
                std::swap(lhs, rhs);
                valid_condition.second = swapped.second;
                rhsexpr = bop->lhs;
        }
        else
            if (rhs.is_sc)
            {
                    // Joins require touppercase on both sides.
                    if (lhs.has_touppercase != rhs.has_touppercase)
                        return false;

                    // this is a relation (aka join)
                    DBRelationCondition cond;
                    cond.precondition = where_element.cond;
                    cond.source1 = lhs.source;
                    cond.columnname1 = lhs.columnname;
                    cond.source2 = rhs.source;
                    cond.columnname2 = rhs.columnname;
                    cond.condition = valid_condition.second;
                    cond.hs_condition = GetHSConditionFromDBCondition(valid_condition.second);
                    cond.casesensitive = !lhs.has_touppercase;
                    cond.expr = where_element.expr;

                    relations.push_back(cond);
                    return true;
            }

        //Is the RHS dependent?
        VariableUseFinder finder;
        finder.Execute(rhsexpr, sources); // Mind a possible switch!

        if (!finder.used.empty())
            return false; //a dependent RHS is not constant and cannot be optimized

        if (lhs.has_touppercase)
        {
                Constant *rhs_constant = dynamic_cast<Constant *>(rhs.expr);
                if (rhs_constant && rhs_constant->type == VariableTypes::String)
                {
                        Blex::StringPair str = context.stackm.GetString(rhs_constant->var);
                        rhs.has_touppercase = Blex::IsUppercase(str.begin, str.end);
                        if (!rhs.has_touppercase)
                        {
                               context.errorhandler.AddWarningAt(bop->position, Warning::ConditionAlwaysFalse);
                               return false;
                        }
                        // now, rhs is proven uppercase
                }
                if (!rhs.has_touppercase)
                {
                        // rhs is not proven uppercase. Lhs is, so using case insensitive compare is forbidden
                        // (would fail to return false if rhs was actually lower case)
                        return false;
                }
        }

//        if (lhs.has_touppercase != rhs.has_touppercase)
//            return false;

        DBSingleCondition cond;
        cond.precondition = where_element.cond;
        cond.source = lhs.source;
        cond.columnname = lhs.columnname;
        cond.value = rhs.expr;
        cond.condition = valid_condition.second;
        cond.hs_condition = GetHSConditionFromDBCondition(valid_condition.second);
        cond.casesensitive = !lhs.has_touppercase;
        cond.expr = where_element.expr;

        directives.push_back(cond);
        return true;
}
*/
SQLTranslator::TreeDecomposeResult SQLTranslator::DecomposeWhere(Rvalue* oldwhere, SQLSources &sources)
{
//        DecomposeResult result(*this, context);

        // Check for an independent where
        if (oldwhere)
        {
                VariableUseFinder finder;
                finder.Execute(oldwhere, sources, 0);
                if (finder.used.empty())
                    context.errorhandler.AddErrorAt(oldwhere->position, Error::IndependentWhere);
        }

        // Stage 1: find all subst-variables from tables and from expressions
//        result.CreateSourcesList(sources, typestorage);

        // Create the subst map
//        std::map<Symbol *, SQLSource *> subst_map;
//        for (std::vector<SQLSource *>::const_iterator it = result.sources.begin(); it != result.sources.end(); ++it)
//            subst_map[(*it)->symbol] = *it;

        TreeDecomposeResult treeresult(*this, context, sources, typestorage);

        treeresult.root = treeresult.ConvertTree(oldwhere, true);
        QUERYBUILDONLY(treeresult.Dump(););

        // Insert all view expressions
        for (std::vector<SQLSource *>::const_iterator it = sources.sources.begin(); it != sources.sources.end(); ++it)
        {
                if ((*it)->symbol && (*it)->symbol->variabledef && (*it)->symbol->variabledef->substitutedef)
                {
                        SymbolDefs::TableDef &tabledef = *(*it)->symbol->variabledef->substitutedef;
                        for (SymbolDefs::TableDef::ViewColumnsDef::const_iterator cit = tabledef.viewcolumnsdef.begin(); cit != tabledef.viewcolumnsdef.end(); ++cit)
                        {
                                DBSingleCondition cond;
                                cond.precondition = 0;
                                cond.source = *it;
                                cond.columnname = cit->name;
                                cond.value = cit->view_value_expr;
                                cond.condition = DBConditionCode::Equal;
                                cond.hs_condition = BinaryOperatorType::OpEqual;
                                cond.casesensitive = true;
                                cond.expr = 0;

//                                result.directives.push_back(cond);
                                treeresult.root->directives.push_back(cond);
                        }
                }
        }

        return treeresult;
/*
        // Stage 2: decompose the where into minimal elements (gather children of all &&, and ?: with constant condition)
        std::list<WhereElement> andedelements;
        SplitWhere(oldwhere, andedelements, sources);

        // Find expressions that can be converted to DB conditions (all TABLE.col = EXPR and EXPR = TABLE.col)
        std::list<WhereElement>::iterator it = andedelements.begin();
        while (it != andedelements.end())
        {
                bool ignored;
                if (result.ConvertToDBCondition(*it,sources,subst_map, ignored)) //succesfully removed the condition
                    it = andedelements.erase(it);
                else
                {
                        LineColumn rejpos = it->expr->position;
                        ++it;
                        if (it != andedelements.end())
                        {
                                // Try to convert the rest of the thingies. Do it in a dummy decomposeresult, so our original won't be filled with the db-conditions
                                DecomposeResult result2(*this, context);
                                result2.CreateSourcesList(sources, typestorage);

                                bool found_opt = false;
                                LineColumn pos;
                                while (it != andedelements.end())
                                {
                                        if (result2.ConvertToDBCondition(*it,sources,subst_map, ignored) && !found_opt && !ignored)
                                        {
                                                found_opt = true;
                                                pos = it->expr->position;
                                        }
                                        ++it;
                                }

                                // FIXME: now adding error to quickly identify all places this is used
                                if (found_opt)
                                    context.errorhandler.AddWarningAt(rejpos, Warning::PartlyUnoptimizedWhere);
                                break;
                        }
                }
        }

        result.rest_conditions.clear();
        for (std::list<WhereElement>::iterator it = andedelements.begin(); it != andedelements.end(); ++it)
        {
                Rvalue* expr;
                if (it->cond)
                    expr = coder->ImConditionalOperator(it->expr->position,
                                    it->cond,
                                    it->expr,
                                    coder->ImConstantBoolean(it->expr->position, true));
                else
                    expr = it->expr;

                result.rest_conditions.push_back(expr);
        }

        return result;

        / *  Results:

            *table sources
            *record array sources

            *single condition (directives)
            *join-conditions (relations)
            *other conditions */
}

Rvalue* SQLTranslator::CreateTempFromExpression(LineColumn pos, Rvalue* expr, Rvalue *conditional)
{
        Symbol *symbol = context.symboltable->RegisterDeclaredVariable(pos, NULL, false, false, typestorage[expr]);

        if (conditional)
        {
                // If possibly not used, default-initialize the symbol, to avoid strictness errors
                if (symbol->variabledef->type != VariableTypes::Variant)
                    coder->CodeInitialize(symbol);
                else
                {
                        // Cannot default-initialize a variant, fill it with a record.
                        VarId var = context.stackm.NewHeapVariable();
                        context.stackm.RecordInitializeNull(var);
                        coder->ImExecute(pos,
                                coder->ImAssignment(pos,
                                        coder->ImVariable(pos, symbol),
                                        coder->ImConstant(pos, var)));
                }
                coder->ImIf_Open(pos, conditional);
        }

        coder->ImExecute(pos,
                coder->ImAssignment(pos,
                        coder->ImVariable(pos, symbol),
                        expr));

        if (conditional)
            coder->ImIf_Close(pos);

        return coder->ImVariable(pos, symbol);
}

void SQLTranslator::ConvertSchemaTableToTable(AST::SQLSource &source)
{
        SchemaTable *schema_table = dynamic_cast< SchemaTable * >(source.expression);
        if (!schema_table)
            return;

        LineColumn pos = source.expression->position;

        Symbol *token = context.symboltable->RegisterDeclaredVariable (pos, 0, false, false, VariableTypes::Table);

        SymbolDefs::SchemaDef const &schemadef = schema_table->schema->symbol->variabledef->schemadef;
        for (SymbolDefs::SchemaDef::TablesDef::const_iterator it = schemadef.tablesdef.begin(); it != schemadef.tablesdef.end(); ++it)
        {
                if (Blex::StrCaseCompare(it->name, schema_table->name) == 0)
                    token->variabledef->tabledef = it->tabledef;
        }

        coder->ImExecute(pos,
                coder->ImAssignment(pos,
                        coder->ImVariable(pos, token),
                        source.expression));

        source.expression = coder->ImVariable(pos, token);
}

/*
unsigned SQLTranslator::GetTableNr(DecomposeResult const &dr, SQLSource *source)
{
        std::vector<SQLSource *>::const_iterator it =
                std::find(dr.db_sources.begin(), dr.db_sources.end(), source);

        if (it != dr.db_sources.end())
            return std::distance(dr.db_sources.begin(), it);

        it = std::find(dr.expr_sources.begin(), dr.expr_sources.end(), source);
        if (it != dr.expr_sources.end())
            return dr.db_sources.size() + std::distance(dr.expr_sources.begin(), it);

        throw Message(true, Error::InternalError, "Referenced not existing sql data source");
}*/

unsigned SQLTranslator::GetTableNr(TreeDecomposeResult const &dr, SQLSource *source)
{
        std::vector<SQLSource *>::const_iterator it =
                std::find(dr.db_sources.begin(), dr.db_sources.end(), source);

        if (it != dr.db_sources.end())
            return std::distance(dr.db_sources.begin(), it);

        it = std::find(dr.expr_sources.begin(), dr.expr_sources.end(), source);
        if (it != dr.expr_sources.end())
            return dr.db_sources.size() + std::distance(dr.expr_sources.begin(), it);

        throw Message(true, Error::InternalError, "Referenced not existing sql data source");
}

bool SQLTranslator::TryTableColumn(AST::Rvalue *expr, SourceColumn &data, SQLSources const &sources, SubstMap const &subst_map)
{
        data.expr = expr;
        data.has_touppercase = false;

        FunctionCall *fc = dynamic_cast<FunctionCall *>(expr);
        if (fc)
        {
                if (fc->symbol->name == "TOUPPERCASE")
                {
                        data.has_touppercase = true;
                        if (fc->parameters.empty())
                            throw std::logic_error("Semantic check on touppercase failed");

                        expr = fc->parameters[0];
                }
        }

        // Detect and skip a cast
        Cast *cast = dynamic_cast<Cast *>(expr);
        data.has_cast = cast;
        if (cast)
            expr = cast->expr;

        RecordColumnConst *rc = dynamic_cast<RecordColumnConst *>(expr);
        if (rc)
        {
                Variable *var = dynamic_cast<Variable *>(rc->record);
                if (var && sources.IsASource(var->symbol)) //not a dependent symbol
                {
                        if (subst_map.find(var->symbol) == subst_map.end())
                                std::cout << "Error finding " << var->symbol << " in " << subst_map << std::endl;

                        data.source = subst_map.find(var->symbol)->second;
                        data.columnname = rc->name;
                        data.is_sc = true;
                        return true;
                }
        }

        data.is_sc = false;
        return false;
}
/* Simple query code. Only handles SELECT, no limit support, no dbase single/relation conditions, etc.
   Running them through a single FOREVERY can be up to 3x faster.
   ADDME: limit support?
*/
SQLTranslator::SelectQuery SQLTranslator::BuildSimpleRecArrQueryFinal(
        const LineColumn &pos,
        TreeDecomposeResult &dr)
{
        SelectQuery retval;
        retval.cursorhandle = 0;

        // Get the block we return
        retval.result_build = Adopt(new Block(pos));
        AST::Block* loop_block = Adopt(new Block(pos));

        Rvalue *source = dr.expr_sources[0]->expression;
        Symbol *substvar = dr.expr_sources[0]->symbol;

        AST::Variable* iterator_var = coder->ImVariable(pos, substvar);
        AST::Variable* position_var = coder->ImVariable(pos, substvar->variabledef->countersymbol);

        coder->ImForEvery(pos, iterator_var, source, loop_block, position_var);

        coder->ImOpenBlock(loop_block);

        // Mop up remaining conditions. Doing them here has the same cost as through sqllib path
        Rvalue *cond = dr.GetRestWhere(pos, coder, dr.root.get());
        bool has_hs_code = bool(cond);
        if (cond)
        {
                Constant* where_constant = carim.Optimize(cond);
                has_hs_code = !where_constant || !context.stackm.GetBoolean(where_constant->var);
        }

        if (has_hs_code)
        {
                carim.Optimize(cond);
                coder->ImIf_Open(pos, cond);
        }

        coder->DoCodeBlock(retval.result_build);

        if (has_hs_code)
            coder->ImIf_Close(pos);

        coder->ImCloseBlock();

        return retval;
}

/*  Final query-code. This code is generic enough to be used by all code that needs
    to cursor through results */
SQLTranslator::SelectQuery SQLTranslator::BuildCursoringQueryFinal(
        const LineColumn &pos,
        TreeDecomposeResult &dr,
        Rvalue* limit,
        unsigned query_type_id,
        bool need_fase2_records,
        SQLDataModifier *update_cols,
        Variable* result_array_assign)
{
        if (!limit                            // Don't handle limit
            && query_type_id == 0               // Only handle SELECT
            && dr.db_sources.empty()            // Don't handle DB sources
            && dr.expr_sources.size() == 1      // Handle only 1 expression source
            && !update_cols                     // Can't update
            && !result_array_assign             // Can't update
            && !dr.HaveDBConditions())          // Can't evaluate directives & relations (faster through sqllib path)
        {
                return BuildSimpleRecArrQueryFinal(pos, dr);
        }

        SelectQuery retval;

        // Get the block we return
        retval.result_build = Adopt(new Block(pos));

        // Get a variable for the handle
        Symbol *handle = context.symboltable->RegisterDeclaredVariable(pos, NULL, false, false, VariableTypes::Integer);
        coder->CodeInitialize(handle);
        retval.cursorhandle = handle;

        // Return value is now usable

//        Symbol *f_cleardata = context.symboltable->RetrieveExternalFunction(pos, "__HS_SQL_CLEARQUERYDATA");
//        Symbol *f_setlimit = context.symboltable->RetrieveExternalFunction(pos, "__HS_SQL_SETLIMIT");
//        Symbol *f_addsourcetable = context.symboltable->RetrieveExternalFunction(pos, "__HS_SQL_ADDSOURCETABLE");
//        Symbol *f_addsourceexpression = context.symboltable->RetrieveExternalFunction(pos, "__HS_SQL_ADDSOURCEEXPRESSION");
//        Symbol *f_addsinglecondition = context.symboltable->RetrieveExternalFunction(pos, "__HS_SQL_ADDCONDITIONSINGLE");
//        Symbol *f_addrelationcondition = context.symboltable->RetrieveExternalFunction(pos, "__HS_SQL_ADDCONDITIONRELATION");
//        Symbol *f_opencursor = context.symboltable->RetrieveExternalFunction(pos, "__HS_SQL_OPENCURSOR");
        Symbol *f_opencursor2 = context.symboltable->RetrieveExternalFunction(pos, "__HS_SQL_OPENCURSOR2");
        Symbol *f_getaction = context.symboltable->RetrieveExternalFunction(pos, "__HS_SQL_GETACTION");
        Symbol *f_getrecaction = context.symboltable->RetrieveExternalFunction(pos, "__HS_SQL_GETRECACTION");
        Symbol *f_reportwhereresult = context.symboltable->RetrieveExternalFunction(pos, "__HS_SQL_REPORTWHERERESULT");
        Symbol *f_getrecord_fase1 = context.symboltable->RetrieveExternalFunction(pos, "__HS_SQL_GETRECORDFASE1");
        Symbol *f_getrecord_fase2 = context.symboltable->RetrieveExternalFunction(pos, "__HS_SQL_GETRECORDFASE2");
        Symbol *f_getrecordarrayposition = context.symboltable->RetrieveExternalFunction(pos, "__HS_SQL_GETRECORDARRAYPOSITION");
        Symbol *f_closequery = context.symboltable->RetrieveExternalFunction(pos, "__HS_SQL_CLOSEQUERY");
        Symbol *f_getarrayresults = context.symboltable->RetrieveExternalFunction(pos, "__HS_SQL_GETARRAYRESULTS");

        Symbol *f_getsourcesbaselist = context.symboltable->RetrieveExternalFunction(pos, "__HS_SQL_GETSOURCESBASELIST");
        Symbol *f_addtablesource = context.symboltable->RetrieveExternalFunction(pos, "__HS_SQL_ADDTABLESOURCE");
        Symbol *f_addrecordarraysource = context.symboltable->RetrieveExternalFunction(pos, "__HS_SQL_ADDRECORDARRAYSOURCE");

        RvaluePtrs parameters;

        std::map<Rvalue*, Rvalue*> temporary;
        bool has_db_sources = !dr.db_sources.empty();

        // First: create specific table variables for schema.table things
        for (std::vector<SQLSource *>::iterator it = dr.db_sources.begin(); it != dr.db_sources.end(); ++it)
            ConvertSchemaTableToTable(**it);

        // Create the typeinfos
        for (std::vector<SQLSource *>::const_iterator it = dr.db_sources.begin(); it != dr.db_sources.end(); ++it)
        {
                Variable *var = dynamic_cast<Variable *>((*it)->expression);
                SchemaTable *st;
                if (!var)
                {
                        st = dynamic_cast< SchemaTable * >((*it)->expression);
                        if (!st)
                        {
                                context.errorhandler.AddErrorAt((*it)->expression->position, Error::FunctionAsTableSource);
                                return retval;
                        }
                        throw std::runtime_error("Expected a schematable element");
                }
                Symbol *symbol = var->symbol;

                (*it)->typeinfo = coder->ImTypeInfo((*it)->position, symbol, 0, true);
        }

        for (std::vector<SQLSource *>::const_iterator it = dr.expr_sources.begin(); it != dr.expr_sources.end(); ++it)
        {
                TypeInfo *typeinfo = coder->ImTypeInfo((*it)->position, 0, 0, true);
                typeinfo->typeinfo->type = VariableTypes::RecordArray;

                (*it)->typeinfo = typeinfo;
        }

        // Create the options record, with the conditions, limits, etc.
        AST::ConstantRecord *crec = coder->ImConstantRecord(pos);
        AST::Rvalue *conditions = dr.GetConditions(pos, coder, dr.root.get());
        crec->columns.push_back(std::make_tuple(AST::ConstantRecord::Item, "CONDITIONS", conditions));

        if (limit)
            crec->columns.push_back(std::make_tuple(AST::ConstantRecord::Item, "LIMIT", limit));

        Rvalue *cond = dr.GetRestWhere(pos, coder, dr.root.get());
        bool has_hs_code = bool(cond);
        if (cond)
        {
                Constant* where_constant = carim.Optimize(cond);
                has_hs_code = !where_constant || !context.stackm.GetBoolean(where_constant->var);
        }
        crec->columns.push_back(std::make_tuple(AST::ConstantRecord::Item, "HAS_HS_CODE", coder->ImConstantBoolean(pos, has_hs_code)));


        if (update_cols && !dr.db_sources.empty())
        {
                Variable *var = dynamic_cast<Variable *>(dr.db_sources[0]->expression);
                Symbol *symbol = var ? var->symbol : 0;
                if (symbol)
                {
                        TypeInfo *typeinfo = dr.db_sources[0]->typeinfo;
                        for (unsigned idx = 0; idx < update_cols->columns.size(); ++idx)
                        {
                                if (update_cols->columns[idx].empty())
                                {
                                        crec->columns.push_back(std::make_tuple(AST::ConstantRecord::Item, "UPDATECOLUMNLIST", update_cols->values[0]));
                                        /* FIXME: This was a quick hack, but we should avoid double execution of the record evaluation
                                                  (I think we're evaluating it in this call and the previous call now!) * /
                                        Symbol *f_setcolumnlist = context.symboltable->RetrieveExternalFunction(pos, "__HS_SQL_SETUPDATECOLUMNLIST");
                                        //Emit a dynamic UPDATE flagger and give it our record with updates
                                        parameters.clear();
                                        parameters.push_back(update_cols->values[0]);
                                        coder->ImExecute(pos, coder->ImFunctionCall(pos, f_setcolumnlist, parameters));*/
                                        break;
                                }
                                else
                                {
        //                                AddFlagToTypeInfo(typeinfo, update_cols->columns[idx], ColumnFlags::InternalUpdates);
                                        unsigned colidx = FindColumnInTypeInfo(typeinfo, update_cols->columns[idx], typeinfo->typeinfo->type == VariableTypes::RecordArray);
                                        typeinfo->typeinfo->columnsdef[colidx].flags |= ColumnFlags::InternalUpdates;

                                        if (typeinfo->typeinfo->columnsdef[colidx].flags & ColumnFlags::ReadOnly)
                                            context.errorhandler.AddErrorAt(update_cols->position, Error::WriteToReadonlyColumn, update_cols->columns[idx]);
                                }
                        }
                }
        }

        crec->columns.push_back(std::make_tuple(AST::ConstantRecord::Item, "QUERYTYPE", coder->ImConstantInteger(pos, query_type_id)));

        Rvalue *opt_crec = crec;
        carim.Optimize(opt_crec);

        // First calc the crec, THEN the sources - so the sources are in the same BB as the call to opencursor
        Symbol *var_crec = context.symboltable->RegisterDeclaredVariable(pos, NULL, false, false, VariableTypes::Record);
        coder->ImExecute(pos,
                coder->ImAssignment(pos,
                        coder->ImVariable(pos, var_crec),
                        opt_crec));

        Symbol *var_sources = context.symboltable->RegisterDeclaredVariable(pos, NULL, false, false, VariableTypes::RecordArray);

        parameters.clear();
        coder->ImExecute(pos,
                coder->ImAssignment(pos,
                        coder->ImVariable(pos, var_sources),
                        coder->ImFunctionCall(pos, f_getsourcesbaselist, parameters)));

        for (std::vector<SQLSource *>::const_iterator it = dr.db_sources.begin(); it != dr.db_sources.end(); ++it)
        {

                parameters.clear();
                parameters.push_back(coder->ImVariable(pos, var_sources));
                parameters.push_back((*it)->expression);
                parameters.push_back((*it)->typeinfo);
                coder->ImExecute(pos,
                    coder->ImAssignment(pos,
                        coder->ImVariable(pos, var_sources),
                        coder->ImFunctionCall(pos, f_addtablesource, parameters)));
        }

        for (std::vector<SQLSource *>::const_iterator it = dr.expr_sources.begin(); it != dr.expr_sources.end(); ++it)
        {
                // Cast the expression here, don't want addrecordarraysource mentioned when the auto-parameter cast goes wrong.
                parameters.clear();
                parameters.push_back(coder->ImVariable(pos, var_sources));
                parameters.push_back(coder->ImCast(
                    (*it)->expression->position,
                    (*it)->expression,
                    VariableTypes::RecordArray,
                    false,
                    false));
                parameters.push_back((*it)->typeinfo);
                coder->ImExecute(pos,
                        coder->ImAssignment(pos,
                                coder->ImVariable(pos, var_sources),
                                coder->ImFunctionCall(pos, f_addrecordarraysource, parameters)));
        }

        // handle := OpenCursor(sources, crec);

        parameters.clear();
        parameters.push_back(coder->ImVariable(pos, var_sources));
        parameters.push_back(coder->ImVariable(pos, var_crec));
        coder->ImExecute(pos,
                coder->ImAssignment(pos,
                        coder->ImVariable(pos, handle),
                        coder->ImFunctionCall(pos, f_opencursor2, parameters)));

        // Execute the loop within a try-catch - upon exception we need to close the query
        // WHDB doesn't like to close work when there are still queries open.
        TryCatchStatement *trycatch = coder->ImTryCatch(pos);
        coder->ImOpenBlock(trycatch->tryblock);

        // WHILE (true);
        // {
        coder->ImFor_Open(pos, 0, 0);

        // INTEGER action := __HS_SQL_GetAction(handle);
        parameters.clear();
        parameters.push_back(coder->ImVariable(pos, handle));
        Symbol *action = context.symboltable->RegisterDeclaredVariable(pos, NULL, false, false, VariableTypes::Integer);
        coder->ImExecute(pos,
                coder->ImAssignment(pos,
                        coder->ImVariable(pos, action),
                        coder->ImFunctionCall(pos, has_db_sources ? f_getaction : f_getrecaction, parameters)));

        if (cond) // Only if fase1 action is needed
        {
                QUERYBUILDPRINT("Has rest where expression, emitting fase1");

                // IF (action = 0)
                //{
                coder->ImIf_Open(pos,
                        coder->ImBinaryOperator(pos,
                                BinaryOperatorType::OpEqual,
                                coder->ImVariable(pos, action),
                                coder->ImConstantInteger(pos, 0)));

                // SubstituteDef_x = GetRecord_fase1(handle, x)
                for (std::vector<SQLSource *>::const_iterator it = dr.sources.sources.begin(); it != dr.sources.sources.end(); ++it)
                {
                        parameters.clear();
                        parameters.push_back(coder->ImVariable(pos, handle));
                        parameters.push_back(coder->ImConstantInteger(pos, GetTableNr(dr, *it)));
                        coder->ImExecute(pos,
                                coder->ImAssignment(pos,
                                        coder->ImVariable(pos, (*it)->symbol),
                                        coder->ImFunctionCall(pos, f_getrecord_fase1, parameters)));

                        if ((*it)->symbol->variabledef->countersymbol)
                        {
                                parameters.clear();
                                parameters.push_back(coder->ImVariable(pos, handle));
                                parameters.push_back(coder->ImConstantInteger(pos, GetTableNr(dr, *it)));

                                coder->ImExecute(pos,
                                        coder->ImAssignment(pos,
                                                coder->ImVariable(pos, (*it)->symbol->variabledef->countersymbol),
                                                coder->ImFunctionCall(pos, f_getrecordarrayposition, parameters)));
                        }
                }

                parameters.clear();
                parameters.push_back(coder->ImVariable(pos, handle));
                parameters.push_back(cond);
                coder->ImExecute(pos,
                        coder->ImFunctionCall(pos, f_reportwhereresult, parameters));

                // } else {
                coder->ImIf_Else(pos);
        }
        else
        {
                QUERYBUILDPRINT("Has no where rest expression, not emitting fase1");

        }

        // if (action = 1)
        // {
        coder->ImIf_Open(pos,
                coder->ImBinaryOperator(pos,
                        BinaryOperatorType::OpEqual,
                        coder->ImVariable(pos, action),
                        coder->ImConstantInteger(pos, 1)));

        if (need_fase2_records)
        {
                // Compute result
                // SubstituteDef_x = GetRecord_fase2(handle, x)
                for (std::vector<SQLSource *>::const_iterator it = dr.sources.sources.begin(); it != dr.sources.sources.end(); ++it)
                {
                        parameters.clear();
                        parameters.push_back(coder->ImVariable(pos, handle));
                        parameters.push_back(coder->ImConstantInteger(pos, GetTableNr(dr, *it)));
                        coder->ImExecute(pos,
                                coder->ImAssignment(pos,
                                        coder->ImVariable(pos, (*it)->symbol),
                                        coder->ImFunctionCall(pos, f_getrecord_fase2, parameters)));

                    if ((*it)->symbol->variabledef->countersymbol)
                    {
                            parameters.clear();
                            parameters.push_back(coder->ImVariable(pos, handle));
                            parameters.push_back(coder->ImConstantInteger(pos, GetTableNr(dr, *it)));

                            coder->ImExecute(pos,
                                    coder->ImAssignment(pos,
                                            coder->ImVariable(pos, (*it)->symbol->variabledef->countersymbol),
                                            coder->ImFunctionCall(pos, f_getrecordarrayposition, parameters)));
                    }
                }
        }

        // Code block with final db results
        coder->DoCodeBlock(retval.result_build);

        // } else {
        coder->ImIf_Else(pos);
        //
        // Stop with loop
        coder->ImBreak(pos);
        // }
        coder->ImIf_Close(pos);

        if (cond) // Only if fase1 action is needed
        {
                // }
                coder->ImIf_Close(pos);
        }

        coder->ImFor_Close(pos);
        // }

        coder->ImCloseBlock();

        // On exception we just need to close the query and rethrow
        coder->ImOpenBlock(trycatch->catchblock);

        parameters.clear();
        parameters.push_back(coder->ImVariable(pos, handle));
        coder->ImExecute(pos,
                coder->ImFunctionCall(pos, f_closequery, parameters));

        coder->ImThrow(pos, coder->ImGetThrowVariable(pos), true);

        coder->ImCloseBlock();

        // Normal exit. For record array updates/deletes, assign the updated record array back to the source
        if (result_array_assign)
        {
                parameters.clear();
                parameters.push_back(coder->ImVariable(pos, handle));

                coder->ImExecute(pos,
                        coder->ImAssignment(pos,
                                result_array_assign,
                                coder->ImFunctionCall(pos, f_getarrayresults, parameters)));
        }

        parameters.clear();
        parameters.push_back(coder->ImVariable(pos, handle));
        coder->ImExecute(pos,
                coder->ImFunctionCall(pos, f_closequery, parameters));



        return retval;
}

//------------------------------------------------------------------------------
//--
//-- Queries/updates/inserts/deletes
//--

/* Arnold: Dealing with SQL update/delete:

   Some database implementations require the ability to re-test the WHERE clause
   on a given record. Being able to pass a function to the SQL Delete would be
   the nicest solution, but I'm not sure whether that's doable...

   To support UPDATE/DELETE on external ODBC data, we will demand the user to
   tell us the primary keys for every table. Then we can use that as a criteria
   for delete.

   The UPDATE/DELETE functions may require us to re-test the complete WHERE
   query. To support this, we will generate code similair to the following:

   currecord := __HS_SQL_CURSOR_DELETE(cursorid);
   IF (RecordExists(currecord) AND StillMatchesWhere(currecord))
     __HS_SQL_CURSOR_DELETERETRY(cursorid, currecord);

 */

void SQLTranslator::V_SQLDelete(SQLDelete *obj, Empty)
{
        if (obj->location.type == ArrayLocation::Where)
            Visit(obj->location.expr, Empty());

        Block *block = Adopt(new Block(obj->position));
        ReplacePtr(block);

        Symbol *f_deleterecord = context.symboltable->RetrieveExternalFunction(obj->position, "__HS_SQL_DELETERECORD");

        coder->ImOpenBlock(block);

        SQLSources sources(obj->sources->position);
        sources.sources.push_back(obj->sources);

        TreeDecomposeResult dr = DecomposeWhere(obj->location.expr, sources);

        SQLTranslator::SelectQuery query = BuildCursoringQueryFinal(
                obj->position,
                dr,
                /*limit=*/0,
                /*query_type_id=*/1,
                /*need_fase2_records*/false,
                /*update_cols*/0,
                obj->sources->reassign);

        coder->ImOpenBlock(query.result_build);

        RvaluePtrs parameters;
        parameters.push_back(coder->ImVariable(obj->sources->position, query.cursorhandle));
        coder->ImExecute(obj->position,
                coder->ImFunctionCall(obj->position, f_deleterecord, parameters));

        coder->ImCloseBlock();
        coder->ImCloseBlock();
}

void SQLTranslator::V_SQLInsert(SQLInsert *obj, Empty)
{
        Block *block = Adopt(new Block(obj->position));
        ReplacePtr(block);

        coder->ImOpenBlock(block);

//        datamodifierrecord = obj->source->symbol;
        datamodifierrecord = context.symboltable->RegisterDeclaredVariable(obj->position, NULL, false, false, VariableTypes::Record);

        //ADDME: Onderscheid tussen TABLE en RECORD ARRAY maken op basis van 'AT' lijkt me niet gezond?
        if (obj->location.type != ArrayLocation::Missing)
        {
                Visit(obj->modifier, Empty());

                coder->ImArrayInsert(obj->position,
                        obj->source->reassign,
                        obj->location,
                        coder->ImVariable(obj->source->position, datamodifierrecord));
        }
        else
        {
                Symbol *f_insert = context.symboltable->RetrieveExternalFunction(obj->position, "__HS_SQL_INSERT");

//                TreeDecomposeResult dr(*this, context, typestorage);

                RvaluePtrs parameters;
                parameters.push_back(obj->source->expression);

                Symbol *type_symbol(0);

                Variable *var = dynamic_cast<Variable *>(obj->source->expression);
                if (var)
                    type_symbol = var->symbol;

                SchemaTable *st = dynamic_cast< SchemaTable * >(obj->source->expression);
                if (st)
                {
                        // Register a temporary variable with good typeinfo
                        type_symbol = context.symboltable->RegisterDeclaredVariable(obj->position, 0, false, false, VariableTypes::Table);

                        SymbolDefs::SchemaDef &schemadef = st->schema->symbol->variabledef->schemadef;
                        for (SymbolDefs::SchemaDef::TablesDef::iterator it = schemadef.tablesdef.begin(); it != schemadef.tablesdef.end(); ++it)
                            if (it->name == st->name)
                                type_symbol->variabledef->tabledef = it->tabledef;
                }
//                Variable *var = dynamic_cast<Variable *>(obj->source->expression);
                bool dynamic_insert = false;
                if (type_symbol)
                {
                        TypeInfo* typeinfo = coder->ImTypeInfo(obj->position, type_symbol, 0, true);
                        parameters.push_back(typeinfo);

                        dynamic_insert = obj->modifier->columns.size() == 1 && obj->modifier->columns[0].empty();

                        for (unsigned idx = 0; idx < type_symbol->variabledef->tabledef.viewcolumnsdef.size(); ++idx)
                        {
                                SymbolDefs::TableDef::ViewColumn &column = type_symbol->variabledef->tabledef.viewcolumnsdef[idx];

                                obj->modifier->columns.push_back(column.name);
                                obj->modifier->values.push_back(column.view_value_expr);
                        }

                        if (!dynamic_insert)
                        {
                                for (unsigned idx = 0; idx < obj->modifier->columns.size(); ++idx)
                                {
                                        std::string name = obj->modifier->columns[idx];
                                        Blex::ToUppercase(name.begin(), name.end());

                                        bool found = false;
                                        for (auto it = typeinfo->typeinfo->columnsdef.begin();
                                                it != typeinfo->typeinfo->columnsdef.end(); ++it)
                                            if (name == it->name)
                                            {
                                                    if (it->flags & ColumnFlags::ReadOnly)
                                                        context.errorhandler.AddErrorAt(obj->modifier->position, Error::WriteToReadonlyColumn, name);

                                                    it->flags |= ColumnFlags::InternalUpdates;
                                                    found = true;
                                                    break;
                                            }
                                        if (!found)
                                            throw Message(true, Error::InternalError, "Unknown column name slipped through semantic check");
                                }
                        }
                }
                else
                    parameters.push_back(coder->ImTypeInfo(obj->position, 0, 0, true));

                parameters.push_back(coder->ImVariable(obj->position, datamodifierrecord));
                parameters.push_back(coder->ImConstantBoolean(obj->position, dynamic_insert));

                Visit(obj->modifier, Empty());
                coder->ImExecute(obj->position,
                        coder->ImFunctionCall(obj->position, f_insert, parameters));
        }

        coder->ImCloseBlock();
}

void SQLTranslator::V_SQLUpdate(SQLUpdate *obj, Empty)
{
        if (obj->location.type == ArrayLocation::Where)
            Visit(obj->location.expr, Empty());

        Block *block = Adopt(new Block(obj->position));
        ReplacePtr(block);

        Symbol *f_updaterecord = context.symboltable->RetrieveExternalFunction(obj->position, "__HS_SQL_UPDATERECORD");

        coder->ImOpenBlock(block);

        SQLSources sources(obj->source->position);
        sources.sources.push_back(obj->source);

        TreeDecomposeResult dr = DecomposeWhere(obj->location.expr, sources);

        SQLTranslator::SelectQuery query = BuildCursoringQueryFinal(
                obj->position,
                dr,
                /*limit=*/0,
                /*query_type_id=*/2,
                /*need_fase2_records*/true,
                /*update_cols=*/obj->modifier,
                obj->source->reassign);

        coder->ImOpenBlock(query.result_build);

        datamodifierrecord = context.symboltable->RegisterDeclaredVariable(obj->source->position, NULL, false, false, VariableTypes::Record);
        Visit(obj->modifier, Empty());

        RvaluePtrs parameters;
        parameters.push_back(coder->ImVariable(obj->source->position, query.cursorhandle));
        parameters.push_back(coder->ImVariable(obj->position, datamodifierrecord));
        coder->ImExecute(obj->position,
                coder->ImFunctionCall(obj->position, f_updaterecord, parameters));

        coder->ImCloseBlock();
        coder->ImCloseBlock();
}

void SQLTranslator::V_SQLSelect(SQLSelect *obj, Empty)
{
        LineColumn pos = obj->position;

        bool check_select_finder = !obj->namedselects.empty();
        VariableUseFinder select_finder;

        if (obj->limit_expr)
            Visit(obj->limit_expr, Empty());
        Visit(obj->sources, Empty());
        if (obj->location.expr)
            Visit(obj->location.expr, Empty());
        if (obj->having_expr)
            Visit(obj->having_expr, Empty());
        for (std::vector< SQLSelect::Temporary >::iterator it = obj->temporaries.begin(); it != obj->temporaries.end(); ++it)
            Visit(it->expr, Empty());
        for (std::vector< SQLSelect::SelectItem >::iterator it = obj->namedselects.begin(); it != obj->namedselects.end(); ++it)
        {
                if (it->is_star || it->from_star)
                    check_select_finder = false;

                if (it->expr)
                {
                        Visit(it->expr, Empty());
                        select_finder.Add(it->expr, *obj->sources, obj);
                }
        }

        for (std::vector<std::pair<Rvalue *, bool> >::iterator it = obj->orderings.begin(); it != obj->orderings.end(); ++it)
            Visit(it->first, Empty());
        for (std::vector<Rvalue * >::iterator it = obj->groupings.begin(); it != obj->groupings.end(); ++it)
            Visit(*it, Empty());

        // Set limit to 1 when result type is not an array (ADDME: Even if there is a limit_expr, replace it with a Max() ? )
        if (obj->result_type != VariableTypes::Uninitialized && !(obj->result_type & VariableTypes::Array) && !obj->limit_expr)
            obj->limit_expr = coder->ImConstantInteger(pos, 1);

        if (check_select_finder && select_finder.used.empty() && !select_finder.uses_count)
            context.errorhandler.AddErrorAt(obj->position, Error::IndependentSelect);

        // Check for independent temporaries
        for (std::vector< SQLSelect::Temporary >::iterator it = obj->temporaries.begin(); it != obj->temporaries.end(); ++it)
        {
                VariableUseFinder finder;
                finder.Execute(it->expr, *obj->sources, obj);
                if (finder.used.empty() && !finder.uses_count)
                    context.errorhandler.AddErrorAt(it->assignpos, Error::IndependentTemporary);
        }

        // Check for independent order by's
        if (!obj->orderings.empty())
        {
                for (std::vector<std::pair<Rvalue*, bool> >::const_iterator it = obj->orderings.begin(); it != obj->orderings.end(); ++it)
                {
                        VariableUseFinder finder;
                        finder.Execute(it->first, *obj->sources, obj);
                        if (finder.used.empty() && !finder.uses_count && !finder.uses_function)
                            context.errorhandler.AddErrorAt(it->first->position, Error::IndependentOrderBy);
                }
        }


        Symbol *temparray;

        Block* baseblock = Adopt(new Block(obj->position));
        coder->ImOpenBlock(baseblock);

        if (!obj->is_grouped)
            temparray = V_SQLSelect_NonGrouped(obj);
        else
            temparray = V_SQLSelect_Grouped(obj);

        if (obj->has_distinct)
        {
                Symbol *f_makedistinct = context.symboltable->RetrieveExternalFunction(pos, "__HS_SQL_MAKEDISTINCT");

                RvaluePtrs parameters;
                parameters.push_back(coder->ImVariable(pos, temparray));

                coder->ImExecute(pos,
                    coder->ImAssignment(pos,
                        coder->ImVariable(pos, temparray),
                        coder->ImFunctionCall(pos, f_makedistinct, parameters)));
        }

        if (!obj->orderings.empty())
        {
                //SQL re-ordering is implemented by a C++ function, it only
                //needs to know the orderings (ascending/descending) which
                //must be passed as a parameter
                std::string orderings;
                for (std::vector<std::pair<Rvalue*, bool> >::const_iterator it = obj->orderings.begin(); it != obj->orderings.end(); ++it)
                    orderings.push_back(it->second ? 'A' : 'D');

                Symbol *f_reorder_results = context.symboltable->RetrieveExternalFunction(pos, "__HS_SQL_REORDER_RESULTS");

                //RECORD ARRAY results := __HS_SQL_REORDER_RESULTS(results, orderings)
                RvaluePtrs parameters;
                parameters.push_back(coder->ImVariable(pos, temparray));
                parameters.push_back(coder->ImConstantString(pos, orderings));

                coder->ImExecute(pos,
                    coder->ImAssignment(pos,
                        coder->ImVariable(pos, temparray),
                        coder->ImFunctionCall(pos, f_reorder_results, parameters)));
        }

        // Need after-limiting?
        if ((!obj->orderings.empty() || obj->is_grouped) && obj->limit_expr)
        {
                Symbol *f_limit_array_len = context.symboltable->RetrieveExternalFunction(pos, "ARRAYSLICE");

                RvaluePtrs parameters;
                parameters.push_back(coder->ImVariable(pos, temparray));
                parameters.push_back(coder->ImConstantInteger(pos, 0));
                parameters.push_back(coder->ImCast(
                    obj->limit_expr->position,
                    obj->limit_expr,
                    VariableTypes::Integer64,
                    false,
                    false));

                coder->ImExecute(pos,
                    coder->ImAssignment(pos,
                        coder->ImVariable(pos, temparray),
                        coder->ImFunctionCall(pos, f_limit_array_len, parameters)));
        }

        Symbol *result_variable = temparray;

        if (obj->result_type != VariableTypes::Uninitialized) //Cast to specific return value ?
        {
                result_variable = context.symboltable->RegisterDeclaredVariable(pos, NULL, false, false, obj->result_type);

                // Initialize for safety
                coder->CodeInitialize(result_variable);

                assert(!obj->namedselects.empty());

                CopySelectToTypedVariable(pos, result_variable, coder->ImVariable(pos, temparray), obj->namedselects[0].name, typestorage[obj->namedselects[0].expr]);
        }

        coder->ImCloseBlock(); //close select statement block

        ExpressionBlock* exprblock = Adopt(new ExpressionBlock(pos, baseblock, coder->ImVariable(pos, result_variable)));
        typestorage[exprblock] = obj->result_type == VariableTypes::Uninitialized ? VariableTypes::RecordArray : obj->result_type;
        ReplacePtr(exprblock);
}

Symbol * SQLTranslator::V_SQLSelect_NonGrouped(SQLSelect *obj)
{
        LineColumn pos = obj->position;

        Symbol* temparray = context.symboltable->RegisterDeclaredVariable(pos, NULL, false, false, VariableTypes::RecordArray);

        coder->CodeInitialize(temparray);

        TreeDecomposeResult dr = DecomposeWhere(obj->location.expr, *obj->sources);

        SQLTranslator::SelectQuery query = BuildCursoringQueryFinal(
                obj->position,
                dr,
                /*limit=*/obj->orderings.empty() ? obj->limit_expr : 0,
                /*query_type_id=*/0,
                /*need_fase2_records*/true,
                /*update_cols=*/0,
                0);

        TreeCopyingVisitor copier(context);

        Symbol* temprec = context.symboltable->RegisterDeclaredVariable(pos, NULL, false, false, VariableTypes::Record);

        coder->ImOpenBlock(query.result_build); // Open cursoring loop

        V_SQLSelect_CodeResultLoop(obj, temprec, temparray);

        coder->ImCloseBlock(); //close cursoring loop

        return temparray;
}

Symbol * SQLTranslator::V_SQLSelect_Grouped(SQLSelect *obj)
{
        LineColumn pos = obj->position;

        Symbol* temprec = context.symboltable->RegisterDeclaredVariable(pos, NULL, false, false, VariableTypes::Record);
        Symbol* temparray = context.symboltable->RegisterDeclaredVariable(pos, NULL, false, false, VariableTypes::RecordArray);
        coder->CodeInitialize(temparray);

        TreeDecomposeResult dr = DecomposeWhere(obj->location.expr, *obj->sources);

        SQLTranslator::SelectQuery query = BuildCursoringQueryFinal(
                obj->position,
                dr,
                /*limit=*/0, // no database limit, we need all records
                /*query_type_id=*/0,
                /*need_fase2_records*/true,
                /*update_cols=*/0,
                0);

        for (std::vector< Rvalue* >::iterator it = obj->groupings.begin(); it != obj->groupings.end(); ++it)
        {
                VariableUseFinder finder;
                finder.Execute(*it, *obj->sources, 0);
                if (finder.used.empty())
                    context.errorhandler.AddErrorAt((*it)->position, Error::IndependentGroupBy);
        }

        TreeCopyingVisitor copier(context);

        // Rewrite select, having and order by expressions
        GroupRewriteData rewrite_data;
        rewrite_data.result_symbol = temprec;
        unsigned idx = 0;
        for (std::vector< Rvalue* >::iterator it = obj->groupings.begin(); it != obj->groupings.end(); ++it, ++idx)
        {
                RecordColumnConst *rcc = dynamic_cast< RecordColumnConst * >(*it);
                if (!rcc)
                    continue;

                Variable *var = dynamic_cast< Variable * >(rcc->record);
                if(!var)
                    continue;

                rewrite_data.grouped_cols[std::make_pair(var->symbol, rcc->name)] = Blex::AnyToString(idx);
        }

        GroupExprRewriter rewriter(context, typestorage, coder, rewrite_data);

        // Grouping:
        // - Get fase1/2 data
        // - Evaluate where (not grouped!)
        // - Group
        // - Evaluate having
        // - Evaluate ordering

        for (std::vector< SQLSelect::Temporary >::iterator it = obj->temporaries.begin(); it != obj->temporaries.end(); ++it)
            rewriter.Execute(it->expr);
        for (std::vector< SQLSelect::SelectItem >::iterator it = obj->namedselects.begin(); it != obj->namedselects.end(); ++it)
            if (it->expr)
                rewriter.Execute(it->expr);
        for (std::vector<std::pair<Rvalue *, bool> >::iterator it = obj->orderings.begin(); it != obj->orderings.end(); ++it)
            rewriter.Execute(it->first);
        if (obj->having_expr)
        {
                  VariableUseFinder finder;
                  finder.Execute(obj->having_expr, *obj->sources, 0);
                  if (finder.used.empty() && !finder.uses_count)
                      context.errorhandler.AddErrorAt(obj->having_expr->position, Error::IndependentHaving);

                  rewriter.Execute(obj->having_expr);
        }

        coder->ImOpenBlock(query.result_build); // Open cursoring loop

        // Select id, name, ...
        coder->CodeInitialize(temprec);

        Symbol *f_getgroupposition = context.symboltable->RetrieveExternalFunction(pos, "__HS_SQL_GETGROUPPOSITION");
        Symbol *f_makearray = context.symboltable->RetrieveExternalFunction(pos, "__HS_SQL_MakeArrayOfValue");

        // Fill the temprecord with group data
        unsigned i = 0;
        for (std::vector< Rvalue * >::iterator it = obj->groupings.begin(); it != obj->groupings.end(); ++it, ++i)
        {
                coder->ImExecute(pos,
                    coder->ImAssignment(pos,
                        coder->ImVariable(pos, temprec),
                        coder->ImRecordCellSet(pos,
                                coder->ImVariable(pos, temprec),
                                Blex::AnyToString(i),
                                *it, true, true)));
        }

        Symbol* group_position = context.symboltable->RegisterDeclaredVariable(pos, NULL, false, false, VariableTypes::Integer);
        RvaluePtrs parameters;
        parameters.push_back(coder->ImVariable(pos, temparray));
        parameters.push_back(coder->ImVariable(pos, temprec));

        // group_position := __HS_SQL_GETGROUPPOSITION(temparray, temprec)
        coder->ImExecute(pos,
            coder->ImAssignment(pos,
                coder->ImVariable(pos, group_position),
                coder->ImFunctionCall(pos, f_getgroupposition, parameters)));

        // If (group_position < 0) {
        coder->ImIf_Open(pos,
                coder->ImBinaryOperator(pos,
                        BinaryOperatorType::OpLess,
                        coder->ImVariable(pos, group_position),
                        coder->ImConstantInteger(pos, 0)));

        // Fill the new group record with aggregate data
        for (GroupRewriteData::Aggregates::iterator it = rewrite_data.aggregates.begin();
                it != rewrite_data.aggregates.end(); ++it)
        {
                parameters.clear();
                parameters.push_back(copier.GetCopy(it->second));

                coder->ImExecute(pos,
                    coder->ImAssignment(pos,
                        coder->ImVariable(pos, temprec),
                        coder->ImRecordCellSet(pos,
                                coder->ImVariable(pos, temprec),
                                it->first,
                                coder->ImFunctionCall(pos, f_makearray, parameters),
                                true, true)));
        }

        // group_position := -group_position - 1
        coder->ImExecute(pos,
            coder->ImAssignment(pos,
                coder->ImVariable(pos, group_position),
                coder->ImBinaryOperator(pos,
                        BinaryOperatorType::OpSubtract,
                        coder->ImUnaryOperator(pos,
                                UnaryOperatorType::OpNeg,
                                coder->ImVariable(pos, group_position)),
                        coder->ImConstantInteger(pos, 1))));

        parameters.clear();
        parameters.push_back(coder->ImVariable(pos, temparray));

        // INSERT temprec INTO temparray AT group_position
        coder->ImArrayInsert(pos,
            coder->ImVariable(pos, temparray),
            ArrayLocation(ArrayLocation::Index, coder->ImVariable(pos, group_position)),
            coder->ImVariable(pos, temprec));

        // } else {
        coder->ImIf_Else(pos);

        for (GroupRewriteData::Aggregates::iterator it = rewrite_data.aggregates.begin();
                it != rewrite_data.aggregates.end(); ++it)
        {
                ConvertedLvalue clvalue;
                clvalue.exprpos = pos;
                clvalue.base = coder->ImVariable(pos, temparray);
                clvalue.basevar = temparray;
                clvalue.first_layer_is_objectref = false;
                clvalue.layers.push_back(LvalueLayer(pos, coder->ImVariable(pos, group_position)));
                clvalue.layers.push_back(LvalueLayer(pos, it->first));

                coder->ImDeepArrayInsert(pos, clvalue, ArrayLocation(ArrayLocation::End), it->second);
        }

        // }
        coder->ImIf_Close(pos);

        coder->ImCloseBlock(); //close cursoring loop

        Block *result_loop = Adopt(new Block(obj->position));

        Symbol *position_symbol = context.symboltable->RegisterDeclaredVariable (pos, 0, false, false, VariableTypes::Integer);

        Symbol *old_temprec = temprec;
        Symbol *old_temparray = temparray;

        temprec = context.symboltable->RegisterDeclaredVariable (pos, 0, false, false, VariableTypes::Record);
        temparray = context.symboltable->RegisterDeclaredVariable (pos, 0, false, false, VariableTypes::RecordArray);

        coder->CodeInitialize(temparray);

        // We now have a list of groups in temp_rec. Now, we can build the result array
        coder->ImForEvery(pos,
            coder->ImVariable(pos, old_temprec),
            coder->ImVariable(pos, old_temparray),
            result_loop,
            coder->ImVariable(pos, position_symbol));

        coder->ImOpenBlock(result_loop); // Open result loop

        // if (having expression) {
        if (obj->having_expr)
            coder->ImIf_Open(pos, obj->having_expr);

        V_SQLSelect_CodeResultLoop(obj, temprec, temparray);

        // }
        if (obj->having_expr)
            coder->ImIf_Close(pos);

        coder->ImCloseBlock(); //close result loop

        return temparray;
}

void SQLTranslator::V_SQLSelect_CodeResultLoop(SQLSelect *obj, Symbol *temprec, Symbol *temparray)
{
        LineColumn pos = obj->position;

        // Select id, name, ...
        coder->CodeInitialize(temprec);

        for (std::vector< SQLSelect::Temporary >::iterator it = obj->temporaries.begin(); it != obj->temporaries.end(); ++it)
        {
                coder->ImExecute(
                    it->assignpos,
                    coder->ImAssignment(it->assignpos,
                        coder->ImVariable(it->symbol->definitionposition, it->symbol),
                        it->expr));
        }

        Symbol *f_mergerecords = context.symboltable->RetrieveExternalFunction(pos, "__HS_SQL_MERGERECORDS");
        Symbol *f_overwriterecord = context.symboltable->RetrieveExternalFunction(pos, "__HS_SQL_OVERWRITERECORD");

        bool seen_spread = false;
        bool require_init = true;
        for (std::vector< SQLSelect::SelectItem >::const_iterator it = obj->namedselects.begin(); it != obj->namedselects.end(); ++it)
        {
                if (it->is_delete)
                {
                        coder->ImExecute(pos,
                            coder->ImAssignment(pos,
                                coder->ImVariable(pos, temprec),
                                coder->ImRecordCellDelete(pos,
                                        coder->ImVariable(pos, temprec),
                                        it->name)));
                }
                else if (it->is_spread || it->is_star)
                {
                        if (it->is_spread)
                            seen_spread = true;

                        if (it == obj->namedselects.begin())
                        {
                                // First spread/start we can assign directly,
                                coder->ImExecute(pos,
                                    coder->ImAssignment(pos,
                                        coder->ImVariable(pos, temprec),
                                        it->expr));
                        }
                        else
                        {
                                RvaluePtrs parameters;
                                parameters.push_back(coder->ImVariable(pos, temprec));
                                parameters.push_back(it->expr);

                                // From star may not overwrite another cell (unless we have seen a spread)
                                coder->ImExecute(pos,
                                    coder->ImAssignment(pos,
                                        coder->ImVariable(pos, temprec),
                                        coder->ImFunctionCall(pos, seen_spread ? f_overwriterecord : f_mergerecords, parameters)));
                        }
                }
                else
                {
                        // From star may not overwrite another cell (unless we have seen a spread)
                        coder->ImExecute(pos,
                            coder->ImAssignment(pos,
                                coder->ImVariable(pos, temprec),
                                coder->ImRecordCellSet(pos,
                                        coder->ImVariable(pos, temprec),
                                        it->name,
                                        it->expr,
                                        true,
                                        it->from_star && !seen_spread)));

                        // after RecordCellSet the record exists
                        require_init = false;
                }
        }

        // Ensure the result record exists (needed when we didn't do a cell insert)
        if (require_init)
        {
                RvaluePtrs parameters;
                parameters.push_back(coder->ImVariable(pos, temprec));

                coder->ImExecute(pos,
                    coder->ImAssignment(pos,
                        coder->ImVariable(pos, temprec),
                        Adopt(new BuiltinInstruction(
                            pos,
                            VariableTypes::Record,
                            ":RECORDMAKEEXISTING",
                            parameters,
                            false,
                            false))));
        }

        if (obj->orderings.size())
        {
                /* ADDME : We just create separate columns for the ORDER-BY
                   columns. But it would be nicer if our we could detect a
                   similair expression in the named columns, and use that for
                   ordering instead of duplicating the work here */

                // Select 'order by' data into the ordering columns (named :__orderby0, :__orderby1, etc)
                for (std::vector<std::pair<Rvalue*, bool> >::const_iterator it = obj->orderings.begin(); it != obj->orderings.end(); ++it)
                {
                        std::string columnname = ":__ORDERBY";
                        Blex::EncodeNumber(it - obj->orderings.begin(), 10, std::back_inserter(columnname));

                        coder->ImExecute(pos,
                            coder->ImAssignment(pos,
                                coder->ImVariable(pos, temprec),
                                coder->ImRecordCellSet(pos, coder->ImVariable(pos, temprec), columnname, it->first, true, true)));
                }
        }

        coder->ImArrayInsert(pos, coder->ImVariable(pos, temparray), ArrayLocation(ArrayLocation::End), coder->ImVariable(pos, temprec));
}

void SQLTranslator::V_SQLDataModifier(AST::SQLDataModifier *obj, Empty)
{
        RvaluePtrs parameters;
        unsigned i = 0;
        Symbol *f_overwriterecord = context.symboltable->RetrieveExternalFunction(obj->position, "__HS_SQL_OVERWRITERECORD");
        for (std::vector<std::string>::iterator it = obj->columns.begin(); it != obj->columns.end(); ++it,++i)
        {
                Visit(obj->values[i], Empty());

                if (*it != "")
                {
                        // When this is the first value, make sure the result variable is initialized
                        if (i == 0)
                            coder->CodeInitialize(datamodifierrecord);

                        coder->ImExecute(obj->position,
                            coder->ImAssignment(obj->position,
                                coder->ImVariable(obj->position, datamodifierrecord),
                                    coder->ImRecordCellSet(obj->position,
                                    coder->ImVariable(obj->position, datamodifierrecord),
                                    *it,
                                    obj->values[i],
                                    true,
                                    true)));
                }
                else if (i == 0)
                {
                        // Direct assign to result when this is the first value, no merge with empty record needed
                        coder->ImExecute(obj->position,
                            coder->ImAssignment(obj->position,
                                 coder->ImVariable(obj->position, datamodifierrecord),
                                 obj->values[i]));
                }
                else
                {
                        parameters.push_back(coder->ImVariable(obj->position, datamodifierrecord));
                        parameters.push_back(obj->values[i]);

                        coder->ImExecute(obj->position,
                            coder->ImAssignment(obj->position,
                                 coder->ImVariable(obj->position, datamodifierrecord),
                                 coder->ImFunctionCall(obj->position, f_overwriterecord, parameters)));
                }
        }
}

void SQLTranslator::CopySelectToTypedVariable(const LineColumn &pos, Symbol *result, Variable *recarr, std::string const &cell_name, VariableTypes::Type cell_type)
{
        VariableTypes::Type type = result->variabledef->type;

        Symbol *f_length = context.symboltable->RetrieveExternalFunction(pos, "LENGTH");
        Symbol *len = context.symboltable->RegisterDeclaredVariable (pos, 0, false, false, VariableTypes::Integer);

        // len := length(recarr)
        RvaluePtrs len_call_params(1, coder->ImVariable(pos, recarr->symbol));
        coder->ImExecute(pos,
                coder->ImAssignment(pos,
                        coder->ImVariable(pos, len),
                        coder->ImFunctionCall(pos, f_length, len_call_params))); //

        if (!(type & VariableTypes::Array))
        {
                // Destination is not array type
                // IF (len != 0) result := recarr[0].cell_name
                coder->ImIf_Open(pos,
                        coder->ImBinaryOperator(pos,
                                BinaryOperatorType::OpUnEqual,
                                coder->ImVariable(pos, len),
                                coder->ImConstantInteger(pos, 0)));

                // data := recarr[0].cellname
                Rvalue *data = coder->ImColumnOf(pos,
                        coder->ImCast(pos,
                                coder->ImVariable(pos, recarr->symbol),
                                VariableTypes::Record,
                                false,
                                false),
                        cell_name);

                // data := (cell_type)data // (only if cell_type is known and not variant)
                if (cell_type != VariableTypes::Uninitialized && cell_type != VariableTypes::Variant)
                    data = coder->ImCast(pos, data, cell_type, false, false);

                coder->ImExecute(pos,
                        coder->ImAssignment(pos,
                                coder->ImVariable(pos, result),
                                data));

                coder->ImIf_Close(pos);
        }
        else
        {
                if (cell_type == VariableTypes::Uninitialized)
                    cell_type = VariableTypes::Variant;

                Symbol *positionvar = context.symboltable->RegisterDeclaredVariable (pos, 0, false, false, VariableTypes::Integer);

                // position := 0
                coder->CodeInitialize(positionvar);

                //IMFOR (position < len; position := position + 1)
                coder->ImFor_Open(pos,
                        coder->ImBinaryOperator(pos,
                                BinaryOperatorType::OpLess,
                                coder->ImVariable(pos, positionvar),
                                coder->ImVariable(pos, len)),
                        coder->ImAssignment(pos,
                                coder->ImVariable(pos, positionvar),
                                coder->ImBinaryOperator(pos, BinaryOperatorType::OpAdd,
                                        coder->ImVariable(pos, positionvar),
                                        coder->ImConstantInteger(pos, 1))));

                // data := recarr[position].cellname
                Rvalue *data = coder->ImColumnOf(pos,
                        coder->ImArrayElementConst(pos,
                                coder->ImVariable(pos, recarr->symbol),
                                coder->ImVariable(pos, positionvar)),
                        cell_name);

                // data := (cell_type)data // (only if cell_type is known and not variant)
                if (cell_type != VariableTypes::Uninitialized && cell_type != VariableTypes::Variant)
                    data = coder->ImCast(pos, data, cell_type, false, false);

                // INSERT recarr[position].cell_name INTO results AT END
                coder->ImArrayInsert(pos,
                        coder->ImVariable(pos, result),
                        ArrayLocation(ArrayLocation::End),
                        data);

                // And end the loop..
                coder->ImFor_Close(pos);
        }
}

void SQLTranslator::V_Cast(AST::Cast *obj, Empty)
{
//        bool eliminate_self = false;
        // If we have are casting a select to record, we can do it directly in the select (is more efficient)
        SQLSelect *select = dynamic_cast< SQLSelect * >(obj->expr);
        if (select && obj->to_type == VariableTypes::Record && select->result_type == VariableTypes::Uninitialized)
        {
                // Set limit to 1 when result type is not an array (ADDME: Even if there is a limit_expr, replace it with a Max(1,limit_expr) ? )
                if (!select->limit_expr)
                    select->limit_expr = coder->ImConstantInteger(select->position, 1);
                //eliminate_self = true;
        }

        Visit(obj->expr, Empty());

        /*// Replace ptr after visiting sqlselect, giving it the chance to replace itself too.
        if (eliminate_self)
            ReplacePtr(obj->expr);
        */
}


/* Forevery statement translation
   Forevery is not native in the Harescript VM, and must therefor be simulated with a for-loop.
   The list over which is iterated is copied, so that changes to it will not affect the loop */



} // end of namespace Compiler
} // end of namespace HareScript
