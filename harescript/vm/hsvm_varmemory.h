#ifndef blex_webhare_harescript_hsvm_varmemory
#define blex_webhare_harescript_hsvm_varmemory

#include <blex/datetime.h>
#include <blex/unicode.h>

#include "hsvm_constants.h"
#include "errors.h"
#include "sharedpool.h"
#include "hsvm_blobinterface.h"
#include "hsvm_columnnamemapper.h"

namespace HareScript
{

class VarMemory;
class Debugger;
class VirtualMachine;
//typedef uint32_t VarId;

class BasePointer
{
        uint32_t id;
    public:
        inline uint32_t GetId() const { return id; }
        friend class VarMemory;
};

struct ObjectLink
{
        VarId source_var;
        VarId source_obj;
        ColumnNameId source_cell;
        std::string source_name;
        std::string source_type;

        VarId dest_obj;
        std::string dest_type;
        unsigned total_elts;
        uint64_t total_ssize;
};

struct BlobReference
{
        VarId source_var;
        std::string source_name;
        std::string source_type;
        std::string path;
        std::string description;
        uint64_t length;
};

struct AllocStats
{
        unsigned allocated_heap;
};

// 0x00000000 - 0x7FFFFFFF: global blocks
// 0x80000000 - 0x8FFFFFFF: stack
// 0x90000000 - 0xFFFFFFFE: heap

VarId const LocalStackBase   = 0x80000000L;
VarId const LocalStackMiddle = 0x88000000L;
VarId const ArrayBase = 0x90000000L;             //<Base VarID of HareScript arrays
unsigned const ObjectMarshallerContextId = 159999;

/** VarMemory stores the stack and the heap that are used when running HareScript
    code. Every variable, heap or stack, is referenced by its VarId. The actual
    storage method, and the differences between stack and heap variables,
    are hidden inside the class. The Get, Set and ...From functions can be
    called without concern for the actual storage.

    All VarIds refer to a spot in one of the VarStore arrays.
    Additionaly, some variables, depending on their type, will also be
    'backed' by some space in the shared buffer.

    VarID 0 will never be given out, and can be used to signal invalid
    variables.

    This object is threadsafe only when calls are serialized */
class BLEXLIB_PUBLIC VarMemory
{
    public:
        typedef unsigned StackId;
        typedef unsigned HeapId;

    protected:

        /** Any backed type */
        struct VarBackedType
        {
                SharedPool::Allocation bufpos;
        };
        /** Record storage */
        struct VarRecord
        {
                // Must be first element, to be compatible with anybackedtype in VarData union
                VarBackedType backed;

                // Bit 31 true: nonexistent, else count of cells
                unsigned numcells;

                static const unsigned NonExistent = 0x80000000;
                static const unsigned CountMask = 0x7FFFFFFF;
        };
        /** HSInteger and boolean storage */
        struct VarIntBool
        {
                int32_t val;
        };
        /** HSMoney, Integer64 storage */
        struct VarMoney
        {
                int64_t val;
        };
        /** HSFloat storage */
        struct VarFloat
        {
                F64 val;
        };
        struct VarBlob
        {
                BlobBase *blob;
        };
        struct VarVMRef
        {
                VirtualMachine *vm;
        };
        struct VarObject
        {
                // Must be first element, to be compatible with anybackedtype in VarData union
                VarBackedType backed;

                bool is_privileged;
        };
        /** Array storage */
        struct VarArray
        {
                // Must be first element, to be compatible with anybackedtype in VarData union
                VarBackedType backed;

                unsigned numelements;
        };

        /** Datetime storage */
        struct VarDatetime
        {
                uint8_t date[8];
        };

        /** Free heap iteam */
        struct VarFreeHeap
        {
                HeapId nextfreeblock; //ID of next free block on the heap, or EndOfFreeList if we're at the end of the heap
        };

