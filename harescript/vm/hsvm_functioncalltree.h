#ifndef blex_harescript_hsvm_functiontrace
#define blex_harescript_hsvm_functiontrace

#include "hsvm_varmemory.h"
#include "hsvm_environment.h"

namespace HareScript
{

struct CallStackElement;
typedef Blex::PodVector< CallStackElement > CallStack;

/** Stats per tracepoint. Must be POD, will be 0-initialized.
*/
struct CallTreeNodeStats
{
        AllocStats allocstats;
        unsigned hits;
};

/** Single tracepoint
*/
struct CallTreeNode
{
        /// Function library
        Library const *library;

        /// Function id (within the library)
        FunctionId function;

        /// Statistics for this tracepoint
        CallTreeNodeStats stats;

        /// First child tracepoint
        CallTreeNode *firstchild;

        /// Nect sibling tracepoint
        CallTreeNode *nextsibling;
};

class FunctionCallTree
{
    private:
        /// List of storage
        std::list< std::shared_ptr< std::vector< CallTreeNode > > > storage;

        /// Current free element
        CallTreeNode *firstfree;

        /// Nr of elements left in the current TracePoint array
        unsigned freeleft;

        /// Root callsite
        CallTreeNode *root;

        /// Trace for last lookup
        CallTreeNode *cache[1026];

        /// Nr of nodes
        unsigned nodecount;

        void AddNewList();
        CallTreeNode * AllocateNode(Library const *library, FunctionId function);
        CallTreeNode * LookupOrAllocate(CallTreeNode *root, Library const *library, FunctionId function);

        void ScreenDump(CallTreeNode const *node, unsigned depth) const;

    public:
        FunctionCallTree();

        void Reset();

        CallTreeNode * GetCallTreeNode(CallStack const &callstack, Library const *library, FunctionId function);

        void StoreTree(VirtualMachine *vm, VarId id_set, VirtualMachine *profile_vm) const;
};

} // End of namespace HareScript

#endif //blex_harescript_hsvm_functiontrace
