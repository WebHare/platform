/*
hsvm_dllinterface.h. Public API for external libraries.
The contents of this file are hereby placed in the public domain.

We strive to keep this API as stable as possible between releases, but cannot
guarantee API and/or ABI stability.

We recommend informing WebHare bv if you use this API, and if possible, in
what way you are using it, so we can try to give an advance warning if we think
or expect planned API changes will affect your applications
*/

#ifndef HSVM_dllinterface_sentry
#define HSVM_dllinterface_sentry

#define HSVM_PUBLIC __attribute__((visibility("default")))
#define HSVM_LOCAL  __attribute__((visibility("hidden")))

#define HSVM_DLLINTERFACE_REVISION 2

/* HareScript VM C language bindings.
   A couple of important notes:
   - this file should conform to the C90 specs. ie, apart from the obvious,
     this also implies: no bools, no // comments, no uint32_t/int32_t types,
   - all our definitions must be prefixed by , to stick inside our own namespace
   - NO exceptions, not even bad_alloc, may travel through the C interface.
*/

#include <time.h>

#ifdef __cplusplus
extern "C"
{
#endif

/*************************************************************************
  Type definitions
*************************************************************************/

/** Virtual Machine ptr; used for accessing virtual machine functions */
struct HSVM;

/** Virtual Machine registration data ptr; used when initializing the module */
struct HSVM_RegData;

/** Variable identifier */
typedef unsigned int HSVM_VariableId;

/** Column identifier */
typedef signed int HSVM_ColumnId;

/** Pointer to a builtin HareScript macro implementation */
typedef void (*HSVM_MacroPtr)(struct HSVM *);

/** Pointer to a builtin HareScript function implementation */
typedef void (*HSVM_FunctionPtr)(struct HSVM*, HSVM_VariableId);

/** Type of the RegisterModule function in the dynamic module */
typedef int (*HSVM_ModuleEntryPointPtr)(struct HSVM_RegData *regdata, void *context_ptr);

/** Type of context constructor functions */
typedef void *(*HSVM_ConstructorPtr)(void *opaque_ptr);

/** Type of context destructor functions */
typedef void (*HSVM_DestructorPtr)(void *opaque_ptr, void *context_ptr);

/** Type of soft reset callback function */
typedef void (*HSVM_SoftResetCallback)(void);

/** Type of collect garbage callback function */
typedef void (*HSVM_GarbageCollectionCallback)(struct HSVM *);


/** Type of object marshaller functions */
//typedef bool (*HSVM_ObjectMarshallerPtr)(struct HSVM *dest_vm, HSVM_VariableId dest, struct HSVM *source_vm, HSVM_VariableId source);

/** Type of the object marshaller restore function. Must restore the object *and* delete the marshalldata
    @param dest_vm Destination VM, if 0 no restore is needed, but the data must be deleted.
    @param dest Destination Destination variable (is 0 when dest_vm is also 0)
    @param marshalldata Marshalldata, as returned by a call to the object's HSVM_ObjectMarshallerPtr
*/
typedef int (*HSVM_ObjectRestorePtr)(struct HSVM *dest_vm, HSVM_VariableId dest, void *marshalldata);

/** Type of the object marshaller restore function. Must restore the object *and* delete the marshalldata
    @param dest_vm Destination VM, if 0 no restore is needed, but the data must be deleted.
    @param dest Destination Destination variable (is 0 when dest_vm is also 0)
    @param marshalldata Marshalldata, as returned by a call to the object's HSVM_ObjectMarshallerPtr
*/
typedef void * (*HSVM_ObjectClonePtr)(void *marshalldata);


/** Type of object marshaller functions
    @param source VM that owns the object
    @param var Variable that contains the object to be marshalled
    @param resultdata Variable that will be filled with a pointer to newly allocated marshal data
    @param restoreptr Pointer to restore/delete function
*/
typedef int (*HSVM_ObjectMarshallerPtr)(struct HSVM *vm, HSVM_VariableId var, void **resultdata, HSVM_ObjectRestorePtr *restoreptr, HSVM_ObjectClonePtr *cloneptr);

/** Type of io reader function
    @param opaque_ptr
    @param numbytes Max number of bytes to write
    @param data Location to put the data into
    @param error_result Resulting errorcode
*/
typedef int (*HSVM_IOReader)(void *opaque_ptr, int numbytes, void *data, int *error_result);
/** Type of io writer function
    @param opaque_ptr
    @param numbytes Number of bytes to write
    @param data Data to write
    @param allow_partial If true, try not to block. If false, don't return unless everything has been written, or an error has occurred.
    @param error_result Resulting error code
    @return Number of bytes written, or a negative value for errors.
*/
typedef int (*HSVM_IOWriter)(void *opaque_ptr, int numbytes, void const *data, int allow_partial, int *error_result);
/** Type of io end of stream function  */
typedef int (*HSVM_IOEndOfStream)(void *opaque_ptr);
/** Type of io close & teardown function  */
typedef void (*HSVM_IOClose)(void *opaque_ptr);

/** Type of a harescript variable */
typedef unsigned int HSVM_VariableType;

typedef void (*HSVM_DynamicFunction)(void);


#define HSVM_VAR_Integer          0x10
#define HSVM_VAR_Money            0x11
#define HSVM_VAR_Float            0x12
#define HSVM_VAR_Boolean          0x13
#define HSVM_VAR_DateTime         0x14
#define HSVM_VAR_Integer64        0x17
#define HSVM_VAR_FunctionPtr      0x20
#define HSVM_VAR_Record           0x21
#define HSVM_VAR_String           0x22
#define HSVM_VAR_Object           0x23
#define HSVM_VAR_WeakObject       0x24
#define HSVM_VAR_Blob             0x40
#define HSVM_VAR_Array            0x80  /* not a real type, but a flag to indicate array type */
#define HSVM_VAR_VariantArray     (HSVM_VAR_Array | 0x01)                      /*0x81*/
#define HSVM_VAR_IntegerArray     (HSVM_VAR_Array | HSVM_VAR_Integer)          /*0x90*/
#define HSVM_VAR_MoneyArray       (HSVM_VAR_Array | HSVM_VAR_Money)            /*0x91*/
#define HSVM_VAR_FloatArray       (HSVM_VAR_Array | HSVM_VAR_Float)            /*0x92*/
#define HSVM_VAR_BooleanArray     (HSVM_VAR_Array | HSVM_VAR_Boolean)          /*0x93*/
#define HSVM_VAR_DateTimeArray    (HSVM_VAR_Array | HSVM_VAR_DateTime)         /*0x94*/
#define HSVM_VAR_Integer64Array   (HSVM_VAR_Array | HSVM_VAR_Integer64)        /*0x97*/
#define HSVM_VAR_FunctionPtrArray (HSVM_VAR_Array | HSVM_VAR_FunctionPtr)      /*0xA0*/
#define HSVM_VAR_RecordArray      (HSVM_VAR_Array | HSVM_VAR_Record)           /*0xA1*/
#define HSVM_VAR_StringArray      (HSVM_VAR_Array | HSVM_VAR_String)           /*0xA2*/
#define HSVM_VAR_ObjectArray      (HSVM_VAR_Array | HSVM_VAR_Object)           /*0xA3*/
#define HSVM_VAR_WeakObjectArray  (HSVM_VAR_Array | HSVM_VAR_WeakObject)       /*0xA4*/
#define HSVM_VAR_BlobArray        (HSVM_VAR_Array | HSVM_VAR_Blob)             /*0xC0*/

/** Maximum length of a HareScript column name, including a terminator NUL byte */
#define HSVM_MaxColumnName 65

/** Types of abort */
#define HSVM_ABORT_DONT_STOP     0x00 // keep running
#define HSVM_ABORT_SILENTTERMINATE 0x01 // no specific reason, just die, and don't give an error
#define HSVM_ABORT_TIMEOUT       0x02 // timeout
#define HSVM_ABORT_DISCONNECT    0x03 // disconnect
#define HSVM_ABORT_HSERROR       0x04 // harescript error
#define HSVM_ABORT_MANUALLY      0x05 // aborted manually
#define HSVM_ABORT_YIELD         0x06 // yield (once, don't die)

/** Running states */
#define HSVM_RUNSTATE_STARTUP           0x00
#define HSVM_RUNSTATE_INITIALRUNNABLE   0x09
#define HSVM_RUNSTATE_RUNNABLE          0x01
#define HSVM_RUNSTATE_RUNNING           0x02
#define HSVM_RUNSTATE_SUSPENDING        0x04
#define HSVM_RUNSTATE_WAITFORMULTIPLE   0x05
#define HSVM_RUNSTATE_LOCKED            0x06
#define HSVM_RUNSTATE_TERMINATED        0x07
#define HSVM_RUNSTATE_DEBUGSTOPPED      0x08


/*****************************************************************************

    Registration (world interface)

*****************************************************************************/

/** Module registration function. YOU are responsible for supplying this
    function. This function can be called multiple times, if it happens to be
    invoked by a process initializing more than one HareScript World (eg, the
    publishing process has separate worlds for templates and harescript files).
    In such a case, you should just re-register all functions.

    Registrations may only be performed inside this function.

    If it is ever necessary to introduce backwards-incompatible changes, it might
    be decided to probe for a HSVM_ModuleEntryPoint2 (or 3, etc) first, to see which
    version of the HareScript API your module supports. Please be careful not to
    export any other functions whose name starts with 'HSVM_ModuleEntryPoint' from
    your library.

    @param regdata Opaque pointer to the function registrator - use this in all
                   HSVM_Register calls
    @param context_ptr Registration context. This is used by programs setting
                       up built-in HareScript functions (eg. the WebHare webserver)
                       and will always be NULL if this module was directly loaded
                       by the HareScript VM because of a function EXTERNAL attribute
    @return non-zero if your initialisation was succesful. if you return zero
            NO registrations may have taken place yet */
 HSVM_PUBLIC int HSVM_ModuleEntryPoint(struct HSVM_RegData *regdata, void *context_ptr);

/** Register an external macro. You may only call this function from your
    HSVM_RegisterModule function.
    @param regdata The pointer passed to HSVM_ModuleEntryPoint
    @param name The name of your macro, properly mangled
    @param macroptr A pointer to the macro's implementation */
 HSVM_PUBLIC void HSVM_RegisterMacro(struct HSVM_RegData *regdata, const char *name, HSVM_MacroPtr macroptr) ;

/** Register an external function. You may only call this function from your
    HSVM_RegisterModule function.
    @param regdata The pointer passed to HSVM_ModuleEntryPoint
    @param name The name of your function, properly mangled
    @param macroptr A pointer to the function's implementation */
 HSVM_PUBLIC void HSVM_RegisterFunction(struct HSVM_RegData *regdata, const char *name, HSVM_FunctionPtr functionptr) ;

/** Register an auto-generatable context. You may only call this function from your
    HSVM_RegisterModule function. Do not try to invoke any struct HSVM functions inside
    your constructor or destructor - specifically, do not try to Unregister or
    Close any resources which you opened through struct HSVM calls (such as OutputObjects
    or Blobs). The destruction order of individual contexts is not specified,
    so you might wind up calling struct HSVM objects after the DllInterface deregistered
    its own context (the DllInterface is just a client too to the HareScript engine)
    @param regdata The pointer passed to HSVM_ModuleEntryPoint
    @param context_id Context id that has been reserved for your data type. Id
                      allocations are done by WebHare bv. For testing purposes,
                      you can just pick an ID in the range 10000 - 19999.
    @param opaque_ptr A pointer that is passed back to the context destructor functions
    @param constructor A function that will be invoked when the context is
                       requested, but not created in the current VM
    @param destructor A function that will be invoked when a VM destructs and
                      the context was requested */
 HSVM_PUBLIC void HSVM_RegisterContext( struct HSVM_RegData *regdata,
                                         unsigned int context_id,
                                         void *opaque_ptr,
                                         HSVM_ConstructorPtr constructor,
                                         HSVM_DestructorPtr destructor) ;

/** Register a callback that is to be called when a softreset is issued. A callback may not (un)register other callbacks,
    or create/destroy webhare environments (will cause deadlock)
    @param regdata The pointer passed to HSVM_ModuleEntryPoint
    @param callback Callback to execute upon a softreset
*/
 HSVM_PUBLIC void HSVM_RegisterSoftResetCallback(HSVM_RegData *regdata,
                                                 HSVM_SoftResetCallback callback);

/** Register a callback that is to be called when a garbage collect is issued. A callback may not (un)register other callbacks,
    or create/destroy webhare environments (will cause deadlock)
    @param regdata The pointer passed to HSVM_ModuleEntryPoint
    @param callback Callback to execute upon a garbage collection
*/
HSVM_PUBLIC void HSVM_RegisterGarbageCollectionCallback(HSVM_RegData *regdata,
                                                        HSVM_GarbageCollectionCallback callback);

/** @short Retrieve the harescript resources directory */
HSVM_PUBLIC const char* HSVM_GetResourcesPath(struct HSVM_RegData *regdata);

/*****************************************************************************

    Virtual machine interface: General functions

*****************************************************************************/

/** Retrieve a context.
    @long Get a pointer to the VM-specific context for this module. Construct the context if it didn't exist yet
    @param vm Virtual machine
    @param context_id Context id as passed to HSVM_RegisterContext
    @param autoconstruct Set to true if you want the context to be automatically constructed if it doesn't exist
    @return The context pointer, as returned by the 'constructor' function. Returns NULL if the context doesn't exist and autoconstruct was not specified
*/
HSVM_PUBLIC void*  HSVM_GetContext(struct HSVM *vm, unsigned int context_id, unsigned int autoconstruct) ;

/** Retrieve a group context.
    @long Get a pointer to the VM group-specific context for this module. Construct the context if it didn't exist yet
    @param vm Virtual machine that is member of the group
    @param context_id Context id as passed to HSVM_RegisterContext
    @param autoconstruct Set to true if you want the context to be automatically constructed if it doesn't exist
    @return The context pointer, as returned by the 'constructor' function. Returns NULL if the context doesn't exist and autoconstruct was not specified
*/
HSVM_PUBLIC void*  HSVM_GetGroupContext(struct HSVM *vm, unsigned int context_id, unsigned int autoconstruct) ;

/** Check whether the current VM is flagged for an abort, or an error is queued. If non-0
    is returned, the calling function must return immediately, and no further VM variable
    accesses may occur.
    @param vm Virtual machine
    @return Returns non-0 if current function must abort, 0 if everything is ok.
*/
 HSVM_PUBLIC int HSVM_TestMustAbort(struct HSVM *vm) ;

/** Check whether the current VM is currently unwinding for an exception. If non-0 is
    returned, the calling function must abort as soon as possible, no VM functions may
    be called, and accessing VM variables is strongly advised against.
    @param vm Virtual machine
    @return Returns non-0 if the VM is currently unwinding, 0 if everything is ok.
*/
 HSVM_PUBLIC int HSVM_IsUnwinding(struct HSVM *vm) ;

/** Aborts the VM when there is an uncaught exception
    @param vm Virtual machine
*/
 HSVM_PUBLIC void HSVM_AbortForUncaughtException(struct HSVM *vm) ;

/** Terminates the VM, without errors
    @param vm Virtual machine
*/
HSVM_PUBLIC void HSVM_SilentTerminate(struct HSVM *vm);

/** Retrieve the type of a variable
    @param vm Virtual machine
    @param id ID of the variable of which the type must be returned
    @return Type of the variable */
HSVM_PUBLIC HSVM_VariableType  HSVM_GetType(struct HSVM *vm, HSVM_VariableId id) ;

/** @short Casts a variable to another type
    @param vm Virtual machine
    @param id ID of the variable that must be retrieved
    @param type Type of the variable
*/
 HSVM_PUBLIC int HSVM_CastTo(struct HSVM *vm, HSVM_VariableId id, HSVM_VariableType type) ;

/** @short Forced casts a variable to another type
    @param vm Virtual machine
    @param id ID of the variable that must be retrieved
    @param type Type of the variable
*/
 HSVM_PUBLIC int HSVM_ForcedCastTo(struct HSVM *vm, HSVM_VariableId id, HSVM_VariableType type) ;

/** Changes the type of a variable to an other type, and initializes it with the
    default value of that type.
    @param vm Virtual machine
    @param id ID of the variable that must be initialized
    @param type New type of the variable */
 HSVM_PUBLIC void HSVM_SetDefault(struct HSVM *vm, HSVM_VariableId id, HSVM_VariableType type) ;

/** Reports an error to the VM. The VM will report the error message as
    a Custom error as soon as the current HareScript function is finished */
 HSVM_PUBLIC void HSVM_ReportCustomError(struct HSVM *vm, const char *errormessage) ;

/** Get the variable ID for an argument.
    @long This function calculates the ID for a HareScript macro or function argument.
    @param x Argument number to retrieve (leftmost argumnet has number 0)
    @return The HareScript variable id for the argument */
#define HSVM_Arg(x) (0x88000000L - 1 - (x))

/** @short Get a handle handle to a function in a loaded HareScript module. Load the module if necessary and possible
    @param modulename Name of the module to find (eg whmod_graphics)
    @param objectname Name of the function to find
    @return A Blex::DynamicFunction pointer to the function, or NULL if it could not be loaded */
HSVM_PUBLIC HSVM_DynamicFunction  HSVM_GetModuleDynamicFunction(struct HSVM *vm, const char *modulename, const char *functionname) ;

/** @short Allocate a HareScript variable id
    @long This function allocates a HareScript variable id, allowing the caller
          to use it for as long as it deems necessary. The caller must store the
          returned variable id, and ensure that it only uses this variabele id
          in the context of the VM in which it first allocated it.
    @return The HareScript variable id for the newly allocated variable */
HSVM_PUBLIC HSVM_VariableId  HSVM_AllocateVariable(struct HSVM *vm) ;

/** @short Deallocate a HareScript variable id
    @long This function deallocates a HareScript variable id previously allocated through HSVM_AllocateVariable */
 HSVM_PUBLIC void HSVM_DeallocateVariable(struct HSVM *vm, HSVM_VariableId varid) ;

/** @short Retrieve the name of the calling library
    @param vm Virtual machine
    @param to_skip Number of stack entries to skip
    @param skip_system If non-zero, skip system libraries when reporting the caller (wh:: libraries)
    @return A null terminated string containing the name of the calling library, or NULL if the name could not be determined */
 HSVM_PUBLIC const char* HSVM_GetCallingLibrary(struct HSVM *vm, unsigned to_skip, int skip_system);

/** @short Retrieve the name of the calling library, and its last recompile time
    @param vm Virtual machine
    @param to_skip Number of stack entries to skip
    @param skip_system If non-zero, skip system libraries when reporting the caller (wh:: libraries)
    @param daysvalue Pointer to integer receiving the day counter
    @param msecsvalue Pointer to integer receiving the mseconds counter
    @return A null terminated string containing the name of the calling library, or NULL if the name could not be determined */
 HSVM_PUBLIC const char* HSVM_GetCallingLibraryWithCompileTime(struct HSVM *vm, unsigned to_skip, int skip_system, int *daysvalue, int *msecsvalue);

/** @short Retrieve stats from the HareScript VM
    @param vm VM that will receive the statistics
    @param stats_var Variable that will receive the statistics
    @param query_vm VM to analyze. May be the same as 'vm' */
 HSVM_PUBLIC void HSVM_GetVMStatistics(struct HSVM *vm, HSVM_VariableId stats_var, struct HSVM *query_vm);

/** @short Collect garbage in a VM (removes all unreferenced objects from memory)
    @param vm VM in which garbage will be collected */
 HSVM_PUBLIC void HSVM_CollectGarbage(struct HSVM *vm) ;

/** @short Enables the profiling timer
    @long If you are running VM code yourself outside of the jobmanager, you must enable the
          profiling timer around calls into harescript to enable profiling
 HSVM_PUBLIC void HSVM_StartProfileTimer(struct HSVM *vm) ;
*/

/** @short Enables the profiling timer
    @long If you are running VM code yourself outside of the jobmanager, you must enable the
          profiling timer around calls into harescript to enable profiling
 HSVM_PUBLIC void HSVM_StopProfileTimer(struct HSVM *vm) ;
*/

/*****************************************************************************

    Virtual machine interface: Primitive types

*****************************************************************************/

/** Retrieves the value of a variable of type HSVM_VAR_Integer.
    @param vm Virtual machine
    @param id ID of the variable that must be retrieved
    @return Value stored in the variable */
 HSVM_PUBLIC int HSVM_IntegerGet(struct HSVM *vm, HSVM_VariableId id) ;

/** Sets a variable to a given integer value.
    @param vm Virtual machine
    @param id ID of the variable that must be set
    @param value New integer value of the integer */
 HSVM_PUBLIC void HSVM_IntegerSet(struct HSVM *vm, HSVM_VariableId id, int value) ;

/** Retrieves the value of a variable of type HSVM_VAR_Integer64.
    @param vm Virtual machine
    @param id ID of the variable that must be retrieved
    @return Value stored in the variable */
 HSVM_PUBLIC long long int HSVM_Integer64Get(struct HSVM *vm, HSVM_VariableId id) ;

 HSVM_PUBLIC void HSVM_Integer64GetParts(struct HSVM *vm, HSVM_VariableId id, int *int_high, unsigned *int_low) ;


/** Sets a variable to a given integer value.
    @param vm Virtual machine
    @param id ID of the variable that must be set
    @param value New integer value of the integer */
 HSVM_PUBLIC void HSVM_Integer64Set(struct HSVM *vm, HSVM_VariableId id, long long int value) ;

 HSVM_PUBLIC void HSVM_Integer64SetParts(struct HSVM *vm, HSVM_VariableId id, int int_high, unsigned int_low) ;

/** Retrieves a variable of type HSVM_VAR_String. The pointers to the begin and
    the end of the string are stored. They may be invalidated by any following struct HSVM function call.
    The string will NOT be 0-terminated. The string is in UTF-8 format.
    @param vm Virtual machine
    @param id ID of the variable
    @param begin Pointer where start of string is stored
    @param end Pointer where end of string is stored */
 HSVM_PUBLIC void HSVM_StringGet(struct HSVM *vm, HSVM_VariableId id, char const ** begin, char const ** end) ;

/** Sets a variable to a given string value. The string must be in UTF-8 format.
    @param vm Virtual machine
    @param id ID of the variable that must be set
    @param begin Pointer to the begin of the new string value
    @param end Pointer to the end of the new string value */
 HSVM_PUBLIC void HSVM_StringSet(struct HSVM *vm, HSVM_VariableId id, char const * begin, char const * end) ;

/** Sets a variable to a given constant string value. The string must be in UTF-8 format.
    @long The contents of the pointed to string may not change or be invalidated
          as long as the current script is running. This version of string set
          stores only a reference to the string in the VM, not the string itself,
          and thus saves the cost of copying and setting up copy-on-write for
          the copied string.
    @param vm Virtual machine
    @param id ID of the variable that must be set
    @param begin Pointer to the begin of the string value.
    @param end Pointer to the end of the new string value
 HSVM_PUBLIC void HSVM_StringSetConstant(struct HSVM *vm, HSVM_VariableId id, char const * begin, char const * end) ;

ADDME: remove and perhaps clear out the entire constant strings stuff
*/
/** Retrieves the value of a variable of type HSVM_VAR_Boolean.
    @param vm Virtual machine
    @param id ID of the variable that must be retrieved
    @return Value stored in the variable */
 HSVM_PUBLIC int HSVM_BooleanGet(struct HSVM *vm, HSVM_VariableId id) ;

/** Sets a variable to a given boolean value
    @param vm Virtual machine
    @param id ID of the variable that must be set
    @param value New boolean value of the variable */
 HSVM_PUBLIC void HSVM_BooleanSet(struct HSVM *vm, HSVM_VariableId id, int value) ;

/** Retrieves the value of a variable of type HSVM_VAR_Float.
    @param vm Virtual machine
    @param id ID of the variable that must be retrieved
    @return Value stored in the variable */
HSVM_PUBLIC double  HSVM_FloatGet(struct HSVM *vm, HSVM_VariableId id) ;

/** Sets a variable to a given float value
    @param vm Virtual machine
    @param id ID of the variable that must be set
    @param value New float value of the variable */
 HSVM_PUBLIC void HSVM_FloatSet(struct HSVM *vm, HSVM_VariableId id, double value) ;

/** Retrieves the value of a variable of type HSVM_VAR_Money.
    @param vm Virtual machine
    @param id ID of the variable that must be retrieved
    @param money_high Pointer to integer receiving the high 32 bits of the money variable mulitplied by 100,000
    @param money_low Pointer to unsigned integer receiving the low 32 bits of the money variable mulitplied by 100,000 */
 HSVM_PUBLIC long long int HSVM_MoneyGet(struct HSVM *vm, HSVM_VariableId id) ;
 HSVM_PUBLIC void HSVM_MoneyGetParts(struct HSVM *vm, HSVM_VariableId id, int *money_high, unsigned *money_low) ;

/** Sets a variable to a given money value
    @param vm Virtual machine
    @param id ID of the variable that must be set
    @param money_high The high 32 bits of the money variable mulitplied by 100,000
    @param money_low The low 32 bits of the money variable mulitplied by 100,000 */
 HSVM_PUBLIC void HSVM_MoneySet(struct HSVM *vm, HSVM_VariableId id, long long int money) ;
 HSVM_PUBLIC void HSVM_MoneySetParts(struct HSVM *vm, HSVM_VariableId id, int money_high, unsigned money_low) ;

/*****************************************************************************

    Virtual machine interface: Date and time values

*****************************************************************************/
/** Retrieves the value of a variable of type HSVM_VAR_DateTime in a C tm structure.
    @param vm Virtual machine
    @param id ID of the variable that must be retrieved
    @param store Time structure to receive time
    @return Value stored in the variable */
 HSVM_PUBLIC void HSVM_DateTimeGetTm(struct HSVM *vm, HSVM_VariableId id, struct tm *store) ;

/** Retrieves the value of a variable of type HSVM_VAR_DateTime as a C time_t value.
    Please note that time_t cannot represent the entire DateTime range
    @param vm Virtual machine
    @param id ID of the variable that must be retrieved
    @return Value stored in the variable. If the
                   time cannot be represented in a time_t, it is rounded
                   to the nearest representable value */
HSVM_PUBLIC time_t  HSVM_DateTimeGetTimeT(struct HSVM *vm, HSVM_VariableId id) ;

/** Retrieves the full datetime value of a variable of type HSVM_VAR_DateTime.
    @param vm Virtual machine
    @param id ID of the variable that must be retrieved
    @param daysvalue Pointer to integer receiving the day counter
    @param msecsvalue Pointer to integer receiving the mseconds counter */
 HSVM_PUBLIC void HSVM_DateTimeGet(struct HSVM *vm, HSVM_VariableId id, int *daysvalue, int *msecsvalue) ;

/** Sets a variable to a given C tm structure value.
    @param vm Virtual machine
    @param id ID of the variable that must be set
    @param value New date and time value (C tm structure) of the datetime */
 HSVM_PUBLIC void HSVM_DateTimeSetTm(struct HSVM *vm, HSVM_VariableId id, struct tm const * value) ;

/** Sets a variable to a given C time_t value.
    @param vm Virtual machine
    @param id ID of the variable that must be set
    @param value New time_t value */
 HSVM_PUBLIC void HSVM_DateTimeSetTimeT(struct HSVM *vm, HSVM_VariableId id, time_t value) ;

/** Sets a variable to a given day and millisecond count.
    @param vm Virtual machine
    @param id ID of the variable that must be set
    @param daysvalue New day count value of the datetime
    @param msecsvalue New day count value of the datetime */
 HSVM_PUBLIC void HSVM_DateTimeSet(struct HSVM *vm, HSVM_VariableId id, int daysvalue, int msecsvalue) ;

/*****************************************************************************

    Virtual machine interface: ARRAYs

*****************************************************************************/

/** Retrieves an element from an array. The returned variable is a reference to
    the requested array element; when written to (using a HSVM_SetXXX function)
    the element in the array is updated.
    @param vm Virtual machine
    @param id ID of the array
    @param index Element within the array
    @return Variable representing the requested array element, 0 if index is out of range. */
HSVM_PUBLIC HSVM_VariableId  HSVM_ArrayGetRef(struct HSVM *vm, HSVM_VariableId id, unsigned index) ;

/** Deletes an element within an array
    @param vm Virtual machine
    @param id ID of the array
    @param index Element within the array that must be deleted */
 HSVM_PUBLIC void HSVM_ArrayDelete(struct HSVM *vm, HSVM_VariableId id, unsigned index) ;

/** Inserts an new variable within a array. It is default-initialized to the type
    stored in the array.
    @param vm Virtual machine
    @param id ID of the array
    @param index Element where the element must be inserted. When the index is
        equal or higher than the number of elements in the array, the element
        is inserted at the end of the array.  */
HSVM_PUBLIC HSVM_VariableId  HSVM_ArrayInsert(struct HSVM *vm, HSVM_VariableId id, unsigned index) ;

/** Appends an new variable within a array. It is default-initialized to the type
    stored in the array.
    @param vm Virtual machine
    @param id ID of the array */
HSVM_PUBLIC HSVM_VariableId  HSVM_ArrayAppend(struct HSVM *vm, HSVM_VariableId id) ;

/** Returns the length of an array
    @param vm Virtual machine
    @param id ID of the array
    @return Length of the array */
HSVM_PUBLIC unsigned  HSVM_ArrayLength(struct HSVM *vm, HSVM_VariableId id) ;

/*****************************************************************************

    Virtual machine interface: OBJECTs

*****************************************************************************/

/** Retrieve an object context. (BETA, may change)
    @long Get a pointer to the VM-specific context for this module. If requested, it will construct the context if it didn't exist yet
    @param vm Virtual machine
    @param object_id Object whose context to pick up
    @param context_id Context id as passed to HSVM_RegisterContext
    @param autoconstruct Set to true if you want the context to be automatically constructed if it doesn't exist
    @return The context pointer, as returned by the 'constructor' function. Returns NULL if the context doesn't exist and autoconstruct was not specified
*/
HSVM_PUBLIC void*  HSVM_ObjectContext(struct HSVM *vm, HSVM_VariableId object_id, unsigned int context_id, unsigned int autoconstruct) ;

/** Sets the marshaller function for a specific object (BETA, may change)
    @long Inserts a marshalling function into the object, which will be called when the object is marshalled from a
        VM to another VM. Marshalling to/from raw data is not supported
    @param vm Virtual machine
    @param object_id Object to set the marshaller for
    @param marshaller Marshalling function
*/
 HSVM_PUBLIC void HSVM_ObjectSetMarshaller(struct HSVM *vm, HSVM_VariableId object_id, HSVM_ObjectMarshallerPtr marshaller);

/** Returns whether an object exists
    @param vm Virtual machine
    @param id Id of the object
    @return 1 if the opject exists */
 HSVM_PUBLIC int HSVM_ObjectExists (struct HSVM *vm, HSVM_VariableId id) ;

/** Returns whether a member in an object exists
    @param vm Virtual machine
    @param id Id of the object
    @param name_id Name of the member to check
    @return 1 if the opject exists */
 HSVM_PUBLIC int HSVM_ObjectMemberExists (struct HSVM *vm, HSVM_VariableId id, HSVM_ColumnId name_id) ;

/** Inserts a new dynamic member in an object (BETA, may change)
    @param vm Virtual machine
    @param id Id of the object
    @param name_id Name of the member to insert
    @param value New value of the member
    @param is_private Set to true to make the new member a private member */
 HSVM_PUBLIC int HSVM_ObjectMemberInsert (struct HSVM *vm, HSVM_VariableId id, HSVM_ColumnId name_id, HSVM_VariableId value, int is_private, int skip_access) ;

/** Delete a dynamic member from an object (BETA, may change)
    @param vm Virtual machine
    @param id Id of the object
    @param name_id Name of the member to delete */
 HSVM_PUBLIC int HSVM_ObjectMemberDelete (struct HSVM *vm, HSVM_VariableId id, HSVM_ColumnId name_id, int skip_access) ;

/** Creates a new, empty object (BETA, may change)
    @param vm Virtual machine
    @param id Id of the object to initialize */
 HSVM_PUBLIC void HSVM_ObjectInitializeEmpty (struct HSVM *vm, HSVM_VariableId id) ;

/** Copies content of an object member (for properties, the return value of the getter function) to another variable (BETA, may change)
    @param vm Virtual machine
    @param object_id Id of the object
    @param name_id The name of the member to return the contents of
    @param storeto The contents will be stored in this variable
    @param skip_access If false, access to PRIVATE members is disallowed
    @return Returns the storeto variable, or 0 if the function failed (member didn't exists, memeber was a method, getter function failed) */
HSVM_PUBLIC HSVM_VariableId  HSVM_ObjectMemberCopy(struct HSVM *vm, HSVM_VariableId object_id, HSVM_ColumnId name_id, HSVM_VariableId storeto, int skip_access);

/** Returns the variable that contains the value of a simple member variable. Fails for properties!(BETA, may change)
    @param vm Virtual machine
    @param object_id Id of the object
    @param name_id The name of the member to return the contents of
    @param storeto The contents will be stored in this variable
    @param skip_access If false, access to PRIVATE members is disallowed
    @return Returns the variable, or 0 if the function failed (member didn't exists, memeber wasn't a simple member) */
HSVM_PUBLIC HSVM_VariableId  HSVM_ObjectMemberRef(struct HSVM *vm, HSVM_VariableId object_id, HSVM_ColumnId name_id, int skip_access);

/** Sets the content of an object member (for properties, calls the setter function) (BETA, may change)
    @param vm Virtual machine
    @param object_id Id of the object
    @param name_id The name of the member to return the contents of
    @param value The new value of the variable
    @param skip_access If false, access to PRIVATE members is disallowed
    @return 1 on success, or 0 if the function failed (member didn't exists, memeber was a method, setter function failed) */
 HSVM_PUBLIC int HSVM_ObjectMemberSet(struct HSVM *vm, HSVM_VariableId object_id, HSVM_ColumnId name_id, HSVM_VariableId storeto, int skip_access);

/** Returns the type of an object member (BETA, may change)
    @param vm Virtual machine
    @param object_id Id of the object
    @param name_id The name of the member to return the contents of
    @return Returns the type of the variable (0: Member does not exist, 1: Variable, 2: Function, 3: Property, 4: Private) */
 HSVM_PUBLIC int HSVM_ObjectMemberType(struct HSVM *vm, HSVM_VariableId object_id, HSVM_ColumnId name_id, int skip_access);

/** Returns whether a weak object exists
    @param vm Virtual machine
    @param id Id of the object
    @return 1 if the opject exists */
 HSVM_PUBLIC int HSVM_WeakObjectExists (struct HSVM *vm, HSVM_VariableId id);

/*****************************************************************************

    Virtual machine interface: RECORDs

*****************************************************************************/

/** Returns the column name for a given columnid
    @param vm Virtual machine
    @param id Columnid
    @param columnname Buffer that receives a nul-terminated UTF-8 formatted column name (must be at least HSVM_MaxColumnName bytes in size
    @return Length of the name
    */
HSVM_PUBLIC unsigned  HSVM_GetColumnName (struct HSVM *vm, HSVM_ColumnId id, char *columnname) ;

/** Returns the columnid for a column name
    @param vm Virtual machine
    @param name Nul-terminated UTF-8 formatted column name
    @return Id of column. */
HSVM_PUBLIC HSVM_ColumnId  HSVM_GetColumnId (struct HSVM *vm, const char *name) ;

/** @short Returns the columnid for a column name without requiring null termination
    @param vm Virtual machine
    @param begin Pointer to the begin of the new string value
    @param end Pointer to the end of the new string value
    @return Id of column. */
HSVM_PUBLIC HSVM_ColumnId  HSVM_GetColumnIdRange(struct HSVM *vm, const char *begin, const char *end) ;

/** Returns whether a column names sorts less than another column name
    @param vm Virtual machine
    @param left
    @param right
    @return Whether the name of column id left < the name of columnid right
*/
HSVM_PUBLIC bool  HSVM_ColumnNameLess(HSVM *vm, HSVM_ColumnId left, HSVM_ColumnId right);

/** Initializes a record to an empty record (use HSVM_SetDefault for non-existing records)
    @param vm Virtual machine
    @param id Id of variable to initialize to an empty record */
 HSVM_PUBLIC void HSVM_RecordSetEmpty(struct HSVM *vm, HSVM_VariableId id) ;

/** Returns the columnid of the num'th cell in a record
    @param vm Virtual machine
    @param id Id of the record
    @return Columnid of the cell */
HSVM_PUBLIC HSVM_ColumnId  HSVM_RecordColumnIdAtPos (struct HSVM *vm, HSVM_VariableId id, unsigned num) ;

/** Deletes a cell with a given name  a record
    @param vm Virtual machine
    @param id Id of the record
    @param columnid The cell with this name will be deleted
    @return non-zero on success */
 HSVM_PUBLIC int HSVM_RecordDelete (struct HSVM *vm, HSVM_VariableId id, HSVM_ColumnId columnid) ;

/** Returns the number of cells in an array
    @param vm Virtual machine
    @param id Id of the record
    @return Number of cells in the record */
 HSVM_PUBLIC int HSVM_RecordLength (struct HSVM *vm, HSVM_VariableId id) ;

/** Returns a variable identifying the cell with the given name
    @param vm Virtual machine
    @param id Id of the record
    @param columnid A reference to the cell with this name is returned
    @return Variable identifying the named cell, 0 if not found. */
HSVM_PUBLIC HSVM_VariableId  HSVM_RecordGetRef (struct HSVM *vm, HSVM_VariableId id, HSVM_ColumnId columnid) ;

/** Returns a variable identifying the cell with the given name. Raises an error when the cell does not exist.
    @param vm Virtual machine
    @param id Id of the record
    @param columnid A reference to the cell with this name is returned
    @return Variable identifying the named cell, 0 if not found. */
HSVM_PUBLIC HSVM_VariableId  HSVM_RecordGetRequiredRef (HSVM *vm, HSVM_VariableId id, HSVM_ColumnId nameid) ;

/** Returns a variable identifying the cell with the given name, and checks its type. Raises an error when the cell does not exist or the type is wrong.
    @param vm Virtual machine
    @param id Id of the record
    @param columnid A reference to the cell with this name is returned
    @param type Required type
    @return Variable identifying the named cell, 0 if not found. */
HSVM_PUBLIC HSVM_VariableId  HSVM_RecordGetRequiredTypedRef (HSVM *vm, HSVM_VariableId id, HSVM_ColumnId nameid, HSVM_VariableType type) ;

/** Creates (or overwrites) a cell with a given name. If created, the new cell is not default initialized!
    @param vm Virtual machine
    @param id Id of the record
    @param columnid Name of the new cell
    @return Variable identifying the new named cell, or the id of the cell if it already existed*/
HSVM_PUBLIC HSVM_VariableId  HSVM_RecordCreate (struct HSVM *vm, HSVM_VariableId id, HSVM_ColumnId columnid) ;

/** Returns whether the record exists
    @param vm Virtual machine
    @param id Id of the record
    @return 1 if the record exists */
 HSVM_PUBLIC int HSVM_RecordExists (struct HSVM *vm, HSVM_VariableId id) ;

/*****************************************************************************

    Virtual machine interface: BLOBs

*****************************************************************************/

/** Open a stream to create a new blob
    @param vm Virtual machine
    @return ID for the new stream. This stream id is also useful for the HareScript CreateStream functions */
 HSVM_PUBLIC int HSVM_CreateStream (struct HSVM *vm) ;

/** Get the write position in a stream
    @param vm Virtual machine
    @return ID for the new stream. This stream id is also useful for the HareScript CreateStream functions */
 HSVM_PUBLIC long long int HSVM_GetStreamOffset (struct HSVM *vm, int streamid) ;

/** Set the write position in a stream
    @param vm Virtual machine
    @return Non-zero on success */
 HSVM_PUBLIC int HSVM_SetStreamOffset (struct HSVM *vm, int streamid, long long int newoffset) ;

/** Get the length of an open stream
    @param vm Virtual machine
    @return ID for the new stream. This stream id is also useful for the HareScript CreateStream functions */
 HSVM_PUBLIC long long int HSVM_GetStreamLength (struct HSVM *vm, int streamid) ;

/** Write data to an open stream
    @param vm Virtual machine
    @param streamid ID for the stream to write to, or 0 for the (possibly redirected!) standard 'Print' device.
    @param numbytes Number of bytes in data buffer to write
    @param buffer Buffer of data to write
    @return non-zero on success
*/
 HSVM_PUBLIC int HSVM_PrintTo(struct HSVM *vm, int streamid, int numbytes, void const *buffer) ;

/** Write data to the default stream
    @param vm Virtual machine
    @param streamid ID for the stream to write to, or 0 for the (possibly redirected!) standard 'Print' device.
    @param numbytes Number of bytes in data buffer to write
    @param buffer Buffer of data to write
    @return non-zero on success
*/
 HSVM_PUBLIC int HSVM_Print(struct HSVM *vm, int numbytes, const void *buffer) ;

/** Write (part of) data to the default stream
    @param vm Virtual machine
    @param streamid ID for the stream to write to, or 0 for the (possibly redirected!) standard 'Print' device.
    @param numbytes Number of bytes in data buffer to write
    @param buffer Buffer of data to write
    @return Number of bytes written
*/
 HSVM_PUBLIC int HSVM_WriteTo(struct HSVM *vm, int streamid, int numbytes, void const *buffer) ;

/** Close a stream and return it as a blob
    @param vm Virtual machine
    @param streamid ID of the stream to close
    @param id Id of the variable that will receive the new blob*/
 HSVM_PUBLIC void HSVM_MakeBlobFromStream(struct HSVM *vm, HSVM_VariableId id, int streamid) ;

/** Create a blob from the contents of a specified memory buffer
    @param vm Virtual machine
    @param numbytes Number of bytes in data buffer to write
    @param buffer Buffer of data to write
    @param id Id of the variable that will receive the new blob*/
 HSVM_PUBLIC void HSVM_MakeBlobFromMemory(struct HSVM *vm, HSVM_VariableId id,  size_t numbytes, void const *buffer) ;

/** Create a blob file from a data file in the WebHare file system
    @param vm Virtual machine
    @param storeid Variable in which the Blob should be stored
    @param filepath Path to the file
    @param type Type of the file to open (2=Witty, 6=Resource)
    @return 0 on success, 1 if the path was invalid, 2 if the file was not found */
 HSVM_PUBLIC int HSVM_MakeBlobFromFilesystem(struct HSVM *vm, HSVM_VariableId storeid, const char *filepath, int type) ;

/** Open a blob for reading
    @param vm Virtual machine
    @param id ID of blob to open
    @return Handle for the open blob */
 HSVM_PUBLIC int HSVM_BlobOpen (struct HSVM *vm, HSVM_VariableId id) ;

/** Get the length of a blob in bytes
    @param vm Virtual machine
    @param id ID of blob to query the length from
    @return Length of the blob in bytes */
 HSVM_PUBLIC long long int HSVM_BlobLength (struct HSVM *vm, HSVM_VariableId id) ;

/** Get the length of an opened blob in bytes
    @param vm Virtual machine
    @param blobhandle Handle of the blob to query the length from
    @return Length of the blob in bytes */
 HSVM_PUBLIC long long int HSVM_BlobOpenedLength (struct HSVM *vm, int blobhandle) ;

/** Read data from an opened blob
    @param vm Virtual machine
    @param blobhandle Handle of the blob to read from
    @param numbytes Maximum number of bytes to read
    @param buffer Buffer in which to store the read bytes
    @return Actual number of bytes read. If this number of bytes is smaller than 'numbytes', EOF was reached */
 HSVM_PUBLIC int HSVM_BlobRead (struct HSVM *vm, int blobhandle, int numbytes, void *buffer) ;

/** Close an opened blob
    @param vm Virtual machine
    @param blobhandle Handle of the blob to read from */

 HSVM_PUBLIC void HSVM_BlobClose (struct HSVM *vm, int blobhandle) ;

/** Write a desription of the blob into the a buffer
    @param vm Virtual machine
    @param blobhandle Handle of the blob to read from
    @param buffer Number of characters written to the buffer
    @param maxlength Length of the buffer
*/
 HSVM_PUBLIC unsigned HSVM_BlobDescription (struct HSVM *vm, int blobhandle, char *buffer, unsigned maxlength);

/** Read data from an opened blob from a specified position
    @param vm Virtual machine
    @param blobhandle Handle of the blob to read from
    @param numbytes Maximum number of bytes to read
    @param buffer Buffer in which to store the read bytes
    @return Actual number of bytes read. If this number of bytes is smaller than 'numbytes', EOF was reached */
 HSVM_PUBLIC int HSVM_BlobDirectRead (struct HSVM *vm, int blobhandle, long long int startpos, int numbytes, void *buffer) ;

/** Redirect output to a specific output id (within-vm redirection)
    @param vm Virtual machine
    @param newoutput New output receiver
    @return Previous output receiver */
 HSVM_PUBLIC int HSVM_RedirectOutputTo(struct HSVM *vm, int newoutput) ;

/** Redirect output to a specific output id (outside-vm redirection, can't be reset by HSVM_RedirectOutputTo)
    @param vm Virtual machine
    @param newoutput New output receiver
    @return Previous output receiver */
 HSVM_PUBLIC int HSVM_RedirectJobOutputTo(struct HSVM *vm, int newoutput) ;

/** Retrieve a context associated with a blob (BETA, may change!)
    @long Get a pointer to the VM-specific context for this module. Construct the context if it didn't exist yet
    @param vm Virtual machine
    @param blobid Blob id
    @param context_id Context id as passed to HSVM_RegisterContext
    @param autoconstruct Set to true if you want the context to be automatically constructed if it doesn't exist
    @return The context pointer, as returned by the 'constructor' function. Returns NULL if the context doesn't exist and autoconstruct was not specified, or if the blob was a default blob
*/
HSVM_PUBLIC void*  HSVM_BlobContext(struct HSVM *vm, HSVM_VariableId blobid, unsigned int context_id, unsigned int autoconstruct) ;

/*****************************************************************************

    Virtual machine interface: Output objects

*****************************************************************************/

/** Register an i/o object
    @param vm Virtual machine
    @param opaque_ptr Pointer that will be passed by HareScript to the specified output function
    @param inputfunction Input callback (may be NULL)
    @param outputfunction Output callback (may be NULL)
    @param endofstreamfunction End of streamcallback (may be NULL, will always return TRUE then)
    @param name Name for reporting purposes
    @return Output object ID allocated by HareScript (usable for HSVM_PrintTo and HSVM_DeregisterOutputObject) */
 HSVM_PUBLIC int HSVM_RegisterIOObject(struct HSVM *vm, void *opaque_ptr, HSVM_IOReader inputfunction, HSVM_IOWriter outputfunction, HSVM_IOEndOfStream endofstreamfunction, HSVM_IOClose closefunction, const char *name) ;

/** De-register an i/o object
   @param vm Virtual machine
   @param objectid Object id as returned by HSVM_RegisterOutputObject*/
 HSVM_PUBLIC void HSVM_UnregisterIOObject(struct HSVM *vm, int objectid) ;

/** @short Set the output callback (ie the output for stream 1 and non-redirected 0).
    @long This function sets up the output callback function. If none is specified, a default output function is used, which will either print to stdout (if opaque_ptr == vm) or to null (if opaqueptr == NULL)
    @param vm Virtual machine
    @param opaque_ptr Pointer that will be passed by HareScript to the specified output function.
    @param outputfunction Output callback (NULL for standard output function)*/
 HSVM_PUBLIC void HSVM_SetOutputCallback(struct HSVM *vm, void *opaque_ptr, HSVM_IOWriter outputfunction) ;

/** @short Set the error callback (ie the output for stream 2).
    @long This function sets up the error callback function. If none is specified, a default output function is used, which will either print to stdout (if opaque_ptr == vm) or to null (if opaqueptr == NULL)
    @param vm Virtual machine
    @param opaque_ptr Pointer that will be passed by HareScript to the specified output function.
    @param outputfunction Error callback (NULL for standard output function)*/
 HSVM_PUBLIC void HSVM_SetErrorCallback(struct HSVM *vm, void *opaque_ptr, HSVM_IOWriter outputfunction) ;

/** Enable or disable output buffering (cuts back on output callback calls)
    @param vm Virtual machine
    @param do_buffer Non-zero to enable buffering, zero to disable (default, also flushes current buffer) */
 HSVM_PUBLIC void HSVM_SetOutputBuffering(struct HSVM *vm, int do_buffer) ;

/** Flush the output buffer
    @param vm Virtual machine
    @param do_buffer Non-zero to enable buffering, zero to disable (default, also flushes current buffer) */
 HSVM_PUBLIC void HSVM_FlushOutputBuffer(struct HSVM *vm) ;

/*****************************************************************************

    Virtual machine interface: Function calls

*****************************************************************************/

/** Schedule the load of a library
    @param vm Virtual Machine
    @param libraryuri Variable containing URI of library in which the function can be found
    @param errors Optional variable to place any errors in. If not present, the script is aborted on error.
    @return 1: The function pointer was found. -1: The function pointer was not found. 0: An unhandled VM exception occured, return to VM asap */
 HSVM_PUBLIC int HSVM_ScheduleLibraryLoad(struct HSVM *vm, HSVM_VariableId libraryuri, HSVM_VariableId errors);

/** Create a function/macro ptr
    @param vm Virtual Machine
    @param id_set Variable to set to function pointer destination. Set to the default function pointer on failure
    @param libraryuri URI of library in which the function can be found
    @param function_name Name of function to call (unmangled name)
    @param returntype Return type of the function (set to 0 for a macro)
    @param numargs Number of arguments the function should expect (including defaultsto arguments)
    @param args Array of type ids of the arguments
    @param errors Optional variable to place any errors in. If not present, the script is aborted on error.
    @return 1: The function pointer was found. -1: The function pointer was not found. 0: An unhandled VM exception occured, return to VM asap */
 HSVM_PUBLIC int HSVM_MakeFunctionPtr(struct HSVM *vm, HSVM_VariableId id_set, const char* libraryuri, const char* function_name, HSVM_VariableType returntype, int numargs, HSVM_VariableType const *args, HSVM_VariableId errors);

/** Create a function/macro ptr
    @param vm Virtual Machine
    @param id_set Variable to set to function pointer destination. Set to the default function pointer on failure
    @param libraryuri Variable containing URI of library in which the function can be found
    @param function_name Variable containing name of function to call (unmangled name)
    @param returntype Return type of the function (set to 0 for a macro)
    @param numargs Number of arguments the function should expect (including defaultsto arguments)
    @param args Array of type ids of the arguments
    @param errors Optional variable to place any errors in. If not present, the script is aborted on error.
    @return 1: The function pointer was found. -1: The function pointer was not found. 0: An unhandled VM exception occured, return to VM asap */
 HSVM_PUBLIC int HSVM_MakeFunctionPtrWithVars(struct HSVM *vm, HSVM_VariableId id_set, HSVM_VariableId libraryuri, HSVM_VariableId function_name, HSVM_VariableType returntype, int numargs, HSVM_VariableType const *args, HSVM_VariableId errors);

/** Create a function/macro ptr, no check on returnvalue or parameters
    @param vm Virtual Machine
    @param id_set Variable to set to function pointer destination. Set to the default function pointer on failure
    @param libraryuri Variable containing URI of library in which the function can be found
    @param function_name Variable containing name of function to call (unmangled name)
    @param errors Optional variable to place any errors in. If not present, the script is aborted on error.
    @return 1: The function pointer was found. -1: The function pointer was not found. 0: An unhandled VM exception occured, return to VM asap */
 HSVM_PUBLIC int HSVM_MakeFunctionPtrWithVarsAutodetect(struct HSVM *vm, HSVM_VariableId id_set, HSVM_VariableId libraryuri, HSVM_VariableId function_name, HSVM_VariableId errors);

/** Rebinds a function/macro ptr
    @param vm Virtual Machine
    @param id_set Variable to set to function pointer destination. Set to the default function pointer on failure
    @param orgfptr Original function pointer
    @param numargs Number of arguments the new function ptr should expect (including defaultsto arguments)
    @param args Array of type ids of the arguments (optional)
    @param passthroughs Array of integers, defining which argument given at invokation of the function
        pointer is used when calling the function. If a position is 0, the corresponding element from the @a bound_params
        array is passed instead of a variable. Optional, when 0 is passed parameters are passed as-is.
    @param bound_params List of variables to bind.
    @param first_rest_source First parameter where non-specified arguments should be bound to
    @param keep_vararg
*/
 HSVM_PUBLIC void HSVM_RebindFunctionPtr(struct HSVM *vm, HSVM_VariableId id_set, HSVM_VariableId orgfptr, int numargs, HSVM_VariableType const *args, int const *passthroughs, HSVM_VariableId const *bound_params, unsigned first_rest_source, bool keep_vararg);

/** Verify whether a function pointer actually points to a function
    @param vm Virtual machine
    @param fptr Function pointer to test
    @return Non-zero if the function pointer points to a function, zero if it is DEFAULT FUNCTION PTR */
 HSVM_PUBLIC int HSVM_FunctionPtrExists(struct HSVM *vm, HSVM_VariableId fptr) ;

/** Prepares for function call, allocates parameters. After this function is
    invoked, HSVM_CloseFunctionCall or HSVM_CancelFunctionCall MUST be called
    before returning to the VM. */
 HSVM_PUBLIC void HSVM_OpenFunctionCall(struct HSVM *vm, unsigned param_count) ;

/** Access for individual parameters
    @param vm Virtual machine
    @param param Nr of param (starts at 0) */
HSVM_PUBLIC HSVM_VariableId  HSVM_CallParam(struct HSVM *vm, unsigned param) ;

/** Calls a function ptr. PrepareFunctionCall needs to be called before, and
    parameters initialized.
    @param vm Virtual Machine
    @param fptr Variable containing function pointer
    @param allow_macro Whether macros are allowed
    @return Returns return variable, 0 if function failed (or threw an error) */
HSVM_PUBLIC HSVM_VariableId  HSVM_CallFunctionPtr(struct HSVM *vm, HSVM_VariableId fptr, int allow_macro) ;

/** FIXME: Document!!! */
HSVM_PUBLIC HSVM_VariableId  HSVM_ScheduleFunctionPtrCall(struct HSVM *vm, HSVM_VariableId fptr, int allow_macro) ;

/** Call a function/macro by name. This function wraps HSVM_MakeFunctionPtr and HSVM_CallFunctionPtr
    @param vm Virtual Machine
    @param libraryuri URI of library in which the function can be found
    @param function_name Name of function to call (unmangled name)
    @param returntype Return type of the function (set to 0 for a macro)
    @param numargs Number of arguments the function should expect (including defaultsto arguments)
    @param args Array of type ids of the arguments
    @return Returns return variable, 0 if function failed (or threw an error) */
HSVM_PUBLIC HSVM_VariableId  HSVM_CallFunction(struct HSVM *vm, const char* libraryuri, const char* function_name, HSVM_VariableType returntype, int numargs, HSVM_VariableType const *args) ;

/** Calls an object method. PrepareFunctionCall needs to be called before, and
    parameters initialized.
    @param vm Virtual Machine
    @param object_id Object in which the method can be found
    @param name_id Name of the method
    @param skip_access If false, this function returns an error on calling PRIVATE members
    @return Returns return variable, 0 if function failed (or threw an error) */
HSVM_PUBLIC HSVM_VariableId  HSVM_CallObjectMethod(struct HSVM *vm, HSVM_VariableId object_id, HSVM_ColumnId name_id, int skip_access, int allow_macro) ;

/** Performs cleanup after function (ptr) call. This destroys the return variable
    offered by HSVM_CallFunction's return value. This function may NOT be called
    before you have done an actual function call using HSVM_CallFunction(ptr)
    @param vm Virtual Machine */
 HSVM_PUBLIC void HSVM_CloseFunctionCall(struct HSVM *vm) ;

/** Performs cleanup after function (ptr) call. This function MUST be called
    if you wish to rollback from a HSVN_OpenFunctionCall
    @param vm Virtual Machine */
 HSVM_PUBLIC void HSVM_CancelFunctionCall(struct HSVM *vm) ;

/** Throws an exception
    @param vm Virtual Machine
    @param text Text of exception to throw, \0 terminated
*/
 HSVM_PUBLIC void HSVM_ThrowException(struct HSVM *vm, const char *text) ;

/** Throws an exception object
    @param vm Virtual Machine
    @param var_except Exception object
    @param is_rethrow Whether this is a rethrow
*/
 HSVM_PUBLIC void HSVM_ThrowExceptionObject(struct HSVM *vm, HSVM_VariableId var_except, bool is_rethrow);

/*****************************************************************************

    Virtual machine interface: Marshalling

*****************************************************************************/

#if 0
/** Calculates total size needed to store the representation of a variable
    @param vm Virtual Machine in which the variable exists
    @param var Variable to calculate the representation size of
    @return Size of representation */
HSVM_PUBLIC unsigned  HSVM_MarshalCalculateLength(struct HSVM *vm, HSVM_VariableId var) ;

/** Writes the marshal-representation to a specified location. The size of the
    buffer needed can be calculated with HSVM_MarshalCalculateLength.
    @param vm Virtual Machine in which the variable exists
    @param var Variable to calculate the marshal-representation of
    @param ptr Buffer to write to */
 HSVM_PUBLIC void HSVM_MarshalWrite(struct HSVM *vm, HSVM_VariableId var, uint8_t *ptr) ;

/** Reads a marshal-representation back into a variable.
    @param vm Virtual Machine in which the variable exists
    @param vm Variable to write to
    @param ptr Address of marshal-representation to read */
 HSVM_PUBLIC void HSVM_MarshalRead(struct HSVM *vm, HSVM_VariableId var, uint8_t const *ptr) ;
#endif

#ifdef __cplusplus
} /* End of "C" linkage */

