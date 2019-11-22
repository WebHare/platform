//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>


#include "hsvm_functioncalltree.h"
#include "hsvm_context.h"
#include <blex/logfile.h>

namespace HareScript
{

FunctionCallTree::FunctionCallTree()
{
        Reset();
}

void FunctionCallTree::Reset()
{
        storage.clear();
        nodecount = 0;
        AddNewList();
        root = AllocateNode(0, 0);
        memset(cache, 0, sizeof(cache));
}

void FunctionCallTree::AddNewList()
{
        freeleft = 1024;

        std::shared_ptr< std::vector< CallTreeNode > > list(new std::vector< CallTreeNode >(freeleft));
        memset(&*list->begin(), 0, sizeof(CallTreeNode) * freeleft);

//        Blex::ErrStream() << "FCT " << this << " storage pre : " << storage.size() * 1024;

        storage.push_back(list);

        firstfree = &*list->begin();

//        Blex::ErrStream() << "FCT " << this << " storage post: " << storage.size() * 1024;
}

CallTreeNode * FunctionCallTree::AllocateNode(Library const *library, FunctionId function)
{
        if (!freeleft || !firstfree)
            AddNewList();

        firstfree->library = library;
        firstfree->function = function;

        --freeleft;
        ++nodecount;
        return firstfree++;
}

CallTreeNode * FunctionCallTree::LookupOrAllocate(CallTreeNode *root, Library const *library, FunctionId function)
{
        if (!library)
            return root;

        if (!root->firstchild)
        {
                root->firstchild = AllocateNode(library, function);
                return root->firstchild;
        }

        CallTreeNode *curr = root->firstchild;
        while (curr->library != library || curr->function != function)
        {
                CallTreeNode *next = curr->nextsibling;
                if (!next)
                {
                        curr->nextsibling = AllocateNode(library, function);
                        return curr->nextsibling;
                }
                curr = next;
        }
        return curr;
}

CallTreeNode * FunctionCallTree::GetCallTreeNode(CallStack const &callstack, Library const *library, FunctionId function)
{
        CallTreeNode *curr = root;
        unsigned cachepos = 0;
        bool cachevalid = true;

        for (CallStack::const_iterator it = callstack.begin(); it != callstack.end(); ++it)
        {
                if (!it->library || it->type != StackElementType::Return)
                      continue;

                if (cachevalid && cache[cachepos] && cache[cachepos]->library == it->library && cache[cachepos]->function == it->function)
                    curr = cache[cachepos];
                else
                {
                        cachevalid = false;
                        curr = LookupOrAllocate(curr, it->library, it->function);
                        cache[cachepos] = curr;
                }
                ++cachepos;
                if (cachepos == 1024)
                    throw std::runtime_error("Max stack depth reached in function call tree recording");
        }

        if (library)
        {
                if (cachevalid && cache[cachepos] && cache[cachepos]->library == library && cache[cachepos]->function == function)
                    curr = cache[cachepos];
                else
                {
                        cachevalid = false;

                        curr = LookupOrAllocate(curr, library, function);
                        cache[cachepos] = curr;
                        cachevalid = false;
                }
                ++cachepos;
//                Blex::ErrStream() << "LookupL " << (void*)library << ":" << function << ", found " << curr << " -> " << (void*)curr->library << ":" << curr->function;
        }
        if (!cachevalid)
            cache[cachepos] = 0;

        return curr;
}

struct Elt
{
        CallTreeNode const *node;
        uint32_t id;
        uint32_t heapalloc_self;
        uint32_t heapalloc_total;
};


void FunctionCallTree::ScreenDump(CallTreeNode const *node, unsigned depth) const
{
        Blex::ErrStream() << std::string(depth, ' ') << " " << (void*)node <<
            " lib: " << (node->library ? node->library->GetLibURI() : "") << " func: " <<
            (node->library ? node->library->GetWrappedLibrary().linkinfo.GetNameStr(node->library->GetWrappedLibrary().FunctionList()[node->function].name_index) : "") << " " <<
            node->stats.allocstats.allocated_heap;

        node = node->firstchild;
        while (node)
        {
                ScreenDump(node, depth + 1);
                node = node->nextsibling;
        }
}


void FunctionCallTree::StoreTree(VirtualMachine *vm, VarId id_set, VirtualMachine *profile_vm) const
{
        // Disable keeping stats for this; will only muck with stats
        profile_vm->GetStackMachine().SetCurrentAllocStats(0);

        StackMachine &stackm = vm->GetStackMachine();

//        ScreenDump(root, 0);

        stackm.InitVariable(id_set, VariableTypes::Record);

        ColumnNameId col_library = stackm.columnnamemapper.GetMapping("LIBRARY");
        ColumnNameId col_func = stackm.columnnamemapper.GetMapping("FUNC");
        ColumnNameId col_id = stackm.columnnamemapper.GetMapping("ID");
        ColumnNameId col_parent = stackm.columnnamemapper.GetMapping("PARENT");
        ColumnNameId col_location = stackm.columnnamemapper.GetMapping("LOCATION");
        ColumnNameId col_locations = stackm.columnnamemapper.GetMapping("LOCATIONS");
        ColumnNameId col_tree = stackm.columnnamemapper.GetMapping("TREE");
        ColumnNameId col_line = stackm.columnnamemapper.GetMapping("LINE");
        ColumnNameId col_hits = stackm.columnnamemapper.GetMapping("HITS");
        ColumnNameId col_col = stackm.columnnamemapper.GetMapping("COL");
        ColumnNameId col_heapalloc_self = stackm.columnnamemapper.GetMapping("HEAPALLOC_SELF");
        ColumnNameId col_heapalloc_total = stackm.columnnamemapper.GetMapping("HEAPALLOC_TOTAL");

        typedef std::map< std::pair< Library const *, unsigned >, unsigned > LocationMap;
        LocationMap locationmap;

        Elt stack[1026];

        int sdepth = 0;
        memset(&stack[0], 0, sizeof(stack[0]));
        stack[0].node = root;
        stack[0].id = 0;
        unsigned cid = 0;
        unsigned lid = 0;

        VarId tree = stackm.RecordCellCreate(id_set, col_tree);
        VarId locations = stackm.RecordCellCreate(id_set, col_locations);

        stackm.InitVariable(tree, VariableTypes::RecordArray);
        stackm.InitVariable(locations, VariableTypes::RecordArray);

        for (unsigned i = 0; i < nodecount - 1; ++i)
            stackm.InitVariable(stackm.ArrayElementAppend(tree), VariableTypes::Record);

        while (true)
        {
                Elt &curr = stack[sdepth];

                if (curr.node->firstchild)
                {
                        Elt &newelt = stack[sdepth + 1];

                        newelt.node = curr.node->firstchild;
                        newelt.id = ++cid;
                        newelt.heapalloc_total = newelt.heapalloc_self = newelt.node->stats.allocstats.allocated_heap;
                        ++sdepth;
                        continue;
                }

                while (true)
                {
                        Elt &elt = stack[sdepth];

                        if (!sdepth)
                            break;

                        stack[sdepth - 1].heapalloc_total += elt.heapalloc_total;

                        VarId rec = stackm.ArrayElementRef(tree, elt.id - 1);
                        stackm.SetInteger(stackm.RecordCellCreate(rec, col_id), elt.id);
                        stackm.SetInteger(stackm.RecordCellCreate(rec, col_parent), sdepth ? stack[sdepth - 1].id : 0);
                        stackm.SetInteger(stackm.RecordCellCreate(rec, col_heapalloc_self), elt.heapalloc_self);
                        stackm.SetInteger(stackm.RecordCellCreate(rec, col_heapalloc_total), elt.heapalloc_total);
                        stackm.SetInteger(stackm.RecordCellCreate(rec, col_hits), elt.node->stats.hits);

                        LocationMap::iterator lit = locationmap.find(std::make_pair(elt.node->library, elt.node->function));
                        unsigned loc;
                        if (lit == locationmap.end())
                            locationmap.insert(std::make_pair(std::make_pair(elt.node->library, elt.node->function), loc = ++lid));
                        else
                            loc = lit->second;

                        stackm.SetInteger(stackm.RecordCellCreate(rec, col_location), loc);

                        if (elt.node->nextsibling)
                        {
                                elt.node = elt.node->nextsibling;
                                elt.id = ++cid;
                                elt.heapalloc_total = elt.heapalloc_self = elt.node->stats.allocstats.allocated_heap;
                                break;
                        }

                        if (!sdepth)
                            break;
                        --sdepth;
                }
                if (!sdepth)
                    break;
        }

        typedef std::vector< std::pair< Library const *, unsigned > > ReverseLocations;

        ReverseLocations rlocs;
        rlocs.resize(locationmap.size());

        for (LocationMap::iterator it = locationmap.begin(); it != locationmap.end(); ++it)
            rlocs[it->second - 1] = it->first;

        lid = 1;
        for (ReverseLocations::iterator it = rlocs.begin(); it != rlocs.end(); ++it, ++lid)
        {
                VarId elt = stackm.ArrayElementAppend(locations);
                stackm.InitVariable(elt, VariableTypes::Record);

                Library const *library = it->first;
                uint32_t function = it->second;

                stackm.SetSTLString(stackm.RecordCellCreate(elt, col_library), library->GetLibURI());

                const FunctionDef &fdef = *library->GetLinkedLibrary().functiondefs[function].def;
                Blex::StringPair fullname = library->GetLinkinfoName(fdef.name_index);

                stackm.SetInteger(stackm.RecordCellCreate(elt, col_id), lid);
                stackm.SetString(stackm.RecordCellCreate(elt, col_func), fullname);
                stackm.SetInteger(stackm.RecordCellCreate(elt, col_line), fdef.definitionposition.line);
                stackm.SetInteger(stackm.RecordCellCreate(elt, col_col), fdef.definitionposition.column);
        }
}

} // End of namespace HareScript
