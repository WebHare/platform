//---------------------------------------------------------------------------
#include <harescript/compiler/allincludes.h>

//---------------------------------------------------------------------------

#include "opt_il_recordoptimizer.h"
#include "debugprints.h"

// Enable for much mumbo-jumbo
//#define DEBUGPRINTS

/* The RecordOptimizer tries to optimize record cell sets and creates that
   are not used. It also optimizes the record sets for SQL queries so that
   columns which are never used are not included in the query

   It works by recording which columns are accessed in a record; and from
   which sources a record is composed (parents).

   After that step that access information is flowed back from a RecordDef to
   it's parents in CalculateAccesses.

   With that information, unneeded RecordCellSets and RecordCellCreates are
   eliminated. Also, GetRecordFaseX function calls are used to adjust the
   typeinfo that is given to the SQLLib with list of needed columns in a query. */

namespace HareScript
{
namespace Compiler
{
using namespace IL;

#ifdef DEBUGPRINTS
 #define PRINT(x) CONTEXT_DEBUGPRINT(x)
#else
 #define PRINT(x)
#endif

std::ostream & operator <<(std::ostream &out, OptILRecordOptimizer::RecordDef const &rhs)
{
        out << "UnkAcc: " << (rhs.has_unknown_access ? "Y" : "N") << ", sure-exists: " << (rhs.exists ? "Y" : "N") << " " << rhs.accesses;
        return out << "[" << rhs.parents << "]";
}

OptILRecordOptimizer::OptILRecordOptimizer(CompilerContext &_context)
: context(_context)
{
}

OptILRecordOptimizer::~OptILRecordOptimizer()
{
}

void OptILRecordOptimizer::Execute(Module *module)
{
        PRINT("\n");
        // Optimizes function-at-a-time
        for (std::vector<CodedFunction *>::iterator it = module->functions.begin(); it != module->functions.end(); ++it)
            Optimize((*it)->block);
}

bool OptILRecordOptimizer::MergeDefs(RecordDef &defs, RecordDef const &source, SSAVariable *parent, bool is_assign)
{
        if (is_assign)
            defs.exists = source.exists;
        else
            defs.exists = defs.exists && source.exists;

        bool changed = false;
        if (!defs.has_unknown_access && source.has_unknown_access)
        {
                defs.has_unknown_access = true;
                changed = true;
        }
        for (std::set<std::string>::const_iterator it2 = source.accesses.begin(); it2 != source.accesses.end(); ++it2)
        {
                // Add ALL the accesses; not just the first!
                changed = defs.accesses.insert(*it2).second || changed;
        }
        if (parent)
            defs.parents.insert(parent);
        return changed;
}


void OptILRecordOptimizer::CalculateAccesses(RecordDefs &defs)
{
        std::vector<SSAVariable *> worklist;
        std::transform(defs.begin(), defs.end(), std::back_inserter(worklist), Utilities::pair_first<SSAVariable *, RecordDef>());

        while (!worklist.empty())
        {
                SSAVariable *var = worklist.back();
                worklist.pop_back();

                RecordDef &vardef = defs[var];

                for (std::set<SSAVariable *>::iterator it = vardef.parents.begin(); it != vardef.parents.end(); ++it)
                {
                        SSAVariable *current = *it;
                        bool must_visit = false;

                        RecordDef &currdef = defs[current];

                        if (!currdef.has_unknown_access && vardef.has_unknown_access)
                        {
                                currdef.has_unknown_access = true;
                                must_visit = true;
                        }
                        for (std::set<std::string>::iterator it2 = vardef.accesses.begin(); it2 != vardef.accesses.end(); ++it2)
                        {
                                must_visit = currdef.accesses.insert(*it2).second || must_visit;
                        }
                        if (must_visit)
                            worklist.push_back(*it);
                }
        }
}

void OptILRecordOptimizer::SetTypeInfoFases(DBTypeInfo &ty, RecordDef const &fase1, RecordDef const &fase2)
{
        if (fase1.has_unknown_access)
        {
                for (auto it = ty.columnsdef.begin(); it != ty.columnsdef.end(); ++it)
                    it->flags |= ColumnFlags::InternalFase1;
                return;
        }
        else
        {
                for (auto it = ty.columnsdef.begin(); it != ty.columnsdef.end(); ++it)
                    if (fase1.accesses.count(it->name))
                        it->flags |= ColumnFlags::InternalFase1;
        }
        if (fase2.has_unknown_access)
        {
                for (auto it = ty.columnsdef.begin(); it != ty.columnsdef.end(); ++it)
                    it->flags |= ColumnFlags::InternalFase2;
                return;
        }
        else
        {
                for (auto it = ty.columnsdef.begin(); it != ty.columnsdef.end(); ++it)
                    if (fase2.accesses.count(it->name) && !(it->flags & ColumnFlags::InternalFase1))
                        it->flags |= ColumnFlags::InternalFase2;
        }
}


namespace {
/// Returns true iff a variable can contain record columns
bool CanContainColumns(VariableTypes::Type type)
{
        return (type == VariableTypes::Record
                || type == VariableTypes::RecordArray
                || type == VariableTypes::Variant
                || type == VariableTypes::VariantArray
                || type == VariableTypes::FunctionRecord
                || type == VariableTypes::FunctionRecordArray);
}
} // End of anonymous namespace

void OptILRecordOptimizer::Optimize(BasicBlock *baseblock)
{
        // Array with list of source definitions (for sql-queries)
        SourceDefsMap sourcedefsmap;
        RecordDefs defs;

        // We need to know the contents of some constant variables
        std::map<SSAVariable *, std::string> const_strings;
        std::map<SSAVariable *, int32_t> const_ints;
        std::map<SSAVariable *, DBTypeInfo *> typeinfos;

        // Iterate over all blocks, breadth first over the dominator tree.
        std::vector<std::pair<BasicBlock *, SourceDefs> > worklist;
        worklist.push_back(std::make_pair(baseblock, SourceDefs()));
        while (!worklist.empty())
        {
                BasicBlock *block = worklist.back().first;
                SourceDefs &sourcedefs = worklist.back().second;

                // Set parents for all phi-variables
                for (std::vector<PhiFunction *>::iterator it = block->phifunctions.begin(); it != block->phifunctions.end(); ++it)
                    for (std::vector<std::pair<AssignSSAVariable *, BasicBlock *> >::iterator it2 = (*it)->params.begin(); it2 != (*it)->params.end(); ++it2)
                        defs[(*it)->variable].parents.insert(it2->first);

                /* List of source definitions in the current basic block. Source definitions
                   for a single query are ALWAYS in one basic block! */

                PRINT("Block: " << (void*)block);
                for (std::vector<ILInstruction *>::iterator it = block->instructions.begin(); it != block->instructions.end(); ++it)
                {
                        PRINT(" " << **it);
                        // All global variables get an unknown access; we can't track their usage.
                        {
                                std::set<SSAVariable*> globallist;
                                (*it)->InsertDefined(&globallist);
                                for (std::set<SSAVariable*>::iterator it2 = globallist.begin(); it2 != globallist.end(); ++it2)
                                     if ((*it2)->variable->storagetype == Variable::Global && CanContainColumns((*it2)->variable->type))
                                     {
                                            PRINT(" Unknown access for global var. " << (*it2)->variable->symbol->name);
                                            defs[*it2].has_unknown_access = true;
                                     }
                        }

                        // Administrate constants; we need to know some of them and where they come from.
                        ILConstant *constant = dynamic_cast<ILConstant *>(*it);
                        if (constant)
                        {
                                if (constant->constant.type == VariableTypes::Record)
                                {
                                        defs[constant->target] = RecordDef();
                                        if (constant->target->variable->symbol && constant->target->variable->symbol->flags & SymbolFlags::Public)
                                        {
                                                PRINT(" Unknown access for public record " << constant->target->variable->symbol->name);
                                                defs[constant->target].has_unknown_access = true;
                                        }
                                }
                                else if (constant->constant.type == VariableTypes::String)
                                {
                                        std::string strval;
                                        VarId var = constant->constant.var;
                                        if (var)
                                            strval = context.stackm.GetSTLString(var);
                                        else
                                            strval = "";

                                        Blex::ToUppercase(strval.begin(), strval.end());
                                        const_strings[constant->target] = strval;
                                }
                                else if (constant->constant.type == VariableTypes::Integer)
                                {
                                        VarId var = constant->constant.var;
                                        if (var)
                                            const_ints[constant->target] = context.stackm.GetInteger(var);
                                        else
                                            const_ints[constant->target] = 0;
                                }
                                else if (constant->constant.type == VariableTypes::TypeInfo)
                                    typeinfos[constant->target] = constant->constant.typeinfovalue;
                        }
                        ILAssignment *ass = dynamic_cast<ILAssignment *>(*it);
                        if (ass)
                        {
                                if (defs.count(ass->target) || defs.count(ass->rhs))
                                {
                                        MergeDefs(defs[ass->target], defs[ass->rhs], ass->rhs, true);
                                }

                                if (sourcedefsmap.count(ass->rhs))
                                {
                                        sourcedefsmap[ass->target] = sourcedefsmap[ass->rhs];
                                }

                                if (ass->target->variable->storagetype == Variable::Global)
                                {
                                        PRINT(" Unknown access for public global var. " << ass->target->variable->symbol->name);
                                        defs[ass->target].has_unknown_access = true;
                                }
                        }
                        ILCast *cass = dynamic_cast<ILCast *>(*it);
                        if (cass)
                        {
                                if (CanContainColumns(cass->to_type))
                                {
                                        if (defs.count(cass->target) || defs.count(cass->rhs))
                                        {
                                                MergeDefs(defs[cass->target], defs[cass->rhs], cass->rhs, true);
                                        }

                                        if (cass->target->variable->storagetype == Variable::Global)
                                        {
                                                PRINT(" Unknown access for public global var. " << cass->target->variable->symbol->name);
                                                defs[cass->target].has_unknown_access = true;
                                        }
                                }
                        }
                        ILColumnOperator *colop = dynamic_cast<ILColumnOperator *>(*it);
                        if (colop)
                        {
                                // Column getting, with known column name; add the access
                                std::string colname(colop->columnname);
                                Blex::ToUppercase(colname.begin(), colname.end());
                                defs[colop->rhs].accesses.insert(colname);
                                /* If the target type can contain columns, the original record becomes it's parent
                                   Substitution variables carry contain enough typeinfo to skip this */
                                if (CanContainColumns(colop->target->variable->type))
                                    defs[colop->target].parents.insert(colop->rhs);
                        }
                        ILReturn *ret = dynamic_cast<ILReturn *>(*it);
                        if (ret)
                        {
                                // We don't know which columns are accessed for returned variables
                                if (ret->returnvalue && defs.count(ret->returnvalue))
                                    defs[ret->returnvalue].has_unknown_access = true;
                        }
                        if (ILUnaryOperator *unop = dynamic_cast<ILUnaryOperator *>(*it))
                        {
                                if (unop->operation == UnaryOperatorType::OpMakeExisting)
                                {
                                        MergeDefs(defs[unop->target], defs[unop->rhs], unop->rhs, false);
                                }
                        }
                        if (ILBinaryOperator *binop = dynamic_cast<ILBinaryOperator *>(*it))
                        {
                                if (binop->operation == BinaryOperatorType::OpConcat)
                                {
                                        MergeDefs(defs[binop->target], defs[binop->lhs], binop->lhs, true);
                                        MergeDefs(defs[binop->target], defs[binop->rhs], binop->rhs, false);
                                }
                        }
                        ILFunctionCall *fc = dynamic_cast<ILFunctionCall *>(*it);
                        if (fc)
                        {
                                if (":ARRAYINSERT" == fc->function->name || ":ARRAYSET" == fc->function->name)
                                {
                                        // The target access def is merged with the old array (obviously, that is his parent)
                                        MergeDefs(defs[fc->target], defs[fc->values[0]], fc->values[0], true);
                                        // The target access def is also merged with the new element (and that is also a parent!!!)
                                        MergeDefs(defs[fc->target], defs[fc->values[2]], fc->values[2], false);
                                }
                                else if (":ARRAYAPPEND" == fc->function->name)
                                {
                                        // The target access def is merged with the old array (obviously, that is his parent)
                                        MergeDefs(defs[fc->target], defs[fc->values[0]], fc->values[0], true);
                                        // The target access def is also merged with the new element (and that is also a parent!!!)
                                        MergeDefs(defs[fc->target], defs[fc->values[1]], fc->values[1], false);
                                }
                                else if (":ARRAYINDEX" == fc->function->name)
                                {
                                        // The array is a parent of the target here, of course
                                        MergeDefs(defs[fc->target], defs[fc->values[0]], fc->values[0], true);
                                }
                                //
                                // SQL query tracking
                                //
                                else if ("__HS_SQL_GETSOURCESBASELIST" == fc->function->name)
                                {
                                        // Initialize sourcedefs map
                                        sourcedefsmap[fc->target];
                                }
                                else if ("__HS_SQL_ADDTABLESOURCE" == fc->function->name)
                                {
                                        /* A SQL source table has been added. Track which variables name
                                           the typeinfo */
                                        SourceDef def;
                                        def.typeinfo = typeinfos[fc->values[2]];
                                        def.typeinfo_target = fc->values[2];

                                        // Add to sourcedefs
                                        sourcedefsmap[fc->target] = sourcedefsmap[fc->values[0]];
                                        sourcedefsmap[fc->target].push_back(def);
                                }
                                else if ("__HS_SQL_ADDRECORDARRAYSOURCE" == fc->function->name)
                                {
                                        /* A SQL source expression has been added. */
                                        SourceDef def;
                                        def.typeinfo = 0;
                                        def.expr_source = fc->values[1];
                                        def.typeinfo_target = fc->values[2]; // Dummy

                                        DBTypeInfo *typeinfo = typeinfos[fc->values[2]];
                                        if (typeinfo)
                                        {
                                                PRINT("Processing typeinfo " << typeinfo << " of var " << fc->values[2]);
                                                for (auto it = typeinfo->columnsdef.begin(); it != typeinfo->columnsdef.end(); ++it)
                                                {
                                                        if (it->flags & ColumnFlags::InternalUsedInCondition)
                                                        {
                                                                std::string colname(it->name);
                                                                Blex::ToUppercase(colname.begin(), colname.end());
                                                                defs[fc->values[1]].accesses.insert(colname);
                                                                PRINT("Adding condition var '" << colname << "' to " << fc->values[1]);
                                                        }
                                                }
                                        }

                                        // Add to sourcedefs
                                        sourcedefsmap[fc->target] = sourcedefsmap[fc->values[0]];
                                        sourcedefsmap[fc->target].push_back(def);
                                }
                                else if ("__HS_SQL_OPENCURSOR2" == fc->function->name)
                                {
                                        /* OpenCursor opens the query with the current source definition
                                           This information is associated with fc->target (a temporary!!) */
                                        sourcedefsmap[fc->target] = sourcedefsmap[fc->values[0]];

                                        // And unknown accesses to the parameters
                                        defs[fc->values[0]].has_unknown_access = true;
                                        defs[fc->values[1]].has_unknown_access = true;
                                }


                                else if ("__HS_SQL_CLEARQUERYDATA" == fc->function->name)
                                {
                                        // Clears the current query data
                                        sourcedefs.clear();
                                }
                                else if ("__HS_SQL_ADDSOURCETABLE" == fc->function->name)
                                {
                                        /* A SQL source table has been added. Track which variables name
                                           the typeinfo */
                                        SourceDef def;
                                        def.typeinfo = typeinfos[fc->values[2]];
                                        def.typeinfo_target = fc->values[2];

/*                                        def.typeinfo_fase1 = typeinfos[fc->values[1]];
                                        def.typeinfo_fase2 = typeinfos[fc->values[2]];
                                        def.typeinfo_target_fase1 = fc->values[1];
                                        def.typeinfo_target_fase2 = fc->values[2];*/
                                        sourcedefs.push_back(def);
                                }
                                else if ("__HS_SQL_ADDSOURCEEXPRESSION" == fc->function->name)
                                {
                                        /* A SQL source expression has been added. */
                                        SourceDef def;
                                        def.typeinfo = 0;
                                        def.typeinfo_target = fc->values[1]; // Dummy

/*                                        def.typeinfo_fase1 = 0;
                                        def.typeinfo_fase2 = 0;
                                        def.typeinfo_target_fase1 = fc->values[0]; // Dummy
                                        def.typeinfo_target_fase2 = fc->values[0];*/
                                        sourcedefs.push_back(def);
                                        // An unknown access is quity handy; we cannot track through a SQL query
                                        defs[*fc->values.begin()].has_unknown_access = true;
                                }
                                else if ("__HS_SQL_OPENCURSOR" == fc->function->name)
                                {
                                        /* OpenCursor opens the query with the current source definition
                                           This information is associated with fc->target (a temporary!!) */
                                        sourcedefsmap[fc->target] = sourcedefs;
                                }
                                else if ("__HS_SQL_GETRECORDFASE1" == fc->function->name)
                                {
                                        defs[fc->target]; // make an empty definition for the target

                                        /* Associate the substitute variable for the current query (fc->values[0]) and current table (fc->values[1])
                                           with the target (fase 1) */
                                        bool int_exists = const_ints.count(fc->values[1]) != 0;
                                        if (int_exists)
                                        {
                                                int32_t value = const_ints[fc->values[1]];
                                                if (value < int32_t(sourcedefsmap[fc->values[0]].size()))
                                                {
                                                        SourceDef &def = sourcedefsmap[fc->values[0]][const_ints[fc->values[1]]];
                                                        def.substrecordvar_fase1 = fc->target;
                                                        if (def.expr_source)
                                                            defs[fc->target].parents.insert(def.expr_source);
                                                }
                                        }
                                }
                                else if ("__HS_SQL_GETRECORDFASE2" == fc->function->name)
                                {
                                        defs[fc->target]; // make an empty definition for the target

                                        /* Associate the substitute variable for the current query (fc->values[0]) and current table (fc->values[1])
                                           with the target (fase 2) */
                                        bool int_exists = const_ints.count(fc->values[1]) != 0;
                                        if (int_exists)
                                        {
                                                int32_t value = const_ints[fc->values[1]];
                                                if (value < int32_t(sourcedefsmap[fc->values[0]].size()))
                                                {
                                                        SourceDef &def = sourcedefsmap[fc->values[0]][const_ints[fc->values[1]]];
                                                        def.substrecordvar_fase2 = fc->target;
                                                        if (def.expr_source)
                                                            defs[fc->target].parents.insert(def.expr_source);
                                                }
                                        }
                                }
                                else if ("__HS_SQL_UPDATERECORD" == fc->function->name)
                                {
                                        // Get subst var, add unknown access - we can't track the contents of the updaterecord. ADDME do that
                                        SourceDefs &sdefs = sourcedefsmap[fc->values[0]];
                                        if (!sdefs.empty())
                                        {
                                                SourceDef &def = sdefs[0];
                                                if (def.expr_source)
                                                    defs[def.expr_source].has_unknown_access = true;
                                        }
                                        defs[fc->values[1]].has_unknown_access = true;
                                }
                                else if ("__HS_SQL_GETARRAYRESULTS" == fc->function->name)
                                {
                                        SourceDefs &sdefs = sourcedefsmap[fc->values[0]];
                                        if (!sdefs.empty())
                                        {
                                                SourceDef &def = sdefs[0];
                                                if (def.expr_source)
                                                    defs[fc->target].parents.insert(def.expr_source);
                                        }
                                }
                                else if ("LENGTH" == fc->function->name)
                                {
                                        // When parameter is a record (or when we don't know), all fields are accessed
                                        if ((!fc->values[0]->variable->symbol) ||
                                            ((fc->values[0]->variable->symbol) && (
                                                fc->values[0]->variable->symbol->variabledef->type == VariableTypes::Variant ||
                                                fc->values[0]->variable->symbol->variabledef->type == VariableTypes::Record)))
                                            for (std::vector<SSAVariable *>::iterator it = fc->values.begin(); it != fc->values.end(); ++it)
                                                if (defs.count(*it))
                                                    defs[*it].has_unknown_access = true;
                                }
                                else if (":ARRAYSIZE" == fc->function->name)
                                {       // ARRAYSIZE does not need columns
                                }
                                else if ("RECORDEXISTS" == fc->function->name)
                                {       // RecordExists does not need columns
                                }
                                else if ("__HS_SQL_DEBUG_GETVARASOPTIMIZED" == fc->function->name)
                                {       // Returns the version as the compiler optimized it
                                }
                                else if ("__HS_SQL_REORDER_RESULTS" == fc->function->name)
                                {
                                        // __HS_SQL_REORDER_RESULTS also needs the :__orderby columns
                                        std::string param2 = const_strings[fc->values[1]];
                                        MergeDefs(defs[fc->target], defs[fc->values[0]], fc->values[0], true);
                                        RecordDef &def = defs[fc->values[0]];

                                        for (unsigned idx = 0; idx < param2.size(); ++idx)
                                            def.accesses.insert(":__ORDERBY" + Blex::AnyToString(idx));
                                }
                                else if (":DEEPSET" == fc->function->name || ":DEEPARRAYINDEX" == fc->function->name || ":DEEPARRAYAPPEND" == fc->function->name)
                                {
                                        unsigned vcount = fc->values.size();
                                        std::string layers = const_strings[fc->values[vcount - 2]];

                                        PRINT("Deep operation '"<<fc->function->name<<"', layers: " << layers);

                                        if (layers[0] == 'R' || layers[0] == 'A')
                                        {
                                                // Inherit from the basevar
                                                MergeDefs(defs[fc->target], defs[fc->values[vcount-1]], fc->values[vcount-1], true);

                                                RecordDef &def = defs[fc->values[vcount-1]];

                                                if (layers[0] == 'A') // then layers[1] == 'R'
                                                {
                                                        PRINT("- Adding access for [x].col, col: '" << const_strings[fc->values[vcount - 4]] << "'");
                                                        def.accesses.insert(const_strings[fc->values[vcount - 4]]);
                                                }
                                                else
                                                {
                                                        PRINT("- Adding access for col[x]/col.x, col: '" << const_strings[fc->values[vcount - 3]] << "'");
                                                        def.accesses.insert(const_strings[fc->values[vcount - 3]]);
                                                }
                                        }

                                        // Give the rest of the variables an unknown access
                                        for (std::vector<SSAVariable *>::iterator it = fc->values.begin(), end = fc->values.end() - 2 - layers.size(); it != end; ++it)
                                            if (defs.count(*it))
                                            {
                                                    PRINT(" Unknown access for " << (*it)->variable->name);
                                                    defs[*it].has_unknown_access = true;
                                            }
                                }
                                else
                                {
                                        PRINT("Unrecognized function " << fc->function->name);
                                        // Default: all function parameters beget a unkown access (we can't track...)
                                        for (std::vector<SSAVariable *>::iterator it = fc->values.begin(); it != fc->values.end(); ++it)
                                            if (defs.count(*it))
                                            {
                                                    PRINT(" Unknown access for " << (*it)->variable->name);
                                                    defs[*it].has_unknown_access = true;
                                            }
                                }
                        }
                        ILMethodCall *mc = dynamic_cast< ILMethodCall * >(*it);
                        if (mc)
                        {
                                // Default: all function parameters beget a unkown access (we can't track...)
                                for (std::vector<SSAVariable *>::iterator it = mc->values.begin(); it != mc->values.end(); ++it)
                                    if (defs.count(*it))
                                    {
                                            if (!(*it)->variable->symbol || CanContainColumns((*it)->variable->symbol->variabledef->type))
                                            {
                                                    PRINT(" Unknown access for " << (*it)->variable->name);
                                                    defs[*it].has_unknown_access = true;
                                            }
                                    }
                        }
                        ILRecordCellSet *colcellset = dynamic_cast<ILRecordCellSet *>(*it);
                        if (colcellset)
                        {
                                // Establish link between source and target
                                MergeDefs(defs[colcellset->target], defs[colcellset->rhs], colcellset->rhs, true);

                                defs[colcellset->target].exists = true; // After set, record must exist

                                /* If the set value contains columns it is also a parent of new record
                                    We can't track nested usage, so it will get an unknown access */
                                if (CanContainColumns(colcellset->value->variable->type))
                                {
                                        defs[colcellset->target].parents.insert(colcellset->value);
                                        defs[colcellset->value].has_unknown_access = true;
                                }
                        }
                        ILRecordCellDelete *colcelldel = dynamic_cast<ILRecordCellDelete *>(*it);
                        if (colcelldel)
                        {
                                // Establish link between source and target
                                MergeDefs(defs[colcelldel->target], defs[colcelldel->rhs], colcelldel->rhs, true);
                        }
                        ILObjectMemberSet *oms = dynamic_cast< ILObjectMemberSet * >(*it);
                        if (oms)
                        {
                                defs[oms->value].has_unknown_access = true;
                        }
                }

                // We destroy the reference to 'sourcedefs' with the pop_back()
                SourceDefs sourcedefscopy = sourcedefs;
                worklist.pop_back();
                for (std::vector<BasicBlock *>::iterator it = block->dominees.begin(); it != block->dominees.end(); ++it)
                    worklist.push_back(std::make_pair(*it, sourcedefscopy));
        }

        // Calculate closure (let access information flow to the parents)
        PRINT("\npre:" << PrintWithNL(defs));
        CalculateAccesses(defs);
        PRINT("post:" << PrintWithNL(defs));

        // Construct filtered typeinfo for all SQL queries
        for (SourceDefsMap::iterator it = sourcedefsmap.begin(); it != sourcedefsmap.end(); ++it)
        {
                SourceDefs &sdefs = it->second;
                for (SourceDefs::iterator it2 = sdefs.begin(); it2 != sdefs.end(); ++it2)
                {
                        RecordDef *rdef_f1 = 0;
                        RecordDef *rdef_f2 = 0;

                        if (defs.count(it2->substrecordvar_fase1))
                            rdef_f1 = &defs[it2->substrecordvar_fase1];
                        if (defs.count(it2->substrecordvar_fase2))
                            rdef_f2 = &defs[it2->substrecordvar_fase2];

                        // There can exist multiple sourcedefs (due to copying of the cursor variable)
                        // Make sure that a non-authorative copy does not get used
                        if ((!rdef_f1 && !rdef_f2) || !it2->typeinfo)
                        {
                                PRINT("Skipping non-authoritive sdef " << it->first << " - " << it2->typeinfo_target << " f1: " << rdef_f1 << " f2: " << rdef_f2 << ", typeinfo: " << it2->typeinfo);
                                continue;
                        }

                        PRINT("Adjusting typeinfo for " << *it2->typeinfo_target);
                        PRINT("Org typeinfo " << *it2->typeinfo);
                        PRINT("Fase unknown access? F1: " << (rdef_f1 ? (rdef_f1->has_unknown_access ? "Y" : "N") : "N/A") << ", F2: " << (rdef_f2 ? (rdef_f2->has_unknown_access ? "Y" : "N") : "N/A"));

                        RecordDef dummy;
                        if (!rdef_f1)
                            rdef_f1 = &dummy;
                        if (!rdef_f2)
                            rdef_f2 = &dummy;

                        SetTypeInfoFases(*it2->typeinfo, *rdef_f1, *rdef_f2);
                        PRINT("New typeinfo " << *it2->typeinfo);
                }
        }

        PRINT("After optimization:\n");

        /* Adjust all load type-info, recordcellsets and recordcellcreates.
           Kill them if they're not needed, adjust otherwise */
        std::vector<BasicBlock *> worklist2;
        worklist2.push_back(baseblock);
        while (!worklist2.empty())
        {
                BasicBlock *block = worklist2.back();
                worklist2.pop_back();

                PRINT("Block: " << (void*)block);
                for (std::vector<ILInstruction *>::iterator it = block->instructions.begin(); it != block->instructions.end(); ++it)
                {

                        ILConstant *constant = dynamic_cast<ILConstant *>(*it);
                        if (constant && constant->constant.type == VariableTypes::TypeInfo)
                        {
                                // Adjusted typeinfo available
                                if (typeinfos.count(constant->target) && typeinfos[constant->target])
                                {
                                        PRINT("Adjusting " << constant->target);

//                                        TypeInfo &typeinfo = *typeinfos[constant->target];

/*                                        std::cout << "New typeinfo: ";
                                        for (std::vector< std::pair< std::string, VariableTypes::Type > >::const_iterator it3 = typeinfo.columnsdef.begin(); it3 != typeinfo.columnsdef.end(); ++it3)
                                        {
                                                std::cout << it3->first << " ";
                                        }
                                        std::cout << std::endl;*/


                                        constant->constant.typeinfovalue = typeinfos[constant->target];
                                }
                        }

                        ILRecordCellSet *colcellset = dynamic_cast<ILRecordCellSet *>(*it);
                        if (colcellset)
                        {
                                if (!defs[colcellset->target].accesses.count(colcellset->columnname) && !defs[colcellset->target].has_unknown_access)
                                {
                                        if (defs[colcellset->rhs].exists)
                                        {
                                                PRINT("Eliminating cellset for " << colcellset->columnname << " with assignment, accesses:\n" << defs[colcellset->target].accesses);

                                                ILAssignment *newass = new ILAssignment(colcellset->position, colcellset->target, colcellset->rhs);
                                                context.owner.Adopt(newass);
                                                *it = newass;
                                        }
                                        else
                                        {
                                                PRINT("Eliminating cellset for " << colcellset->columnname << " with creating func, accesses:\n" << defs[colcellset->target].accesses);

                                                ILUnaryOperator *newunop = new ILUnaryOperator(colcellset->position, colcellset->target, UnaryOperatorType::OpMakeExisting, colcellset->rhs);
                                                context.owner.Adopt(newunop);
                                                *it = newunop;
/*
                                                // CellCreate not needed; replace by a function call that creats a record when it's NULL, and copies otherwise
                                                std::vector<SSAVariable *> newvalues;
                                                newvalues.push_back(colcellset->rhs);

                                                Function *func = new Function;
                                                context.owner.Adopt(func);
                                                func->name = "__HS_CreateRecordIfNotExisting";
                                                func->symbol = context.symboltable->RetrieveExternalFunction(colcellset->position, func->name);

                                                // Create a new function call.
                                                ILFunctionCall *newfc = new ILFunctionCall(colcellset->position, colcellset->target, func, newvalues);
                                                context.owner.Adopt(newfc);

                                                *it = newfc;
*/
                                        }
                                }
                        }

                        ILRecordCellDelete *colcelldel = dynamic_cast<ILRecordCellDelete *>(*it);
                        if (colcelldel)
                        {
                                if (!defs[colcelldel->target].accesses.count(colcelldel->columnname) && !defs[colcelldel->target].has_unknown_access)
                                {
                                        PRINT("Eliminating celldelete of " << colcelldel->columnname << " with assignment, accesses:\n" << defs[colcelldel->target].accesses);

                                        ILAssignment *newass = new ILAssignment(colcelldel->position, colcelldel->target, colcelldel->rhs);
                                        context.owner.Adopt(newass);
                                        *it = newass;
                                }
                        }

                        PRINT(" " << **it);
                }

                std::copy(block->dominees.begin(), block->dominees.end(), std::back_inserter(worklist2));
        }
}

} // end of namespace Compiler
} // end of namespace HareScript


//---------------------------------------------------------------------------