extern "C"
{
#endif  /* __cplusplus */


/*****************************************************************************

    Virtual machine interface: Other

*****************************************************************************/

 HSVM_PUBLIC void HSVM_CopyFrom(struct HSVM *vm, HSVM_VariableId dest, HSVM_VariableId source) ;

 HSVM_PUBLIC void HSVM_CopyFromOtherVM(struct HSVM *destvm, HSVM_VariableId dest, struct HSVM *sourcevm, HSVM_VariableId source) ;

/** Set arguments for a script */
 HSVM_PUBLIC void HSVM_SetConsoleArguments(struct HSVM *vm, int numargs, const char *args[]);
/** Get a job's exit code */
 HSVM_PUBLIC int HSVM_GetConsoleExitCode(struct HSVM *vm);

/** Start a new job. Release the vm with HSVM_ReleaseJob or HSVM_DeleteJob
    @param vm VM that creates this new process
    @param scriptname Script to start
    @param environment Environment to start the script in
    @param errorstore If not 0, variable in @a vm that will be filled with the errors if starting the new job failed.
    @return If succesfull, job id of the virtual machine that has been created for the new process
*/
 HSVM_PUBLIC int HSVM_CreateJob(struct HSVM *vm, const char *scriptname, HSVM_VariableId errorstore) ;

/** Starts a newly created job
    @param vm VM to run
*/
 HSVM_PUBLIC int HSVM_StartJob(struct HSVM *vm, int jobid) ;

/** Release a process (allow it to run further)
    @param vm VM to release
*/
 HSVM_PUBLIC void HSVM_ReleaseJob(struct HSVM *vm, int jobid) ;

HSVM_PUBLIC struct HSVM *  HSVM_GetVMFromJobId(struct HSVM *vm, int jobid) ;

/** Return the VM group id for a specific vm
    @return Size of group string. If room >= size + 1 (0-byte) the group id has been copied to dest
*/
HSVM_PUBLIC unsigned  HSVM_GetVMGroupId(struct HSVM *vm, char *dest, unsigned room);

/** Aborts a vm
    @param vm VM to abort
*/
 HSVM_PUBLIC void HSVM_AbortVM(struct HSVM *vm) ;

/** Try to lock a VM for exclusive access
    @param vm VM to try and lock
    @param callback When lock fails, function to call when locking is possible again
        (parameters: vm, current vm running state, context), or 0 to do nothing when locking fails
    @param context Context to pass to the callback
    @return 1 when locked, 0 when not locked
*/
 HSVM_PUBLIC int HSVM_TryLockVM(struct HSVM *vm, void (*callback)(struct HSVM *, int, void *), void *context) ;

/** Unlocks a previously collected process
    @param vm VM to unlock
*/
 HSVM_PUBLIC void HSVM_UnlockVM(struct HSVM *vm) ;

/** Load a script
    @return non-zero on success */
 HSVM_PUBLIC int HSVM_LoadScript(struct HSVM *vm, const char *scriptname) ;

/** Execute a script
    @param vm Virtual machine
    @param deinitialize_when_finished If non-zero, the VM will be finalized when finished
    @param allow_suspension If non-zero, the VM can request its own suspension/halt and will return '2' if so
    @return 0 on error, 1 on completion of requested run items, 2 on suspension  */
 HSVM_PUBLIC int HSVM_ExecuteScript(struct HSVM *vm, int deinitialize_when_finished, int allow_suspension) ;

/** Schedules suspension of a script. Only possible when the VM has been started with allow_suspension.
    On success, the HSVM_ExecuteScript will return 2.
    @param vm Virtual machine to suspend.
    @return 0 on error, 1 on error (script is not suspendable)
*/
 HSVM_PUBLIC int HSVM_SuspendVM(struct HSVM *vm) ;

/** Get the current message list (note that all VMs currently share the error list of their group - ADDME: Not sure if that resource should be global (simplifies error handling) or local (simplifies try-and-load) )
    @param vm Virtual machine
    @param errorstore Variable which will store the warning/errorlist (it will be initailzied to RECORD ARRAY)
    @return 2 if there were errors, 1 if there were warnings, 0 if nothing */
 HSVM_PUBLIC int HSVM_GetMessageList(struct HSVM *vm, HSVM_VariableId errorstore) ;

/** Returns contents the authentication record variable.
    @param vm Virtual machine
    @param write_to Variable that will be filled with the auhentication record.
*/
 HSVM_PUBLIC void HSVM_GetAuthenticationRecord(struct HSVM *vm, HSVM_VariableId write_to);

/** Returns the authentication record variable. From the HS interface, this record is writable only with
    'SUPER' permissions, make sure that it not becomes user-writable without it.
    @param vm Virtual machine
    @param write_to Variable that will be filled with the auhentication record.
*/
 HSVM_PUBLIC void HSVM_SetAuthenticationRecord(struct HSVM *vm, HSVM_VariableId var);

/** Clear all caches & execute soft reset callbacks
    @return 0 if all went well
*/
 HSVM_PUBLIC int HSVM_ClearCaches();

/** Returns whether the script has a system redirect script property */
 HSVM_PUBLIC int HSVM_HasSystemRedirect(HSVM *hsvm);

/** Returns whether the current environment allows stdin/out/err sharing */
 HSVM_PUBLIC int HSVM_AllowStdStreamSharing(HSVM *hsvm);

#ifdef __cplusplus
} /* End of "C" linkage */

