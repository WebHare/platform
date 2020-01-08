#ifndef blex_harescript_shared_hsvm_constants
#define blex_harescript_shared_hsvm_constants

#include <harescript/vm/hsvm_dllinterface.h>

//ADDME: Convert to const
#define HARESCRIPT_LIBRARYVERSION 0x014D // 0x major(01) minor(4D).

namespace HareScript
{

/** Class in which the testfunctions can be defined. This class can be declared friend,
    so that test functions can have internal access in the various objects */
class Tests;
class VirtualMachine;

/** Variable types in the VM.

    Simple types (no special procedures for creation/deletion) must fall in the range 0x00 - 0x1F
    Types with backing must fall in the ranges 0x20 - 0x3F, 0x80-0xFF
    Other special types may be placed in the range 0x40 - 0x7F

    To get the array type of a type, | with VariableTypes (use ToArray for that) */
namespace VariableTypes
{
        enum Type
        {
        Uninitialized   = 0x00,                 ///< Not initialised variable
        Variant         = 0x01,                 ///< Matches all types at comparisons (compiler only)
        NoReturn        = 0x02,                 ///< Return type of macro (compiler only)
        TypeInfo        = 0x03,                 ///< Typeinfo id (compiler only)

        Integer         = HSVM_VAR_Integer, //0x10
        Money           = HSVM_VAR_Money,   //0x11
        Float           = HSVM_VAR_Float,   //0x12
        Boolean         = HSVM_VAR_Boolean, //0x13
        DateTime        = HSVM_VAR_DateTime,//0x14
        Table           = 0x15,
        Schema          = 0x16,
        Integer64       = HSVM_VAR_Integer64, //0x17

        FunctionRecord  = HSVM_VAR_FunctionPtr, //0x20
        Record          = HSVM_VAR_Record,      //0x21
        String          = HSVM_VAR_String,      //0x22
        Object          = HSVM_VAR_Object,      //0x23
        WeakObject      = HSVM_VAR_WeakObject,  //0x24

        Blob            = HSVM_VAR_Blob,        //0x40
        VMRef           = 0x41,                 ///< Reference to another VM

        Array           = HSVM_VAR_Array,       //< 0x80: Bit flag to indicate array (not used as variable type!)
        VariantArray    = HSVM_VAR_VariantArray,
        IntegerArray    = HSVM_VAR_IntegerArray,
        MoneyArray      = HSVM_VAR_MoneyArray,
        FloatArray      = HSVM_VAR_FloatArray,
        BooleanArray    = HSVM_VAR_BooleanArray,
        DateTimeArray   = HSVM_VAR_DateTimeArray,
        TableArray      = 0x95,
        Integer64Array  = HSVM_VAR_Integer64Array,

        FunctionRecordArray = HSVM_VAR_FunctionPtrArray,
        RecordArray     = HSVM_VAR_RecordArray,
        StringArray     = HSVM_VAR_StringArray,
        ObjectArray     = HSVM_VAR_ObjectArray,

        BlobArray       = HSVM_VAR_BlobArray,

        IsBacked        = 0xA0,                 ///< Bit flag to indicate backing
        IsPrimitive     = 0x1F                  ///< Bit flag to indicate primitive variable types
        };
}

/** Condition codes */
namespace ConditionCode
{
        /// All these codes compare to 0
        enum _type
        {
        Less            = 0x00, // Negative
        LessEqual       = 0x01, // Negative or zero
        Equal           = 0x02, // Zero
        Bigger          = 0x03, // Positive (not zero)
        BiggerEqual     = 0x04, // Positive or zero
        UnEqual         = 0x05  // Not zero
        };
}

namespace DBConditionCode
{
        enum _type
        { Less            = 0x80 // a < b
        , LessEqual       = 0x81 // a <= b
        , Equal           = 0x82 // a == b
        , Bigger          = 0x83 // a > b
        , BiggerEqual     = 0x84 // a >= b
        , UnEqual         = 0x85 // a != b
        , Like            = 0x86 // a LIKE b
        , In              = 0x87 // a IN b
        };
        std::string BLEXLIB_PUBLIC GetName(_type type);
}

namespace InstructionSet
{
        enum _type
        {