        union VarData
        {
                VarRecord record;
                VarIntBool intbool;
                VarMoney money;
                VarFloat floatvar;
                VarBlob blob;
                VarVMRef vmref;
                VarArray array;
                VarDatetime datetime;
                VarFreeHeap freeheap;
                VarObject object;

                VarBackedType anybackedtype;
        };

        struct RecordColumn
        {
                ColumnNameId nameid;
                VarId varid;
        };

        struct ObjectBacking
        {
                // Number of strong references
                unsigned strongreferences;

                /// Type descriptor (stores typeinfo for VirtualMachine)
                void const *typedescriptor;

                // Number of cells in the object
                unsigned numcells;
                // Object cells
                SharedPool::Allocation cellbufpos;

                // Number of contexts in the object
                unsigned numcontexts;
                // Object cells
                SharedPool::Allocation contextbufpos;

                // Is this object marked (reachable through a root) (only valid within GC)
                bool marked;

                // Have deletable members? (can skip extend checks if not)
                bool has_deletable_members;
        };

        // Object cell; only accessable for varmemory and stackmachine.
        struct ObjectCell
        {
                VariableTypes::Type member_type;
                bool is_private : 1;
                bool contains_no_objects : 1;
                bool is_deletable : 1;
                VarId varid;
                ColumnNameId nameid; //< name for this cell. 0 for Contexts
        };

        struct ObjectContext
        {
                unsigned int context_id;
                struct Ctx
                {
                        void *contextptr;
                        void *opaqueptr; //ADDME: Do we need to copy this or should we look it up?
                        HSVM_DestructorPtr destructor; //ADDME: Do we need to copy this or should we look it up?
                };
                union
                {
                        Ctx ctx;
                        HSVM_ObjectMarshallerPtr marshaller;
                };
        };

        /** The new variable structure. User is responsible for setting type to Uninitialized when allocating! */
        struct VarStore
        {
                /** The type of the Variable */
                VariableTypes::Type type;
                /** The data of the Variable */
                VarData data;
        };

        /** Mapping of id to heap area */
        struct Mapping
        {
                inline Mapping() : var(0), size(0) {}

                VarId var;
                unsigned size;
        };

        /** Adds a reserved element on the heap */
        HeapId NewReservedHeapBuffer();

        /** Delete an element on the heap */
        void  DeleteHeapBuffer(HeapId heap_id);

        void* WriteableBuffer(VarBackedType *var, unsigned newsize,bool preserve_contents);

        /** Check if a VarID is stored on the heap */
        inline bool IsOnHeap(VarId id) const;

        /** Map a heap VarID to its shared_heap ID */
        inline HeapId MapHeapId(VarId id) const;

        /** Unmap a heap VarID to its shared_heap ID */
        inline VarId UnmapHeapId(VarMemory::HeapId id) const;

        /** Map a stack VarID to its shared_stack ID */
        StackId inline MapStackId(VarId id) const
        {
//                assert(id>=LocalStackBase && id<ArrayBase);//local stack
//                if (basepointer + id < LocalStackMiddle)
//                    throw VMRuntimeError (Error::InternalError, "Accessing variables below stack floor");
                return basepointer + id - LocalStackMiddle;
        }

        /** Unmap a stack VarID to its shared_stack ID */
        VarId inline UnmapStackId(StackId id) const
        {
                return LocalStackMiddle + id - basepointer;
        }

        /** Recycle a variable by clearing its current contents, allocating
            a writeable buffer for it and setting its type
            @param id HSVAR id of the variable to recycle (will be recalculated to the proper list)
            @param type Type of the new variable
            @param bufsize Size of the buffer to reserve inside the sharedbuffer.
                           If non-0, Recycle will set the data_buffer_pos element
            @return The variables structure pointed to by id */
        VarStore* RecycleVariableInternal(VarStore *store, VariableTypes::Type type,unsigned bufsize);