// Include needed STL headers
#include <string>
#include <vector>
#include <stdexcept>

HSVM_PUBLIC void HSVM_InternalThrowObjectContextError();


/* C++ struct HSVM interface */

/** Retrieves a variable of type HSVM_VAR_STRING as a std::string type
    @param vm Virtual machine
    @param id ID of the variable
    @return Value stored in the variable */
inline std::string HSVM_StringGetSTD(struct HSVM *vm, HSVM_VariableId id)
{
        char const * begin, * end;
        HSVM_StringGet(vm,id,&begin,&end);
        return std::string(begin,end);
}

/** Set a variable of type HSVM_VAR_STRING from a std::string(_view) or C string
    @param vm Virtual machine
    @param id ID of the variable
    @param value Value to set
    @return Value stored in the variable */
inline void HSVM_StringSetSTD(struct HSVM *vm, HSVM_VariableId id, std::string_view const &value)
{
        HSVM_StringSet(vm,id,value.data(),value.data()+value.size());
}
inline void HSVM_StringSetSTD(struct HSVM *vm, HSVM_VariableId id, const char *value)
{
        if(value)
            HSVM_StringSet(vm,id,value,value + std::strlen(value));
        else
            HSVM_SetDefault(vm,id,HSVM_VAR_String);
}