        ILLEGAL         = 0x00, // Illegal opcde
        CALL            = 0x01, // Call [function-index]
        JUMP            = 0x02, // Jump to [code-diff ptr]
        JUMPC           = 0x03, // Jump to [code-diff ptr] if (condition) is true : DEPRECATED
        RET             = 0x04, // Returns to previous function (return values)
        JUMPC2          = 0x05, // Jump to [code-diff ptr] (bool arg1) jumpt if arg1 is true : UNTESTED
        JUMPC2F         = 0x06, // Jump to [code-diff ptr] (bool arg1) jumpt if arg1 is false : UNTESTED
        NOP             = 0x07, // No-operation
        DUP             = 0x08, // pop (arg), 2*push (arg)
        POP             = 0x09, // pop (arg)
        SWAP            = 0x0A, // pop (arg1), pop (arg2), pusg arg1, push arg2

        CMP             = 0x0C, // cmp (arg1, arg2) push integer representing comparison : DEPRECATED
        CMP2            = 0x0D, // cmp2 (arg1, arg2, condition) push bool if relation is true : UNTESTED

        LOADC           = 0x10, // Loads constant with [constant-index] from constants section
        LOADG           = 0x12, // Loads global from [variable-index] within variable-section
        LOADS           = 0x13, // Loads local stack variable at [variable-location], relative to base-pointer
        STOREG          = 0x14, // Stores (value) global, at [variable-index] within variable-section
        STORES          = 0x15, // Stores (value) local at [variable-location], relative to base-pointer
        LOADSD          = 0x16, // Loads local stack variable at [variable-location], relative to base-pointer (and destroys it)
        LOADGD          = 0x17, // Loads local global from [variable-index] within variable-section (and destroys it)

        INITVAR         = 0x18, // Initializes a variable of [type] with it's default value
        DESTROYS        = 0x19, // Destroys an unused variable on the stack
        COPYS           = 0x1A, // Copies the variable on top of the stack to (value) local at [variable-location], relative to base-pointer, doesn't pop!!
        ISDEFAULTVALUE  = 0x1B, // Tests if the argument has a default value PUSH (POP A = default value) (VARIANT a)
        ISVALUESET      = 0x1C, // Tests if the argument has a non-default value PUSH (POP A = default value) (VARIANT a)

        LOADTYPEID      = 0x2F, // Loads an id that can be mapped to a type by the typemapper

        ADD             = 0x30, // Addition PUSH (POP A + POP B) (number arg1, number arg2)
        SUB             = 0x31, // Subtraction PUSH (POP A - POP B) : (number arg1, number arg2)
        MUL             = 0x32, // Multiplication PUSH (POP A * POP B) : (number arg1, number arg2)
        DIV             = 0x33, // Division PUSH (POP A / POP B) : (number arg1, number arg2)
        MOD             = 0x34, // Modulo PUSH (POP A % POP B) : (number arg1, number arg2)
        NEG             = 0x35, // Negation PUSH (- POP A) : (number arg1)
        INC             = 0x36, // Increment PUSH (++ POP A) : (number arg1)
        DEC             = 0x37, // Decrement PUSH (-- POP A) : (number arg1)

        AND             = 0x38, // logical and PUSH (POP A and POP B) : (BOOLEAN A, BOOLEAN B)
        OR              = 0x39, // logical or PUSH (POP A or POP B) : (BOOLEAN A, BOOLEAN B)
        XOR             = 0x3A, // logical  PUSH (POP A xor POP B) : (BOOLEAN A, BOOLEAN B)
        NOT             = 0x3B, // Logical NOT PUSH (not POP A) : (BOOLEAN A)

        ARRAYINDEX      = 0x40, // Returns element (index) of array : (array, int index)
        ARRAYSIZE       = 0x41, // Returns size of array : (array)
        ARRAYINSERT     = 0x42, // Inserts element value at index (O(N), O(1) at end) : (X array, int index, X value)
        ARRAYSET        = 0x43, // Sets element value at index to value (O(1)) : (X array, int index, X value)
        ARRAYDELETE     = 0x44, // Deletes element value at index (at end -1 O(1) else O(N)) : (X array, int index)
        ARRAYAPPEND     = 0x45, // Inserts element value at end (O(1)) : (X array, X value)
        ARRAYDELETEALL  = 0x46, // Deletes all elements from an array (X array)