        inline VarStore* RecycleVariableInternal2(VarStore *store, VariableTypes::Type type,unsigned bufsize)
        {
                if (bufsize != 0 || !IsPrimitive(*store)) // IsBacked(*store) || store->type== VariableTypes::Blob || store->type== VariableTypes::VMRef)
                    return RecycleVariableInternal(store, type, bufsize);
                else
                {
                        store->data.anybackedtype.bufpos=SharedPool::AllocationUnused;
                        store->type=type;
                        return store;
                }
        }
        inline VarStore* RecycleVariable   (VarId dest_id,VariableTypes::Type type,unsigned bufsize);

        /** Destroy all elements inside an array (but not the array itself)
            @param arraybuffer The array data (as returned by GetVarBuffer) */
        void DestroyArrayElements(const VarArray &todestroy);

        /** Ensure that an array is writable (clone it if necessary)
            @param varid Array to make writable */
        void MakeArrayWritable(VarId arrayid);

        /** Destroy all elements inside an record (but not the array itself)
            @param todestroy The record data (as returned by GetVarBuffer) */
        void DestroyRecordElements(const VarRecord &todestroy);

        /** Ensure that an record is writable (clone it if necessary)
            @param varid Record to make writable */
        void MakeRecordWritable(VarId record_id, signed newlength = -1);

        /** Dereference only the contexts inside an object
            @param todestroy The object data */
        void DereferenceObjectMembers(VarObject &todestroy);

        /** Destroy all elements inside an object not the object itself). Returns the allocation by the variable
            @param todestroy The object data
            @return Sharedpool allocation ptr
        */
        SharedPool::Allocation DestroyObjectElements(VarObject &todestroy);

        /** Fill a string or variable
            @param varid Variable to set
            @param settype Method of setting the string
            @param strstart Start of the string to set
            @param strend End+1 of the string to set */
        void InternalSetString(VarId varid,
                                        const char* start,
                                        const char* end);

        /** Fill a string with a wide string
            @param varid Variable to set
            @param settype Method of setting the string
            @param strstart Start of the string to set
            @param strend End+1 of the string to set */
        void InternalSetUTF16String(VarId varid,
                                            const uint16_t* start,
                                            const uint16_t* end);

        /** Check if a specific variable is backed by space in the shared buffer */
        inline bool IsBacked(const VarStore &check) const
        {
                return IsBackedType(check.type) && check.data.anybackedtype.bufpos!=SharedPool::AllocationUnused;
        }

        /** Check if a specific variable is primitive (no backing, no references) */
        inline bool IsPrimitive(const VarStore &check) const
        {
                return IsPrimitiveType(check.type);
        }

        const VarStore * GetVarReadPtr(VarId id) const;
        VarStore * GetVarWritePtr(VarId id);

        StackId GetStackPointer() const { return stacksize; }

        /** Add a variable to the heap
            @return VarId of the new variable  */
        VarId InternalNewHeapVariable();

        /** Delete a variable from the heap
            @param varid VarId of the variable to delete */
        void InternalDeleteHeapVariable(VarId varid);

        /** The Shared Storage used to store every variable */
        SharedPool backings;

        /** Mapping mapped VarIDs to the heap */
        std::vector< Mapping > maps;

        /// Type of the stack store
        typedef Blex::PodVector< VarStore > StackStore;

        /** The new variable stack structure */
        StackStore stackstore;

        /** The used size of the stackstore */
        unsigned stacksize;

        /// Type of the heap store
        typedef Blex::PodVector< VarStore > HeapStore;

        /** The new variable heap structure */
        HeapStore heapstore;

        /** List of allocated global blocks + their length (these are roots for the GC) */
        std::vector< std::pair< HeapId, unsigned > > globalblocks;

        /// List of external allocated heap variables (also roots for the GC)
        std::set< VarId > external_heap_vars;

        /** VarId of basepointer */
        StackId basepointer;