inline std::string HSVM_GetVMGroupIdSTD(struct HSVM *vm)
{
        char groupid_buffer[129];
        unsigned size = HSVM_GetVMGroupId(vm, groupid_buffer, sizeof(groupid_buffer));
        if (size >= sizeof(groupid_buffer))
            throw std::runtime_error("Not enough room in groupid buffer");
        return std::string(groupid_buffer, groupid_buffer + size);
}

/** Returns a string with a stack trace */
 HSVM_PUBLIC void HSVM_GetStackTrace(struct HSVM *vm, std::string *lines) ;

/** Wrapper around a C++ marshal object restore function
    Expects the template parameter to be a class with a member bool RestoreTo(struct HSVM *dest_vm, HSVM_VariableId dest)
*/
 template < class A > HSVM_PUBLIC int HSVM_ObjectMarshalRestoreWrapper(struct HSVM *dest_vm, HSVM_VariableId dest, void *marshaldata)
{
        A *data = static_cast< A *>(marshaldata);
        bool result = true;
        try
        {
                if (dest_vm)
                    result = data->RestoreTo(dest_vm, dest);
        }
        catch (std::exception &)
        {
                delete data;
                return 0;
        }
        delete data;
        return result;
}

/** Wrapper around a C++ marshal object clone function
    Expects the template parameter to be a class with a member bool RestoreTo(struct HSVM *dest_vm, HSVM_VariableId dest)
*/
template < class A > void * HSVM_ObjectMarshalCloneWrapper(void *marshaldata)
{
        A *data = static_cast< A *>(marshaldata);
        try
        {
                A *result = data->Clone();
                return result;
        }
        catch (std::exception &)
        {
                return 0;
        }
}