        MERGE           = 0x48, // Concatenate 2 strings or integers : (string arg1, string arg2)
        CAST            = 0x4A, // Casts argument to specified type (variant arg1)[new-type]
        ISIN            = 0x4B, // Is arg1 in the array arg2? (variant, array of type1)
        LIKE            = 0x4C, // Glob arg1 with arg2 (string, string)
        CONCAT          = 0x4D, // Concatenate 2 arrays (array, array)
        CASTPARAM       = 0x4E, // Casts argument to specified type, for a function (variant arg1)[new-type, function-index]
        CASTF           = 0x4F, // Casts argument to specified type, forced (variant arg1)[new-type]

        RECORDCELLGET   = 0x50, // Gets a cell of a record [columnname](record)
        RECORDCELLSET   = 0x51, // Sets a cell of a record (record, name, value), returns record (insert or update, no type check)
        RECORDCELLDELETE= 0x52, // Deletes a cell from a record (record, name), returns record
        RECORDCELLCREATE= 0x54, // Creates a cell of a record (record, name, value), returns record (only insert)
        RECORDCELLUPDATE= 0x55, // Creates a cell of a record (record, name, value), returns record (only update, with type check)
        RECORDMAKEEXISTING = 0x56, // Makes a record existing if it doesn't exist, else id (record), returns record

        BITAND          = 0x58, // Bitwise and operator (POP A & POP B) : (INTEGER A, INTEGER B)
        BITOR           = 0x59, // Bitwise or operator (POP A | POP B) : (INTEGER A, INTEGER B)
        BITXOR          = 0x5A, // Bitwise xor operator (POP A ^ POP B) : (INTEGER A, INTEGER B)
        BITNEG          = 0x5B, // Bitwise negation operator (~ POP A) : (INTEGER A)
        BITLSHIFT       = 0x5C, // Bitwise left-shift operator (POP A << POP B) : (INTEGER A, INTEGER B)
        BITRSHIFT       = 0x5D, // Bitwise right-shift operator (POP A >> POP B) : (INTEGER A, INTEGER B)

        INITFUNCTIONPTR = 0x60, // Creates a functionptr from lib, name & funcdata (string, string, record): returns record
        INVOKEFPTR      = 0x61, // Invoke function pointer (FUNCTION PTR func, VARIANT ARRAY args)
        INVOKEFPTRNM    = 0x62, // Invoke function pointer, disallow macros (FUNCTION PTR func, VARIANT ARRAY args)

        OBJNEW          = 0x68, // Create new record ()
        OBJMEMBERGET    = 0x69, // Gets a member from an object [member-name](object)
        OBJMEMBERGETTHIS= 0x6A, // Gets a member from an object (using this ptr) [member-name](object)
        OBJMEMBERSET    = 0x6B, // Sets a member in an object (object, member-name, newvalue)
        OBJMEMBERSETTHIS = 0x6C, // Sets a member in an object (using this ptr) (object, member-name, newvalue)
        OBJMEMBERINSERT = 0x6D, // Inserts a new member into an object (object, member-name, is_private, newvalue)
        OBJMETHODCALL   = 0x6E, // Calls a method of an object [member-name, paramcount](object, parameters...)
        OBJSETTYPE      = 0x6F, // Set the type of an object (object, type-name)
        OBJMETHODCALLTHIS = 0x70, // Calls a method of an object (using this ptr) [member-name, paramcount](object, parameters...)
        OBJMAKEREFPRIV  = 0x71, // Makes an object reference privileged (object) : object
        OBJMETHODCALLNM   = 0x72, // Calls a method of an object, disallow macros [member-name, paramcount](object, parameters...), does not allow macros
        OBJMETHODCALLTHISNM = 0x73, // Calls a method of an object, disallow macros (using this ptr) [member-name, paramcount](object, parameters...), does not allow macros
        OBJMEMBERISSIMPLE = 0x74, // Returns whether a member is simple (variable, or property with that r/w the same var) (object): boolean
        OBJTESTNONSTATIC  = 0x75, // Check for non-staticness of object before dynamic extend
        OBJMEMBERDELETE = 0x76, // Deletes a member from an object [member-name](object)
        OBJMEMBERINSERTTHIS = 0x77, // Inserts a new member into an object (object, member-name, is_private, newvalue)
        OBJMEMBERDELETETHIS = 0x79, // Deletes a member from an object [member-name](object)
        OBJTESTNONSTATICTHIS = 0x7A, // Check for non-staticness of object before dynamic extend, via this ptr

        YIELD           = 0x78, // (object generator, record retval)