        /** ID of next free heap block, or -1 if no more free blocks are avaialble */
        HeapId freeheapid;
/*
#ifdef DEBUG
        struct VMProf;
        VMProf *prof;
#endif
*/
        void InternalSetRecord  (VarId id, unsigned length, VariableTypes::Type type);
        VarId RecordCellRefByNameCreate (VarId record_id, ColumnNameId num, bool create, bool exclusive);

        ObjectCell * ObjectFindCellFromBacking(ObjectBacking const *backing, ColumnNameId nameid, bool this_access);
        ObjectCell const * ObjectFindCellFromBacking(ObjectBacking const *backing, ColumnNameId nameid, bool this_access) const;
        ObjectCell * ObjectFindCell(VarId object, ColumnNameId nameid, bool this_access);

    public:
        VarMemory(ColumnNames::LocalMapper &columnnamemapper);

        ~VarMemory();

        /** Column name mapper, maps column names to ids and vv */
        ColumnNames::LocalMapper &columnnamemapper;

        void Reset();

        void GetVMStats(VMStats *stats);

        // ---------------- Individual variabele manipulation ------------------

        void Clear              (VarId id);

        /// Check if varid is in valid range
        bool CheckVarId(VarId id) const;

        /** Initialize a variable to the default contents for its type
            @param id HSVarid of the variable to initialize
            @param type Type of the variable */
        void InitVariable(VarId id, VariableTypes::Type type);

        /** Destroys a variable
            @param id HSVarid of the variable to destroy
        */
        inline void DestroyVariable(VarId dest_id);

        /** Initialize a string from UTF-8 bytes
            @param id HSVarid of the variable to initialize
            @param start Start of the range of UTF-8 bytes
            @param end End of the range of UTF-8 bytes */
        template <class Itr> void SetString(VarId id, Itr start, Itr end)
        {
                InternalSetString(id, &*start, &*end);
        }

        /** Initialize a string from UTF-8 bytes
            @param id HSVarid of the variable to initialize
            @param str UTF-8 string to copy */
        inline void SetString(VarId id, Blex::StringPair str)
        {
                InternalSetString(id, str.begin, str.end);
        }

        /** Initialize a string from UTF-16 bytes (Windows WCHAR)
            @param id HSVarid of the variable to initialize
            @param start Start of the range of UTF-16 bytes
            @param end End of the range of UTF-16 bytes */
        template <class Itr> void SetUTF16String(VarId id, Itr start, Itr end)
        {
                InternalSetUTF16String(id,reinterpret_cast<uint16_t const*>(&*start),reinterpret_cast<uint16_t const*>(&*end));
        }
        void SetSTLString         (VarId id, std::string_view str)
        {
                SetString(id,str.begin(),str.end());
        }

        void SetBlob            (VarId id, BlobRefPtr blob);
        void SetVMRef           (VarId id, VirtualMachine *vm);
        void SetInteger         (VarId id, int32_t s);
        void SetMoney           (VarId id, int64_t s);
        void SetInteger64       (VarId id, int64_t s);
        void SetFloat           (VarId id, F64 f);
        void SetDateTime        (VarId id, Blex::DateTime const &date);
        void SetBoolean         (VarId id, bool b);
        void SetTable           (VarId id, int32_t s);

        void DEBUG_FunctionRecordToRecord(VarId id);

        /** Get the harescript type of the specified variable */
        VariableTypes::Type GetType                    (VarId id) const;

        BlobRefPtr           GetBlob                   (VarId id) const;
        VirtualMachine *     GetVMRef                  (VarId id) const;
//        VMObjectPtr          GetObject                 (VarId id) const;

        int32_t                  GetInteger                (VarId id) const;
        int64_t                  GetMoney                  (VarId id) const; // BCB breaks returned uint64_t's/int64_t's when using
        int64_t                  GetInteger64              (VarId id) const; // BCB breaks returned uint64_t's/int64_t's when using
        F64                  GetFloat                  (VarId id) const;
        Blex::DateTime       GetDateTime               (VarId id) const;
        bool                 GetBoolean                (VarId id) const;
        int32_t                  GetTable                  (VarId id) const;