template < class ContextData, unsigned contextid > class HSVM_RegisteredContext
{
    private:
        static void *CreateContext(void *)
        {
                return new ContextData;
        }
        static void DestroyContext(void *, void *context_ptr)
        {
                delete static_cast< ContextData * >(context_ptr);
        }

        class RefBase
        {
            private:
                ContextData *ptr;

            public:
                typedef ContextData * Pointer;
                typedef ContextData & Reference;

                RefBase(HSVM *vm, HSVM_VariableId var, bool autocreate)
                {
                        ptr = static_cast< ContextData * >(HSVM_ObjectContext(vm, var, contextid, autocreate));
                        if (!ptr)
                            HSVM_InternalThrowObjectContextError();
                }

                RefBase(RefBase const &) = delete;
                RefBase & operator=(RefBase const &) = delete;

                inline ContextData * operator->() { return ptr; }
                inline ContextData & operator*() { return *ptr; }
                inline operator Pointer() { return ptr; }
                inline operator Reference() { return *ptr; }
        };

    public:
        static inline void Register(HSVM_RegData *regdata)
        {
                HSVM_RegisterContext (regdata, contextid, NULL, &CreateContext, &DestroyContext);
        }

        static bool HasContext(HSVM *vm, HSVM_VariableId var)
        {
                return HSVM_ObjectContext(vm, var, contextid, false) != nullptr;
        }

        class Ref: public RefBase
        {
            public:
                Ref(HSVM *vm, HSVM_VariableId var)
                : RefBase(vm, var, false)
                {
                }
        };

        class AutoCreateRef: public RefBase
        {
            public:
                AutoCreateRef(HSVM *vm, HSVM_VariableId var)
                : RefBase(vm, var, true)
                {
                }
        };
};



///** Writes the marshal-representation to a vector. The vector is automatically
//    resize to the size of the representation.
//    @param vm Virtual Machine in which the variable exists
//    @param var Variable to calculate the marshal-representation of
//    @param dest Pointer of vector to write to */
//inline void HSVM_MarshalToVector(struct HSVM *vm, HSVM_VariableId var, std::vector< uint8_t > *dest)
//{
//        dest->resize(HSVM_MarshalCalculateLength(vm, var));
//        HSVM_MarshalWrite(vm, var, &(*dest)[0]);
//}

///** Reads the marshal-representation from a vector.
//    @param vm Virtual Machine in which the variable exists
//    @param var Variable to read in
//    @param dest Pointer of vector to read from */
//inline void HSVM_MarshalFromVector(struct HSVM *vm, HSVM_VariableId var, std::vector< uint8_t > const &src)
//{
//        HSVM_MarshalRead(vm, var, &src[0]);
//}

#endif  /* __cplusplus */

#endif /* Sentry */
