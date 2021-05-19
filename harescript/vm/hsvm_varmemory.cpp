//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>

//---------------------------------------------------------------------------

#include "hsvm_varmemory.h"
#include <blex/logfile.h>

//#define CONTEXTS

#ifndef DEBUG
#undef VARMEMPROFILING
#endif

namespace HareScript
{

#ifdef VARMEMPROFILING
#define VARMEMPROF(x) DEBUGONLY(x)

struct HareScript::VarMemory::VMProf
{
        //highest number of variables to appear on the stack
        unsigned maxstackvars;
        //highest number of variables to appear on the heap (just get heapst.size())
        //unsigned maxheapvars;
        //largest registered size of the backing
        unsigned maxbackingsize;
        //total number of string sets
        unsigned totalvarstringsets;
        //total number of string sets that were constant
        unsigned totalconstantstringsets;
};

#else
#define VARMEMPROF(x)
#endif

#if defined(DEBUG) && defined(CONTEXTS)
 #define CTX_PRINT(x) DEBUGPRINT(x)
#else
 #define CTX_PRINT(x) (void)0
#endif


//---------------------------------------------------------------------------
//
// VarMemory general functions
//
//---------------------------------------------------------------------------

const unsigned VarMemory::VarRecord::NonExistent;
const unsigned VarMemory::VarRecord::CountMask;

static const VarMemory::HeapId EndOfFreeList = VarMemory::HeapId(-1);

void VarMemory::GetVMStats(VMStats *stats)
{
        stats->stacklength = (stackstore.capacity() * sizeof(VarStore) + 1023)/1024;
        stats->heaplength = (heapstore.capacity() * sizeof(VarStore) + 1023)/1024;
        stats->backingstorelength = (backings.GetCapacity() + 1023)/1024;
        stats->objectcount = objectcount;
}

inline void VarMemory::Dereference_Externals(VarStore &store)
{
        if (store.type == VariableTypes::Blob && store.data.blob.blob)
        {
                store.data.blob.blob->InternalRemoveReference();
                store.data.blob.blob = 0;
        }
}

bool VarMemory::CheckVarId(VarId id) const
{
        if (id >= ArrayBase)
              return id - ArrayBase < heapstore.size();
        else
        {
              if (basepointer + id < LocalStackMiddle)
                  return false;

              id = basepointer + id - LocalStackMiddle;
              return id < stackstore.size();
        }
}

VarMemory::VarMemory(ColumnNames::LocalMapper &_columnnamemapper)
: stacksize(0)
, basepointer(0)
, freeheapid(EndOfFreeList)
, columnnamemapper(_columnnamemapper)
, keep_allocstats(false)
, allocstats(0)
{
        //ADDME? Better initial values may improve stackstore/heapstore performance?
        stackstore.resize(512); //start with 32 stack variables
        heapstore.reserve(1024); //start with room for 1024 variables on the heap
        maps.reserve(64);   //64 stack maps are enough for up to 63 LOADLIBs.

        // Prealloc variable 0, so VarId 0 won't be given out
        heapstore.resize(1);

        // Initialize all variables
        for (StackStore::iterator it = stackstore.begin(), end = stackstore.end(); it != end; ++it)
            it->type = VariableTypes::Uninitialized;
        for (HeapStore::iterator it = heapstore.begin(), end = heapstore.end(); it != end; ++it)
            it->type = VariableTypes::Uninitialized;

#ifdef VARMEMPROFILING
        prof=new VMProf;
        memset(prof,0,sizeof(*prof));
#endif
        objectcount = 0;
}

VarMemory::~VarMemory()
{
#ifdef VARMEMPROFILING
        Debug::Msg("-- VarMemory profile --");
        Debug::Msg("Stack vars:   %u max (%u bytes)",prof->maxstackvars,prof->maxstackvars*sizeof(VarStore));
        Debug::Msg("Heap  vars:   %u max (%u bytes)",prof->maxheapvars,prof->maxheapvars*sizeof(VarStore));
        Debug::Msg("Sharedbuffer: %u bytes max",prof->maxbackingsize);
        if (prof->totalconstantstringsets+prof->totalvarstringsets)
            Debug::Msg("Strings:      %u sets, %u%% constant",(prof->totalconstantstringsets+prof->totalvarstringsets),(prof->totalconstantstringsets*100)/(prof->totalconstantstringsets+prof->totalvarstringsets));
        delete prof;
#endif
        Reset();
}

void VarMemory::Reset()
{
        VALGRIND_MAKE_MEM_DEFINED(&heapstore[0], sizeof(heapstore[0]) * heapstore.size());

//        DEBUGPRINT("Destroying blobs");
        // Destroy all blobs and objects in stack
        for (unsigned i=0;i<stacksize;++i)
        {
                Dereference_Externals(stackstore[i]);
                if (stackstore[i].type == VariableTypes::Object)
                    DereferenceObjectMembers(stackstore[i].data.object);
        }

        // Destroy all blobs and objects in heap
        for (HeapStore::iterator it = heapstore.begin(); it != heapstore.end(); ++it)
        {
                Dereference_Externals(*it);
                if (it->type == VariableTypes::Object)
                    DereferenceObjectMembers(it->data.object);
        }

        stacksize = 0;
        stackstore.clear();
        heapstore.clear();
}

//Copies the variable is_src to id_dest, regardless of the id_dest type.

void VarMemory::CopyFrom(VarId id_dest, VarId id_src)
{
        //if copying to self, return
        if (id_dest==id_src)
            return;

        assert(id_src != 0);
        assert(id_dest != 0);

        const VarStore *src=GetVarReadPtr(id_src);

        //if copying a Notype (reserved), to self, return (no data to copy)
        if (src->type==VariableTypes::Uninitialized)
            ThrowInternalError("Copying uninitialized variable");

        //If the source type is backed by sharedbuffer data, increase its reference count
        if (IsBacked(*src))
        {
                backings.DuplicateReference(src->data.anybackedtype.bufpos);
                if (src->type == VariableTypes::Object)
                {
                        ObjectBacking *backing=static_cast< ObjectBacking * >(backings.GetWritePtr(src->data.anybackedtype.bufpos));
                        ++backing->strongreferences;
                        //DEBUGPRINT("Add strong ref to " << src->data.object.backed.bufpos << ", now " << backing->strongreferences);
                }
        }

        // Add a reference if copying a blob
        if (src->type==VariableTypes::Blob && src->data.blob.blob)
            src->data.blob.blob->InternalAddReference();

        //Create a copy of the source buffer (it may be destroyed)
        VarStore temp(*src);

        //Recyle the variable so that it can be reused, but don't create a backing buffer
        //NOTE: if id_src referred to an array that was held by id_dest, (possible)
        //      then this action will destroy the original id_src
        VarStore *dest = RecycleVariable(id_dest,src->type,0);

        //Copy the contents of the source variable, which will also cause
        //it to point at the proper buffer, if necessary
        *dest = temp;
}

void VarMemory::MoveFrom(VarId id_dest, VarId id_src)
{
        //if copying to self, return
        if (id_dest==id_src)
            return;

        assert(id_src != 0);
        assert(id_dest != 0);

        // Copy data directly, and invalidate src
        VarStore *dest = RecycleVariable(id_dest,VariableTypes::Uninitialized,0);
        VarStore *src = GetVarWritePtr(id_src);
        *dest = *src;
        src->type = VariableTypes::Uninitialized;
}

void VarMemory::InitVariable(VarId id, VariableTypes::Type type)
{
        /* ADDME: initializevariable could be sped up a bit by implementing
                  all double-integer types as a simple memset(), and only do
                  special things for the special cases */
        if (type & VariableTypes::Array)
        {
                ArrayInitialize(id,0,type);
                return;
        }

        switch (type)
        {
        case VariableTypes::Schema:
                SetInteger  (id,0);
                break;
        case VariableTypes::Table:
                SetTable(id,0);
                break;
        case VariableTypes::Integer:
                SetInteger  (id,0);
                break;
        case VariableTypes::Money:
                SetMoney  (id,0);
                break;
        case VariableTypes::Integer64:
                SetInteger64(id,0);
                break;
        case VariableTypes::Float:
                SetFloat  (id,0);
                break;
        case VariableTypes::String:
                SetString<const char*>(id,NULL,NULL);
                break;
        case VariableTypes::Boolean:
                SetBoolean  (id,false);
                break;
        case VariableTypes::DateTime:
                SetDateTime(id,Blex::DateTime(0, 0));
                break;
        case VariableTypes::Record:
                RecordInitializeNull(id);
                break;
        case VariableTypes::FunctionRecord:
                FunctionRecordInitializeEmpty(id);
                break;
        case VariableTypes::Blob:
                SetBlob(id, BlobRefPtr(NULL));
                break;
        case VariableTypes::VMRef:
                SetVMRef(id, nullptr);
                break;
        case VariableTypes::Object:
                ObjectInitializeDefault(id);
                break;
        case VariableTypes::WeakObject:
                WeakObjectInitializeDefault(id);
                break;

        default:
            ThrowVMRuntimeError(Error::NoTypeDefaultValue, HareScript::GetTypeName(type).c_str());
        }
}

//---------------------------------------------------------------------------
//
// VarMemory stack management functions
//
//---------------------------------------------------------------------------

VarId VarMemory::PushVariables(unsigned numvars)
{
        unsigned oldptr = stacksize;
        if (numvars)
        {
                stacksize += numvars;
                VARMEMPROF(prof->maxstackvars=std::max(prof->maxstackvars,stackstore.size()));

                StackStore::iterator it = stackstore.begin() + stacksize;
                if (it > stackstore.end()) // FIXME: this is undefined behaviour in C++ ('it' points into unallocated space); though it is the fastest way to do this :-(.
                {
                        stackstore.resize(std::max<std::size_t>(stacksize, stackstore.size()*2)); //grow at least 2-expontially
                        it = stackstore.begin() + stacksize;
                }

                for (; numvars; --numvars)
                {
                        --it;
                        it->type = VariableTypes::Uninitialized;
                }
        }
        return UnmapStackId(oldptr);

/*/
        unsigned oldptr = GetStackPointer();
        if (stacksize + numvars >= stackstore.size()) //need more stack space..
            stackstore.resize(std::max(stacksize+numvars, stackstore.size()*2)); //grow at least 2-expontially

        for (unsigned i=0;i<numvars;++i)
            stackstore[stacksize+i].type = VariableTypes::Uninitialized;
        stacksize+=numvars;
        VARMEMPROF(prof->maxstackvars=std::max(prof->maxstackvars,stackstore.size()));

        return UnmapStackId(oldptr);//*/
}

/* ADDME: Duplicates CopyFrom code?! */
VarId VarMemory::PushCopy(VarId id_src)
{
        VarId id_dest = PushVariables(1);

        const VarStore *src=GetVarReadPtr(id_src);
                  /*
        if (IsBadReadPtr(src,1))
                std::cerr<<"bad read pointer\n";
                  */
        //if copying a Notype (reserved), to self, return (no data to copy)
        if (src->type==VariableTypes::Uninitialized)
            ThrowInternalError("Copying uninitialized variable");

        //If the source type is backed by sharedbuffer data, increase its reference count
        if (IsBacked(*src))
        {
                backings.DuplicateReference(src->data.anybackedtype.bufpos);
                if (src->type == VariableTypes::Object)
                {
                        ObjectBacking *backing=static_cast< ObjectBacking * >(backings.GetWritePtr(src->data.anybackedtype.bufpos));
                        ++backing->strongreferences;
                        //DEBUGPRINT("Add strong ref to " << src->data.object.backed.bufpos << ", now " << backing->strongreferences);
                }
        }

        // Add a reference if copying a blob
        if (src->type==VariableTypes::Blob && src->data.blob.blob)
            src->data.blob.blob->InternalAddReference();

        // Store the data
        *GetVarWritePtr(id_dest) = *src;

        return id_dest;
}

void VarMemory::PopVariablesN (unsigned numvars)
{
        if (numvars)
        {
                //loop through all variables to destroy them
                StackStore::iterator it = stackstore.begin() + stacksize - 1;
                stacksize -= numvars;

                while (true)
                {
                    RecycleVariableInternal2(&*it, VariableTypes::Uninitialized, 0);
                    if (!--numvars)
                        break;
                    --it;
                }
        }
/*        //loop through all variables to destroy them
        for (StackId var = GetStackPointer() - numvars; var < GetStackPointer(); ++var)
            RecycleVariable(UnmapStackId(var),VariableTypes::Uninitialized,0);

        stacksize -= numvars;*/
}

void VarMemory::PopDeepVariables (unsigned numvars, unsigned keep)
{
        if (!numvars)
            return;

        StackStore::iterator dest = stackstore.begin() + stacksize - numvars - keep;
        StackStore::iterator dest_copy = dest;

        for (unsigned idx = 0; idx < numvars; ++idx, ++dest_copy)
        {
                RecycleVariableInternal2(&*dest_copy, VariableTypes::Uninitialized, 0);
        }

        if (keep)
        {
                StackStore::iterator source = dest + numvars;

                for (; keep; --keep)
                {
                        *dest++ = *source;
                        source++->type = VariableTypes::Uninitialized;
                }
        }
        stacksize -= numvars;
}

void VarMemory::Swap()
{
        StackId ptr = GetStackPointer();
        std::iter_swap(stackstore.begin() + ptr - 2, stackstore.begin() + ptr - 1);
}

void VarMemory::SwapVariables(VarId a, VarId b)
{
        VarStore *store_a = GetVarWritePtr(a);
        VarStore *store_b = GetVarWritePtr(b);
        std::swap(*store_a, *store_b);
}

VarId VarMemory::StackStart() const
{
        return UnmapStackId(0);
}

BasePointer VarMemory::GetBasePointer()
{
        BasePointer bp;
        bp.id = basepointer;
        return bp;
}

/** Enters a new stackframe, returns old base pointer (to be given to LeaveStackFrame */
BasePointer VarMemory::EnterStackFrame(unsigned numvars)
{
//        Blex::ErrStream() << "ESF pre  " << basepointer << " " << GetStackPointer();

        BasePointer bp;
        bp.id = basepointer;
        basepointer = GetStackPointer();
        PushVariables(numvars);

//        Blex::ErrStream() << "ESF post " << basepointer << " " << GetStackPointer();
        return bp;
}

/** Leaves stack frame, destroys local variables and parameters */
void VarMemory::LeaveStackFrame(const BasePointer& oldbase, unsigned returnvalues, unsigned parameters)
{
//        Blex::ErrStream() << "LSF pre  " << basepointer << " " << GetStackPointer();
        assert(GetStackPointer() + parameters >= basepointer + returnvalues);

        PopDeepVariables(GetStackPointer() - basepointer - returnvalues + parameters, returnvalues);
        basepointer = oldbase.id;

//        Blex::ErrStream() << "LSF post " << basepointer << " " << GetStackPointer();
}

void VarMemory::SaveStackFrame(unsigned returnvalues, unsigned parameters, VarId target)
{
        unsigned numvars = GetStackPointer() - basepointer - returnvalues + parameters;
        VarId source = UnmapStackId(GetStackPointer()) - numvars - returnvalues;
//        Blex::ErrStream() << "SAL pre  " << basepointer << " " << GetStackPointer() << " " << source << " " << numvars;

        ArrayInitialize(target, numvars, VariableTypes::VariantArray);

        for (unsigned idx = 0; idx < numvars; ++idx)
        {
                VarId target_elt = ArrayElementRef(target, idx);
//                Blex::ErrStream() << " sal move " << source + idx;
                if (GetType(source + idx) == VariableTypes::Uninitialized)
                    SetBoolean(target_elt, false);
                else
                    MoveFrom(target_elt, source + idx);
        }
}

BasePointer VarMemory::RestoreStackFrame(unsigned returnvalues, unsigned parameters, VarId source)
{
//        Blex::ErrStream() << "RSF pre  " << basepointer << " " << GetStackPointer() << " " << returnvalues << " " << parameters;

        BasePointer bp;
        bp.id = basepointer;
        basepointer = GetStackPointer() - returnvalues + parameters;

        unsigned numvars = ArraySize(source);

        VarId start = PushVariables(numvars) - returnvalues;
        for (unsigned i = 0; i < returnvalues; ++i)
            MoveFrom(start + numvars + i, start + i);
        for (unsigned i = 0; i < numvars; ++i)
            MoveFrom(start + i, ArrayElementRef(source, i));

//        Blex::ErrStream() << "RSF post " << basepointer << " " << GetStackPointer();

        return bp;
}

void VarMemory::SetLocalStackSize(unsigned size)
{
        PopVariablesN(GetStackPointer() - basepointer - size);
}

//---------------------------------------------------------------------------
//
// VarMemory heap management functions
//
//---------------------------------------------------------------------------

VarId VarMemory::InternalNewHeapVariable()
{
        VarId test=UnmapHeapId(NewReservedHeapBuffer());
//        DEBUGPRINT(std::hex << ">> alloc " << test << std::dec);
        return test;
}

void VarMemory::InternalDeleteHeapVariable(VarId varid)
{
        assert(IsOnHeap(varid));
        RecycleVariable(varid, VariableTypes::Uninitialized, 0);
        DeleteHeapBuffer(MapHeapId(varid));
//        DEBUGPRINT(std::hex << ">> delete " << varid << std::dec);
}

VarId VarMemory::NewHeapVariable()
{
        VarId test=InternalNewHeapVariable();
        external_heap_vars.insert(test);
        return test;
}

void VarMemory::DeleteHeapVariable(VarId varid)
{
        InternalDeleteHeapVariable(varid);
        external_heap_vars.erase(varid);
}

/* we maintain a single-linked list of free heap items, with 'freeheapid' pointing
   to the front of the list. free heaps are used in LIFO order */
VarMemory::HeapId VarMemory::NewReservedHeapBuffer()
{
        VarMemory::HeapId result;

        if (freeheapid == EndOfFreeList) //no more free blocks
        {
                unsigned cursize = heapstore.size();
                heapstore.resize(cursize + 256);
                if (keep_allocstats)
                    heapallocrefs.resize(cursize + 256);
                freeheapid = cursize;
                for (HeapStore::iterator it = heapstore.begin() + cursize, end = heapstore.end() - 1; it != end; ++it)
                {
                        it->type = VariableTypes::Uninitialized;
                        it->data.freeheap.nextfreeblock = ++cursize;
                }
                heapstore.end()[-1].data.freeheap.nextfreeblock = EndOfFreeList;
                heapstore.end()[-1].type = VariableTypes::Uninitialized;
        }

        result = freeheapid;

        assert(heapstore[result].type == VariableTypes::Uninitialized);

        freeheapid = heapstore[result].data.freeheap.nextfreeblock;

        if (keep_allocstats)
        {
              assert(heapallocrefs.size() == heapstore.size());
              heapallocrefs[result] = allocstats;
              if (allocstats)
                  ++allocstats->allocated_heap;
        }

        return result;
}

void VarMemory::DeleteHeapBuffer  (HeapId heap_id)
{
        VarStore *store = &heapstore[heap_id];
        assert(store->data.anybackedtype.bufpos==SharedPool::AllocationUnused);

        // Make current contents undefined
        VALGRIND_MAKE_MEM_UNDEFINED(store, sizeof(*store));

        store->data.anybackedtype.bufpos = SharedPool::AllocationUnused; // Needed for valgrind (before setting nextfreeblock, may overlap)
        store->data.freeheap.nextfreeblock = freeheapid;
        store->type = VariableTypes::Uninitialized;

        freeheapid=heap_id;

        if (keep_allocstats)
        {
                AllocStats *stats = heapallocrefs[heap_id];
                heapallocrefs[heap_id] = 0;
                if (stats)
                    --stats->allocated_heap;
        }
}

void*  VarMemory::WriteableBuffer(VarBackedType *var, unsigned newsize,bool preserve_contents)
{
        if (var->bufpos!=SharedPool::AllocationUnused)
            var->bufpos=backings.MakePrivate(var->bufpos,newsize,preserve_contents);
        else
            var->bufpos=backings.Allocate(newsize,newsize);

        VARMEMPROF(if (backings.GetTotalLength() > prof->maxbackingsize)
                       prof->maxbackingsize=backings.GetTotalLength());

        return backings.GetWritePtr(var->bufpos);
}

//---------------------------------------------------------------------------
//
// VarMemory Uncategorized variable management functions
//
//---------------------------------------------------------------------------

void VarMemory::Clear(VarId id)
{
        RecycleVariable(id, VariableTypes::Uninitialized, 0);
}

//---------------------------------------------------------------------------
//
// VarMemory Record functions
//
//---------------------------------------------------------------------------

void VarMemory::InternalSetRecord (VarId id, unsigned length, VariableTypes::Type type)
{
        VarRecord *var = &RecycleVariable(id,type,length*sizeof(RecordColumn))->data.record;
        assert(length <= VarRecord::CountMask);
        var->numcells = length;

        if (length)
        {
                RecordColumn *columns=static_cast<RecordColumn *>(backings.GetWritePtr(var->backed.bufpos));
                for (unsigned i=0; i<length; ++i)
                {
                        // Allocation-adres is safe on InternalNewHeapVariable()
                        columns[i].nameid=0;
                        columns[i].varid=InternalNewHeapVariable();
                }
        }
}

void VarMemory::RecordInitializeNull(VarId id)
{
        VarRecord *var = &RecycleVariable(id,VariableTypes::Record,0)->data.record;
        var->numcells = VarRecord::NonExistent;
}

void VarMemory::RecordInitializeEmpty(VarId id)
{
        VarRecord *var = &RecycleVariable(id,VariableTypes::Record,0)->data.record;
        var->numcells = 0;
}

void VarMemory::DestroyRecordElements(const VarRecord &todestroy)
{
        if (todestroy.numcells & VarRecord::CountMask)
        {
                unsigned bufpos = todestroy.backed.bufpos;
                //Destroy all seperate elements
                for (unsigned i=0;i<todestroy.numcells;++i)
                {
                        const RecordColumn *record=static_cast<const RecordColumn *>(backings.GetReadPtr(bufpos));
                        InternalDeleteHeapVariable(record[i].varid);
                }
        }
}

bool  VarMemory::RecordNull (VarId record_id) const
{
        assert(GetType(record_id) == VariableTypes::Record || GetType(record_id) == VariableTypes::FunctionRecord);
        const VarRecord *var=&GetVarReadPtr(record_id)->data.record;
        return var->numcells & VarRecord::NonExistent;
}

bool VarMemory::RecordCellCopyByName(VarId record_id, ColumnNameId nameid, VarId copy)
{
        //DEBUGPRINT("GetRecordColumn("<<record_id<<","<<nameid<<")");
        if (GetType(record_id) != VariableTypes::Record && GetType(record_id) != VariableTypes::FunctionRecord)
            ThrowInternalError("RecordCellCopyByName got no record");
        assert(GetType(record_id) == VariableTypes::Record || GetType(record_id) == VariableTypes::FunctionRecord);

        //Obtain record itself
        const VarRecord *var=&GetVarReadPtr(record_id)->data.record;

        // Search all columns
        unsigned numcells = var->numcells & VarRecord::CountMask;
        if (numcells)
        {
                RecordColumn const *column=static_cast<const RecordColumn *>(backings.GetReadPtr(var->backed.bufpos));

                for (unsigned idx = 0; idx != numcells; ++idx, ++column)
                   if (column->nameid == nameid)
                {
                        CopyFrom(copy, column->varid);
                        return true;
                }
        }
        return false;
}

VarId VarMemory::RecordCellGetByName(VarId record_id, ColumnNameId nameid) const
{
        //DEBUGPRINT("GetRecordColumn("<<record_id<<","<<nameid<<")");
        if (GetType(record_id) != VariableTypes::Record && GetType(record_id) != VariableTypes::FunctionRecord)
            ThrowInternalError("RecordCellCopyByName got no record");
        assert(GetType(record_id) == VariableTypes::Record || GetType(record_id) == VariableTypes::FunctionRecord);

        //Obtain record itself
        const VarRecord *var=&GetVarReadPtr(record_id)->data.record;

        unsigned numcells = var->numcells & VarRecord::CountMask;
        if (numcells)
        {
                RecordColumn const *column=static_cast<const RecordColumn *>(backings.GetReadPtr(var->backed.bufpos));

                // Search all columns
                for (unsigned idx = 0; idx != numcells; ++idx, ++column)
                    if (column->nameid == nameid)
                        return column->varid;
        }
        return 0;
}


ColumnNameId VarMemory::RecordCellNameByNr(VarId record_id, unsigned num) const
{
        assert(GetType(record_id) == VariableTypes::Record || GetType(record_id) == VariableTypes::FunctionRecord);

        //Obtain record itself
        const VarRecord *var=&GetVarReadPtr(record_id)->data.record;
        assert(!(var->numcells & VarRecord::NonExistent) && num < var->numcells);

        const RecordColumn *column=static_cast<const RecordColumn *>(backings.GetReadPtr(var->backed.bufpos));

        // Search all columns
        return column[num].nameid;
}

bool VarMemory::RecordCellExists(VarId record_id, ColumnNameId nameid)
{
        //Obtain record itself. Write ptr, we need to write
        assert(GetType(record_id) == VariableTypes::Record || GetType(record_id) == VariableTypes::FunctionRecord);

        VarRecord const *var=&GetVarReadPtr(record_id)->data.record;

        // Search all columns
        unsigned numcells = var->numcells & VarRecord::CountMask;
        if (numcells)
        {
                RecordColumn const *column=static_cast<RecordColumn const *>(backings.GetReadPtr(var->backed.bufpos));

                for (unsigned idx = 0; idx != numcells; ++idx, ++column)
                  if (column->nameid == nameid)
                    return true;
        }

        return false;
}

VarId VarMemory::RecordCellRefByNameCreate(VarId record_id, ColumnNameId nameid, bool create, bool exclusive)
{
        //Obtain record itself. Write ptr, we need to write
        assert(GetType(record_id) == VariableTypes::Record || GetType(record_id) == VariableTypes::FunctionRecord);

        /* Make the record writeable. Although we are not sure that the user
           is actually going to write to the record, we lose control over
           the returned VarId and can't prevent the user from writing (and modifying other arrays
           that share storage space with this record) */

        MakeRecordWritable(record_id);

        VarRecord *var=&GetVarWritePtr(record_id)->data.record;

        unsigned numcells = var->numcells & VarRecord::CountMask;
        if (numcells)
        {
                RecordColumn *column=static_cast<RecordColumn *>(backings.GetWritePtr(var->backed.bufpos));

                // Search all columns
                for (unsigned idx = 0; idx != numcells; ++idx, ++column)
                    if (column->nameid == nameid)
                    {
                            if (create && exclusive)
                                ThrowVMRuntimeError(Error::ColumnNameAlreadyExists, columnnamemapper.GetReverseMapping(nameid).stl_str().c_str());
                            return column->varid;
                    }
        }

        // Not found!
        if (!create)
            return 0;

        // Expand the record
        MakeRecordWritable(record_id, (var->numcells & VarRecord::CountMask)+1);
        var = &GetVarWritePtr(record_id)->data.record;
        RecordColumn *mod_column = static_cast<RecordColumn *>(backings.GetWritePtr(var->backed.bufpos));
        mod_column[var->numcells-1].nameid = nameid;
        return mod_column[var->numcells-1].varid;
}

bool VarMemory::RecordCellDelete (VarId record_id, ColumnNameId nameid)
{
        assert(GetType(record_id) == VariableTypes::Record || GetType(record_id) == VariableTypes::FunctionRecord);

        {
                // Don't want to call MakeRecordWritable on an non-existing record, it makes them empty records.
                VarRecord const *var=&GetVarReadPtr(record_id)->data.record;
                if (var->numcells & VarRecord::NonExistent || !var->numcells)
                    return false;
        }
        MakeRecordWritable(record_id);

        VarRecord *var=&GetVarWritePtr(record_id)->data.record;
        RecordColumn *column=static_cast<RecordColumn *>(backings.GetWritePtr(var->backed.bufpos));

        // Search all columns
        int32_t killindex = -1;
        unsigned numcells = var->numcells & VarRecord::CountMask;
        for (unsigned idx = 0; idx != numcells; ++idx)
            if (column[idx].nameid == nameid)
            {
                    killindex = idx;
                    break;
            }
        if (killindex == -1)
            return false;

        // Save the id of the variable we'll kill, because that is going to be removed by the memmove
        VarId killid = column[killindex].varid;

        memmove(&column[killindex], &column[killindex + 1], (var->numcells - killindex - 1) * sizeof(RecordColumn));
        --var->numcells;

        WriteableBuffer(&var->backed,var->numcells*sizeof(RecordColumn),true);

        // Kill the heap variable we did just remove
        InternalDeleteHeapVariable(killid);
        return true;
}

unsigned VarMemory::RecordSize(VarId record_id) const
{
        return GetVarReadPtr(record_id)->data.record.numcells & VarRecord::CountMask;
}

void VarMemory::MakeRecordWritable(VarId record_id, signed newlength)
{
        assert(GetType(record_id) == VariableTypes::Record || GetType(record_id) == VariableTypes::FunctionRecord);

        //Obtain record itself. Make it empty if non-existing.
        VarRecord *var=&GetVarWritePtr(record_id)->data.record;
        if (var->numcells & VarRecord::NonExistent)
            var->numcells = 0;

        if (newlength < 0)
            newlength = var->numcells;

        assert(newlength >= static_cast<int32_t>(var->numcells));

        //If we have the only reference, then don't bother copying all elements
        if ((var->backed.bufpos == SharedPool::AllocationUnused
                || !backings.IsShared(var->backed.bufpos)))
        {
                if (static_cast<int32_t>(var->numcells) == newlength)
                    return;
                unsigned oldlen = var->numcells;
                var->numcells = newlength;
                RecordColumn *newcolumn=static_cast<RecordColumn *>(WriteableBuffer(&var->backed, newlength * sizeof(RecordColumn), true));
                // Initialize new elements
                for (signed idx = oldlen; idx != newlength; ++idx)
                {
                        newcolumn[idx].nameid=0;
                        newcolumn[idx].varid=InternalNewHeapVariable();
                }
                return;
        }

        VarRecord oldvar = *var;
        // Build a new record, over ourselves
        InternalSetRecord(record_id, newlength, GetType(record_id));
        VarRecord newvar = GetVarReadPtr(record_id)->data.record;

        for (unsigned idx = 0; idx < oldvar.numcells; ++idx)
        {
                RecordColumn *newcolumn=static_cast<RecordColumn *>(backings.GetWritePtr(newvar.backed.bufpos));
                const RecordColumn *oldcolumn=static_cast<const RecordColumn *>(backings.GetReadPtr(oldvar.backed.bufpos));
                newcolumn[idx].nameid = oldcolumn[idx].nameid;
                CopyFrom(newcolumn[idx].varid, oldcolumn[idx].varid);
        }
}

void VarMemory::RecordThrowCellNotFound(VarId record_id, std::string const &name)
{
        assert(GetType(record_id) == VariableTypes::Record || GetType(record_id) == VariableTypes::FunctionRecord);
        const VarRecord *var=&GetVarReadPtr(record_id)->data.record;

        if (!(var->numcells & VarRecord::CountMask))
            ThrowVMRuntimeError(Error::UnknownColumn, name.c_str());

        const RecordColumn *column=static_cast<const RecordColumn *>(backings.GetReadPtr(var->backed.bufpos));

        int bestmapping = -1;
        std::string bestname;

        for (unsigned i = 0; i < var->numcells; ++i)
        {
                std::string cellname = columnnamemapper.GetReverseMapping(column[i].nameid).stl_str();

                int ld = Blex::LevenshteinDistance(name, cellname);
                if (bestmapping == -1 || ld < bestmapping)
                {
                        //DEBUGPRINT("Mapping '" << cellname << "' better (" << ld << ") than previous mapping '" << bestname << "' (" << bestmapping << ")");
                        bestmapping = ld;
                        bestname = cellname;
                }
        }
        if (bestmapping == 1 || bestmapping == 2)
            ThrowVMRuntimeError(Error::MisspelledColumn, name.c_str(), bestname.c_str());
        else
            ThrowVMRuntimeError(Error::UnknownColumn, name.c_str());
}

VarId VarMemory::RecordCellTypedGetByName  (VarId record_id, ColumnNameId nameid, VariableTypes::Type type, bool required)
{
        VarId val = RecordCellGetByName(record_id, nameid);
        if (val)
        {
            if (GetType(val) != type && type != VariableTypes::Variant)
                ThrowVMRuntimeError(Error::CellWrongType, columnnamemapper.GetReverseMapping(nameid).stl_str().c_str(), GetTypeName(type).c_str());
        }
        else if (required)
            RecordThrowCellNotFound(record_id, columnnamemapper.GetReverseMapping(nameid).stl_str());
        return val;
}

VarId VarMemory::RecordCellTypedRefByName  (VarId record_id, ColumnNameId nameid, VariableTypes::Type type, bool required)
{
        VarId val = RecordCellRefByName(record_id, nameid);
        if (val)
        {
            if (GetType(val) != type && type != VariableTypes::Variant)
                ThrowVMRuntimeError(Error::CellWrongType, columnnamemapper.GetReverseMapping(nameid).stl_str().c_str(), GetTypeName(type).c_str());
        }
        else if (required)
            RecordThrowCellNotFound(record_id, columnnamemapper.GetReverseMapping(nameid).stl_str());
        return val;
}


//---------------------------------------------------------------------------
//
// FunctionRecord specific functions
//
//---------------------------------------------------------------------------

void VarMemory::FunctionRecordInitializeEmpty(VarId id)
{
        VarRecord *var = &RecycleVariable(id,VariableTypes::FunctionRecord,0)->data.record;
        var->numcells = 0;
}

void VarMemory::ConvertRecordToFunctionRecord(VarId id)
{
        VarStore *var = GetVarWritePtr(id);
        assert(var->type == VariableTypes::Record);
        var->type = VariableTypes::FunctionRecord;
}

//---------------------------------------------------------------------------
//
// Object specific functions
//
//---------------------------------------------------------------------------

VarMemory::ObjectCell const * VarMemory::ObjectFindCellFromBacking(ObjectBacking const *backing, ColumnNameId nameid, bool this_access) const
{
        ObjectCell const *cell=static_cast< ObjectCell const * >(backings.GetReadPtr(backing->cellbufpos));
        for (ObjectCell const *end = cell + backing->numcells; cell != end; ++cell)
            if (cell->nameid == nameid)
            {
                  if (cell->is_private && !this_access)
                      ThrowVMRuntimeError(Error::PrivateMemberOnlyThroughThis);
                  return cell;
            }
        return 0;
}

VarMemory::ObjectCell * VarMemory::ObjectFindCellFromBacking(ObjectBacking const *backing, ColumnNameId nameid, bool this_access)
{
        ObjectCell *cell=static_cast< ObjectCell * >(backings.GetWritePtr(backing->cellbufpos));
        for (ObjectCell *end = cell + backing->numcells; cell != end; ++cell)
            if (cell->nameid == nameid)
            {
                  if (cell->is_private && !this_access)
                      ThrowVMRuntimeError(Error::PrivateMemberOnlyThroughThis);
                  return cell;
            }
        return 0;
}

VarMemory::ObjectCell * VarMemory::ObjectFindCell(VarId object, ColumnNameId nameid, bool this_access)
{
        VarObject *var = &GetVarWritePtr(object)->data.object;
        if (var->backed.bufpos == SharedPool::AllocationUnused)
            ThrowVMRuntimeError(Error::DereferencedDefaultObject);

        ObjectBacking *backing=static_cast< ObjectBacking * >(backings.GetWritePtr(var->backed.bufpos));

        return ObjectFindCellFromBacking(backing, nameid, this_access || var->is_privileged);
}

void VarMemory::ObjectInitializeDefault(VarId id)
{
        VarStore *dest = RecycleVariable(id,VariableTypes::Object,0);
        dest->data.object.is_privileged = false;
}

bool VarMemory::ObjectExists(VarId id)
{
        VarObject const *var = &GetVarReadPtr(id)->data.object;
        return var->backed.bufpos != SharedPool::AllocationUnused;
}

void VarMemory::ObjectInitializeEmpty(VarId id)
{
        VarObject *var = &RecycleVariable(id,VariableTypes::Object,sizeof(ObjectBacking))->data.object;
        var->is_privileged = false;

        // Allocation of this data could cause the objectbacking to move if done later, so do it first.
        // Preallocation of 8 members is chosen to stay below the dyanmic allocation border of sharedpool (starts at 177 bytes)
        SharedPool::Allocation newbuf = backings.Allocate(0, 8*sizeof(ObjectCell));

        ObjectBacking *backing=static_cast< ObjectBacking * >(backings.GetWritePtr(var->backed.bufpos));
        backing->strongreferences = 1;
        backing->typedescriptor = nullptr;
        backing->cellbufpos = newbuf;
        backing->numcells = 0;
        backing->contextbufpos = SharedPool::AllocationUnused;
        backing->numcontexts = 0;
        backing->has_deletable_members = 0;
        ++objectcount;
        //DEBUGPRINT("Init strong ref to " << var->backed.bufpos << ", now " << backing->strongreferences);
}

bool VarMemory::ObjectMemberInsert(VarId id, ColumnNameId nameid, bool this_access, bool is_private, bool is_deletable, VarId new_value)
{
        VarId var = ObjectMemberCreate(id, nameid, this_access, is_private, is_deletable, GetType(new_value));
        if (!var)
            return false;
        CopyFrom(var, new_value);
        return true;
}

bool VarMemory::ObjectMemberInsertDefault(VarId id, ColumnNameId nameid, bool this_access, bool is_private, bool is_deletable, VariableTypes::Type type)
{
        VarId var = ObjectMemberCreate(id, nameid, this_access, is_private, is_deletable, type);
        if (!var)
            return false;
        InitVariable(var, type);
        return true;
}

VarId VarMemory::ObjectMemberCreate(VarId id, ColumnNameId nameid, bool this_access, bool is_private, bool is_deletable, VariableTypes::Type type)
{
        VarObject *var = &GetVarWritePtr(id)->data.object;
        if (var->backed.bufpos == SharedPool::AllocationUnused)
            ThrowVMRuntimeError(Error::DereferencedDefaultObject);

        ObjectBacking *backing=static_cast< ObjectBacking * >(backings.GetWritePtr(var->backed.bufpos));

        // Check if the member already existed
        ObjectCell *member = ObjectFindCellFromBacking(backing, nameid, true);
        if (member != 0)
            return 0;

        if (!var->is_privileged && !this_access)
            ThrowVMRuntimeError(Error::PrivateMemberOnlyThroughThis);

        // Resize the cell backing. Invalidates member!
        SharedPool::Allocation newpos = backings.MakePrivate(backing->cellbufpos, sizeof(ObjectCell)*(backing->numcells + 1), true);

        // Object backing may be moved due to resize of cell backing, reget it.
        backing=static_cast< ObjectBacking * >(backings.GetWritePtr(var->backed.bufpos));
        backing->cellbufpos=newpos;
        if (is_deletable)
            backing->has_deletable_members = true;

        ObjectCell *cell=static_cast< ObjectCell * >(backings.GetWritePtr(newpos));
        cell += backing->numcells++;
        cell->nameid = nameid;
        cell->is_private = is_private;
        cell->is_deletable = is_deletable;
        cell->contains_no_objects = false; // ADDME: conditionalize this on the type of the new value
        cell->member_type = type;
        cell->varid = InternalNewHeapVariable();
        return cell->varid;
}

bool VarMemory::ObjectMemberDelete(VarId id, ColumnNameId nameid, bool this_access)
{
        assert(GetType(id) == VariableTypes::Object);

        VarObject *var = &GetVarWritePtr(id)->data.object;
        if (var->backed.bufpos == SharedPool::AllocationUnused)
            ThrowVMRuntimeError(Error::DereferencedDefaultObject);

        ObjectBacking *backing=static_cast< ObjectBacking * >(backings.GetWritePtr(var->backed.bufpos));
        ObjectCell *cell=static_cast< ObjectCell * >(backings.GetWritePtr(backing->cellbufpos));

        int32_t killindex = -1;
        for (unsigned idx = 0; idx != backing->numcells; ++idx)
            if (cell[idx].nameid == nameid)
            {
                    killindex = idx;
                    break;
            }
        if (killindex == -1)
            return false;

        ObjectCell *tokill = cell + killindex;

        if (!tokill->is_deletable)
            ThrowVMRuntimeError(Error::MemberDeleteNotAllowed);

        if (!var->is_privileged && !this_access)
            ThrowVMRuntimeError(Error::PrivateMemberOnlyThroughThis);

        // Save the id of the variable we'll kill, because that is going to be removed by the memmove
        VarId killid = tokill->varid;

        memmove(tokill, tokill + 1, (backing->numcells - killindex - 1) * sizeof(ObjectCell));
        --backing->numcells;

        backing->cellbufpos=backings.MakePrivate(backing->cellbufpos, backing->numcells * sizeof(ObjectCell), true);

        // Kill the heap variable we did just remove
        InternalDeleteHeapVariable(killid);
        return true;
}

bool VarMemory::ObjectMemberCopy(VarId var, ColumnNameId nameid, bool this_access, VarId storeto)
{
        ObjectCell *member = ObjectFindCell(var, nameid, this_access);
        if (!member)
            return false;

        CopyFrom(storeto, member->varid);
        return true;
}

bool VarMemory::ObjectMemberSet(VarId var, ColumnNameId nameid, bool this_access, VarId new_value)
{
        ObjectCell *member = ObjectFindCell(var, nameid, this_access);
        if (!member)
            return false;

        member->contains_no_objects = false; // ADDME: conditionalize this on the type of the new value
        CopyFrom(member->varid, new_value); // Invalidates member!
        return true;
}

bool VarMemory::ObjectMemberAccessible(VarId var, ColumnNameId nameid, bool this_access)
{
        ObjectCell *member = ObjectFindCell(var, nameid, true);
        if (!member)
            return false;

        return this_access || !member->is_private;
}

VarId VarMemory::ObjectMemberRef(VarId var, ColumnNameId nameid, bool this_access)
{
        ObjectCell *member = ObjectFindCell(var, nameid, this_access);
        if (!member)
            return 0;
        member->contains_no_objects = false;
        return member->varid;
}

VarId VarMemory::ObjectMemberGet(VarId var, ColumnNameId nameid, bool this_access)
{
        ObjectCell *member = ObjectFindCell(var, nameid, this_access);
        if (!member)
            return 0;
        return member->varid;
}

/* FIXME: De eisen aan destructors moeten worden gedocumenteerd: vanwege de
          destroy loop is het momenteel niet acceptabel dat destructors zelf
          nog in de VM rotzooien via een of andere VM pointer die ze zelf ergens
          vandaag geplukt hebben. */
void VarMemory::DereferenceObjectMembers(VarObject &todestroy)
{
        if (todestroy.backed.bufpos == SharedPool::AllocationUnused)
            return;

        ObjectBacking *backing=static_cast< ObjectBacking * >(backings.GetWritePtr(todestroy.backed.bufpos));
        if (backing->numcontexts)
        {
                // If any cells present, kill em all.
                ObjectContext *cell=static_cast< ObjectContext * >(backings.GetWritePtr(backing->contextbufpos));
                for (unsigned idx = 0, end = backing->numcontexts; idx < end; ++idx, ++cell)
                {
                        CTX_PRINT("Destruct context cell from " << backing->contextbufpos << " at " << cell);
                        CTX_PRINT("Read destructor from " << &cell->ctx.destructor << " is " << (void*)cell->ctx.destructor);

                        if(cell->context_id != ObjectMarshallerContextId && cell->ctx.destructor)
                            (cell->ctx.destructor)(cell->ctx.opaqueptr, cell->ctx.contextptr);
                }
                backing->numcontexts=0;
        }
}

SharedPool::Allocation VarMemory::DestroyObjectElements(VarObject &todestroy)
{
        if (todestroy.backed.bufpos == SharedPool::AllocationUnused)
            return SharedPool::AllocationUnused;

        // Steal the backing from the object; this prevents recursive deletion.
        SharedPool::Allocation bufpos = todestroy.backed.bufpos;
        todestroy.backed.bufpos = SharedPool::AllocationUnused;

        ObjectBacking *backing=static_cast< ObjectBacking * >(backings.GetWritePtr(bufpos));
        if (backing->numcells)
        {
                // If any cells present, kill em all. Don't use todestoy after this point
                ObjectCell *cell=static_cast< ObjectCell * >(backings.GetWritePtr(backing->cellbufpos));
                for (unsigned idx = 0, end = backing->numcells; idx < end; ++idx, ++cell)
                {
                        // This may recursively delete the current variable (todestroy) when called from the collector!!!
                        if(cell->nameid)
                            InternalDeleteHeapVariable(cell->varid);
                }
                backing->numcells = 0;
        }

        if (backing->numcontexts)
        {
                // If any cells present, kill em all. Don't use todestoy after this point
                ObjectContext *cell=static_cast< ObjectContext * >(backings.GetWritePtr(backing->contextbufpos));
                for (unsigned idx = 0, end = backing->numcontexts; idx < end; ++idx, ++cell)
                {
                        CTX_PRINT("Destruct context cell from " << backing->contextbufpos << " at " << cell);
                        CTX_PRINT("Read destructor from " << &cell->ctx.destructor);

                        // This may recursively delete the current variable (todestroy) when called from the collector!!!
                        if (cell->context_id != ObjectMarshallerContextId && cell->ctx.destructor)
                            (cell->ctx.destructor)(cell->ctx.opaqueptr, cell->ctx.contextptr);
                }
                backing->numcontexts = 0;
        }

        backings.ReleaseReference(backing->cellbufpos);
        backing->cellbufpos = SharedPool::AllocationUnused;

        if (backing->contextbufpos != SharedPool::AllocationUnused)
        {
                backings.ReleaseReference(backing->contextbufpos);
                backing->contextbufpos = SharedPool::AllocationUnused;
        }

        // Return the backing (don't put it back, recursive delete may have deleted this variable)
        return bufpos;
}

void *VarMemory::ObjectGetContext (VarId id, unsigned context_id, HSVM_ConstructorPtr cons, HSVM_DestructorPtr des, void*opaque, bool autocreate)
{
        assert(GetType(id) == VariableTypes::Object);

        VarObject const *var = &GetVarReadPtr(id)->data.object;
        if (var->backed.bufpos == SharedPool::AllocationUnused)
            return NULL; //default object

        ObjectBacking *backing=static_cast< ObjectBacking * >(backings.GetWritePtr(var->backed.bufpos));
        if (backing->numcontexts)
        {
                ObjectContext *cell=static_cast< ObjectContext * >(backings.GetWritePtr(backing->contextbufpos));
                for (unsigned idx = 0, end = backing->numcontexts; idx < end; ++idx, ++cell)
                {
                        if(cell->context_id == context_id)
                            return cell->ctx.contextptr;
                }
        }

        if(!autocreate)
            return NULL;

        // Construct the object before manipulating sharedpool (exception resilience)
        void *contextptr = cons(opaque);
        if(!contextptr)
            return NULL;

        // Allocate / expand the context store
        SharedPool::Allocation newpos = backing->contextbufpos == SharedPool::AllocationUnused
            ? backings.Allocate(sizeof(ObjectContext), sizeof(ObjectContext))
            : backings.MakePrivate(backing->contextbufpos, sizeof(ObjectContext)*(backing->numcontexts + 1), true);

        // Backing may have been moved by allocation
        backing=static_cast< ObjectBacking * >(backings.GetWritePtr(var->backed.bufpos));
        CTX_PRINT("Context store of " << id << " reallocated from " << backing->contextbufpos << " to " << newpos);
        backing->contextbufpos=newpos;

        ObjectContext *cell=static_cast< ObjectContext * >(backings.GetWritePtr(newpos));
        cell += backing->numcontexts++;
        cell->context_id = context_id;
        cell->ctx.contextptr = contextptr;
        cell->ctx.opaqueptr = opaque;
        cell->ctx.destructor = des;

        CTX_PRINT("Allocate context cell from " << newpos << " at " << cell);
        CTX_PRINT("Write destructor to " << &cell->ctx.destructor << " is " << (void*)des);

        return contextptr;
}

void VarMemory::ObjectSetMarshaller (VarId id, HSVM_ObjectMarshallerPtr marshaller)
{
        VarObject const *var = &GetVarReadPtr(id)->data.object;
        if (var->backed.bufpos == SharedPool::AllocationUnused)
            ThrowVMRuntimeError(Error::DereferencedDefaultObject);

        ObjectBacking *backing=static_cast< ObjectBacking * >(backings.GetWritePtr(var->backed.bufpos));
        if (backing->numcontexts)
        {
                ObjectContext *cell=static_cast< ObjectContext * >(backings.GetWritePtr(backing->contextbufpos));
                for (unsigned idx = 0, end = backing->numcontexts; idx < end; ++idx, ++cell)
                {
                        if(cell->context_id == ObjectMarshallerContextId)
                            cell->marshaller = marshaller;
                }
        }

        // Allocate / expand the context store
        SharedPool::Allocation newpos = backing->contextbufpos == SharedPool::AllocationUnused
            ? backings.Allocate(sizeof(ObjectContext), sizeof(ObjectContext))
            : backings.MakePrivate(backing->contextbufpos, sizeof(ObjectContext)*(backing->numcontexts + 1), true);

        // Backing may have been moved by allocation
        backing=static_cast< ObjectBacking * >(backings.GetWritePtr(var->backed.bufpos));
        CTX_PRINT("Context store of " << id << " reallocated from " << backing->contextbufpos << " to " << newpos);
        backing->contextbufpos=newpos;

        ObjectContext *cell=static_cast< ObjectContext * >(backings.GetWritePtr(newpos));
        cell += backing->numcontexts++;
        cell->context_id = ObjectMarshallerContextId;
        cell->marshaller = marshaller;
}

HSVM_ObjectMarshallerPtr VarMemory::ObjectGetMarshaller (VarId id)
{
        VarObject const *var = &GetVarReadPtr(id)->data.object;
        if (var->backed.bufpos == SharedPool::AllocationUnused)
            ThrowVMRuntimeError(Error::DereferencedDefaultObject);

        ObjectBacking *backing=static_cast< ObjectBacking * >(backings.GetWritePtr(var->backed.bufpos));
        if (backing->numcontexts)
        {
                ObjectContext *cell=static_cast< ObjectContext * >(backings.GetWritePtr(backing->contextbufpos));
                for (unsigned idx = 0, end = backing->numcontexts; idx < end; ++idx, ++cell)
                {
                        if(cell->context_id == ObjectMarshallerContextId)
                            return cell->marshaller;
                }
        }
        return 0;
}

long VarMemory::GetObjectId(VarId id) const
{
        VarObject const *var = &GetVarReadPtr(id)->data.object;
        if (var->backed.bufpos != SharedPool::AllocationUnused)
        {
                ObjectBacking const *backing=static_cast< ObjectBacking const * >(backings.GetReadPtr(var->backed.bufpos));
                if (!backing->strongreferences)
                {
                        //DEBUGPRINT("GetObjectId of " << var->backed.bufpos << ": no strong refs");
                        return 0;
                }
        }
        return var->backed.bufpos;
}


bool VarMemory::ObjectMemberExists(VarId id, ColumnNameId nameid)
{
        VarObject const *var = &GetVarReadPtr(id)->data.object;
        if (var->backed.bufpos == SharedPool::AllocationUnused)
            return false;

        ObjectBacking const *backing=static_cast< ObjectBacking const * >(backings.GetReadPtr(var->backed.bufpos));

        return ObjectFindCellFromBacking(backing, nameid, true) != 0;
}

ColumnNameId VarMemory::ObjectMemberNameByNr(VarId id, unsigned num)
{
        VarObject *var = &GetVarWritePtr(id)->data.object;
        if (var->backed.bufpos == SharedPool::AllocationUnused)
            ThrowVMRuntimeError(Error::DereferencedDefaultObject);

        ObjectBacking *backing=static_cast< ObjectBacking * >(backings.GetWritePtr(var->backed.bufpos));
        ObjectCell *cell=static_cast< ObjectCell * >(backings.GetWritePtr(backing->cellbufpos));
        if (num >= backing->numcells)
           ThrowInternalError("Object member nr. out of range");

        return (cell + num)->nameid;
}

VariableTypes::Type VarMemory::ObjectMemberType(VarId var, ColumnNameId nameid)
{
        ObjectCell *member = ObjectFindCell(var, nameid, true);
        if (!member)
            return VariableTypes::Variant;
        return member->member_type;
}

unsigned VarMemory::ObjectSize(VarId id)
{
        VarObject *var = &GetVarWritePtr(id)->data.object;
        if (var->backed.bufpos == SharedPool::AllocationUnused)
            ThrowVMRuntimeError(Error::DereferencedDefaultObject);

        ObjectBacking *backing=static_cast< ObjectBacking * >(backings.GetWritePtr(var->backed.bufpos));
        return backing->numcells;
}

void VarMemory::DEBUG_FunctionRecordToRecord(VarId id)
{
        assert (GetType(id) == VariableTypes::FunctionRecord);
        GetVarWritePtr(id)->type = VariableTypes::Record;
}

bool VarMemory::ObjectIsPrivilegedReference(VarId obj)
{
        return GetVarReadPtr(obj)->data.object.is_privileged;
}

void VarMemory::ObjectSetReferencePrivilegeStatus(VarId obj, bool new_state)
{
        GetVarWritePtr(obj)->data.object.is_privileged = new_state;
}

void const * VarMemory::ObjectGetTypeDescriptor(VarId obj)
{
        VarObject const *var = &GetVarReadPtr(obj)->data.object;
        if (var->backed.bufpos == SharedPool::AllocationUnused)
            return nullptr;

        ObjectBacking const *backing=static_cast< ObjectBacking const * >(backings.GetReadPtr(var->backed.bufpos));
        return backing->typedescriptor;
}

void VarMemory::ObjectSetTypeDescriptor(VarId obj, void const *newdescriptor)
{
        VarObject const *var = &GetVarReadPtr(obj)->data.object;
        if (var->backed.bufpos == SharedPool::AllocationUnused)
            ThrowVMRuntimeError(Error::DereferencedDefaultObject);

        ObjectBacking *backing=static_cast< ObjectBacking * >(backings.GetWritePtr(var->backed.bufpos));
        backing->typedescriptor = newdescriptor;
}

bool VarMemory::ObjectHasDeletableMembers(VarId obj)
{
        VarObject const *var = &GetVarReadPtr(obj)->data.object;
        if (var->backed.bufpos == SharedPool::AllocationUnused)
            ThrowVMRuntimeError(Error::DereferencedDefaultObject);

        ObjectBacking *backing=static_cast< ObjectBacking * >(backings.GetWritePtr(var->backed.bufpos));
        return backing->has_deletable_members;
}

bool VarMemory::ObjectIsSharedReference(VarId obj)
{
        VarObject const *var = &GetVarReadPtr(obj)->data.object;
        if (var->backed.bufpos == SharedPool::AllocationUnused)
            return false;
        return backings.IsShared(var->backed.bufpos);
}

void VarMemory::WeakObjectInitializeDefault(VarId id)
{
        VarStore *dest = RecycleVariable(id,VariableTypes::WeakObject,0);
        dest->data.object.is_privileged = false;
}

bool VarMemory::WeakObjectExists(VarId id)
{
        VarStore *src = GetVarWritePtr(id);

        if (src->data.object.backed.bufpos == SharedPool::AllocationUnused)
            return false;

        ObjectBacking *backing = static_cast< ObjectBacking * >(backings.GetWritePtr(src->data.object.backed.bufpos));
        return backing->strongreferences;
}

void VarMemory::ConvertObjectToWeakObject(VarId id)
{
        assert(GetType(id) == VariableTypes::Object);
        VarStore *src = GetVarWritePtr(id);

        if (src->data.object.backed.bufpos != SharedPool::AllocationUnused)
        {
                ObjectBacking *backing = static_cast< ObjectBacking * >(backings.GetWritePtr(src->data.object.backed.bufpos));
                if (backing->strongreferences > 1)
                {
                        --backing->strongreferences;
                        //DEBUGPRINT("Converting " << src->data.object.backed.bufpos << " to weak object by decreasing refs to " << backing->strongreferences);
                        src->type = VariableTypes::WeakObject;
                }
                else
                {
                        //DEBUGPRINT("Converting " << src->data.object.backed.bufpos << " to weak object by recycle");
                        RecycleVariableInternal(src, VariableTypes::WeakObject, 0);
                }
        }
        else
        {
                //DEBUGPRINT("Converting " << src->data.object.backed.bufpos << " to weak object by setting type");
                src->type = VariableTypes::WeakObject;
        }
}

void VarMemory::ConvertWeakObjectToObject(VarId id)
{
        assert(GetType(id) == VariableTypes::WeakObject);

        VarStore *src = GetVarWritePtr(id);

        if (src->data.object.backed.bufpos != SharedPool::AllocationUnused)
        {
                ObjectBacking *backing = static_cast< ObjectBacking * >(backings.GetWritePtr(src->data.object.backed.bufpos));
                if (backing->strongreferences)
                {
                        ++backing->strongreferences;
                        //DEBUGPRINT("Converting " << src->data.object.backed.bufpos << " to strong object by increasing refs to " << backing->strongreferences);
                        src->type = VariableTypes::Object;
                }
                else
                {
                        //DEBUGPRINT("Converting " << src->data.object.backed.bufpos << " to strong object by recycle");
                        RecycleVariableInternal(src, VariableTypes::Object, 0);
                }
        }
        else
        {
                //DEBUGPRINT("Converting " << src->data.object.backed.bufpos << " to strong object by setting type");
                src->type = VariableTypes::Object;
        }
}

//---------------------------------------------------------------------------
//
// VarMemory Array functions
//
//---------------------------------------------------------------------------
void VarMemory::ArrayInitialize(VarId id, int length,VariableTypes::Type arraytype)
{
        assert(arraytype&VariableTypes::Array);

        VarArray *var = &RecycleVariable(id,arraytype,length*sizeof(VarId))->data.array;
        var->numelements=std::max(0,length);

        if (length)
        {
                VarId *array=static_cast<VarId*>(backings.GetWritePtr(var->backed.bufpos));

                for (signed i=0; i<length; ++i)
                    array[i]=InternalNewHeapVariable();
        }
}
VarId VarMemory::ArrayElementAppend (VarId array_id)
{
        assert(GetType(array_id)&VariableTypes::Array);

        /* ADDME: As an optimzation, MakeArrayWritable and extending array could be combined */
        MakeArrayWritable(array_id);                            //Make sure that we can write
        VarId newid=InternalNewHeapVariable();                  //Create new variable

        VarArray *var=&GetVarWritePtr(array_id)->data.array;    //Obtain array elements
        ++var->numelements;                                     //Increase array in length

        //Expand the array to its new size
        VarId *array=static_cast<VarId*>(WriteableBuffer(&var->backed,var->numelements*sizeof(VarId),true));

        //Insert the new ID into the array
        array[var->numelements-1]=newid;

        return newid;
}
VarId VarMemory::ArrayElementInsert (VarId array_id, int before)
{
        assert(GetType(array_id)&VariableTypes::Array);

        /* ADDME: As an optimzation, MakeArrayWritable and extending array could be combined */
        MakeArrayWritable(array_id);                            //Make sure that we can write
        VarId newid=InternalNewHeapVariable();                  //Create new variable

        //Obtain array itself
        VarArray *var =&GetVarWritePtr(array_id)->data.array;
        ++var->numelements;

        //Expand the array to its new size
        VarId *array=static_cast<VarId*>(WriteableBuffer(&var->backed,var->numelements*sizeof(VarId),true));

        //Make room for the new element
        memmove( &array[before+1], &array[before], sizeof(*array) * ((var->numelements-1)-before));

        //Insert the new ID into the array
        array[before]=newid;
        return newid;
}
void VarMemory::ArrayElementDelete (VarId array_id, int which)
{
        assert(GetType(array_id)&VariableTypes::Array);
        if (which < 0)
            return;

        /* ADDME: As an optimzation, MakeArrayWritable and decreasing array size could be combined */
        MakeArrayWritable(array_id);

        //Get the array, and do bounds checking
        VarArray *var = &GetVarWritePtr(array_id)->data.array;
        VarId *array=static_cast<VarId*>(backings.GetWritePtr(var->backed.bufpos));
        assert(which >=0 && (unsigned)which<var->numelements);
        --var->numelements;

        //Destroy the element itself first
        InternalDeleteHeapVariable(array[which]);

        //Move rest of the elements if needed
        if (var->numelements && var->numelements != unsigned(which))
            memmove(&array[which], &array[which+1], sizeof(*array) * (var->numelements-which));

        //Resize the array buffer
        WriteableBuffer(&var->backed,var->numelements*sizeof(VarId),true);
}

unsigned VarMemory::ArraySize(VarId array_id) const
{
        assert(GetType(array_id)&VariableTypes::Array);

        //Obtain array itself
        const VarArray *var=&GetVarReadPtr(array_id)->data.array;
        return var->numelements;
}

void VarMemory::ArrayResize(VarId array_id, int newsize)
{
        assert(GetType(array_id)&VariableTypes::Array);
        if (newsize < 0)
            newsize = 0;

        //Make array writable, and obtain pointer to data
        MakeArrayWritable(array_id);
        VarArray *var=&GetVarWritePtr(array_id)->data.array;

        if (var->numelements > unsigned(newsize))
        {
                // Must size down. Delete all now unused entries
                VarId *array=static_cast<VarId*>(backings.GetWritePtr(var->backed.bufpos));

                for (unsigned idx = newsize, end = var->numelements; idx != end; ++idx)
                    InternalDeleteHeapVariable(array[idx]);

                var->numelements = newsize;

                //Resize the array buffer
                WriteableBuffer(&var->backed,var->numelements*sizeof(VarId),true);
        }
        else if (var->numelements < unsigned(newsize))
        {
                // Get array bits, and update size
                VarArray *var=&GetVarWritePtr(array_id)->data.array;
                unsigned current = var->numelements;
                var->numelements = newsize;

                //Expand the array to its new size
                VarId *array=static_cast<VarId*>(WriteableBuffer(&var->backed,var->numelements*sizeof(VarId),true));

                VariableTypes::Type inittype = ToNonArray(GetType(array_id));

                // Set and init new variables.
                for (; current != unsigned(newsize); ++current)
                {
                        array[current] = InternalNewHeapVariable();
                        InitVariable(array[current], inittype);
                }
        }
}

VarId  VarMemory::ArrayElementRef(VarId array_id, int num)
{
        //DEBUGPRINT("GetElement("<<array_id<<","<<num<<")");
        assert(GetType(array_id)&VariableTypes::Array);

        /* Make the array writeable. Although we are not sure that the user
           is actually going to write to the array, we lose control over
           the returned VarId and can't prevent the user from writing */
        MakeArrayWritable(array_id);

        //Obtain array itself
        const VarArray *var=&GetVarReadPtr(array_id)->data.array;
        assert(num >=0 && (unsigned)num<var->numelements);

        const VarId *array=static_cast<const VarId*>(backings.GetReadPtr(var->backed.bufpos));
        return array[num];
}

VarId VarMemory::ArrayElementGet(VarId array_id, int num) const
{
        //DEBUGPRINT("GetElement("<<array_id<<","<<num<<")");
        assert(GetType(array_id)&VariableTypes::Array);

        //Obtain array itself
        const VarArray *var=&GetVarReadPtr(array_id)->data.array;
        assert(num >=0 && (unsigned)num<var->numelements);

        const VarId *array=static_cast<const VarId*>(backings.GetReadPtr(var->backed.bufpos));
        return array[num];
}

void  VarMemory::ArrayElementCopy(VarId array_id, int num, VarId dest)
{
        //DEBUGPRINT("GetElement("<<array_id<<","<<num<<")");
        assert(GetType(array_id)&VariableTypes::Array);

        //Obtain array itself
        const VarArray *var=&GetVarReadPtr(array_id)->data.array;

        if (num < 0 || unsigned(num) >= var->numelements)
            throw VMRuntimeError (Error::ArrayIndexOutOfBounds, Blex::AnyToString(num));

        CopyFrom(dest, static_cast<const VarId*>(backings.GetReadPtr(var->backed.bufpos))[num]);
}

void VarMemory::DestroyArrayElements(const VarArray &todestroy)
{
        if (todestroy.numelements)
        {
                const VarId *array=static_cast<const VarId*>(backings.GetReadPtr(todestroy.backed.bufpos));

                //Destroy all seperate elements
                for (unsigned i=0;i<todestroy.numelements;++i)
                    InternalDeleteHeapVariable(array[i]);
        }
}

void VarMemory::MakeArrayWritable(VarId array_id)
{
        assert(GetType(array_id)&VariableTypes::Array);

        const VarStore *var=GetVarReadPtr(array_id);

        //If we have the only reference, then don't bother yet
        if (var->data.array.backed.bufpos == SharedPool::AllocationUnused
            || !backings.IsShared(var->data.array.backed.bufpos))
        {
                return;
        }

        //Keep a pointer to the array's buffer (assuming it is unmoveable because there are still referencse)
        unsigned srcarraylength=var->data.array.numelements;
        unsigned srcarraypos=var->data.array.backed.bufpos;

        //Create a new, empty array with the same type we have now, on top of ourselves
        ArrayInitialize(array_id,srcarraylength,var->type);
        var=GetVarReadPtr(array_id);
        unsigned destarraypos=var->data.array.backed.bufpos;

        //Copy all our elements into the new array
        for (unsigned i=0;i<srcarraylength;++i)
        {
                const VarId *srcarray=static_cast<const VarId*>(backings.GetReadPtr(srcarraypos));
                const VarId *destarray=static_cast<const VarId*>(backings.GetWritePtr(destarraypos));
                CopyFrom(destarray[i],srcarray[i]);
        }
}

void VarMemory::SetArrayType(VarId id, VariableTypes::Type newtype)
{
        assert(GetType(id)&VariableTypes::Array);
        assert(newtype&VariableTypes::Array);

        VarStore *var=GetVarWritePtr(id);
        var->type = newtype;
}

//---------------------------------------------------------------------------
//
// VarMemory Blob functions
//
//---------------------------------------------------------------------------
void VarMemory::SetBlob (VarId id, BlobRefPtr blobptr)
{
        //We must be careful not to destroy the blobptr in case of a self-assignment!
        if (blobptr.ptr)
            blobptr.ptr->InternalAddReference();
        try
        {
                VarBlob *var = &RecycleVariable(id,VariableTypes::Blob,0)->data.blob;
                var->blob = blobptr.ptr;
        }
        catch(...)
        {
                blobptr.ptr->InternalRemoveReference();
                throw;
        }
}
BlobRefPtr VarMemory::GetBlob (VarId id) const
{
        assert(GetType(id)==VariableTypes::Blob);

        const VarBlob *var=&GetVarReadPtr(id)->data.blob;
        return BlobRefPtr(var->blob);
}

//---------------------------------------------------------------------------
//
// VarMemory VMRef functions
//
//---------------------------------------------------------------------------
void VarMemory::SetVMRef (VarId id, VirtualMachine *vm)
{
        //We must be careful not to destroy the vmrefptr in case of a self-assignment!
        VarVMRef *var = &RecycleVariable(id,VariableTypes::VMRef,0)->data.vmref;
        var->vm = vm;
}

VirtualMachine * VarMemory::GetVMRef (VarId id) const
{
        assert(GetType(id)==VariableTypes::VMRef);

        const VarVMRef *var=&GetVarReadPtr(id)->data.vmref;
        return var->vm;
}

//---------------------------------------------------------------------------
//
// VarMemory String & Password functions
//
//---------------------------------------------------------------------------
void VarMemory::InternalSetString(VarId varid,
                                           const char* start,
                                           const char* end)
{
        //DEBUGONLY(Debug::Msg("SetString [%.*s]",strend-strstart,strstart));
        VARMEMPROF(++prof->totalvarstringsets);

        unsigned required_size = Blex::PtrDiff(start,end);
        VarBackedType *var = &RecycleVariable
                             (varid,
                              VariableTypes::String,
                              required_size)->data.anybackedtype;

        if (required_size!=0)
        {
                char *backing=static_cast<char*>(backings.GetWritePtr(var->bufpos));
                memcpy(backing,start,required_size);
        }
}

void VarMemory::InternalSetUTF16String(VarId varid,
                                                const uint16_t* start,
                                                const uint16_t* end)
{
        //ADDME: Optimize by pre-calculating required size (and writing straight into VarMem)
        //       instead of using temp std::string
        std::string outstring;
        Blex::UTF8Encode(start, end, std::back_inserter(outstring));
        SetSTLString(varid,outstring);
}

int32_t VarMemory::GetStringSize(VarId id) const
{
        VariableTypes::Type type = GetType(id);
        if (type!=VariableTypes::String)
            ThrowInternalError("MakeStringWritable got no string");

        assert(GetType(id)==VariableTypes::String);
        VarBackedType const *var = &GetVarReadPtr(id)->data.anybackedtype;

        if (var->bufpos==SharedPool::AllocationUnused) //constant string
            return 0;
        else
            return backings.GetBufferSize(var->bufpos);
}

std::pair<char*,char*> VarMemory::ResizeString(VarId id, unsigned newsize)
{
        VarBackedType *var = &GetVarWritePtr(id)->data.anybackedtype;
        unsigned cursize=GetStringSize(id);

        if (newsize == 0) //destroy the string
        {
                InitVariable(id,VariableTypes::String);
                return std::make_pair((char*)0,(char*)0);
        }

        const char *string_begin=NULL;

        //If this is a constant string, save its location and create a new string
        if (var->bufpos==SharedPool::AllocationUnused)
        {
                var = &RecycleVariable(id, VariableTypes::String, newsize)->data.anybackedtype;
        }
        else if (backings.IsShared(var->bufpos) || cursize!=newsize) //non constant string, unshare and resize it
        {
                var->bufpos = backings.MakePrivate(var->bufpos, newsize, true);
        }

        char *backing=static_cast<char*>(backings.GetWritePtr(var->bufpos));
        if (string_begin && cursize>0) //copy the original constant string
            memcpy(backing,string_begin,std::min(newsize,cursize));

        return std::make_pair(backing,backing + newsize);
}

Blex::StringPair VarMemory::GetString (VarId id) const
{
        VariableTypes::Type type = GetType(id);
        if (type!=VariableTypes::String)
            ThrowInternalError("GetString got no string");

        assert(GetType(id)==VariableTypes::String);
        const VarBackedType *var = &GetVarReadPtr(id)->data.anybackedtype;

        if (var->bufpos==SharedPool::AllocationUnused)
        {
                //No backing, so it is a constant string
                return Blex::StringPair::ConstructEmpty();
        }
        else
        {
                //It's backed, so it's not a constant
                const char *backing=static_cast<const char*>(backings.GetReadPtr(var->bufpos));
                return Blex::StringPair(backing,backing+backings.GetBufferSize(var->bufpos));
        }
}

std::string VarMemory::GetSTLString(VarId id) const
{
        return GetString(id).stl_str();
}

void VarMemory::GetUTF16String (VarId id, Blex::UTF16String *store) const
{
        Blex::StringPair source = GetString(id);
        store->clear();
        Blex::UTF8Decode(source.begin, source.end, std::back_inserter(*store));
}


//---------------------------------------------------------------------------
//
// VarMemory Integer functions
//
//---------------------------------------------------------------------------
void VarMemory::SetInteger (VarId id, int32_t s)
{
        VarIntBool *var = &RecycleVariable(id,VariableTypes::Integer,0)->data.intbool;
        var->val=s;
}

int32_t VarMemory::GetInteger(VarId id) const
{
        assert (GetType(id) == VariableTypes::Integer);
        const VarIntBool *var = &GetVarReadPtr(id)->data.intbool;
        return var->val;
}

//---------------------------------------------------------------------------
//
// VarMemory Money functions
//
//---------------------------------------------------------------------------
void VarMemory::SetMoney (VarId id, int64_t s)
{
        VarMoney *var = &RecycleVariable(id,VariableTypes::Money,0)->data.money;
        var->val=s;
}

int64_t VarMemory::GetMoney(VarId id) const
{
        assert (GetType(id) == VariableTypes::Money);
        const VarMoney *var = &GetVarReadPtr(id)->data.money;

        return var->val;
}

//---------------------------------------------------------------------------
//
// VarMemory Integer64 functions
//
//---------------------------------------------------------------------------
void VarMemory::SetInteger64 (VarId id, int64_t s)
{
        VarMoney *var = &RecycleVariable(id,VariableTypes::Integer64,0)->data.money;
        var->val=s;
}

int64_t VarMemory::GetInteger64(VarId id) const
{
        assert (GetType(id) == VariableTypes::Integer64);
        const VarMoney *var = &GetVarReadPtr(id)->data.money;

        return var->val;
}

//---------------------------------------------------------------------------
//
// VarMemory Float functions
//
//---------------------------------------------------------------------------
void VarMemory::SetFloat (VarId id, F64 f)
{
        VarFloat *var = &RecycleVariable(id,VariableTypes::Float,0)->data.floatvar;
        var->val=f;
}

F64 VarMemory::GetFloat(VarId id) const
{
        assert (GetType(id) == VariableTypes::Float);
        const VarFloat *var = &GetVarReadPtr(id)->data.floatvar;
        return var->val;
}


//---------------------------------------------------------------------------//
//                                                                           //
// VarMemory DateTime functions                                              //
//                                                                           //
//---------------------------------------------------------------------------//

void VarMemory::SetDateTime (VarId id, const Blex::DateTime &date)
{
        VarDatetime *var = &RecycleVariable(id,VariableTypes::DateTime,0)->data.datetime;
        Blex::PutLsb(var->date,date);
}

Blex::DateTime VarMemory::GetDateTime(VarId id) const
{
        assert (GetType(id)==VariableTypes::DateTime);
        const VarDatetime *var = &GetVarReadPtr(id)->data.datetime;
        return Blex::GetLsb<Blex::DateTime>(var->date);
}

//---------------------------------------------------------------------------
//
// VarMemory Boolean functions
//
//---------------------------------------------------------------------------
void VarMemory::SetBoolean (VarId id, bool b)
{
        VarIntBool *var = &RecycleVariable(id,VariableTypes::Boolean,0)->data.intbool;
        var->val=b;
}

bool VarMemory::GetBoolean (VarId id) const
{
        assert (GetType(id) == VariableTypes::Boolean);
        return GetVarReadPtr(id)->data.intbool.val;
}

//GLobal blocks are never freed, but as they are only used for storing global variables, this doesn't matter.
VarId VarMemory::GlobalAllocateBlock(unsigned numvars)
{
        unsigned heapsize = heapstore.size();
        globalblocks.push_back(std::make_pair(heapsize, numvars));
        heapstore.resize(heapsize + numvars);

        // Initialize new variables
        for (HeapStore::iterator it = heapstore.begin() + heapsize, end = heapstore.end(); it != end; ++it)
            it->type = VariableTypes::Uninitialized;

        if (keep_allocstats)
            heapallocrefs.resize(heapstore.size());

        return UnmapHeapId(heapstore.size()-numvars);
}

//---------------------------------------------------------------------------
//
// VarMemory Table functions
//
//---------------------------------------------------------------------------

void VarMemory::SetTable (VarId id, int32_t s)
{
        VarIntBool *var = &RecycleVariable(id,VariableTypes::Table,0)->data.intbool;
        var->val=s;
}

int32_t VarMemory::GetTable(VarId id) const
{
        assert (GetType(id) == VariableTypes::Table);
        const VarIntBool *var = &GetVarReadPtr(id)->data.intbool;
        return var->val;
}

//---------------------------------------------------------------------------
//
// VarMemory copy functions
//
//---------------------------------------------------------------------------

void VarMemory::CopySimpleVariableFromOtherVarMem(VarId dest, VarMemory &other, VarId source)
{
        // No arrays, no records
        VariableTypes::Type type = other.GetType(source);
        assert (!(type & VariableTypes::Array) && (type != VariableTypes::Record) && (type != VariableTypes::FunctionRecord));

        VarMemory::VarStore &newstore = *GetVarWritePtr(dest);
        VarMemory::VarStore const &oldstore = *other.GetVarReadPtr(source);

        if (type == VariableTypes::String)
        {
                Blex::StringPair str = other.GetString(source);
                SetString(dest, str.begin, str.end);
        }
        else if (type == VariableTypes::Blob)
        {
                SetBlob(dest, other.GetBlob(source));
        }
        else if (type == VariableTypes::VMRef)
        {
                SetVMRef(dest, other.GetVMRef(source));
        }
        else
        {
                newstore = oldstore;
        }
}

//---------------------------------------------------------------------------
//
// StackMaps
//
//---------------------------------------------------------------------------

void VarMemory::CreateMapping(unsigned id, unsigned size)
{
        if (maps.size() <= id)
        {
                //Expand stack remappings to make room for the new map and set them to 0
                maps.resize(id+1, Mapping());
        }
        else    //Ensure that we didn't map it yet
        {
                assert(maps[id].var==0);
        }
        Mapping newmapping;
        newmapping.var = GlobalAllocateBlock(size);
        newmapping.size = size;

        maps[id] = newmapping;
}

std::pair< unsigned, unsigned > VarMemory::LookupMapping(VarId var) const
{
        unsigned pos = 0;
        for (std::vector< Mapping >::const_iterator it = maps.begin(); it != maps.end(); ++it, ++pos)
            if (var >= it->var && var < it->var + it->size)
                return std::make_pair(pos, var - it->var);

        return std::make_pair(0, 0);
}

VarMemory::VarStore* VarMemory::RecycleVariableInternal (VarStore *buf,VariableTypes::Type type,unsigned bufsize)
{
        bool is_backed = IsBacked(*buf);
        if (is_backed)
        {
                if (buf->type & VariableTypes::Array)
                {
                        if (buf->data.array.backed.bufpos != SharedPool::AllocationUnused
                            && !backings.IsShared(buf->data.array.backed.bufpos)) //Destroy existing elements?
                        {
                                DestroyArrayElements(buf->data.array);
                        }
                }
                else if (buf->type == VariableTypes::Record || buf->type == VariableTypes::FunctionRecord)
                {
                        if (buf->data.array.backed.bufpos != SharedPool::AllocationUnused
                            && !backings.IsShared(buf->data.anybackedtype.bufpos)) //Destroy existing elements?
                        {
                                DestroyRecordElements(buf->data.record);
                        }
                }
                else if (buf->type == VariableTypes::Object)
                {
                        if (buf->data.object.backed.bufpos != SharedPool::AllocationUnused)
                        {
                                ObjectBacking *backing = static_cast< ObjectBacking * >(backings.GetWritePtr(buf->data.object.backed.bufpos));
                                --backing->strongreferences;
                                //DEBUGPRINT("Decrease strong references of " << buf->data.object.backed.bufpos << " to " << backing->strongreferences);
                                if (!backings.IsShared(buf->data.object.backed.bufpos) || !backing->strongreferences)
                                {
                                        --objectcount;
                                        buf->data.anybackedtype.bufpos = DestroyObjectElements(buf->data.object);

                                        //DEBUGPRINT("Destroyed object elements " << buf->data.anybackedtype.bufpos);
                                }
                        }
                }
                // WeakObjects whose buffer isn't shared have no strong references - storage has already been released
        }
        else
        {
                // Either empty backed types, or reference types
                Dereference_Externals(*buf);
        }

        if (bufsize==0) //We don't want a buffer in our final version?
        {
                if (is_backed) //Get rid of the existing buffer
                    backings.ReleaseReference(buf->data.anybackedtype.bufpos);

                buf->data.anybackedtype.bufpos=SharedPool::AllocationUnused;
        }
        else
        {
                SharedPool::Allocation newpos;

                if (is_backed) //We already have a buffer, reuse it!
                    newpos=backings.MakePrivate(buf->data.anybackedtype.bufpos, bufsize, false);
                else //No buffer yet, so obtain a new buffer
                    newpos=backings.Allocate(bufsize,bufsize);

                VARMEMPROF(if (backings.GetTotalLength() > prof->maxbackingsize)
                               prof->maxbackingsize=backings.GetTotalLength());
                buf->data.anybackedtype.bufpos=newpos;
        }
        buf->type=type;
        return buf;
}

void VarMemory::UnmarkUsed(VarStore *buf)
{
        if (buf->type == VariableTypes::Object)
        {
                if (buf->data.object.backed.bufpos != SharedPool::AllocationUnused)
                {
                        ObjectBacking *backing = static_cast< ObjectBacking * >(backings.GetWritePtr(buf->data.object.backed.bufpos));
                        backing->marked = false;
                }
        }
}

bool VarMemory::RecursiveMarkUsed(VarStore *buf)
{
        if (buf->type & VariableTypes::Array)
        {
                VarArray *var = &buf->data.array;
                unsigned length = var->numelements;
                if (length)
                {
                        VarId *array=static_cast<VarId*>(backings.GetWritePtr(var->backed.bufpos));

                        bool any_object = false;
                        for (unsigned i=0; i<length; ++i, ++array)
                            any_object = RecursiveMarkUsed(GetVarWritePtr(*array)) || any_object;
                        return any_object;
                }
        }
        else if (buf->type == VariableTypes::Record || buf->type == VariableTypes::FunctionRecord)
        {
                VarRecord *var = &buf->data.record;
                unsigned length = var->numcells & VarRecord::CountMask;
                if (length)
                {
                        RecordColumn *columns=static_cast<RecordColumn *>(backings.GetWritePtr(var->backed.bufpos));

                        bool any_object = false;
                        for (; length; --length, ++columns)
                            any_object = RecursiveMarkUsed(GetVarWritePtr(columns->varid)) || any_object;
                        return any_object;
                }
        }
        else if (buf->type == VariableTypes::Object)
        {
                VarObject *var = &buf->data.object;
                if (var->backed.bufpos == SharedPool::AllocationUnused)
                    return false; // default objects don't count

                ObjectBacking *backing = static_cast< ObjectBacking * >(backings.GetWritePtr(var->backed.bufpos));
                if (backing->marked)
                    return true; // live object
                backing->marked = true;

                ObjectCell *cell=static_cast< ObjectCell * >(backings.GetWritePtr(backing->cellbufpos));
                unsigned length = backing->numcells;

                if (length)
                {
                        for (; length; --length, ++cell)
                            if (cell->nameid && !cell->contains_no_objects)
                                cell->contains_no_objects = !RecursiveMarkUsed(GetVarWritePtr(cell->varid));
                }
                return true; // Live object found
        }
        return false;
}

void VarMemory::CollectObjects()
{
        /* This is tha garbage collector */

        // Unmark all the arrays, records and objects
        for (HeapStore::iterator it = heapstore.begin(), end = heapstore.end(); it != end; ++it)
            if (!IsPrimitive(*it))
                UnmarkUsed(&*it);
        for (StackStore::iterator it = stackstore.begin(), end = stackstore.begin() + stacksize; it != end; ++it)
            if (!IsPrimitive(*it))
                UnmarkUsed(&*it);

        // Mark used objects ADDME: rewrite to be non-recursive (at least for objects)

        // Mark all stack objects
        for (StackStore::iterator it = stackstore.begin(), end = stackstore.begin() + stacksize; it != end; ++it)
            if (!IsPrimitive(*it))
                 RecursiveMarkUsed(&*it);

        // Mark all global objects
        for (std::vector< std::pair< HeapId, unsigned > >::iterator it = globalblocks.begin(), end = globalblocks.end(); it != end; ++it)
        {
                for (HeapStore::iterator it2 = heapstore.begin() + it->first, end = heapstore.begin() + it->first + it->second; it2 != end; ++it2)
                    if (!IsPrimitive(*it2))
                        RecursiveMarkUsed(&*it2);
        }
        for (std::set< VarId >::iterator it = external_heap_vars.begin(), end = external_heap_vars.end(); it != end; ++it)
        {
                VarStore *store = GetVarWritePtr(*it);
                if (!IsPrimitive(*store))
                    RecursiveMarkUsed(store);
        }

        // Recycle heap object that point to non-used objects (stack is root, so no sweep needed there). Refcounting will take care of destruction.
        for (HeapStore::iterator it = heapstore.begin(), end = heapstore.end(); it != end; ++it)
        {
                if (it->type == VariableTypes::Object)
                {
                        VarObject *var = &it->data.object;
                        if (var->backed.bufpos == SharedPool::AllocationUnused)
                            continue;

                        ObjectBacking *backing = static_cast< ObjectBacking * >(backings.GetWritePtr(var->backed.bufpos));
                        if (backing->marked)
                            continue;

                        // Change type to uninitialized to avoid recursive DestroyObjectElements calls
                        it->type = VariableTypes::Uninitialized;
                        backing->strongreferences = 0;
                        SharedPool::Allocation buf;

                        if (backings.IsShared(var->backed.bufpos))
                            buf = var->backed.bufpos;
                        else
                        {
                                --objectcount;
                                buf = DestroyObjectElements(*var);
                        }

                        backings.ReleaseReference(buf);
              }
              else if (it->type == VariableTypes::WeakObject)
              {
                        VarObject *var = &it->data.object;
                        if (var->backed.bufpos == SharedPool::AllocationUnused)
                            continue;

                        ObjectBacking *backing = static_cast< ObjectBacking * >(backings.GetWritePtr(var->backed.bufpos));
                        if (backing->marked && backing->strongreferences != 0)
                            continue;

                        SharedPool::Allocation buf = var->backed.bufpos;
                        var->backed.bufpos = SharedPool::AllocationUnused;
                        backings.ReleaseReference(buf);
              }
        }

        for (StackStore::iterator it = stackstore.begin(), end = stackstore.begin() + stacksize; it != end; ++it)
        {
              if (it->type == VariableTypes::WeakObject)
              {
                        VarObject *var = &it->data.object;
                        if (var->backed.bufpos == SharedPool::AllocationUnused)
                            continue;

                        ObjectBacking *backing = static_cast< ObjectBacking * >(backings.GetWritePtr(var->backed.bufpos));
                        if (backing->strongreferences != 0)
                            continue;

                        SharedPool::Allocation buf = var->backed.bufpos;
                        var->backed.bufpos = SharedPool::AllocationUnused;
                        backings.ReleaseReference(buf);
              }
        }
}

std::pair< unsigned, uint64_t > VarMemory::RecursiveGetObjectLinks(ObjectLink &source, VarId varid, std::vector< ObjectLink > *links, std::map< long, ObjectData > &objects, std::set< VarId > *seenvarsptr) const
{
        if (seenvarsptr)
            seenvarsptr->insert(varid);

        VarStore const *buf = GetVarReadPtr(varid);

        std::pair< unsigned, uint64_t > result(1, 0);

        if (IsBacked(*buf))
            result.second = backings.GetBufferSize(buf->data.anybackedtype.bufpos);

        if (buf->type & VariableTypes::Array)
        {
                VarArray const *var = &buf->data.array;
                unsigned length = var->numelements;
                if (length)
                {
                        VarId const *array=static_cast< VarId const * >(backings.GetReadPtr(var->backed.bufpos));

                        for (unsigned i=0; i<length; ++i, ++array)
                        {
                                std::pair< unsigned, uint64_t > subr = RecursiveGetObjectLinks(source, *array, links, objects, seenvarsptr);
                                result.first += subr.first;
                                result.second += subr.second;
                        }
                }
        }
        else if (buf->type == VariableTypes::Record || buf->type == VariableTypes::FunctionRecord)
        {
                VarRecord const *var = &buf->data.record;
                unsigned length = var->numcells & VarRecord::CountMask;
                if (length)
                {
                        RecordColumn const *columns=static_cast< RecordColumn const * >(backings.GetReadPtr(var->backed.bufpos));

                        for (; length; --length, ++columns)
                        {
                                std::pair< unsigned, uint64_t > subr = RecursiveGetObjectLinks(source, columns->varid, links, objects, seenvarsptr);
                                result.first += subr.first;
                                result.second += subr.second;
                        }
                }
        }
        else if (buf->type == VariableTypes::Object || buf->type == VariableTypes::WeakObject)
        {
                VarObject const *var = &buf->data.object;
                if (var->backed.bufpos == SharedPool::AllocationUnused)
                    return result; // default objects don't count

                ObjectBacking const *backing = static_cast< ObjectBacking const * >(backings.GetReadPtr(var->backed.bufpos));
                if (backing->strongreferences == 0)
                    return result; // weak references to dead objects don't count

                ObjectCell const *cell=static_cast< ObjectCell const * >(backings.GetReadPtr(backing->cellbufpos));
                unsigned length = backing->numcells;

                bool is_visited = objects[var->backed.bufpos].var != 0;

                if (!is_visited)
                    objects[var->backed.bufpos].var = varid;
                else
                    varid = objects[var->backed.bufpos].var;

                source.dest_obj = varid;
                if (source.dest_obj != source.source_obj) // Ignore all self-links
                {
                        source.total_elts = 0;
                        source.total_ssize = 0;
                        links->push_back(source);
                }

                if (!is_visited)
                {
                        ObjectLink newsource;
                        newsource.source_var = varid;
                        newsource.source_obj = varid;

                        std::pair< unsigned, uint64_t > oresult(1, 0);

                        if (backing->cellbufpos != SharedPool::AllocationUnused)
                            oresult.second += backings.GetBufferSize(backing->cellbufpos);
                        if (backing->contextbufpos != SharedPool::AllocationUnused)
                            oresult.second += backings.GetBufferSize(backing->contextbufpos);

                        unsigned total_elts = 0;
                        for (; length; --length, ++cell)
                            if (cell->nameid)// && !cell->contains_no_objects)
                            {
                                    ++total_elts;
                                    newsource.source_cell = cell->nameid;
                                    std::pair< unsigned, uint64_t > subr = RecursiveGetObjectLinks(newsource, cell->varid, links, objects, seenvarsptr);

                                    oresult.first += subr.first;
                                    oresult.second += subr.second;

                            }

                        objects[var->backed.bufpos].total_elts = oresult.first;
                        objects[var->backed.bufpos].total_ssize = oresult.second;
                }
        }
        else if (buf->type == VariableTypes::Uninitialized)
        {
                result.first = 0;
        }
        return result;
}

void VarMemory::GetObjectLinks(std::vector< ObjectLink > *links, std::function< std::string(VarId, bool) > const &namegetter, bool include_unreferenced) const
{
        std::map< long, ObjectData > objects;
        std::set< VarId > seenvars;
        std::set< VarId > *seenvarsptr = include_unreferenced ? &seenvars : 0;
        links->clear();

        ObjectLink link;
        link.source_obj = -1;
        link.dest_obj = -1;
        link.source_cell = 0;
        link.total_elts = 0;
        link.total_ssize = 0;

        // Get external heap vars
        for (std::set< VarId >::const_iterator it = external_heap_vars.begin(), end = external_heap_vars.end(); it != end; ++it)
        {
                link.source_var = *it;
                link.source_name = "var.ext";

                std::pair< unsigned, uint64_t > sizes = RecursiveGetObjectLinks(link, *it, links, objects, seenvarsptr);
                link.dest_obj = -1;
                link.total_elts = sizes.first;
                link.total_ssize = sizes.second;
                if (link.total_elts)
                    links->push_back(link);
        }

        // Get global blocks
        for (std::vector< std::pair< HeapId, unsigned > >::const_iterator it = globalblocks.begin(), end = globalblocks.end(); it != end; ++it)
        {
                VarId hvar = UnmapHeapId(it->first);
                for (HeapStore::const_iterator it2 = heapstore.begin() + it->first, end = heapstore.begin() + it->first + it->second; it2 != end; ++it2, ++hvar)
                {
                        link.source_var = hvar;
                        link.source_name = "var.global";

                        std::pair< unsigned, uint64_t > sizes = RecursiveGetObjectLinks(link, hvar, links, objects, seenvarsptr);
                        link.dest_obj = -1;
                        link.total_elts = sizes.first;
                        link.total_ssize = sizes.second;
                        if (link.total_elts)
                            links->push_back(link);
                }
        }

        // Get stack
        VarId svar = UnmapStackId(0);
        for (StackStore::const_iterator it = stackstore.begin(), end = stackstore.begin() + stacksize; it != end; ++it, ++svar)
        {
                link.source_var = svar;
                link.source_name = "var.stack";

                std::pair< unsigned, uint64_t > sizes = RecursiveGetObjectLinks(link, svar, links, objects, seenvarsptr);
                link.dest_obj = -1;
                link.total_elts = sizes.first;
                link.total_ssize = sizes.second;
                if (link.total_elts)
                    links->push_back(link);
        }

        if (include_unreferenced)
        {
                VarId svar = UnmapHeapId(0);
                for (HeapStore::const_iterator it = heapstore.begin(), end = heapstore.end(); it != end; ++it, ++svar)
                {
                        if (it->type == VariableTypes::Uninitialized)
                            continue;

                        if (it->type == VariableTypes::Object || it->type == VariableTypes::WeakObject)
                        {
                                VarObject const *var = &it->data.object;
                                if (var->backed.bufpos == SharedPool::AllocationUnused)
                                    continue; // default objects don't count

                                ObjectBacking const *backing = static_cast< ObjectBacking const * >(backings.GetReadPtr(var->backed.bufpos));
                                if (backing->strongreferences == 0)
                                    continue; // weak references to dead objects don't count

//                                ObjectCell const *cell=static_cast< ObjectCell const * >(backings.GetReadPtr(backing->bufpos));
//                                unsigned length = backing->numcells;

                                bool is_visited = objects[var->backed.bufpos].var != 0;
                                if (!is_visited)
                                {
                                        link.source_var = svar;
                                        link.source_name = "unreferenced_heap";

                                        std::pair< unsigned, uint64_t > sizes = RecursiveGetObjectLinks(link, svar, links, objects, seenvarsptr);
                                        link.dest_obj = -1;
                                        link.total_elts = sizes.first;
                                        link.total_ssize = sizes.second;
                                        links->push_back(link);
                                        continue;
                                }
                        }

                        if (!include_unreferenced)
                            continue;

                        std::set< VarId >::const_iterator sit = seenvars.find(svar);
                        if (sit == seenvars.end())
                        {
                                link.source_var = svar;
                                link.source_name = "unreferenced_heap";

                                std::pair< unsigned, uint64_t > sizes = RecursiveGetObjectLinks(link, svar, links, objects, seenvarsptr);
                                link.dest_obj = -1;
                                link.total_elts = sizes.first;
                                link.total_ssize = sizes.second;
                                links->push_back(link);
                        }
                }
        }

        link.dest_obj = -1;
        link.source_name = "object";
        for (std::map< long, ObjectData >::const_iterator it = objects.begin(); it != objects.end(); ++it)
        {
                link.source_var = it->second.var;
                link.source_obj = it->second.var;
                link.total_elts = it->second.total_elts;
                link.total_ssize = it->second.total_ssize;
                links->push_back(link);
        }

        if (namegetter)
        {
                for (std::vector< ObjectLink >::iterator it = links->begin(); it != links->end(); ++it)
                {
                        if (it->dest_obj != 0xFFFFFFFFU)
                            it->dest_type = namegetter(it->dest_obj, false);
                        it->source_type = namegetter(it->source_var, true);
                }
        }
}

void VarMemory::RecursiveGetBlobReferences(std::vector< BlobReference > *refs, VarId varid, std::string const &path, BlobReference const &ref, std::set< VarId > &seenvars, std::set< long > &visitedobjects) const
{
        if (!seenvars.insert(varid).second)
            return;

        VarStore const *buf = GetVarReadPtr(varid);
        if (buf->type == VariableTypes::Blob)
        {
                if (buf->data.blob.blob)
                {
                        BlobReference copy(ref);
                        copy.path = path;
                        copy.description = buf->data.blob.blob->GetDescription();
                        copy.length = buf->data.blob.blob->GetLength();
                        refs->push_back(copy);
                }
        }
        else if (buf->type & VariableTypes::Array)
        {
                VarArray const *var = &buf->data.array;
                unsigned length = var->numelements;
                if (length)
                {
                        VarId const *array = static_cast< VarId const * >(backings.GetReadPtr(var->backed.bufpos));

                        for (unsigned i=0; i<length; ++i, ++array)
                            RecursiveGetBlobReferences(refs, *array, path + "[" + Blex::AnyToString(i) + "]", ref, seenvars, visitedobjects);
                }
        }
        else if (buf->type == VariableTypes::Record || buf->type == VariableTypes::FunctionRecord)
        {
                VarRecord const *var = &buf->data.record;
                unsigned length = var->numcells & VarRecord::CountMask;
                if (length)
                {
                        RecordColumn const *columns=static_cast< RecordColumn const * >(backings.GetReadPtr(var->backed.bufpos));

                        for (; length; --length, ++columns)
                            RecursiveGetBlobReferences(refs, columns->varid, path + "." + columnnamemapper.GetReverseMapping(columns->nameid).stl_str(), ref, seenvars, visitedobjects);
                }
        }
        else if (buf->type == VariableTypes::Object || buf->type == VariableTypes::WeakObject)
        {
                VarObject const *var = &buf->data.object;
                if (var->backed.bufpos == SharedPool::AllocationUnused)
                    return; // default objects don't count

                ObjectBacking const *backing = static_cast< ObjectBacking const * >(backings.GetReadPtr(var->backed.bufpos));
                if (backing->strongreferences == 0)
                    return; // weak references to dead objects don't count

                if (!visitedobjects.insert(var->backed.bufpos).second)
                    return; //already cisited this object

                ObjectCell const *cell=static_cast< ObjectCell const * >(backings.GetReadPtr(backing->cellbufpos));
                unsigned length = backing->numcells;

                BlobReference subref;
                subref.source_var = varid;
                subref.source_name = "obj";

                for (; length; --length, ++cell)
                    if (cell->nameid)
                        RecursiveGetBlobReferences(refs, cell->varid, "->" + columnnamemapper.GetReverseMapping(cell->nameid).stl_str(), subref, seenvars, visitedobjects);
        }
}

void VarMemory::GetBlobReferences(std::vector< BlobReference > *refs, std::function< std::string(VarId, bool) > const &namegetter, bool include_unreferenced) const
{
        std::set< long > objects;
        std::set< VarId > seenvars;
        refs->clear();

        BlobReference ref;

        // Get external heap vars
        for (std::set< VarId >::const_iterator it = external_heap_vars.begin(), end = external_heap_vars.end(); it != end; ++it)
        {
                ref.source_var = *it;
                ref.source_name = "var.ext";

                RecursiveGetBlobReferences(refs, *it, "", ref, seenvars, objects);
        }

        // Get global blocks
        for (std::vector< std::pair< HeapId, unsigned > >::const_iterator it = globalblocks.begin(), end = globalblocks.end(); it != end; ++it)
        {
                VarId hvar = UnmapHeapId(it->first);
                for (HeapStore::const_iterator it2 = heapstore.begin() + it->first, end = heapstore.begin() + it->first + it->second; it2 != end; ++it2, ++hvar)
                {
                        ref.source_var = hvar;
                        ref.source_name = "var.global";

                        RecursiveGetBlobReferences(refs, hvar, "", ref, seenvars, objects);
                }
        }

        // Get stack
        VarId svar = UnmapStackId(0);
        for (StackStore::const_iterator it = stackstore.begin(), end = stackstore.begin() + stacksize; it != end; ++it, ++svar)
        {
                ref.source_var = svar;
                ref.source_name = "var.stack";

                RecursiveGetBlobReferences(refs, svar, "", ref, seenvars, objects);
        }

        if (include_unreferenced)
        {
                VarId hvar = UnmapHeapId(0);
                for (HeapStore::const_iterator it = heapstore.begin(), end = heapstore.end(); it != end; ++it, ++hvar)
                {
                        if (it->type == VariableTypes::Uninitialized)
                            continue;

                        if (it->type == VariableTypes::Object || it->type == VariableTypes::WeakObject)
                        {
                                VarObject const *var = &it->data.object;
                                if (var->backed.bufpos == SharedPool::AllocationUnused)
                                    continue; // default objects don't count

                                ObjectBacking const *backing = static_cast< ObjectBacking const * >(backings.GetReadPtr(var->backed.bufpos));
                                if (backing->strongreferences == 0)
                                    continue; // weak references to dead objects don't count

                                RecursiveGetBlobReferences(refs, hvar, "", ref, seenvars, objects);
                        }
                }
        }

        if (namegetter)
        {
                for (auto &ref: *refs)
                    ref.source_type = namegetter(ref.source_var, true);
        }
}

void VarMemory::SetKeepAllocStats(bool allocstats)
{
        keep_allocstats = allocstats;
        if (keep_allocstats)
        {
                heapallocrefs.resize(heapstore.size());
        }
        else
            heapallocrefs.clear();
}

} // End of namespace HareScript