        Blex::StringPair     GetString                 (VarId id) const;
        std::string          GetSTLString              (VarId id) const;
        /** @short Read a VarMemory string as UTF-16
            @param id VarId of string to read
            @param store Vector in which to store the UTF-16 bytes (will be cleared first) */
        void                 GetUTF16String            (VarId id, Blex::UTF16String *store) const;

        /** Get the length of a string
            @param id Id of the string variable to query */
        int32_t GetStringSize(VarId id) const;

        /** Resize a string, and make it writable
            @param id Id of the string variable to resize
            @param newlength New length of the string
            @return a pair of iterators pointing to the writable string buffer.
                    invalidated by the next VarMemory function call */
        std::pair<char*,char*> ResizeString (VarId id, unsigned newlength);


        void             ArrayInitialize    (VarId id, int length, VariableTypes::Type arraytype);
        unsigned         ArraySize          (VarId id) const;
        void             ArrayResize        (VarId id, int newsize);
        VarId            ArrayElementAppend (VarId var_id);
        VarId            ArrayElementInsert (VarId var_id, int before);
        void             ArrayElementDelete (VarId var_id, int which);
        VarId            ArrayElementRef    (VarId id, int num);
        VarId            ArrayElementGet    (VarId id, int num) const;
        void             ArrayElementCopy   (VarId id, int num, VarId dest);

        /* Record manipulation */
        void             RecordInitializeNull (VarId id);
        void             RecordInitializeEmpty(VarId id);
        bool             RecordCellCopyByName (VarId record_id, ColumnNameId nameid, VarId copy);
        VarId            RecordCellGetByName  (VarId record_id, ColumnNameId nameid) const;
        ColumnNameId     RecordCellNameByNr   (VarId record_id, unsigned num) const;
        bool             RecordCellDelete     (VarId record_id, ColumnNameId nameid);
        unsigned         RecordSize           (VarId record_id) const;
        bool             RecordCellExists     (VarId record_id, ColumnNameId nameid);

        /** Look up a cell inside the record. Makes the record writeable
            @param record_id Record ID to look in
            @param nameid Cell to look up
            @return VarId for the name. 0 if the nameid does not exist */
        VarId            RecordCellRefByName  (VarId record_id, ColumnNameId nameid)
        { return RecordCellRefByNameCreate(record_id, nameid, false, false); }

        /** Returns a cell inside the record, creates if not existing
            Makes the record writeable
            @param record_id Record ID to look in
            @param nameid Cell to look up
            @return VarId for the name. Never 0 */
        VarId            RecordCellCreate     (VarId record_id, ColumnNameId nameid)
        { return RecordCellRefByNameCreate(record_id, nameid, true, false); }

        /** Creates a cell inside the record, fails if exists
            Makes the record writeable
            @param record_id Record ID to look in
            @param nameid Cell to look up
            @return VarId for the name. Never 0 */
        VarId            RecordCellCreateExclusive (VarId record_id, ColumnNameId nameid)
        { return RecordCellRefByNameCreate(record_id, nameid, true, true); }

        /** Is the record NULL? (non-existent)
            @param record_id Record to check
            @return true if the record is NULL, false is the record has cells or is empty */
        bool             RecordNull (VarId record_id) const;

        /** Throw an error that a cell is not found in a record, tries to look for misspellings
        */
        void             RecordThrowCellNotFound(VarId record_id, std::string const &name);

        /** Look up a cell inside the record. Makes the record writeable
            @param record_id Record ID to look in
            @param nameid Cell to look up
            @param type Type the cell must have, throw if not
            @param required Whether the cell is required (then throw if not found)
            @return VarId for the name. 0 if the nameid does not exist */
        VarId            RecordCellTypedRefByName  (VarId record_id, ColumnNameId nameid, VariableTypes::Type type, bool required);