        THROW2          = 0x7D, // (errorid integer, str1 string, str2 string): throws a VMRuntimeError
        THROW           = 0x7E, // Prints (value), and does a throw of UserException
        PRINT           = 0x7F, // Prints (value). Not all types are supported at the moment

        DEEPSET         = 0x80, // Sets within multiple layers of indirection (a[0].b) (string/integer arg1..n-2, string argn-1, record/array argn)
        DEEPSETTHIS     = 0x81, // Sets within multiple layers of indirection (a[0].b), with object privileged access  (string/integer arg1..n-2, string argn-1, record/array argn)
        DEEPARRAYINSERT = 0x82, // Inserts within multiple layers of indirection (a[0].b) (string/integer arg1..n-2, string argn-1, record/array argn)
        DEEPARRAYINSERTTHIS = 0x83, // Inserts within multiple layers of indirection (a[0].b), with object privileged access (string/integer arg1..n-2, string argn-1, record/array argn)
        DEEPARRAYAPPEND = 0x84, // Appends within multiple layers of indirection (a[0].b) (string/integer arg1..n-2, string argn-1, record/array argn)
        DEEPARRAYAPPENDTHIS = 0x85, // Appends within multiple layers of indirection (a[0].b), with object privileged access  (string/integer arg1..n-2, string argn-1, record/array argn)
        DEEPARRAYDELETE = 0x86, // Deletes within multiple layers of indirection (a[0].b) (string/integer arg1..n-2, string argn-1, record/array argn)
        DEEPARRAYDELETETHIS = 0x87, // Deletes within multiple layers of indirection (a[0].b), with object privileged access  (string/integer arg1..n-2, string argn-1, record/array argn)
        };
}

namespace SymbolFlags
{
        enum Type
        { None            = 0x0000000
        , Deprecated      = 0x0000001  //<Whether this symbol is now depreacted
        , Public          = 0x0000002  //<Indicates whether this variable is made public
        , Imported        = 0x0000004  //<Indicates whether is imported.
        };
        inline Type& operator |= (Type &lhs, Type rhs) { lhs = (Type)(lhs | rhs); return lhs; }
}

namespace FunctionFlags
{
        enum Type
        {
        None            = 0x00000000,
        Constant        = 0x00000001, // Doesn't read or write global variables or system state.

