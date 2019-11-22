#ifndef blex_webhare_compiler_opt_il_recordoptimizer
#define blex_webhare_compiler_opt_il_recordoptimizer
//---------------------------------------------------------------------------

#include "il.h"
#include "illiveanalyzer.h"

/** This file contains a class that optimizes record cell and array element references */

namespace HareScript
{
namespace Compiler
{

class OptILRecordOptimizer
{
    public:
        struct SourceDef
        {
                DBTypeInfo *typeinfo;
                IL::SSAVariable *typeinfo_target;
                IL::SSAVariable *expr_source;

                IL::SSAVariable *substrecordvar_fase1;
                IL::SSAVariable *substrecordvar_fase2;
                SourceDef() : typeinfo(0), typeinfo_target(0), expr_source(0), /*typeinfo_fase1(0), typeinfo_fase2(0),typeinfo_target_fase1(0), typeinfo_target_fase2(0), */substrecordvar_fase1(0), substrecordvar_fase2(0) {}
        };

        /** Record column access definition structure */
        struct RecordDef
        {
                /// Set to true if we can't track which columns of this variable will be accessed
                bool has_unknown_access;

                /// Whether all records of this def are sure to exist
                bool exists;

                /// List of columns which are known to be accessed
                std::set<std::string> accesses;

                /** List of variables from which parts of this record(array) come from. */
                std::set<IL::SSAVariable *> parents;

                RecordDef() : has_unknown_access(false), exists(false) {}
        };

    private:
        CompilerContext &context;

        typedef std::map<IL::SSAVariable *, RecordDef> RecordDefs;
        typedef std::vector<SourceDef> SourceDefs;
        typedef std::map<IL::SSAVariable *, SourceDefs> SourceDefsMap;

        /** Adds the accessed from source to defs; adds parent to list of parents of defs
            @param defs Record access definition to add accesses to
            @param source List of accesses to add
            @param parent Parent to add to list of parents of defs (0 to skip)
            @param is_assign Whether this is the first mergedefs
            @return Returns whether defs has changed because of this merge */
        bool MergeDefs(RecordDef &defs, RecordDef const &source, IL::SSAVariable *parent, bool is_assign);

        /** Optimizes a function
            @param block Entry block of function */
        void Optimize(IL::BasicBlock *block);

        /** Calculates the closure of all record definitons. It adds all accesses in a RecordDef to
            all of its parents, and sets has_unkown_access of all it's parents to true if if it's
            own has_unkown_access is true.
            @param recorddefs List of all record definitions of which the closure must be calculated */
        void CalculateAccesses(RecordDefs &recorddefs);

        /** Constructs a new typeinfo structure, which is essentialy an old typeinfo filtered by a record access def.
            @param ty Old typeinfo to filter
            @param rd Record access definition (list of accessed columns)
            @return New typeinfo structure (a;lready owned by the context.owner) */
//        TypeInfo * ConstructTypeInfo(TypeInfo *ty, RecordDef *rd);

        void SetTypeInfoFases(DBTypeInfo &ty, RecordDef const &fase1, RecordDef const &fase2);
    public:
        OptILRecordOptimizer(CompilerContext &context);
        ~OptILRecordOptimizer();

        void Execute(IL::Module *module);
};

} // end of namespace Compiler
} // end of namespace HareScript

//---------------------------------------------------------------------------
#endif