        /** Look up a cell inside the record. Makes the record writeable
            @param record_id Record ID to look in
            @param nameid Cell to look up
            @param type Type the cell must have, throw if not
            @param required Whether the cell is required (then throw if not found)
            @return VarId for the name. 0 if the nameid does not exist */
        VarId            RecordCellTypedGetByName  (VarId record_id, ColumnNameId nameid, VariableTypes::Type type, bool required);

        void             FunctionRecordInitializeEmpty(VarId id);
        void             ConvertRecordToFunctionRecord(VarId id);

        /** CopyFrom: Fill a variable with the contents of another variable without casts
            @param id_dest Variable to fill
            @param id_src Variable to read, or 0 to read ourselves */
        void CopyFrom(VarId id_dest, VarId id_src);

        /** MoveFrom: Moves a variable into another without casts, then clears the source (sets to Uninitialized)
            @param id_dest Variable to fill
            @param id_src Variable to read, or 0 to read ourselves */
        void MoveFrom(VarId id_dest, VarId id_src);

        // ---------------- Object manipulation --------------------------------
        // These functions only operate on the raw stored data. No vtables stuff etcetera, only variable member data is stored here!

        void            ObjectInitializeDefault(VarId var);
        bool            ObjectExists           (VarId var);
        void            ObjectInitializeEmpty  (VarId var);
        VarId           ObjectMemberCreate     (VarId var, ColumnNameId nameid, bool this_access, bool is_private, bool is_deletable, VariableTypes::Type type);
        bool            ObjectMemberInsertDefault(VarId var, ColumnNameId nameid, bool this_access, bool is_private, bool is_deletable, VariableTypes::Type type);
        bool            ObjectMemberInsert     (VarId var, ColumnNameId nameid, bool this_access, bool is_private, bool is_deletable, VarId new_value);
        bool            ObjectMemberDelete     (VarId var, ColumnNameId nameid, bool this_access);
        bool            ObjectMemberCopy       (VarId var, ColumnNameId nameid, bool this_access, VarId storeto);
        bool            ObjectMemberSet        (VarId var, ColumnNameId nameid, bool this_access, VarId new_value);
        VarId           ObjectMemberRef        (VarId var, ColumnNameId nameid, bool this_access);
        VarId           ObjectMemberGet        (VarId obj, ColumnNameId nameid, bool this_access); // for readonly purposes only, use xxxref for writes.
        bool            ObjectMemberExists     (VarId obj, ColumnNameId nameid);
        bool            ObjectMemberAccessible (VarId var, ColumnNameId nameid, bool this_access);
        ColumnNameId    ObjectMemberNameByNr   (VarId obj, unsigned num);
        VariableTypes::Type ObjectMemberType (VarId obj, ColumnNameId nameid);
        unsigned        ObjectSize             (VarId obj);
        bool            ObjectIsPrivilegedReference(VarId obj);
        void            ObjectSetReferencePrivilegeStatus(VarId obj, bool new_state);
        void const *    ObjectGetTypeDescriptor(VarId obj);
        void            ObjectSetTypeDescriptor(VarId obj, void const *newdescriptor);
        bool            ObjectHasDeletableMembers(VarId obj);
        bool            ObjectIsSharedReference(VarId obj);

        /** Get the context pointer for an object, construct if necessary
            @param todestroy The object data */
        void*           ObjectGetContext       (VarId var, unsigned context_id, HSVM_ConstructorPtr cons, HSVM_DestructorPtr des, void*opaque, bool autoconstruct);
        void            ObjectSetMarshaller    (VarId var, HSVM_ObjectMarshallerPtr marshaller);
        HSVM_ObjectMarshallerPtr ObjectGetMarshaller(VarId var);

        // Debug functions
        long            GetObjectId            (VarId var) const;
        void            GetObjectLinks         (std::vector< ObjectLink > *links, std::function< std::string(VarId, bool) > const &namegetter, bool include_unreferenced) const;