        External        = 0x00000004, // Function is implemented in non-Harescript code
        SkipTrace       = 0x00000008, // Function must not be mentioned in stack traces
        ExecutesHarescript = 0x00000010, // Function can invoke a harescript function or function pointer
        DeinitMacro     = 0x00000020, // Macro is a deinitialization macro
        Terminates      = 0x00000040, // Calling macro terminates script
        Aggregate       = 0x00000080, // This is an aggregate function
        IsCount         = 0x00000100, // This is the count aggregate function
        Constructor     = 0x00000200, // This is an object constructor
        IsSpecial       = 0x00000400, // This is a function with special treatment
        ObjectMember    = 0x00000800, // This is an object member
        NoStateModify   = 0x00001000, // This function reads but does not write outside state
        VarArg          = 0x00002000  // This function's last parameter is a vararg VARIANT ARRAY.
        };
        inline Type& operator |= (Type &lhs, Type rhs) { lhs = (Type)(lhs | rhs); return lhs; }
}

namespace ObjectTypeFlags
{
        enum Type
        {
        None            = 0x00000000,
        //formerly UnknownIsError  = 0x00000001, // Flag accesses to unknown members as errors (inherited)
        InternalProtected = 0x00000002, // Protect against access
        Static          = 0x00000004, // Flag accesses to unknown members as errors, disallow dynamic extends (not inherited)
        };
        inline Type& operator |= (Type &lhs, Type rhs) { lhs = (Type)(lhs | rhs); return lhs; }
}

namespace ColumnFlags
{
        enum _type
        {
        None            = 0x00000000,
        InternalFase1   = 0x00000001, ///< Retrieved in fase1; may NOT be used by database providers; other means for this are provided.
        InternalFase2   = 0x00000002, ///< Retrieved in fase2; may NOT be used by database providers; other means for this are provided.
        InternalUpdates = 0x00000004, ///< Marked for update; may NOT be used by database providers; other means for this are provided.
        Key             = 0x00000008, ///< Is part of the key for this table
        TranslateNulls  = 0x00000010, ///< Has NULL translation
        ReadOnly        = 0x00000020, ///< Is readonly
        WarnUnindexed   = 0x00000040, ///< This column cannot be indexed by the database
        MaskExcludeInternal = 0x00000078, ///< mask to mask out internal fields
        InternalUsedInCondition = 0x00000080, ///< Used within SQLLib handled conditions
        Binary          = 0x00000100, ///< Column contains binary data
        };
        inline _type& operator |= (_type &lhs, _type rhs) { lhs = (_type)(lhs | rhs); return lhs; }
}

namespace ObjectCellType
{
        enum _type
        {
        Unknown         = 0x0U,
        Member          = 0x1U,
        Method          = 0x2U,
        Property        = 0x3U
        };
}

namespace DeepOperation
{
        enum Type
        {
            Set = 0,
            Insert = 1,
            Append = 2,
            Delete = 3
        };
}

typedef int32_t LibraryId;
typedef int32_t FunctionId;
typedef signed CodePtr;
typedef uint32_t VarId;
typedef uint32_t ColumnNameId;

///Maximum identifier length (note: HSVM_MaxColumnName counts the NUL byte, we don't)
unsigned const IdentifierMax = HSVM_MaxColumnName - 1;

/** Convert a type to an array type */
inline VariableTypes::Type ToArray(VariableTypes::Type origtype)
{
        return VariableTypes::Type(origtype | VariableTypes::Array);
}
/** Convert an array type to a non- array type */
inline VariableTypes::Type ToNonArray(VariableTypes::Type origtype)
{
        return VariableTypes::Type(origtype & ~VariableTypes::Array);
}
inline unsigned IsBackedType(VariableTypes::Type type)
{
        return type & VariableTypes::IsBacked;
}
inline bool IsPrimitiveType(VariableTypes::Type type)
{
        return (type & ~VariableTypes::IsPrimitive) == 0;
}

inline bool IsExplicitNumericType(VariableTypes::Type type)
{
        return type == VariableTypes::Integer
                || type == VariableTypes::Money
                || type == VariableTypes::Float
                || type == VariableTypes::Integer64;
}

inline bool IsObjectType(VariableTypes::Type type)
{
        return type == VariableTypes::WeakObject
                || type == VariableTypes::Object;
}


/// Can a variable of type 'from' be casted to type 'to' (but the actual cast can fail run-time)
bool CanCastTo(VariableTypes::Type from, VariableTypes::Type to);

/** Can a variable of type 'from' always be casted to type 'to', without run-time errors. For example, will fail on cast from Variant
    to String
*/
bool CanAlwaysCastTo(VariableTypes::Type from, VariableTypes::Type to);


/** Type-info structure */
class BLEXLIB_PUBLIC DBTypeInfo
{
    //renamed to DBTypeInfo because Compiler also has a TypeInfo
    public:
        DBTypeInfo();
        ~DBTypeInfo();

        VariableTypes::Type type;

        struct Column
        {
                // Harescript name for this column; primary key for this struct, always uppercase!
                std::string name;

                // Name of this column in the database
                std::string dbase_name;

                // Harescript type for this column
                VariableTypes::Type type;

                // Flags for this column.
                ColumnFlags::_type flags;

                // Default value for NULLs (marshall data)
                std::vector< uint8_t > null_default;

                // Fixed value for view-defining columns
                std::vector< uint8_t > view_value;

                // ColumnNameId for name (only valid in VM)
                ColumnNameId nameid;

                Column();
                bool operator ==(Column const &rhs) const;
        };

        typedef std::vector< Column > ColumnsDef;

        struct Table
        {
                //bool operator ==(Table const &rhs) const;

                // Harescript name for this table; primary key for this struct, always uppercase!
                std::string name;

                // Name of this table in the database
                std::string dbase_name;

                // List of columns
                ColumnsDef columnsdef;

                // List of view-defining columns
                ColumnsDef viewcolumnsdef;
        };

        typedef std::vector< Table > TablesDef;

        ColumnsDef columnsdef;
        ColumnsDef viewcolumnsdef;
        TablesDef tablesdef;

        signed FindColumn(ColumnNameId nameid) const;