        void            RecursiveGetBlobReferences(std::vector< BlobReference > *refs, VarId var, std::string const &path, BlobReference const &ref, std::set< VarId > &seenvars, std::set< long > &visitedobjects) const;
        void            GetBlobReferences       (std::vector< BlobReference > *refs, std::function< std::string(VarId, bool) > const &namegetter, bool include_unreferenced) const;

        void            WeakObjectInitializeDefault(VarId var);
        bool            WeakObjectExists          (VarId var);
        void            ConvertObjectToWeakObject (VarId var);
        void            ConvertWeakObjectToObject (VarId var);

        // ---------------- Stack manipulation ---------------------------------

        // ** Compute stack **

        /** Add variables to the local stack
            @param numvars Number of variables to create
            @return Base VarId of the new variables (first created variable is base+0) */
        VarId PushVariables(unsigned numvars);

        VarId PushCopy(VarId var);

        /** Remove variables from the local stack as created by PushVariables.
            @param Number of variables to pop. */
        void PopVariablesN (unsigned numvars);
        void PopDeepVariables (unsigned numvars, unsigned keep);

        /** Returns the current base pointer */
        BasePointer GetBasePointer();

        /** Enters a new stackframe, returns old base pointer (to be given to LeaveStackFrame
            @param numvars Number of local variables
            @return Saved basepointer, needed to leave this stackframe */
        BasePointer EnterStackFrame(unsigned numvars);

        /** Leaves stack frame, destroys local variables and parameters
            @param oldbase Old basepointer returned by EnterStackFrame
            @param returnvalues Number of return values on top of the stack that must be saved
            @param parameters Number of parameters to remove */
        void LeaveStackFrame(const BasePointer& oldbase, unsigned returnvalues, unsigned parameters);

        void SaveStackFrame(unsigned returnvalues, unsigned parameters, VarId target);
        BasePointer RestoreStackFrame(unsigned returnvalues, unsigned parameters, VarId source);

        /** Lowers the number of variables in the local stack frame, pops unneeded variables.
            Don't call to increase the number of variables!
            @param size New number of variables in the local stack frame
        */
        void SetLocalStackSize(unsigned size);

        /** Returns current stack pointer. Increases on push, decreases on pop. Beginvalue is not 0.
            Stack pointer points to place where next pushed variable is placed, so the returnvalue can NOT be used directly.
            @return Current stack pointer. */
        VarId inline StackPointer() const { return UnmapStackId(GetStackPointer()); }

        /** Returns the start of the stack, for debugging visualisation purposes
            @return VarId of first element on stack */
        VarId StackStart() const;

        /** Swaps top 2 variables on stack */
        void Swap();

        /** Swaps the contents of two variables */
        void SwapVariables(VarId a, VarId b);

        // ---------------- Heap manipulation ----------------------------------

        /** Add a variable to the heap
            @return VarId of the new variable  */
        VarId NewHeapVariable();

        /** Delete a variable from the heap
            @param varid VarId of the variable to delete */
        void DeleteHeapVariable(VarId varid);

        // ---------------- Mapping interface ----------------------------------

        /** Reserve stack space for a module's global variables. After calling
            this function, the address of the first variable can be retrieved
            with GetMappingAddress
            @param id Id of the mapping
            @param size Size of the mapping */
        void CreateMapping(unsigned id, unsigned size);

        /** Retrieves the first variable of a requested mapping */
        VarId GetMappingAddress(unsigned id) const
        { return maps[id].var; }

        /** Retrieves the first variable of a requested mapping */
        unsigned GetMappingSize(unsigned id) const
        { return maps[id].size; }

        /// Return the mapping for a variable, 0 if not found (+ the offset within the mapping)
        std::pair< unsigned, unsigned > LookupMapping(VarId var) const;

        void CollectObjects();

        void CopySimpleVariableFromOtherVarMem(VarId dest, VarMemory &other, VarId source);

        void SetKeepAllocStats(bool allocstats);
        void SetCurrentAllocStats(AllocStats *_allocstats) { allocstats = _allocstats; }

    protected: // Only usable from stackmachine

        // Convert array to another type - caller is responsible for making sure the contents matches the type!
        void             SetArrayType       (VarId id, VariableTypes::Type newtype);

    private:
        /** Allocates a block of numvars variables. Variables can be accesses by return .. return + numvars - 1
            @param numvars Number of variables to allocate
            @return Returns base VarId */
        VarId GlobalAllocateBlock(unsigned numvars);

        /** Remove a reference to any external reference counts */
        void Dereference_Externals(VarStore &store);

        void UnmarkUsed(VarStore *buf);

        /** Marks a variable and all objects beneath that variable as used (use
            preferrably only for arrays, records and objects)
            @return Returns whether a live object was found (ignoring default objects)
        */
        bool RecursiveMarkUsed(VarStore *buf);

        struct ObjectData
        {
                inline ObjectData() : var(0), total_elts(0) { }

                VarId var;
                unsigned total_elts;
                uint64_t total_ssize;
        };

        /** @param objects Map from sharedpool bufpos -> object data
        */
        std::pair< unsigned, uint64_t > RecursiveGetObjectLinks(ObjectLink &source, VarId var, std::vector< ObjectLink > *links, std::map< long, ObjectData > &objects, std::set< VarId > *seenvars) const;

        int32_t objectcount;

        /// Whether to keep alloc stats
        bool keep_allocstats;

        /// Current place to administer allocation statistics stats (depends on code location)
        AllocStats *allocstats;

        /// Allocation stats per heap variable (0 if no allocation point known)
        std::vector< AllocStats * > heapallocrefs;

        VarMemory(VarMemory const &) = delete;
        VarMemory& operator=(VarMemory const &) = delete;

        friend class Debugger;
};

// ADDME: add a ArrayPushElement and a RecordPushElement that do not make their structures writable (but just copy the variable)

/** Check if a VarID is stored on the heap */
inline bool VarMemory::IsOnHeap(VarId id) const
{ return id>=ArrayBase; }

/** Map a heap VarID to its shared_heap ID */
inline VarMemory::HeapId VarMemory::MapHeapId(VarId id) const
{ return id-ArrayBase; }

/** Unmap a heap VarID to its shared_heap ID */
inline VarId VarMemory::UnmapHeapId(VarMemory::HeapId id) const
{ return id+ArrayBase; }

inline const VarMemory::VarStore * VarMemory::GetVarReadPtr(VarId id) const
{
        return (IsOnHeap(id) ? (&heapstore[MapHeapId(id)])
                             : (&stackstore[MapStackId(id)]) );
}
inline VarMemory::VarStore * VarMemory::GetVarWritePtr(VarId id)
{
        return (IsOnHeap(id) ? (&heapstore[MapHeapId(id)])
                             : (&stackstore[MapStackId(id)]) );
}
inline VariableTypes::Type VarMemory::GetType (VarId id) const
{
        return GetVarReadPtr(id)->type;
}
inline VarMemory::VarStore* VarMemory::RecycleVariable (VarId dest_id,VariableTypes::Type type,unsigned bufsize)
{
        VarStore *store = GetVarWritePtr(dest_id);
        if (bufsize != 0 || !IsPrimitive(*store)) // || IsBacked(*store) || store->type== VariableTypes::Blob || store->type== VariableTypes::VMRef)
            return RecycleVariableInternal(store, type, bufsize);
        else
        {
                store->data.anybackedtype.bufpos=SharedPool::AllocationUnused;
                store->type=type;
                return store;
        }
}
inline void VarMemory::DestroyVariable(VarId dest_id)
{
        RecycleVariable   (dest_id,VariableTypes::Uninitialized,0);
}

} // End of namespace HareScript

#endif