        //bool operator ==(TypeInfo const &rhs) const { return type == rhs.type && columnsdef == rhs.columnsdef && tablesdef == rhs.tablesdef; }
        //bool operator !=(TypeInfo const &rhs) const { return !(*this == rhs); }
};

struct InstructionCodeNamePair
{
        InstructionSet::_type id;
        const char* name;
};

typedef std::map<InstructionSet::_type, std::string> InstructionCodeNameMap;
typedef std::map<std::string,  InstructionSet::_type> InstructionCodeNameReverseMap;

const InstructionCodeNamePair* GetInstructionCodeNameList(unsigned &len);
const BLEXLIB_PUBLIC InstructionCodeNameMap & GetInstructionCodeNameMap();
const InstructionCodeNameReverseMap & GetInstructionCodeNameReverseMap();

/** Given a variable type, return a descriptive name for it. Used for debugging
    and error reporting
    \param type Type to explain
    \return String containing the spelled out name, such as 'blob' or 'array of string' */
std::string BLEXLIB_PUBLIC GetTypeName(VariableTypes::Type type);

class VarMemory;

/** Reference counted object that can be used in VarMemory */
class BLEXLIB_PUBLIC VarMemRefCounted
{
    protected:
        // Current reference count
        unsigned refcount;

        // Increases the refcount
        void InternalAddReference();

        // Decreases the refount
        void InternalRemoveReference();

    public:
        /** Constructor */
        inline VarMemRefCounted() : refcount(0) {}

        virtual ~VarMemRefCounted();

        /// Returns the current reference count
        inline unsigned GetRefCount() const { return refcount; }

        friend class VarMemory;
};


struct VMStats
{
        ///KBs of stack used by VM
        int32_t stacklength;
        ///KBs of heap used by VM
        int32_t heaplength;
        ///KBs of backing store used by VM (stores strings, record arrays, etc)
        int32_t backingstorelength;
        ///Executing library
        std::string executelibrary;
        ///Number of instructions executed
        uint64_t instructions_executed;
        ///Number of objects
        int32_t objectcount;
        //Blobstore size
        uint64_t blobstore;
};

namespace IPCMessageState
{
enum Type
{
        None,           ///< Just initialized
        SentMessage,    ///< Normal message, is in queue
        SentRequest,    ///< Request, is in queue
        Processing,     ///< Request, has been accepted but no reply sent yet
        SentReply,      ///< Request, reply is in queue
        Cancelled       ///< Request, message has been cancelled
};
} // End of namespace MessageState
std::ostream & operator << (std::ostream &out, IPCMessageState::Type type);

namespace BroadcastMode
{
enum Type
{
        Local,          ///< Local process only
        CrossProcess    ///< Cross-process

};
} // End of namespace BroadcastMode

namespace RunningState
{
enum Type
{
        Startup         = HSVM_RUNSTATE_STARTUP,    ///< Startup state
        InitialRunnable = HSVM_RUNSTATE_INITIALRUNNABLE, ///< VM is runnable (just started, hasn't run yet)
        Runnable        = HSVM_RUNSTATE_RUNNABLE,   ///< VM is runnable
        Running         = HSVM_RUNSTATE_RUNNING,    ///< VM is currently running
        Suspending      = HSVM_RUNSTATE_SUSPENDING, ///< VM is currently suspending
        WaitForMultiple = HSVM_RUNSTATE_WAITFORMULTIPLE, ///< VM is waiting for some objects
        Locked          = HSVM_RUNSTATE_LOCKED,     ///< VM is locked for external access
        Terminated      = HSVM_RUNSTATE_TERMINATED, ///< VM has been terminated
        DebugStopped    = HSVM_RUNSTATE_DEBUGSTOPPED ///< VM is runnable, but stopped for debugging
};
} // End of namespace RunningState
std::ostream & operator << (std::ostream &out, RunningState::Type type);
const char * GetRunningStateName(RunningState::Type type);

namespace StackElementType
{
enum Type
{
        Return,         ///< Return from a harescript function
        StopExecute,    ///< Returned to starting position of Run
        TailCall,       ///< C-call to execute
        Dummy,          ///< Frame that will be popped without any effects
        PopVariable,    ///< Frame that will be popped, and a variable will be popped
        ReturnToOtherVM,///< Return from other VM in the same group (copy retval, pop fptr data)
        SwitchToOtherVM ///< Switch execution to other VM in the same group (direct switch)
};
} // End of namespace StackElementType
std::ostream & operator <<(std::ostream &out, StackElementType::Type type);

} // End of namespace HareScript

#endif
