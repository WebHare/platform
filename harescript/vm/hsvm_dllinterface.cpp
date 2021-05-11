//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>

//---------------------------------------------------------------------------

//#include "baselibs.h"
#include "hsvm_dllinterface.h"
#include "hsvm_dllinterface_blex.h"
#include "hsvm_context.h"
#include "baselibs.h"
#include "hsvm_processmgr.h"
#include "hsvm_debugger.h"
#include "mangling.h"
#include <blex/datetime.h>
#include <blex/path.h>
#include <iostream>

/* ADDMEs: - Functions should be exception-safe
           - Add type checking so that we don't have to fear an exception
           - Move type checking out of sharedpool/varmem, into dllinterface and VM
           - Fold EmptyBlob and other blob stuff into dllinterface
*/

namespace HareScript
{
const unsigned MaxOutputBufferSize = 32768; // Maximum size of write output buffer

#define START_CATCH_VMEXCEPTIONS try {
#define END_CATCH_VMEXCEPTIONS \
        } \
        catch (HareScript::VMRuntimeError &e) \
        { \
                try \
                { \
                        HareScript::GetVirtualMachine(vm)->PrepareStackTrace(&e); \
                        HareScript::GetVirtualMachine(vm)->GetErrorHandler().AddMessage(e); \
                } \
                catch (HareScript::VMRuntimeError &e) {} \
        } \
        catch(std::exception &e) \
        { \
                try \
                { \
                        HareScript::VMRuntimeError msg(HareScript::Error::CustomError,std::string("Exception in HareScript internal call: " ) + e.what(),""); \
                        HareScript::GetVirtualMachine(vm)->PrepareStackTrace(&msg); \
                        HareScript::GetVirtualMachine(vm)->GetErrorHandler().AddMessage(msg); \
                } \
                catch (HareScript::VMRuntimeError &) {} \
        } \

typedef int (*HSVM_OutputWriter)(void *opaque_ptr, int numbytes, void const *data);

class DllInterfaceOutputObject : public HareScript::OutputObject
{
        public:
        DllInterfaceOutputObject(HSVM *vm, void *opaque_ptr, HSVM_IOReader inputfunction, HSVM_IOWriter outputfunction, HSVM_IOEndOfStream endofstreamfunction, HSVM_IOClose closefunction, const char *name);
        ~DllInterfaceOutputObject();

        std::pair< Blex::SocketError::Errors, unsigned > Read(unsigned numbytes, void *data);
        std::pair< Blex::SocketError::Errors, unsigned > Write(unsigned numbytes, const void *data, bool allow_partial);
        bool IsAtEOF();

        private:
        void *opaque_ptr;
        HSVM_IOReader inputfunction;
        HSVM_IOWriter outputfunction;
        HSVM_IOEndOfStream endofstreamfunction;
        HSVM_IOClose closefunction;
};
typedef std::shared_ptr<DllInterfaceOutputObject> DllInterfaceOutputObjectPtr;


struct OpenBlobInfo
{
        OpenBlobInfo() : blob(NULL), curpos(0), bufferoffset(0), bufferlength(0)
        {
        }
        BlobRefPtr blob;
        std::unique_ptr< OpenedBlob > openblob;
        Blex::FileOffset curpos;

        ///Blob input buffer
        uint8_t buffer[16384];
        ///Offset of current blobinputbuffer
        Blex::FileOffset bufferoffset;
        ///Number of bytes ued
        unsigned bufferlength;
};

struct DllInterfaceExternalOutputContextData
{
        DllInterfaceExternalOutputContextData();
        ~DllInterfaceExternalOutputContextData();

        /// Write data to output buffer
        void WriteToBuffer(void const *start, unsigned length);
        /** Flush the output buffer.
            This function writes the current output buffer to writefunc. */
        void FlushOutputBuffer();

        ///Opaque ptr for output_func
        void *output_opaque_ptr;
        ///Output function (NULL: stdout)
        HSVM_IOWriter output_func;
        ///Opaque ptr for error_func
        void *error_opaque_ptr;
        ///error function (NULL: stdout)
        HSVM_IOWriter error_func;
        /// Buffer for buffered writes
        std::vector<uint8_t> writebuffer;
        /// Are we writing to buffer?
        bool write_to_buffer;
};

struct DllInterfaceContextData
{
        DllInterfaceContextData();
        ~DllInterfaceContextData();

        typedef RegisteredIdMapStorage<OpenBlobInfo> OpenBlobs;
        typedef std::map<int, DllInterfaceOutputObjectPtr> DllIfaceObjects;

        DllIfaceObjects dlliface_objects;

        struct TempFile
        {
                std::string name;
                std::unique_ptr< Blex::ComplexFileStream > file;

                unsigned Write(void const *buffer, unsigned bufferlen);
        };
        typedef std::shared_ptr<TempFile> TempFilePtr;
        typedef std::map<int, TempFilePtr> TempFiles;

        TempFiles tempfiles;

        OpenBlobs blobs;

        /// in-vm-redirected output
        int current_output;
        /// Outside-vm redirected output
        int current_job_output;
};

typedef Blex::Context<DllInterfaceContextData, 11, void> DllInterfaceContext;
typedef Blex::Context<DllInterfaceExternalOutputContextData, 19, void> DllInterfaceExternalOutputContext;

int StandardWriter(void *opaque_ptr, int numbytes, void const *data, int /*allow_partial*/, int *error_code)
{
        if(opaque_ptr)
        {
                std::cout.write(static_cast<const char*>(data),numbytes);
                std::cout.flush();
        }
        *error_code = 0;
        return numbytes; //ADDME: Report # of bytes really writen
}

//ADDME: Hopelijk kan deze buffer weer weg zodra we ComplexFS-en voor harescript
unsigned DllInterfaceContextData::TempFile::Write(void const *data, unsigned bufferlen)
{
        return file->Write(data, bufferlen);
}

DllInterfaceExternalOutputContextData::DllInterfaceExternalOutputContextData()
: output_opaque_ptr(this)
, output_func(StandardWriter)
, error_opaque_ptr(NULL)
, error_func(StandardWriter)
, write_to_buffer(false)
{
}

DllInterfaceExternalOutputContextData::~DllInterfaceExternalOutputContextData()
{
}

void DllInterfaceExternalOutputContextData::FlushOutputBuffer()
{
        if (!writebuffer.size())
            return;

        // Write buffer to write function and clear buffer
        int error_code;
        output_func(output_opaque_ptr, writebuffer.size(), &writebuffer[0], false, &error_code);
        writebuffer.clear();
}


DllInterfaceContextData::DllInterfaceContextData()
: blobs("Open blobs")
, current_output(0)
, current_job_output(0)
{
}

DllInterfaceContextData::~DllInterfaceContextData()
{
}


DllInterfaceOutputObject::DllInterfaceOutputObject(HSVM *vm, void *opaque_ptr, HSVM_IOReader inputfunction, HSVM_IOWriter outputfunction, HSVM_IOEndOfStream endofstreamfunction, HSVM_IOClose closefunction, const char *name)
: HareScript::OutputObject(vm, name)
, opaque_ptr(opaque_ptr)
, inputfunction(inputfunction)
, outputfunction(outputfunction)
, endofstreamfunction(endofstreamfunction)
, closefunction(closefunction)
{
}

void DllInterfaceExternalOutputContextData::WriteToBuffer(void const *start, unsigned length)
{
        if (writebuffer.size()+length > MaxOutputBufferSize)
            FlushOutputBuffer();

        // Resize buffer to hold new data (and reserve some more)
        if (writebuffer.capacity() < (writebuffer.size()+length))
            writebuffer.reserve(writebuffer.size()*2+length);
        // Write to buffer
        writebuffer.insert(writebuffer.end(),static_cast<uint8_t const*>(start),static_cast<uint8_t const*>(start)+length);
}

std::pair< Blex::SocketError::Errors, unsigned >  DllInterfaceOutputObject::Read(unsigned numbytes, void *data)
{
        int errorcode = 0;
        unsigned bytes_read = 0;
        if (inputfunction)
            bytes_read = inputfunction(opaque_ptr, numbytes, data, &errorcode);
        return std::make_pair(static_cast< Blex::SocketError::Errors >(errorcode), bytes_read);
}
std::pair< Blex::SocketError::Errors, unsigned > DllInterfaceOutputObject::Write(unsigned numbytes, const void *data, bool allow_partial)
{
        int errorcode = 0;
        unsigned bytes_written = 0;
        if (outputfunction)
            bytes_written = outputfunction(opaque_ptr, numbytes, data, allow_partial, &errorcode);
        return std::make_pair(static_cast< Blex::SocketError::Errors >(errorcode), bytes_written);
}
bool DllInterfaceOutputObject::IsAtEOF()
{
        return endofstreamfunction ? endofstreamfunction(opaque_ptr) : true;
}
DllInterfaceOutputObject::~DllInterfaceOutputObject()
{
        if(closefunction)
            closefunction(opaque_ptr);
}

} // End of namespace HareScript

// Helper functions
namespace
{
using namespace HareScript;

// Get best name match for library function names. Returns TRUE when an exact name match (ex returnvalue/arguments has been found)
bool GetBestLibraryFunctionMatch(struct HSVM *vm, HSVM_VariableId id_set, LinkedLibrary::ResolvedFunctionDefList const &functiondefs, std::string funcname)
{
        HSVM_SetDefault(vm, id_set, HSVM_VAR_String);
        int curdist = 9999;

        // Remove first ':' and everything after that
        int cpos = funcname.find(':');
        if (cpos != -1)
            funcname.resize(cpos);

        // Compare all function names
        for (LinkedLibrary::ResolvedFunctionDefList::const_iterator it = functiondefs.begin(); it != functiondefs.end(); ++it)
        {
                //ADDME: Why are we consulting the linked function list? we should probably walk the exported function list?!
                if (!(it->def->symbolflags & SymbolFlags::Public))
                    continue; // this function wasn't public, so skip

                // Get name part of current function name
                Blex::StringPair thisname = it->lib->GetLinkinfoName(it->def->name_index);
                const char *first_colon = std::find(thisname.begin, thisname.end, ':');
                std::string namepart(thisname.begin, first_colon);

                int distance = Blex::LevenshteinDistance(funcname, namepart);
                if(distance>2 || distance >= curdist)
                    continue;

                curdist = distance;

                HSVM_StringSet(vm, id_set, thisname.begin, thisname.end);
                if (distance == 0)
                    return true;
        }

        return false;
}

void AddCustomError(struct HSVM *vm, std::string const &message)
{
        if (HareScript::GetVirtualMachine(vm)->GetErrorHandler().AnyErrors())
            return;

        try
        {
                HareScript::VMRuntimeError msg(HareScript::Error::CustomError, "Exception in HareScript internal call: " + message,"");
                HareScript::GetVirtualMachine(vm)->PrepareStackTrace(&msg);
                HareScript::GetVirtualMachine(vm)->GetErrorHandler().AddMessage(msg);
        }
        catch (HareScript::VMRuntimeError &) {};
}

}


extern "C"
{

using namespace HareScript;

#define VM (*GetVirtualMachine(vm))
#define STACKMACHINE VM.GetStackMachine()

namespace
{
int TestMustAbort(struct HSVM *vm)
{
        bool must_abort = VM.GetVMGroup()->TestMustAbort() || VM.GetErrorHandler().AnyErrors() || VM.is_unwinding;
        return must_abort;
}

} // End of anonymous namespace

void HSVM_RegisterMacro(HSVM_RegData *regdata, const char *name, HSVM_MacroPtr function)
{
        //ADDME: Verify that defined names are defined for the proper DLL
        ((DynamicLinkManager*)regdata)->externals.bifreg.RegisterBuiltinFunction(
                BuiltinFunctionDefinition(name, function, 'C'));
}

void HSVM_RegisterFunction(HSVM_RegData *regdata, const char *name, HSVM_FunctionPtr function)
{
        //ADDME: Verify that defined names are defined for the proper DLL
        ((DynamicLinkManager*)regdata)->externals.bifreg.RegisterBuiltinFunction(
                BuiltinFunctionDefinition(name, function, 'C'));
}

void HSVM_RegisterContext( HSVM_RegData *regdata,
                                         unsigned int context_id,
                                         void *opaque_ptr,
                                         HSVM_ConstructorPtr constructor,
                                         HSVM_DestructorPtr destructor)
{
        //ADDME: Should probably record WHO registered us, for safe de-registration of contexts
        ((DynamicLinkManager*)regdata)->RegModuleContext(context_id,opaque_ptr,constructor,destructor);
}

void HSVM_RegisterSoftResetCallback(HSVM_RegData *regdata, HSVM_SoftResetCallback callback)
{
        ((DynamicLinkManager*)regdata)->RegSoftResetCallback(callback);
}

void HSVM_RegisterGarbageCollectionCallback(HSVM_RegData *regdata, HSVM_GarbageCollectionCallback callback)
{
        ((DynamicLinkManager*)regdata)->RegGarbageCollectionCallback(callback);
}

const char* HSVM_GetResourcesPath(struct HSVM_RegData *regdata)
{
        return ((DynamicLinkManager*)regdata)->filesystem.GetWHResDir().c_str();
}

const char* HSVM_GetCallingLibrary(HSVM *vm, unsigned to_skip, int skip_system)
{
        VirtualMachine *the_vm = GetVirtualMachine(vm);
        return the_vm->GetCallingLibrary(to_skip, skip_system, 0);
}

const char* HSVM_GetCallingLibraryWithCompileTime(struct HSVM *vm, unsigned to_skip, int skip_system, int *daysvalue, int *msecsvalue)
{
        VirtualMachine *the_vm = GetVirtualMachine(vm);
        Blex::DateTime modtime;
        const char *retval = the_vm->GetCallingLibrary(to_skip, skip_system, &modtime);
        *daysvalue = modtime.GetDays();
        *msecsvalue = modtime.GetMsecs();
        return retval;
}

/*****************************************************************************

    Virtual machine interface: General functions

*****************************************************************************/
void *HSVM_GetContext(HSVM *vm, unsigned int id, unsigned int autoconstruct)
{
        START_CATCH_VMEXCEPTIONS
        return VM.GetContextKeeper().GetContext(id, autoconstruct);
        END_CATCH_VMEXCEPTIONS
        return 0;
}

void *HSVM_GetGroupContext(HSVM *vm, unsigned int id, unsigned int autoconstruct)
{
        START_CATCH_VMEXCEPTIONS
        return VM.GetVMGroup()->GetContextKeeper().GetContext(id, autoconstruct);
        END_CATCH_VMEXCEPTIONS
        return 0;
}

void* HSVM_ObjectContext(struct HSVM *vm, HSVM_VariableId object_id, unsigned int context_id, unsigned int autoconstruct)
{
        /* FIXME:
           Object implementatie suckt maar goed genoeg voor proof of concept. Hoeveel ugly hack punten krijg ik hiervoor?
           FIXME:
           Bij een default object, geen null teruggeven maar een dummy geconstrueerde context, en ondertussen een error
           geven van type Errors::ModuleInternalError
        */
        START_CATCH_VMEXCEPTIONS
        DynamicLinkManager::DynamicRegistration info;
        if (!VM.GetEnvironment().GetDLLManager().GetRegistrationInfo(context_id, &info))
            return NULL;

        void *context = STACKMACHINE.ObjectGetContext(object_id, context_id, info.constructor, info.destructor, info.opaque_ptr, autoconstruct);
        return context;
        END_CATCH_VMEXCEPTIONS
        return 0;
}

void HSVM_ObjectSetMarshaller(struct HSVM *vm, HSVM_VariableId object_id, HSVM_ObjectMarshallerPtr marshaller)
{
        START_CATCH_VMEXCEPTIONS
        STACKMACHINE.ObjectSetMarshaller(object_id, marshaller);
        END_CATCH_VMEXCEPTIONS
}

int HSVM_ObjectExists (HSVM *vm, HSVM_VariableId id)
{
        START_CATCH_VMEXCEPTIONS
        return STACKMACHINE.ObjectExists(id)==true;
        END_CATCH_VMEXCEPTIONS
        return 0;
}

int HSVM_ObjectMemberExists (struct HSVM *vm, HSVM_VariableId id, HSVM_ColumnId name_id)
{
        START_CATCH_VMEXCEPTIONS
        return VM.ObjectMemberExists(id, name_id)==true;
        END_CATCH_VMEXCEPTIONS
        return 0;
}

void HSVM_ObjectInitializeEmpty (struct HSVM *vm, HSVM_VariableId id)
{
        START_CATCH_VMEXCEPTIONS
        STACKMACHINE.ObjectInitializeEmpty(id);
        END_CATCH_VMEXCEPTIONS
}

int HSVM_ObjectMemberInsert(struct HSVM *vm, HSVM_VariableId object_id, HSVM_ColumnId name_id, HSVM_VariableId value, int is_private, int skip_access)
{
        START_CATCH_VMEXCEPTIONS
        if (VM.ObjectMemberInsert(object_id, name_id, skip_access, is_private, value))
            return 1;
        END_CATCH_VMEXCEPTIONS
        return 0;
}

int HSVM_ObjectMemberDelete(struct HSVM *vm, HSVM_VariableId object_id, HSVM_ColumnId name_id, int skip_access)
{
        START_CATCH_VMEXCEPTIONS
        if (VM.ObjectMemberDelete(object_id, name_id, skip_access))
            return 1;
        END_CATCH_VMEXCEPTIONS
        return 0;
}

HSVM_VariableId HSVM_ObjectMemberCopy(struct HSVM *vm, HSVM_VariableId object_id, HSVM_ColumnId name_id, HSVM_VariableId storeto, int skip_access)
{
        START_CATCH_VMEXCEPTIONS
        if (VM.ObjectMemberCopy(object_id, name_id, skip_access, storeto))
            return storeto;
        END_CATCH_VMEXCEPTIONS
        return 0;
}

HSVM_VariableId HSVM_ObjectMemberRef(struct HSVM *vm, HSVM_VariableId object_id, HSVM_ColumnId name_id, int skip_access)
{
        START_CATCH_VMEXCEPTIONS
        return VM.ObjectMemberRef(object_id, name_id, skip_access);
        END_CATCH_VMEXCEPTIONS
        return 0;
}

int HSVM_ObjectMemberType(struct HSVM *vm, HSVM_VariableId object_id, HSVM_ColumnId name_id, int skip_access)
{
        START_CATCH_VMEXCEPTIONS
        HareScript::ObjectCellType::_type membertype = VM.ObjectMemberType(object_id, name_id);
        if (membertype == HareScript::ObjectCellType::Unknown)
            return 0;

        if (!VM.ObjectMemberAccessible(object_id, name_id, skip_access))
            return 4;

        switch (membertype)
        {
        case HareScript::ObjectCellType::Unknown:       return 0;
        case HareScript::ObjectCellType::Member:        return 1;
        case HareScript::ObjectCellType::Method:        return 2;
        case HareScript::ObjectCellType::Property:      return 3;
        }
        END_CATCH_VMEXCEPTIONS
        return 0;
}

int HSVM_ObjectMemberSet(struct HSVM *vm, HSVM_VariableId object_id, HSVM_ColumnId name_id, HSVM_VariableId value, int skip_access)
{
        START_CATCH_VMEXCEPTIONS
        if (VM.ObjectMemberSet(object_id, name_id, skip_access, value))
            return 1;
        END_CATCH_VMEXCEPTIONS
        return 0;
}

int HSVM_WeakObjectExists (struct HSVM *vm, HSVM_VariableId id)
{
        START_CATCH_VMEXCEPTIONS
        return STACKMACHINE.WeakObjectExists(id)==true;
        END_CATCH_VMEXCEPTIONS
        return 0;
}

int HSVM_TestMustAbort(struct HSVM *vm)
{
        return TestMustAbort(vm);
}

int HSVM_IsUnwinding(struct HSVM *vm)
{
        return VM.is_unwinding;
}

void HSVM_AbortForUncaughtException(struct HSVM *vm)
{
        START_CATCH_VMEXCEPTIONS
        if (VM.is_unwinding)
            VM.AbortForUncaughtException();
        END_CATCH_VMEXCEPTIONS
}

void HSVM_SilentTerminate(struct HSVM *vm)
{
        volatile unsigned *flag = VM.GetVMGroup()->GetAbortFlag();
        *flag = HSVM_ABORT_SILENTTERMINATE;
}

HSVM_VariableType HSVM_GetType(HSVM *vm, HSVM_VariableId id)
{
        START_CATCH_VMEXCEPTIONS
        return STACKMACHINE.GetType(id);
        END_CATCH_VMEXCEPTIONS
        return 0;
}

int HSVM_CastTo(struct HSVM *vm, HSVM_VariableId id, HSVM_VariableType type)
{
        START_CATCH_VMEXCEPTIONS
        STACKMACHINE.CastTo(id, static_cast< VariableTypes::Type >(type));
        return 1;
        END_CATCH_VMEXCEPTIONS
        return 0;
}

int HSVM_ForcedCastTo(struct HSVM *vm, HSVM_VariableId id, HSVM_VariableType type)
{
        START_CATCH_VMEXCEPTIONS
        STACKMACHINE.ForcedCastTo(id, static_cast< VariableTypes::Type >(type));
        return 1;
        END_CATCH_VMEXCEPTIONS
        return 0;
}

void HSVM_SetDefault(HSVM *vm, HSVM_VariableId id, HSVM_VariableType type)
{
        START_CATCH_VMEXCEPTIONS
        STACKMACHINE.InitVariable(id, static_cast<VariableTypes::Type>(type));
        END_CATCH_VMEXCEPTIONS
}

void HSVM_ReportCustomError(HSVM *vm, const char *errormessage)
{
        START_CATCH_VMEXCEPTIONS //protect against Too many errors exception
        VMRuntimeError e(Error::CustomError,errormessage,"");
        GetVirtualMachine(vm)->PrepareStackTrace(&e);
        GetVirtualMachine(vm)->GetErrorHandler().AddMessage(e);
        END_CATCH_VMEXCEPTIONS
}

HSVM_DynamicFunction HSVM_GetModuleDynamicFunction(HSVM *vm, const char *modulename, const char *functionname)
{
        START_CATCH_VMEXCEPTIONS
        void *module = VM.LoadHarescriptModule(modulename);
        if (module)
        {
                return Blex::FindDynamicFunction(module,functionname);
        }
        END_CATCH_VMEXCEPTIONS
        return 0;
}
HSVM_VariableId HSVM_AllocateVariable(HSVM *vm)
{
        START_CATCH_VMEXCEPTIONS
        return STACKMACHINE.NewHeapVariable();
        END_CATCH_VMEXCEPTIONS
        return 0;
}
void HSVM_DeallocateVariable(HSVM *vm, HSVM_VariableId varid)
{
        START_CATCH_VMEXCEPTIONS
        STACKMACHINE.DeleteHeapVariable(varid);
        END_CATCH_VMEXCEPTIONS
}

/*****************************************************************************

    Virtual machine interface: Primitive types

*****************************************************************************/
int32_t HSVM_IntegerGet(HSVM *vm, HSVM_VariableId id)
{
        START_CATCH_VMEXCEPTIONS
        return STACKMACHINE.GetInteger(id);
        END_CATCH_VMEXCEPTIONS
        return 0;
}

void HSVM_IntegerSet(HSVM *vm, HSVM_VariableId id, int value)
{
        START_CATCH_VMEXCEPTIONS
        STACKMACHINE.SetInteger(id, value);
        END_CATCH_VMEXCEPTIONS
}

long long int HSVM_Integer64Get(HSVM *vm, HSVM_VariableId id)
{
        START_CATCH_VMEXCEPTIONS
        return STACKMACHINE.GetInteger64(id);
        END_CATCH_VMEXCEPTIONS
        return 0;
}

void HSVM_Integer64Set(HSVM *vm, HSVM_VariableId id, long long int value)
{
        START_CATCH_VMEXCEPTIONS
        STACKMACHINE.SetInteger64(id, value);
        END_CATCH_VMEXCEPTIONS
}

void HSVM_Integer64GetParts(struct HSVM *vm, HSVM_VariableId id, int *int_high, unsigned *int_low)
{
        START_CATCH_VMEXCEPTIONS
        int64_t intval = STACKMACHINE.GetInteger64(id);
        *int_high = int(intval >> 32);
        *int_low = unsigned(intval&uint64_t(0xFFFFFFFF));
        return; //make sure the reset of the output values is skipped

        END_CATCH_VMEXCEPTIONS
        //this code is reachable! - exception handling gets here
        *int_high = *int_low = 0;
}

void HSVM_Integer64SetParts(struct HSVM *vm, HSVM_VariableId id, int int_high, unsigned int_low)
{
        START_CATCH_VMEXCEPTIONS
        int64_t int64val = (int64_t(int_high) << 32) | int_low;
        STACKMACHINE.SetInteger64(id,int64val);
        END_CATCH_VMEXCEPTIONS
}

void HSVM_StringGet(HSVM *vm, HSVM_VariableId id, char const ** begin, char const ** end)
{
        START_CATCH_VMEXCEPTIONS
        Blex::StringPair pair = STACKMACHINE.GetString(id);
        *begin = pair.begin;
        *end = pair.end;
        return; //make sure the reset of the output values is skipped

        END_CATCH_VMEXCEPTIONS
        //this code is reachable! - exception handling gets here
        *begin = *end = NULL;
}

void HSVM_StringSet(HSVM *vm, HSVM_VariableId id, char const * begin, char const * end)
{
        START_CATCH_VMEXCEPTIONS
        STACKMACHINE.SetString(id, begin, end);
        END_CATCH_VMEXCEPTIONS
}

int HSVM_BooleanGet(HSVM *vm, HSVM_VariableId id)
{
        START_CATCH_VMEXCEPTIONS
        return STACKMACHINE.GetBoolean(id);
        END_CATCH_VMEXCEPTIONS
        return 0;
}
void HSVM_BooleanSet(HSVM *vm, HSVM_VariableId id, int value)
{
        START_CATCH_VMEXCEPTIONS
        STACKMACHINE.SetBoolean(id, value);
        END_CATCH_VMEXCEPTIONS
}
double HSVM_FloatGet(HSVM *vm, HSVM_VariableId id)
{
        START_CATCH_VMEXCEPTIONS
        return STACKMACHINE.GetFloat(id);
        END_CATCH_VMEXCEPTIONS
        return 0;
}
void HSVM_FloatSet(HSVM *vm, HSVM_VariableId id, double value)
{
        START_CATCH_VMEXCEPTIONS
        STACKMACHINE.SetFloat(id,value);
        END_CATCH_VMEXCEPTIONS
}
long long int HSVM_MoneyGet(HSVM *vm, HSVM_VariableId id)
{
        START_CATCH_VMEXCEPTIONS
        return STACKMACHINE.GetMoney(id);
        END_CATCH_VMEXCEPTIONS
        return 0;
}
void HSVM_MoneySet(HSVM *vm, HSVM_VariableId id, long long int value)
{
        START_CATCH_VMEXCEPTIONS
        STACKMACHINE.SetMoney(id,value);
        END_CATCH_VMEXCEPTIONS
}
void HSVM_MoneyGetParts(HSVM *vm, HSVM_VariableId id, int *money_high, unsigned *money_low)
{
        START_CATCH_VMEXCEPTIONS
        int64_t moneyval = STACKMACHINE.GetMoney(id);
        *money_high = int(moneyval >> 32);
        *money_low = unsigned(moneyval&uint64_t(0xFFFFFFFF));
        return; //make sure the reset of the output values is skipped

        END_CATCH_VMEXCEPTIONS
        //this code is reachable! - exception handling gets here
        *money_high = *money_low = 0;
}
void HSVM_MoneySetParts(HSVM *vm, HSVM_VariableId id, int money_high, unsigned money_low)
{
        START_CATCH_VMEXCEPTIONS
        int64_t moneyval = (int64_t(money_high) << 32) | money_low;
        STACKMACHINE.SetMoney(id,moneyval);
        END_CATCH_VMEXCEPTIONS
}

/*****************************************************************************

    Virtual machine interface: Date and time values

*****************************************************************************/
void HSVM_DateTimeGetTm(HSVM *vm, HSVM_VariableId id, struct tm *store)
{
        START_CATCH_VMEXCEPTIONS
        *store = STACKMACHINE.GetDateTime(id).GetTM();
        END_CATCH_VMEXCEPTIONS
}

time_t HSVM_DateTimeGetTimeT(HSVM *vm, HSVM_VariableId id)
{
        START_CATCH_VMEXCEPTIONS
        return STACKMACHINE.GetDateTime(id).GetTimeT();
        END_CATCH_VMEXCEPTIONS
        return 0;
}

void HSVM_DateTimeGet(HSVM *vm, HSVM_VariableId id, int *daysvalue, int *msecsvalue)
{
        START_CATCH_VMEXCEPTIONS
        Blex::DateTime dtm = STACKMACHINE.GetDateTime(id);
        *daysvalue = dtm.GetDays();
        *msecsvalue = dtm.GetMsecs();
        return; //make sure the reset of the output values is skipped
        END_CATCH_VMEXCEPTIONS

        //this code is reachable! - exception handling gets here
        *daysvalue = *msecsvalue = 0;
}

void HSVM_DateTimeSetTm(HSVM *vm, HSVM_VariableId id, struct tm const * value)
{
        START_CATCH_VMEXCEPTIONS
        STACKMACHINE.SetDateTime(id, Blex::DateTime::FromTM(*value));
        END_CATCH_VMEXCEPTIONS
}

void HSVM_DateTimeSetTimeT(HSVM *vm, HSVM_VariableId id, time_t value)
{
        START_CATCH_VMEXCEPTIONS
        STACKMACHINE.SetDateTime(id, Blex::DateTime::FromTimeT(value));
        END_CATCH_VMEXCEPTIONS
}

void HSVM_DateTimeSet(HSVM *vm, HSVM_VariableId id, int daysvalue, int msecsvalue)
{
        START_CATCH_VMEXCEPTIONS
        STACKMACHINE.SetDateTime(id, Blex::DateTime(daysvalue, msecsvalue));
        END_CATCH_VMEXCEPTIONS
}

/*****************************************************************************

    Virtual machine interface: ARRAYs

*****************************************************************************/
HSVM_VariableId HSVM_ArrayGetRef(HSVM *vm, HSVM_VariableId id, unsigned index)
{
        START_CATCH_VMEXCEPTIONS
        unsigned size = STACKMACHINE.ArraySize(id);
        if (index >= size)
            return 0; //ADDME: Note fatal error

        return STACKMACHINE.ArrayElementRef(id, index);
        END_CATCH_VMEXCEPTIONS
        return 0;
}

void HSVM_ArrayDelete(HSVM *vm, HSVM_VariableId id, unsigned index)
{
        START_CATCH_VMEXCEPTIONS
        unsigned size = STACKMACHINE.ArraySize(id);
        if (index >= size)
            return; //ADDME: Note fatal error

        STACKMACHINE.ArrayElementDelete(id, index);
        END_CATCH_VMEXCEPTIONS
}

HSVM_VariableId HSVM_ArrayInsert(HSVM *vm, HSVM_VariableId id, unsigned index)
{
        START_CATCH_VMEXCEPTIONS
        unsigned size = STACKMACHINE.ArraySize(id);
        VariableTypes::Type type = STACKMACHINE.GetType(id);
        if (index >= size)
            return 0; //ADDME: Note fatal error

        id = STACKMACHINE.ArrayElementInsert(id, index);
        STACKMACHINE.InitVariable(id, static_cast<VariableTypes::Type>(type & ~VariableTypes::Array));
        return id;
        END_CATCH_VMEXCEPTIONS
        return 0;
}

HSVM_VariableId HSVM_ArrayAppend(HSVM *vm, HSVM_VariableId id)
{
        START_CATCH_VMEXCEPTIONS
        VariableTypes::Type type = STACKMACHINE.GetType(id);

        id = STACKMACHINE.ArrayElementAppend(id);
        if (type == VariableTypes::VariantArray)
            type = VariableTypes::RecordArray;
        STACKMACHINE.InitVariable(id, static_cast<VariableTypes::Type>(type & ~VariableTypes::Array));
        return id;
        END_CATCH_VMEXCEPTIONS
        return 0;
}

unsigned HSVM_ArrayLength(HSVM *vm, HSVM_VariableId id)
{
        START_CATCH_VMEXCEPTIONS
        return STACKMACHINE.ArraySize(id);
        END_CATCH_VMEXCEPTIONS
        return 0;
}

/*****************************************************************************

    Virtual machine interface: RECORDs

*****************************************************************************/
unsigned HSVM_GetColumnName(HSVM *vm, HSVM_ColumnId id, char *columnname)
{
        START_CATCH_VMEXCEPTIONS
        Blex::StringPair name = VM.columnnamemapper.GetReverseMapping(id);
        unsigned colnamesize = std::min<unsigned>(name.size(), HSVM_MaxColumnName - 1);
        std::copy(name.begin, name.begin + colnamesize, columnname);
        columnname[colnamesize]=0;
        return colnamesize;
        END_CATCH_VMEXCEPTIONS
        return 0;
}

bool HSVM_ColumnNameLess(HSVM *vm, HSVM_ColumnId left, HSVM_ColumnId right)
{
        START_CATCH_VMEXCEPTIONS
        Blex::StringPair str_left = VM.columnnamemapper.GetReverseMapping(left);
        Blex::StringPair str_right = VM.columnnamemapper.GetReverseMapping(right);
        bool result = Blex::StrCompare(str_left.begin, str_left.end, str_right.begin, str_right.end) < 0;

        return result;
        END_CATCH_VMEXCEPTIONS
        return false;
}

HSVM_ColumnId HSVM_GetColumnId (HSVM *vm, const char *name)
{
        START_CATCH_VMEXCEPTIONS
        return VM.columnnamemapper.GetMapping(name);
        END_CATCH_VMEXCEPTIONS
        return 0;
}
HSVM_ColumnId HSVM_GetColumnIdRange (HSVM *vm, const char *begin, const char *end)
{
        START_CATCH_VMEXCEPTIONS
        return VM.columnnamemapper.GetMapping(std::distance(begin,end), begin);
        END_CATCH_VMEXCEPTIONS
        return 0;
}

void HSVM_RecordSetEmpty(HSVM *vm, HSVM_VariableId id)
{
        START_CATCH_VMEXCEPTIONS
        STACKMACHINE.RecordInitializeEmpty(id);
        END_CATCH_VMEXCEPTIONS
}

HSVM_ColumnId HSVM_RecordColumnIdAtPos (HSVM *vm, HSVM_VariableId id, unsigned num)
{
        START_CATCH_VMEXCEPTIONS
        return STACKMACHINE.RecordCellNameByNr(id, num);
        END_CATCH_VMEXCEPTIONS
        return 0;
}

int HSVM_RecordDelete (HSVM *vm, HSVM_VariableId id, HSVM_ColumnId nameid)
{
        START_CATCH_VMEXCEPTIONS
        return STACKMACHINE.RecordCellDelete(id, nameid);
        END_CATCH_VMEXCEPTIONS
        return 0;
}

int HSVM_RecordLength (HSVM *vm, HSVM_VariableId id)
{
        START_CATCH_VMEXCEPTIONS
        return STACKMACHINE.RecordSize(id);
        END_CATCH_VMEXCEPTIONS
        return 0;
}

HSVM_VariableId HSVM_RecordGetRef (HSVM *vm, HSVM_VariableId id, HSVM_ColumnId nameid)
{
        START_CATCH_VMEXCEPTIONS
        return STACKMACHINE.RecordCellRefByName(id, nameid);
        END_CATCH_VMEXCEPTIONS
        return 0;
}

HSVM_VariableId HSVM_RecordGetRequiredRef (HSVM *vm, HSVM_VariableId id, HSVM_ColumnId nameid)
{
        START_CATCH_VMEXCEPTIONS
        return STACKMACHINE.RecordCellTypedRefByName(id, nameid, VariableTypes::Variant, true);
        END_CATCH_VMEXCEPTIONS
        return 0;
}

HSVM_VariableId HSVM_RecordGetRequiredTypedRef (HSVM *vm, HSVM_VariableId id, HSVM_ColumnId nameid, HSVM_VariableType type)
{
        START_CATCH_VMEXCEPTIONS
        return STACKMACHINE.RecordCellTypedRefByName(id, nameid, static_cast< VariableTypes::Type >(type), true);
        END_CATCH_VMEXCEPTIONS
        return 0;
}

HSVM_VariableId HSVM_RecordCreate (HSVM *vm, HSVM_VariableId id, HSVM_ColumnId nameid)
{
        START_CATCH_VMEXCEPTIONS
        return STACKMACHINE.RecordCellCreate(id, nameid);
        END_CATCH_VMEXCEPTIONS
        return 0;
}

int HSVM_RecordExists (HSVM *vm, HSVM_VariableId id)
{
        START_CATCH_VMEXCEPTIONS
        return STACKMACHINE.RecordNull(id)==false;
        END_CATCH_VMEXCEPTIONS
        return 0;
}

int TempFileWriter(void *opaque_ptr, int numbytes, void const *data, int /*allow_partial*/, int *error_result)
{
        DllInterfaceContextData::TempFile* file = (DllInterfaceContextData::TempFile*)opaque_ptr;

        *error_result = 0;
        if (numbytes > 0)
             return file->Write(data,numbytes);

        return 0;
}

/* Webhare filesystem blob */
class FileSystemBlob : public BlobBase
{
    private:
        HareScript::FilePtr file;

        class MyOpenedBlob: public OpenedBlobBase< FileSystemBlob >
        {
            private:
                std::unique_ptr< Blex::RandomStream > stream;
                Blex::DateTime modtime;

            public:
                MyOpenedBlob(FileSystemBlob &blob);
                ~MyOpenedBlob();

                std::size_t DirectRead(Blex::FileOffset startoffset, std::size_t numbytes, void *buffer);
                Blex::FileOffset GetCacheableLength();
        };

    public:
        /** Constructor */
        FileSystemBlob(VirtualMachine *vm, HareScript::FilePtr &&file);
        ~FileSystemBlob();

        bool HasFile() { return file.get(); }

        std::unique_ptr< OpenedBlob > OpenBlob();
        Blex::FileOffset GetCacheableLength();
        Blex::DateTime GetModTime();
        std::string GetDescription();
};

FileSystemBlob::FileSystemBlob(VirtualMachine *vm, HareScript::FilePtr &&_file)
: BlobBase(vm)
, file(_file)
{
}

FileSystemBlob::~FileSystemBlob()
{
}

FileSystemBlob::MyOpenedBlob::MyOpenedBlob(FileSystemBlob &blob)
: OpenedBlobBase< FileSystemBlob >(blob)
{
        blob.file->GetSourceData(&stream, &modtime);
}

FileSystemBlob::MyOpenedBlob::~MyOpenedBlob()
{
}

std::size_t FileSystemBlob::MyOpenedBlob::DirectRead(Blex::FileOffset startoffset, std::size_t numbytes, void *buffer)
{
        return stream ? stream->DirectRead(startoffset, buffer, numbytes) : 0;
}

Blex::FileOffset FileSystemBlob::MyOpenedBlob::GetCacheableLength()
{
        return stream ? stream->GetFileLength() : 0;
}

std::unique_ptr< OpenedBlob > FileSystemBlob::OpenBlob()
{
        return std::make_unique< MyOpenedBlob >(*this);
}

Blex::FileOffset FileSystemBlob::GetCacheableLength()
{
        return MyOpenedBlob(*this).GetCacheableLength();
}

Blex::DateTime FileSystemBlob::GetModTime()
{
        return file->GetSourceModTime();
}

std::string FileSystemBlob::GetDescription()
{
        return file->GetDescription();
}


int HSVM_CreateStream (HSVM *vm)
{
        /* Readd to catch blob creations
        std::string info;
        HSVM_GetStackTrace(vm, &info);
        DEBUGPRINT(info);
        */

        START_CATCH_VMEXCEPTIONS
        DllInterfaceContext dll(VM.GetContextKeeper());
        DllInterfaceContextData::TempFilePtr newfile(new DllInterfaceContextData::TempFile);

        newfile->file = VM.GetBlobManager().CreateTempStream(&newfile->name);

        int tempfileid = HSVM_RegisterIOObject(vm, newfile.get(), NULL, &TempFileWriter, NULL, NULL, "Stream");
        dll->tempfiles[tempfileid]=newfile;
        return tempfileid;

        END_CATCH_VMEXCEPTIONS
        return 0;
}

long long int HSVM_GetStreamOffset (struct HSVM *vm, int streamid)
{
        START_CATCH_VMEXCEPTIONS
        DllInterfaceContext dll(VM.GetContextKeeper());
        DllInterfaceContextData::TempFiles::iterator tempfile = dll->tempfiles.find(streamid);
        if (tempfile == dll->tempfiles.end())
            throw VMRuntimeError(Error::IllegalBlobStream);

        return tempfile->second->file->GetOffset();

        END_CATCH_VMEXCEPTIONS
        return 0;
}
int HSVM_SetStreamOffset (struct HSVM *vm, int streamid, long long int newoffset)
{
        START_CATCH_VMEXCEPTIONS
        DllInterfaceContext dll(VM.GetContextKeeper());
        DllInterfaceContextData::TempFiles::iterator tempfile = dll->tempfiles.find(streamid);
        if (tempfile == dll->tempfiles.end())
            throw VMRuntimeError(Error::IllegalBlobStream);

        return tempfile->second->file->SetOffset(newoffset) ? 1 : 0;

        END_CATCH_VMEXCEPTIONS
        return 0;
}

long long HSVM_GetStreamLength (struct HSVM *vm, int streamid)
{
        START_CATCH_VMEXCEPTIONS

        DllInterfaceContext dll(VM.GetContextKeeper());
        DllInterfaceContextData::TempFiles::iterator tempfile = dll->tempfiles.find(streamid);
        if (tempfile == dll->tempfiles.end())
            throw VMRuntimeError(Error::IllegalBlobStream);

        tempfile->second->file->Flush(); // FIXME: shouldn't be needed, fix randomstreambuffer::GetFileLength
        return tempfile->second->file->GetFileLength();
//        VM.GetLocalBlobHandler().GetStreamLength(tempfile->second->streamid) + tempfile->second->GetNumBufferedBytes());

        END_CATCH_VMEXCEPTIONS
        return 0;
}

int HSVM_Print(HSVM *vm, int numbytes, void const *buffer)
{
       return HSVM_PrintTo(vm,0,numbytes,buffer);
}

int HSVM_OutputBytes(HSVM *vm, int streamid, int numbytes, void const *buffer, int allow_partial)
{
        START_CATCH_VMEXCEPTIONS
        if (numbytes==0)
            return allow_partial ? 0 : 1;

        DllInterfaceContext dll(VM.GetContextKeeper());
        DllInterfaceExternalOutputContext dlloutput(VM.GetContextKeeper());
        bool redirected = false;

        if (streamid==0 && (dll->current_output != 0 || dll->current_job_output != 0)) //Redirection within VM?
        {
                redirected = true;
                streamid = dll->current_output != 0 ? dll->current_output : dll->current_job_output;
        }
        if (streamid == 0 || streamid == 1) //standard output
        {
                int bytes_written;
                int errorcode = 0;

                if (dlloutput->write_to_buffer)
                {
                        dlloutput->WriteToBuffer(buffer, numbytes);
                        bytes_written = numbytes;
                }
                else
                    bytes_written = dlloutput->output_func(dlloutput->output_opaque_ptr, numbytes, buffer, allow_partial, &errorcode);

                return errorcode ? errorcode : (allow_partial ? bytes_written : 1);
        }
        if (streamid == 2) // standard error
        {
                int errorcode = 0;
                int bytes_written = dlloutput->error_func(dlloutput->error_opaque_ptr, numbytes, buffer, allow_partial, &errorcode);
                return errorcode ? errorcode : (allow_partial ? bytes_written : 1);
        }

        /* ADDME: Move output object management to DLL Interface ? */
        HareScript::OutputObject *myobject = VM.GetOutputObject(streamid, redirected);

        std::pair< Blex::SocketError::Errors, unsigned > res = myobject->Write(numbytes, buffer, allow_partial);
//        DEBUGPRINT("Outputobject " << streamid << " write: code:" << res.first << " - " << res.second << " bytes");
//        int bytes_written = myobject->Write(numbytes, buffer, allow_partial);
        int retval = res.first != Blex::SocketError::NoError ? static_cast< int >(res.first) : (allow_partial ? res.second : (res.second == (unsigned)numbytes ? 1 : 0));
        if (myobject->ShouldYieldAfterWrite())
        {
                volatile unsigned *flag = VM.GetVMGroup()->GetAbortFlag();
                if (*flag == HSVM_ABORT_DONT_STOP)
                    *flag = HSVM_ABORT_YIELD;
        }
        return retval;
        END_CATCH_VMEXCEPTIONS
        return 0;
}

int HSVM_PrintTo(HSVM *vm, int streamid, int numbytes, void const *buffer)
{
        return HSVM_OutputBytes(vm, streamid, numbytes, buffer, false);
}

int HSVM_WriteTo(HSVM *vm, int streamid, int numbytes, void const *buffer)
{
        return HSVM_OutputBytes(vm, streamid, numbytes, buffer, true);
}

int HSVM_RedirectOutputTo(struct HSVM *vm, int newoutput)
{
        START_CATCH_VMEXCEPTIONS
        DllInterfaceContext dll(VM.GetContextKeeper());

        std::swap(dll->current_output, newoutput);
        return newoutput;

        END_CATCH_VMEXCEPTIONS
        return 0;
}

int HSVM_RedirectJobOutputTo(struct HSVM *vm, int newoutput)
{
        START_CATCH_VMEXCEPTIONS
        DllInterfaceContext dll(VM.GetContextKeeper());

        std::swap(dll->current_job_output, newoutput);
        return newoutput;

        END_CATCH_VMEXCEPTIONS
        return 0;
}


int HSVM_MakeBlobFromFilesystem(HSVM *vm, HSVM_VariableId storeid, const char *filepath, int /*loadtype*/)
{
        START_CATCH_VMEXCEPTIONS
        std::string path = filepath;

        if (!IsValidFilesystemPath(path))
        {
                //Return an empty blob
                HSVM_MakeBlobFromMemory(vm, storeid, 0, NULL);
                return 1; //invalid path
        }

        VM.GetFileSystem().ResolveAbsoluteLibrary(VM.GetContextKeeper(), VM.GetExecuteLibrary(), &path);
        HareScript::FilePtr file = VM.GetFileSystem().OpenLibrary(VM.GetContextKeeper(), path);
        if (!file || file->GetSourceModTime() == Blex::DateTime::Invalid())
        {
                HSVM_MakeBlobFromMemory(vm, storeid, 0, NULL);
                return 2; //failed..
        }
        STACKMACHINE.SetBlob(storeid, BlobRefPtr(new FileSystemBlob(&VM, std::move(file))));
        return 0;

        END_CATCH_VMEXCEPTIONS
        return 0;
}

void HSVM_MakeBlobFromStream(HSVM *vm, HSVM_VariableId id, int streamid)
{
        START_CATCH_VMEXCEPTIONS

        DllInterfaceContext dll(VM.GetContextKeeper());
        DllInterfaceContextData::TempFiles::iterator tempfile = dll->tempfiles.find(streamid);
        if (tempfile == dll->tempfiles.end())
            throw VMRuntimeError(Error::IllegalBlobStream);

        HSVM_UnregisterIOObject(vm, streamid);

        std::shared_ptr< GlobalBlob > globalblob = VM.GetBlobManager().BuildBlobFromTempStream(std::move(tempfile->second->file), tempfile->second->name);
        BlobRefPtr blob = VM.GetBlobManager().BuildBlobFromGlobalBlob(&VM, globalblob);
        VM.GetStackMachine().SetBlob(id, blob);

        dll->tempfiles.erase(tempfile);

        END_CATCH_VMEXCEPTIONS
}

void HSVM_MakeBlobFromMemory(HSVM *vm, HSVM_VariableId id, size_t numbytes, void const *buffer)
{
        //No wrappers, we are completely exception-free
        if (numbytes==0)
        {
                HSVM_SetDefault(vm, id, HSVM_VAR_Blob);
        }
        else
        {
                int streamid = HSVM_CreateStream(vm);
                while (numbytes)
                {
                      unsigned to_print = std::min< size_t >(numbytes, 65536);
                      HSVM_PrintTo(vm, streamid, to_print, buffer);

                      buffer = ((uint8_t*)buffer) + to_print;
                      numbytes -= to_print;
                }
                HSVM_MakeBlobFromStream(vm, id, streamid);
        }
}

int HSVM_BlobOpen (HSVM *vm, HSVM_VariableId id)
{
        START_CATCH_VMEXCEPTIONS
        DllInterfaceContext dll(VM.GetContextKeeper());

        OpenBlobInfo blobinfo;
        blobinfo.blob = STACKMACHINE.GetBlob(id);
        blobinfo.openblob = blobinfo.blob.OpenBlob();
        if (!blobinfo.openblob)
            throw VMRuntimeError(Error::IOError);

        dll->blobs.SetVM(&VM);
        return dll->blobs.Set(&VM, std::move(blobinfo));
        END_CATCH_VMEXCEPTIONS
        return 0;
}

long long int HSVM_BlobLength (HSVM *vm, HSVM_VariableId id)
{
        START_CATCH_VMEXCEPTIONS
        BlobRefPtr blob = STACKMACHINE.GetBlob(id);
        return blob.GetLength();
        END_CATCH_VMEXCEPTIONS
        return 0;
}

void *HSVM_BlobContext(HSVM *vm, HSVM_VariableId blobid, unsigned int context_id, unsigned int autoconstruct)
{
        START_CATCH_VMEXCEPTIONS
        DllInterfaceContext dll(VM.GetContextKeeper());
        BlobRefPtr blob = STACKMACHINE.GetBlob(blobid);
        return blob.GetContext(context_id, autoconstruct);
        END_CATCH_VMEXCEPTIONS
        return 0;
}

long long int HSVM_BlobOpenedLength (HSVM *vm, int blobhandle)
{
        START_CATCH_VMEXCEPTIONS
        DllInterfaceContext dll(VM.GetContextKeeper());
        OpenBlobInfo *blob = dll->blobs.Get(blobhandle);
        if (!blob)
            return 0;
        return blob->blob.GetLength();
        END_CATCH_VMEXCEPTIONS
        return 0;
}
int HSVM_BlobRead (HSVM *vm, int blobhandle, int numbytes, void *buffer)
{
        DllInterfaceContext dll(VM.GetContextKeeper());
        OpenBlobInfo* blob = dll->blobs.Get(blobhandle);
        if (!blob)
            return 0;

        int totalread = HSVM_BlobDirectRead(vm, blobhandle, blob->curpos, numbytes, buffer);
        blob->curpos += totalread;
        return totalread;
}
int HSVM_BlobDirectRead (HSVM *vm, int blobhandle, long long int _startpos, int numbytes, void *buffer)
{
        START_CATCH_VMEXCEPTIONS

        DllInterfaceContext dll(VM.GetContextKeeper());
        OpenBlobInfo* blob = dll->blobs.Get(blobhandle);
        if (!blob)
            return 0;

        int totalread = 0;
        Blex::FileOffset startpos = _startpos;
        while(numbytes>0)
        {
                int thisread;

                /* Can we satisfy part from the buffer? Same blob, and startpos in
                   [dll.blobbufferoffset, dll.blobbufferoffset + dll.blobbufferlength[
                */

                //ADDME: support tail reads from buffer
                if (blob->bufferoffset <= startpos && startpos < (blob->bufferoffset + blob->bufferlength))
                {
                        unsigned internaloffset = startpos - blob->bufferoffset;
                        thisread = std::min<unsigned>(numbytes, blob->bufferlength - internaloffset);
                        memcpy(buffer, &blob->buffer[internaloffset], thisread);

                }
                //If the remaining read is large enough to fill the buffer, do a pass through
                else if ((unsigned)numbytes >= sizeof blob->buffer)
                {
                        thisread = blob->openblob->DirectRead(startpos, numbytes, buffer);
                        if(thisread<=0)
                            break;// EOF
                }
                //If the remaining read is SMALLER than the buffer, fill up a full buffer, if possible
                else
                {
                        thisread = blob->openblob->DirectRead(startpos, sizeof blob->buffer, blob->buffer);
                        if(thisread>0) //there was data - buffer it!
                        {
                                blob->bufferoffset = startpos;
                                blob->bufferlength = thisread;
                                continue; //the next iteration will copy data out of the buffer
                        }
                        //EOF!
                        break;
                }

                totalread += thisread;
                startpos += thisread;
                numbytes -= thisread;
                buffer = static_cast<char*>(buffer) + thisread;
        }
        return totalread;
        END_CATCH_VMEXCEPTIONS
        return 0;
}

unsigned HSVM_BlobDescription (HSVM *vm, int blobhandle, char *data, unsigned maxlength)
{
        START_CATCH_VMEXCEPTIONS
        DllInterfaceContext dll(VM.GetContextKeeper());
        std::string descr;
        OpenBlobInfo *blob = dll->blobs.Get(blobhandle);
        if (blob)
            descr = blob->blob.GetDescription();
        else
            descr = "?(dllitf)";

        if (descr.size() > maxlength)
            descr.resize(maxlength);
        std::copy(descr.begin(), descr.end(), data);
        return descr.size();
        END_CATCH_VMEXCEPTIONS
        return 0;
}

void HSVM_BlobClose (HSVM *vm, int blobhandle)
{
        START_CATCH_VMEXCEPTIONS
        DllInterfaceContext dll(VM.GetContextKeeper());
        OpenBlobInfo* blob = dll->blobs.Get(blobhandle);
        if (!blob)
            return;
        dll->blobs.Erase(blobhandle);
        END_CATCH_VMEXCEPTIONS
}

void HSVM_SetOutputCallback(struct HSVM *vm, void *opaque_ptr, HSVM_IOWriter outputfunction)
{
        START_CATCH_VMEXCEPTIONS
        DllInterfaceExternalOutputContext dlloutput(VM.GetContextKeeper());
        dlloutput->output_opaque_ptr = opaque_ptr;
        dlloutput->output_func = outputfunction ? outputfunction : StandardWriter;
        END_CATCH_VMEXCEPTIONS
}
void HSVM_SetErrorCallback(struct HSVM *vm, void *opaque_ptr, HSVM_IOWriter outputfunction)
{
        START_CATCH_VMEXCEPTIONS
        DllInterfaceExternalOutputContext dlloutput(VM.GetContextKeeper());
        dlloutput->error_opaque_ptr = opaque_ptr;
        dlloutput->error_func = outputfunction ? outputfunction : StandardWriter;
        END_CATCH_VMEXCEPTIONS
}
void HSVM_SetOutputBuffering(struct HSVM *vm, int do_buffer)
{
        START_CATCH_VMEXCEPTIONS
        DllInterfaceExternalOutputContext dlloutput(VM.GetContextKeeper());
        if(dlloutput->write_to_buffer && !do_buffer)
            dlloutput->FlushOutputBuffer();
        dlloutput->write_to_buffer = do_buffer;
        END_CATCH_VMEXCEPTIONS
}
void HSVM_FlushOutputBuffer(struct HSVM *vm)
{
        START_CATCH_VMEXCEPTIONS
        DllInterfaceExternalOutputContext dlloutput(VM.GetContextKeeper());
        if(dlloutput->write_to_buffer)
            dlloutput->FlushOutputBuffer();
        END_CATCH_VMEXCEPTIONS
}

int HSVM_RegisterIOObject(struct HSVM *vm, void *opaque_ptr, HSVM_IOReader inputfunction, HSVM_IOWriter outputfunction, HSVM_IOEndOfStream endofstreamfunction, HSVM_IOClose closefunction, const char *name)
{
        START_CATCH_VMEXCEPTIONS
        DllInterfaceContext dll(VM.GetContextKeeper());

        DllInterfaceOutputObjectPtr newobj(new DllInterfaceOutputObject(vm, opaque_ptr, inputfunction, outputfunction, endofstreamfunction, closefunction, name));
        dll->dlliface_objects[newobj->GetId()] = newobj;
        return newobj->GetId();
        END_CATCH_VMEXCEPTIONS
        return 0;
}

void HSVM_UnregisterIOObject(HSVM *vm, int objectid)
{
        START_CATCH_VMEXCEPTIONS
        DllInterfaceContext dll(VM.GetContextKeeper());
        dll->dlliface_objects.erase(objectid);
        END_CATCH_VMEXCEPTIONS
}

int HSVM_FunctionPtrExists(HSVM *vm, HSVM_VariableId fptr)
{
        START_CATCH_VMEXCEPTIONS
        return STACKMACHINE.RecordSize(fptr) != 0;
        END_CATCH_VMEXCEPTIONS
        return false;
}

void HSVM_OpenFunctionCall(HSVM *vm, unsigned param_count)
{
        START_CATCH_VMEXCEPTIONS
        STACKMACHINE.PushVariables(param_count + 1);
        STACKMACHINE.SetInteger(STACKMACHINE.StackPointer() - 1, param_count);
        END_CATCH_VMEXCEPTIONS
}

void HSVM_CloseFunctionCall(HSVM *vm)
{
        START_CATCH_VMEXCEPTIONS
        // Remove result value
        STACKMACHINE.PopVariablesN(VM.is_unwinding ? 0 : 1);
        END_CATCH_VMEXCEPTIONS
}

void HSVM_CancelFunctionCall(HSVM *vm)
{
        START_CATCH_VMEXCEPTIONS
        STACKMACHINE.PopVariablesN(STACKMACHINE.GetInteger(STACKMACHINE.StackPointer() - 1) + 1);
        END_CATCH_VMEXCEPTIONS
}

HSVM_VariableId HSVM_CallParam(HSVM *vm, unsigned x)
{
        START_CATCH_VMEXCEPTIONS
        return STACKMACHINE.StackPointer() - 2 - x;
        END_CATCH_VMEXCEPTIONS
        return 0;
}

HSVM_VariableId HSVM_CallFunction(struct HSVM *vm, const char *libraryuri, const char *function_name, HSVM_VariableType returntype, int numargs, HSVM_VariableType const *args)
{
        START_CATCH_VMEXCEPTIONS

        HSVM_VariableId temp = HSVM_AllocateVariable(vm);
        int result = HSVM_MakeFunctionPtr(vm, temp, libraryuri, function_name, returntype, numargs, args, 0);

        if(!result)
            return 0; //fatal error..
        else if (result < 0)
            throw HareScript::VMRuntimeError(HareScript::Error::UnknownFunction, function_name);

        HSVM_VariableId retval = HSVM_CallFunctionPtr(vm, temp, true);
        HSVM_DeallocateVariable(vm, temp);

        return retval;

        END_CATCH_VMEXCEPTIONS
        return 0;
}

HSVM_VariableId HSVM_CallFunctionPtrInternal(HSVM *vm, HSVM_VariableId fptr, int schedule, int allow_macro)
{
        START_CATCH_VMEXCEPTIONS

        if (!schedule)
            VM.SetupReturnStackframe();

        // Don't do anything if aborted or error thrown
        if (TestMustAbort(vm))
            return 0;

        StackMachine &stackm = STACKMACHINE;
        VarId rec = stackm.StackPointer() - 1;

        // Get param count, replace by values array
        unsigned param_count = stackm.GetInteger(rec);
        stackm.InitVariable(rec, VariableTypes::VariantArray);

        // Copy all pushed variables into values array
        for (unsigned i = 1; i <= param_count; ++i)
            stackm.MoveFrom(stackm.ArrayElementAppend(rec), rec - i);

        // Push copy of function pointer
        stackm.PushCopy(fptr);

        // Remove the original parameters from the stack
        if (param_count)
           stackm.PopDeepVariables(param_count, 2);

        // Call function pointer
        VirtualMachine *remote = VM.PrepareCallFunctionPtr(false, allow_macro);

        if (TestMustAbort(vm))
            return 0;

        if (schedule)
        {
                if (remote)
                    VM.PushSwitchToOtherVMFrame(remote);
                else
                    VM.PushDummyFrame(); // Must push a frame, to catch automatic popframe()
                return rec - param_count;
        }

        VM.Run(false, false); //unsafe to suspend

        if (TestMustAbort(vm))
            return 0;

        return stackm.StackPointer() - 1;
        END_CATCH_VMEXCEPTIONS
        return 0;
}

HSVM_VariableId HSVM_CallFunctionPtr(HSVM *vm, HSVM_VariableId fptr, int allow_macro)
{
        return HSVM_CallFunctionPtrInternal(vm, fptr, false, allow_macro);
}

HSVM_VariableId HSVM_ScheduleFunctionPtrCall(struct HSVM *vm, HSVM_VariableId fptr, int allow_macro)
{
        return HSVM_CallFunctionPtrInternal(vm, fptr, true, allow_macro);
}

HSVM_VariableId HSVM_CallObjectMethod(struct HSVM *vm, HSVM_VariableId object_id, HSVM_ColumnId name_id, int skip_access, int allow_macro)
{
        START_CATCH_VMEXCEPTIONS

        VM.SetupReturnStackframe();

        // Don't do anything if aborted or error thrown or when unwinding
        if (TestMustAbort(vm))
            return 0;

        VarId last = STACKMACHINE.StackPointer() - 1;
        unsigned param_count = STACKMACHINE.GetInteger(last);
        ++param_count;

        STACKMACHINE.CopyFrom(last, object_id);

        VM.PrepareObjMethodCall(name_id, param_count, skip_access, allow_macro);

        if (TestMustAbort(vm))
            return 0;

        VM.Run(false, false); //unsafe to suspend

        if (TestMustAbort(vm))
            return 0;

        return STACKMACHINE.StackPointer() - 1;
        END_CATCH_VMEXCEPTIONS
        return 0;
}

int HSVM_ScheduleLibraryLoad(struct HSVM *vm, HSVM_VariableId libraryuri, HSVM_VariableId errors)
{
        START_CATCH_VMEXCEPTIONS

        std::string toload = HSVM_StringGetSTD(vm, libraryuri);
        Library const *lib;
        try
        {
                VM.GetFileSystem().ResolveAbsoluteLibrary(VM.GetContextKeeper(), VM.GetExecuteLibrary(), &toload);

                if(toload.empty())
                {
                        return -1; //we don't accept selfloads in the DLL interface
                }

                lib = VM.GetLibraryLoader().GetWHLibrary(toload);
        }
        catch (HareScript::VMRuntimeError &e)
        {
                if (!errors)
                    throw; // Throw it into the exception-catcher of this function

                VM.GetErrorHandler().AddMessage(e);
                HSVM_GetMessageList(vm, errors);

                VM.GetErrorHandler().Reset();
                return -2;
        }

        if(!lib) //the library holding the function isn't in memory yet
        {
                bool fatal_load_error = true;
                try
                {
                        VM.GetLoadedLibrary(toload, &fatal_load_error);
                }
                catch (VMRuntimeError &e)
                {
                        if (fatal_load_error || !errors)
                            throw; // Throw it into the exception-catcher of this function

                        VM.GetErrorHandler().AddMessage(e);
                        HSVM_GetMessageList(vm, errors);

                        VM.GetErrorHandler().Reset();

                        return -2; //library has errors (but not fatal for this vm)
                }

                // Running of libs isn't suspendable FIXME: make loading a lib a separate instruction, and
                // let make functionptr only work on loaded libs
                VM.GetVMGroup()->GetJobManager()->GetDebugger().OnScriptNewLibrariesLoaded(*VM.GetVMGroup());

                VM.PushDummyFrame(); // Must push a frame, to catch automatic popframe()
        }
        return 1;
        END_CATCH_VMEXCEPTIONS
        return 0;
}

int HSVM_MakeFunctionPtrInternal(struct HSVM *vm, HSVM_VariableId id_set, std::string const &libraryuri, std::string const &function_name, bool withsignature, HSVM_VariableType returntype, int numargs, HSVM_VariableType const *args, HSVM_VariableId errors)
{
        START_CATCH_VMEXCEPTIONS

        StackMachine &stackm = STACKMACHINE;
        stackm.InitVariable(id_set, VariableTypes::FunctionRecord);

        std::string toload = libraryuri;
        Library const *lib;
        try
        {
                VM.GetFileSystem().ResolveAbsoluteLibrary(VM.GetContextKeeper(), VM.GetExecuteLibrary(), &toload);

                if(toload.empty())
                {
                        HSVM_SetDefault(vm, id_set, HSVM_VAR_String);
                        return -1; //we don't accept selfloads in the DLL interface
                }

                lib = VM.GetLibraryLoader().GetWHLibrary(toload);
        }
        catch (HareScript::VMRuntimeError &e)
        {
                if (!errors)
                    throw; // Throw it into the exception-catcher of this function

                VM.GetErrorHandler().AddMessage(e);
                HSVM_GetMessageList(vm, errors);

                VM.GetErrorHandler().Reset();
                return -2;
        }

        if(!lib) //the library holding the function isn't in memory yet
        {
                // Load the function itself first
                VM.SetupReturnStackframe();

                bool fatal_load_error = true;
                try
                {
                        lib = VM.GetLoadedLibrary(toload, &fatal_load_error);
                }
                catch (VMRuntimeError &e)
                {
                        if (fatal_load_error || !errors)
                            throw; // Throw it into the exception-catcher of this function

                        VM.GetErrorHandler().AddMessage(e);
                        HSVM_GetMessageList(vm, errors);

                        VM.GetErrorHandler().Reset();

                        // Pop the return stack frame
                        VM.CancelReturnStackframe();

                        return -2; //library has errors (but not fatal for this vm)
                }

                VM.Run(false, false); //make sure any necessary initialization is completed

                if (TestMustAbort(vm))
                    return 0;

                // Running of libs isn't suspendable FIXME: make loading a lib a separate instruction, and
                // let make functionptr only work on loaded libs
                VM.GetVMGroup()->GetJobManager()->GetDebugger().OnScriptNewLibrariesLoaded(*VM.GetVMGroup());
        }

        // Construct the function name (FIXME: Allow loading of exported external functions - can't do that now because of modulename mangling)
        static_assert(sizeof(args[0]) == sizeof(VariableTypes::Type), "For safe mangling encode, HSVM_VariableType must have the same width as VariableTypes::Type"); //needed for safe mangling invoke
        VariableTypes::Type rettype = returntype ? (VariableTypes::Type)returntype : VariableTypes::NoReturn;

        std::string funcname;
        if (withsignature)
            Mangling::MangleFunctionName(&funcname, function_name.c_str(), NULL, rettype, numargs, reinterpret_cast<VariableTypes::Type const*>(args));
        else
        {
                funcname = function_name + ":";
                Blex::ToUppercase(funcname.begin(), funcname.end());
        }

        // Lookup the function
        LinkedLibrary::ResolvedFunctionDef const *def = 0;
        for (LinkedLibrary::ResolvedFunctionDefList::const_iterator it = lib->GetLinkedLibrary().functiondefs.begin();
             !def && it != lib->GetLinkedLibrary().functiondefs.end();
             ++it)
        {
                //ADDME: Why are we consulting the linked function list? we should probably walk the exported function list?!
                if (!(it->def->symbolflags & SymbolFlags::Public))
                    continue; // this function wasn't public, so skip

                Blex::StringPair thisname = it->lib->GetLinkinfoName(it->def->name_index);

                if (withsignature)
                {
                        if (thisname==funcname)
                            def = &*it;
                }
                else
                {
//                        DEBUGPRINT("fck " << thisname.size() << " " << funcname.size() << thisname << " " << funcname);
                        if (thisname.size() >= funcname.size() && std::equal(funcname.begin(), funcname.end(), thisname.begin))
                            def = &*it;
                }
        }

        if (!def)
        {
                bool exactmatch = GetBestLibraryFunctionMatch(vm, id_set, lib->GetLinkedLibrary().functiondefs, funcname);
                return exactmatch ? -3 : -1; //signature fail vs not found
        }

        // If the function is found based on the name & rettype, we can directly build the function ptr
        bool is_vararg = def->def->flags & FunctionFlags::VarArg;

        stackm.SetInteger(stackm.RecordCellCreate(id_set, VM.columnnamemapper.GetMapping("LIBID")), def->lib->GetId());
        stackm.SetInteger(stackm.RecordCellCreate(id_set, VM.columnnamemapper.GetMapping("FUNCTIONID")), def->id);
        stackm.SetVMRef  (stackm.RecordCellCreate(id_set, VM.columnnamemapper.GetMapping("VM")), &VM);
        stackm.SetInteger(stackm.RecordCellCreate(id_set, VM.columnnamemapper.GetMapping("RETURNTYPE")), def->def->resulttype);
        stackm.SetInteger(stackm.RecordCellCreate(id_set, VM.columnnamemapper.GetMapping("EXCESSARGSTYPE")), is_vararg ? ToNonArray(def->def->parameters.back().type) : 0);
        stackm.SetInteger(stackm.RecordCellCreate(id_set, VM.columnnamemapper.GetMapping("FIRSTUNUSEDSOURCE")), def->def->parameters.size() + 1 - is_vararg);
        VarId parameters = stackm.RecordCellCreate(id_set, VM.columnnamemapper.GetMapping("PARAMETERS"));
        stackm.InitVariable(parameters, VariableTypes::RecordArray);

        ColumnNameId col_source = VM.columnnamemapper.GetMapping("SOURCE");
        ColumnNameId col_value = VM.columnnamemapper.GetMapping("VALUE");
        ColumnNameId col_type = VM.columnnamemapper.GetMapping("TYPE");

        WrappedLibrary const &wlib = def->lib->GetWrappedLibrary();
        Marshaller marshaller(&VM, MarshalMode::DataOnly);
        marshaller.SetLibraryColumnNameDecoder(&def->lib->GetLinkedLibrary().resolvedcolumnnames);

        for (unsigned idx = 0, end = def->def->parameters.size() - is_vararg; idx < end; ++idx)
        {
                FunctionDef::Parameter const &parameter = def->def->parameters[idx];
                VarId param = stackm.ArrayElementAppend(parameters);
                stackm.InitVariable(param, VariableTypes::Record);

                int32_t source;
                if (parameter.defaultid != -1)
                {
                        uint8_t const *buf = wlib.GetConstantBuffer(parameter.defaultid);
                        uint8_t const *limit = buf + wlib.GetConstantBufferLength(parameter.defaultid);
                        marshaller.Read(stackm.RecordCellCreate(param, col_value), buf, limit);
                        source = -idx - 1;
                }
                else
                    source = idx + 1;

                stackm.SetInteger(stackm.RecordCellCreate(param, col_type), parameter.type);
                stackm.SetInteger(stackm.RecordCellCreate(param, col_source), source);
        }

        return 1;
        END_CATCH_VMEXCEPTIONS
        return 0;
}

int HSVM_MakeFunctionPtr(struct HSVM *vm, HSVM_VariableId id_set, const char* libraryuri, const char* function_name, HSVM_VariableType returntype, int numargs, HSVM_VariableType const *args, HSVM_VariableId errors)
{
        return HSVM_MakeFunctionPtrInternal(vm, id_set, libraryuri, function_name, true, returntype, numargs, args, errors);
}

int HSVM_MakeFunctionPtrWithVars(struct HSVM *vm, HSVM_VariableId id_set, HSVM_VariableId libraryuri, HSVM_VariableId function_name, HSVM_VariableType returntype, int numargs, HSVM_VariableType const *args, HSVM_VariableId errors)
{
        std::string str_libraryuri = HSVM_StringGetSTD(vm, libraryuri);
        std::string str_function_name = HSVM_StringGetSTD(vm, function_name);

        return HSVM_MakeFunctionPtrInternal(vm, id_set, str_libraryuri, str_function_name, true, returntype, numargs, args, errors);
}

int HSVM_MakeFunctionPtrWithVarsAutodetect(struct HSVM *vm, HSVM_VariableId id_set, HSVM_VariableId libraryuri, HSVM_VariableId function_name, HSVM_VariableId errors)
{
        std::string str_libraryuri = HSVM_StringGetSTD(vm, libraryuri);
        std::string str_function_name = HSVM_StringGetSTD(vm, function_name);

        return HSVM_MakeFunctionPtrInternal(vm, id_set, str_libraryuri, str_function_name, false, 0, 0, 0, errors);
}


void HSVM_RebindFunctionPtr(struct HSVM *vm, HSVM_VariableId id_set, HSVM_VariableId functionptr, int argcount, HSVM_VariableType const *args, int const *passthroughs, HSVM_VariableId const *bound_params, unsigned first_rest_source, bool keep_vararg)
{
        START_CATCH_VMEXCEPTIONS

        StackMachine &stackm = STACKMACHINE;
//        ColumnNames::LocalMapper &columnnamemapper = VM.columnnamemapper;

        if (stackm.RecordSize(functionptr) == 0)
            throw VMRuntimeError(Error::RebindingDefaultPtr);

        ColumnNameCache const &cn_cache = VM.cn_cache;

/*        ColumnNameId col_functionid = columnnamemapper.GetMapping("FUNCTIONID");
        ColumnNameId col_libid = columnnamemapper.GetMapping("LIBID");
        ColumnNameId col_parameters = columnnamemapper.GetMapping("PARAMETERS");
        ColumnNameId col_source = columnnamemapper.GetMapping("SOURCE");
        ColumnNameId col_value = columnnamemapper.GetMapping("VALUE");
        ColumnNameId col_type = columnnamemapper.GetMapping("TYPE");
//        ColumnNameId col_rettype = columnnamemapper.GetMapping("RETURNTYPE");
        ColumnNameId col_excessargstype = columnnamemapper.GetMapping("EXCESSARGSTYPE");
        ColumnNameId col_firstunusedsource = columnnamemapper.GetMapping("FIRSTUNUSEDSOURCE");
        ColumnNameId col_vm = columnnamemapper.GetMapping("VM");
*/
        stackm.CopyFrom(id_set, functionptr);

        VarId var_excessargstype = stackm.RecordCellRefByName(id_set, cn_cache.col_excessargstype);

        VariableTypes::Type excessargstype = static_cast< VariableTypes::Type >(stackm.GetInteger(var_excessargstype));
        int32_t firstunusedsource = stackm.GetInteger(stackm.RecordCellGetByName(id_set, cn_cache.col_firstunusedsource));
        if (excessargstype == VariableTypes::Uninitialized)
            keep_vararg = false;

        // Get the function definition
        VirtualMachine *remote_vm = stackm.GetVMRef(stackm.RecordCellGetByName(functionptr, cn_cache.col_vm));

        LibraryId libid = remote_vm->GetStackMachine().GetInteger(remote_vm->GetStackMachine().RecordCellGetByName(id_set, cn_cache.col_libid));
        int32_t functionid = remote_vm->GetStackMachine().GetInteger(remote_vm->GetStackMachine().RecordCellGetByName(id_set, cn_cache.col_functionid));

        Library const *lib = remote_vm->GetLibraryLoader().GetWHLibraryById(libid);
        if (!lib)
            throw VMRuntimeError (Error::InternalError, "Function called in already unloaded library");

        // Check a little
        LinkedLibrary::ResolvedFunctionDefList const &deflist = lib->GetLinkedLibrary().functiondefs;
        if (functionid >= (signed)deflist.size())
            throw VMRuntimeError (Error::UnknownFunction, "#" + Blex::AnyToString(functionid), lib->GetLibURI());

        LinkedLibrary::ResolvedFunctionDefList::value_type const *def = &deflist[functionid];

        /* The rebinding algorithm. Too bloody difficult!

           The types of arguments to a function ptr MUST like following
             'required'* 'optional'* 'vararg'* (vararg is optional without a default value)

             Internally, the source-nrs for optional and vararg parameters must be increasing.

             If a functionptr is a vararg (EXCESSARGTYPE != 0), it has virtual parameters, which source starts at FIRSTUNUSEDSOURCE.
             A virtual parameter is of type 'vararg'.


             Rebinding is done as follows:
             - for a (virtual) parameter, check its source
               - = 0 (fixed): already done, skip
               - != 0
                   try to locate the source in the arguments list
                   - found
                     - source = 0: set newsource to 0, copy value
                     - source > 0: set dnewsource to new source, remove value if present
                     - source < 0
                         set newsource to new source
                         have default value?
                         - yes: set default value
                         - no: must be vararg to begin with
                   - not found
                     parameter type?
                     - 'required': error out, missing parameter
                     - 'optional': fix to default
                     - 'vararg':   done
                   check parameter type ordering & source ordering constraints

             new excessargtype: keep_vararg ? excessargtype : 0
             firstunusedsource: // use the set parameter, otherwise calculate from new source nrs. A call to non-vararg with firstunusedsource or more arguments is an error (too many arguments)
                 first_rest_source (is parameter) != 0
                 - yes: set to first_rest_source
                 - no:  set to max(new source) + 1

             too many parameters supplied: argcount >= firstunusedsource and org fptr was not vararg.
        */

        enum ParamType
        {
                Required,
                Optional,
                Vararg
        };

        VarId params = stackm.RecordCellRefByName(id_set, cn_cache.col_parameters);
        int32_t paramcount = stackm.ArraySize(params);

        // Administration to enforce 'required', 'optional', 'vararg' parameter ordering
        ParamType curtype = Required;
        int32_t last_optional_source = 0; // 1-based

        // Admin to calculate new firstunusedsource if first_rest_source isn't set
        int32_t first_unused_newsource = 1; // 1-based

        // Element type for vararg
        VariableTypes::Type varargtype = ToNonArray(excessargstype);

        //DEBUGPRINT("Rebind, params " << paramcount << " args " << argcount << " vatype " << varargtype << " firstunused " << firstunusedsource << " first_rest_source " << first_rest_source << " keep_vararg " << keep_vararg);

        for (int32_t i = 0;; ++i)
        {
                //DEBUGPRINT(" Handling parameter " << i << ", last_optional_source "<< last_optional_source);

                try
                {
                        VarId param;

                        if (i >= paramcount)
                        {
                                // Parameter beyond parameters in current fptr - virtual parameter of type 'vararg'
                                if (!excessargstype)
                                {
                                        //DEBUGPRINT("  fptr not vararg, stop");
                                        break;
                                }

                                // Is this source specified in arguments? (shortcut)
                                int32_t abs_source = i - paramcount + firstunusedsource - 1; // firstunusedsource is 1-based, abs-source 0-based
                                //DEBUGPRINT("  abs source " << abs_source);
                                if (abs_source >= argcount)
                                {
                                        //DEBUGPRINT("   source not specified, stop");
                                        break;
                                }

                                //DEBUGPRINT("   is virtual parameter, source " << -abs_source - 1);
                                // Instantiate the virtual parameter
                                param = stackm.ArrayElementAppend(params);
                                stackm.InitVariable(param, VariableTypes::Record);
                                stackm.SetInteger(stackm.RecordCellCreate(param, cn_cache.col_type), (int32_t)varargtype);
                                stackm.SetInteger(stackm.RecordCellCreate(param, cn_cache.col_source), -abs_source - 1);
                        }
                        else
                        {
                                //DEBUGPRINT("  is specified");
                                param = stackm.ArrayElementRef(params, i);
                        }

                        // Get the value to set
                        VarId var_source = stackm.RecordCellRefByName(param, cn_cache.col_source);
                        int32_t source = stackm.GetInteger(var_source);
                        if (source == 0)
                        {
                                //DEBUGPRINT("  is fixed, nothing to do");
                                // Already bound to fixed value, nothing to do
                                continue;
                        }

                        // Set the type we need to cast to
                        VariableTypes::Type type = VariableTypes::Variant;

                        // Get the current value
                        VarId var_curvalue = stackm.RecordCellRefByName(param, cn_cache.col_value);

                        // Calc the new param this param wants as source, update first_unused_source
                        int32_t abs_source = abs(source) - 1;
                        //DEBUGPRINT("  source " << source << " abs_source " << abs_source);

                        int32_t new_source = 0;
                        VarId var_newvalue = 0;
                        if (abs_source < argcount)
                        {
                                // Source new param is present, reuse it.
                                VarId var_type = stackm.RecordCellRefByName(param, cn_cache.col_type);
                                var_newvalue = bound_params ? bound_params[abs_source] : 0;

                                if (var_type)
                                    type = static_cast< VariableTypes::Type >(stackm.GetInteger(var_type));

                                //DEBUGPRINT("  fptr type " << type << " var_newvalue " << var_newvalue);

                                // Type override present?
                                if (args && args[abs_source])
                                {
                                        VariableTypes::Type argtype = static_cast< VariableTypes::Type >(args[abs_source]);
                                        //DEBUGPRINT("  type override to " << argtype);
                                        if (!CanAlwaysCastTo(argtype, type))
                                            throw VMRuntimeError (Error::CannotConvertType, HareScript::GetTypeName(argtype), HareScript::GetTypeName(type));

                                        type = argtype;
                                        stackm.SetInteger(var_type, type);
                                }

                                new_source = passthroughs ? passthroughs[abs_source] : abs_source + 1;
                                //DEBUGPRINT("  new source " << new_source << " at state " << curtype);
                        }
                        else
                        {
                                if (source > 0)
                                    throw VMRuntimeError (Error::ParameterCountWrong, VM.GenerateFunctionPTRSignature(id_set, def));
                                else if (var_curvalue)
                                    new_source = 0;
                                else
                                {
                                        // type 'vararg': done (rest of the parameters must also be of type 'vararg' with higher source nrs
                                        stackm.ArrayResize(params, i);
                                        break;
                                }
                        }

                        if (new_source >= 0)
                        {
                                if (curtype != Required)
                                    throw VMRuntimeError (Error::InternalError, "Required & fixed parameters not allowed after optional parameters (param #" + Blex::AnyToString(abs_source) + ")");
                                if (new_source != 0)
                                {
                                        var_newvalue = 0; // Ignore for fixed parameters
                                        stackm.RecordCellDelete(param, cn_cache.col_value);
                                }
                        }
                        else if (new_source < 0)
                        {
                                if (-new_source < last_optional_source)
                                    throw VMRuntimeError (Error::InternalError, "Optional parameters may not be reordered (param #" + Blex::AnyToString(abs_source) + ")");

                                if (var_newvalue)
                                {
                                        if (curtype == Vararg)
                                            throw VMRuntimeError (Error::InternalError, "Optional parameters may not be reordered (param #" + Blex::AnyToString(abs_source) + ")");
                                        curtype = Optional;
                                }
                                else
                                {
                                        if (source >= 0 || var_curvalue)
                                            throw VMRuntimeError (Error::InternalError, "Can't bind vararg param to non-vararg param (param #" + Blex::AnyToString(abs_source) + ")");

                                        curtype = Vararg;
                                }

                                last_optional_source = -new_source;
                        }

                        if (var_newvalue)
                        {
                                VarId var_value = stackm.RecordCellCreate(param, cn_cache.col_value);
                                stackm.CopyFrom(var_value, var_newvalue);
                                if (type != VariableTypes::Variant)
                                    stackm.CastTo(var_value, type);
                        }

                        int32_t abs_new_source = abs(new_source);
                        if (abs_new_source >= first_unused_newsource)
                            first_unused_newsource = abs_new_source + 1;

                        stackm.SetInteger(var_source, new_source);
                }
                catch (VMRuntimeError &)
                {
                        VM.AddRelevantFunctionError(VM.GenerateFunctionPTRSignature(functionptr, def));
                        throw;
                }
        }

        //DEBUGPRINT(" frs " << first_rest_source << " fus " << firstunusedsource << " funs " << first_unused_newsource << " argcount " << argcount);

        if (!first_rest_source)
            first_rest_source = first_unused_newsource;

        if (excessargstype == VariableTypes::Uninitialized && argcount >= firstunusedsource)
            throw VMRuntimeError(Error::ParameterCountWrong, VM.GenerateFunctionPTRSignature(id_set, def));

        stackm.SetInteger(stackm.RecordCellRefByName(id_set, cn_cache.col_firstunusedsource), first_rest_source);
        if (!keep_vararg)
            stackm.SetInteger(var_excessargstype, 0);

        END_CATCH_VMEXCEPTIONS
}

void HSVM_ThrowException(struct HSVM *vm, const char *text)
{
        if (HSVM_IsUnwinding(vm))
        {
                AddCustomError(vm, "Threw multiple exception within the same external function");
                return;
        }

        HSVM_OpenFunctionCall(vm, 1);
        HSVM_StringSet(vm, HSVM_CallParam(vm, 0), text, text + strlen(text));
        static const HSVM_VariableType funcargs[1] = { HSVM_VAR_String };
        HSVM_CallFunction(vm, "wh::system.whlib", "__HS_INTERNAL_THROWEXCEPTION", 0, 1, funcargs);
        HSVM_CloseFunctionCall(vm);
}

void HSVM_ThrowExceptionObject(struct HSVM *vm, HSVM_VariableId var_except, bool is_rethrow)
{
        if (HSVM_IsUnwinding(vm))
        {
                AddCustomError(vm, "Threw multiple exception within the same external function");
                return;
        }

        HSVM_OpenFunctionCall(vm, 2);
        HSVM_CopyFrom(vm, HSVM_CallParam(vm, 0), var_except);
        HSVM_BooleanSet(vm, HSVM_CallParam(vm, 1), is_rethrow);
        static const HSVM_VariableType funcargs[2] = { HSVM_VAR_Object, HSVM_VAR_Boolean };
        HSVM_CallFunction(vm, "wh::system.whlib", "__HS_THROWEXCEPTION", 0, 2, funcargs);
        HSVM_CloseFunctionCall(vm);
}

void HSVM_CopyFrom(HSVM *vm, HSVM_VariableId dest, HSVM_VariableId source)
{
        START_CATCH_VMEXCEPTIONS
        STACKMACHINE.CopyFrom(dest, source);
        END_CATCH_VMEXCEPTIONS
}

void HSVM_CopyFromOtherVM(struct HSVM *vm, HSVM_VariableId dest, struct HSVM *sourcevm, HSVM_VariableId source)
{
        START_CATCH_VMEXCEPTIONS

        VirtualMachine *_destvm = GetVirtualMachine(vm);
        VirtualMachine *_sourcevm = GetVirtualMachine(sourcevm);

        _destvm->GetStackMachine().CopyFromOtherVM(_destvm, dest, _sourcevm, source, _destvm->GetVMGroup() == _sourcevm->GetVMGroup());
        END_CATCH_VMEXCEPTIONS
}


/*
unsigned HSVM_MarshalCalculateLength(struct HSVM *vm, HSVM_VariableId var)
{
        unsigned size = 0;
        START_CATCH_VMEXCEPTIONS
        size = STACKMACHINE.MarshalCalculateLength(var);
        END_CATCH_VMEXCEPTIONS
        return size;
}

void HSVM_MarshalWrite(struct HSVM *vm, HSVM_VariableId var, uint8_t *ptr)
{
        START_CATCH_VMEXCEPTIONS
        STACKMACHINE.MarshalWrite(var, ptr);
        END_CATCH_VMEXCEPTIONS
}

void HSVM_MarshalRead(struct HSVM *vm, HSVM_VariableId var, uint8_t const *ptr)
{
        START_CATCH_VMEXCEPTIONS
        STACKMACHINE.MarshalRead(&VM, var, ptr);
        END_CATCH_VMEXCEPTIONS
} */


void HSVM_GetVMStatistics(HSVM *vm, HSVM_VariableId stats_var, HSVM *query_vm)
{
        START_CATCH_VMEXCEPTIONS

        VMStats stats;
        HareScript::GetVirtualMachine(query_vm)->GetVMStats(&stats);
        HareScript::GetVirtualMachine(vm)->EncodeVMStats(stats_var, stats);

        END_CATCH_VMEXCEPTIONS
}

void HSVM_CollectGarbage(struct HSVM *vm)
{
        START_CATCH_VMEXCEPTIONS
        STACKMACHINE.CollectObjects();
        END_CATCH_VMEXCEPTIONS
}

/*void HSVM_StartProfileTimer(struct HSVM *vm)
{
        VM.profile_timer.Start();
}

void HSVM_StopProfileTimer(struct HSVM *vm)
{
        VM.profile_timer.Stop();
        VM.GetProfileData().totaltime += VM.profile_timer.GetTotalTime();
}
*/
int HSVM_LoadScript(struct HSVM *vm, const char *scriptname)
{
        START_CATCH_VMEXCEPTIONS
        GetVirtualMachine(vm)->SetExecuteLibrary(scriptname);
        return 1;
        END_CATCH_VMEXCEPTIONS
        return 0;
}

int HSVM_LoadJobScript(struct HSVM *vm, const char *scriptname)
{
        START_CATCH_VMEXCEPTIONS
        GetVirtualMachine(vm)->SetExecuteLibrary(scriptname);
        return 1;
        END_CATCH_VMEXCEPTIONS
        return 0;
}

int  HSVM_ExecuteScript(struct HSVM *vm, int deinitialize_when_finished, int allow_suspension)
{
//        DEBUGPRINT("Executing script in VM " << vm);
        START_CATCH_VMEXCEPTIONS
        //HSVM_StartProfileTimer(vm);
        GetVirtualMachine(vm)->Run(allow_suspension != 0, deinitialize_when_finished);
        HSVM_FlushOutputBuffer(vm);
        //HSVM_StopProfileTimer(vm);

        if(GetVirtualMachine(vm)->is_suspended)
            return 2; //suspended indicator

        if (HSVM_IsUnwinding(vm))
            HSVM_AbortForUncaughtException(vm);

        GetVirtualMachine(vm)->HandleAbortFlagErrors();

        return GetVirtualMachine(vm)->GetErrorHandler().AnyErrors() ? 0 /* error */ : 1 /* success */;
        END_CATCH_VMEXCEPTIONS
        return 0; //ADDME: should we ever get here?
}

int HSVM_SuspendVM(struct HSVM *vm)
{
        START_CATCH_VMEXCEPTIONS
        if (GetVirtualMachine(vm)->IsSafeToSuspend())
        {
                GetVirtualMachine(vm)->Suspend();
                return 1;
        }
        END_CATCH_VMEXCEPTIONS
        return 0; //ADDME: should we ever get here?
}

/* FIXME: Redelijk zinloze functie, want je VM is toch dood, dus het lijkt in de praktijk toch
          geen zin hebben om errors te reflecteren naar dezelfde VM's varmemory */
int HSVM_GetMessageList(struct HSVM *vm, HSVM_VariableId errorstore)
{
        GetMessageList(vm, errorstore, GetVirtualMachine(vm)->GetErrorHandler(), false);
        return 0;
}

int32_t HSVM_CreateJob(struct HSVM *vm, const char *scriptname, HSVM_VariableId errorstore)
{
        START_CATCH_VMEXCEPTIONS
        if (errorstore != 0)
            STACKMACHINE.InitVariable(errorstore, VariableTypes::RecordArray);

        JobManager *jobmgr = GetVirtualMachine(vm)->GetVMGroup()->GetJobManager();
/*        if(jobmgr->GetNumRunningJobs()>10000)
        {
                HSVM_ReportCustomError(vm, "Too many running jobs");
                return 0;
        }
*/

        std::pair< VMGroup *, int32_t > data = jobmgr->CreateVMGroupInVM(vm);
        HSVM *newvm = data.first->CreateVirtualMachine();

        if (!HSVM_LoadJobScript(newvm, scriptname))
        {
                if (errorstore != 0)
                    GetMessageList(vm, errorstore, data.first->GetErrorHandler(), false);

                jobmgr->EraseJobById(vm, data.second);
                return -1;
        }

        // Copy the authentication info
        {
                VirtualMachine *old_vm = GetVirtualMachine(vm);
                VirtualMachine *new_vm = GetVirtualMachine(newvm);

                std::unique_ptr< MarshalPacket > copy;
                {
                        VirtualMachine::LockedProtectedData::ReadRef lock(old_vm->protected_data);
                        if (lock->authenticationrecord.get())
                            lock->authenticationrecord->TryClone(&copy);
                }
                {
                        VirtualMachine::LockedProtectedData::WriteRef lock(new_vm->protected_data);
                        lock->authenticationrecord.reset(copy.release());
                }
        }

        return data.second;
        END_CATCH_VMEXCEPTIONS
        return 0;
}

int HSVM_StartJob(struct HSVM *vm, int jobid)
{
        START_CATCH_VMEXCEPTIONS
        HSVM *jobvm = HSVM_GetVMFromJobId(vm, jobid);
        if (jobvm)
            throw VMRuntimeError(Error::InternalError, "No job with id #" + Blex::AnyToString(jobid) + " exists");

        VMGroup *group = GetVirtualMachine(jobvm)->GetVMGroup();
        group->GetJobManager()->StartVMGroup(group);
        return 1;
        END_CATCH_VMEXCEPTIONS
        return 0;
}

int HSVM_TryLockVM(struct HSVM *vm, void (*callback)(struct HSVM *, int, void *), void *context)
{
        START_CATCH_VMEXCEPTIONS
        VMGroup *group = GetVirtualMachine(vm)->GetVMGroup();
        if (callback)
            return group->GetJobManager()->TryLockVMGroup(group, std::bind(callback, vm, std::placeholders::_1, context)) ? 1 : 0;
        else
            return group->GetJobManager()->TryLockVMGroup(group, 0) ? 1 : 0;
        END_CATCH_VMEXCEPTIONS
        return 0;
}

void HSVM_UnlockVM(struct HSVM *vm)
{
        START_CATCH_VMEXCEPTIONS
        VMGroup *group = GetVirtualMachine(vm)->GetVMGroup();
        group->GetJobManager()->UnlockVMGroup(group);
        END_CATCH_VMEXCEPTIONS
}

void HSVM_AbortVM(struct HSVM *vm)
{
        START_CATCH_VMEXCEPTIONS
        VMGroup *group = GetVirtualMachine(vm)->GetVMGroup();
        group->GetJobManager()->AbortVMGroup(group);
        END_CATCH_VMEXCEPTIONS
}

void HSVM_ReleaseJob(struct HSVM *vm, int jobid)
{
        START_CATCH_VMEXCEPTIONS
        VMGroup *group = GetVirtualMachine(vm)->GetVMGroup();
        group->GetJobManager()->EraseJobById(vm, jobid);
        END_CATCH_VMEXCEPTIONS
}

HSVM * HSVM_GetVMFromJobId(struct HSVM *vm, int jobid)
{
        START_CATCH_VMEXCEPTIONS
        VMGroup *group = GetVirtualMachine(vm)->GetVMGroup();
        return group->GetJobManager()->GetJobFromId(vm, jobid);
        END_CATCH_VMEXCEPTIONS
        return NULL;
}

unsigned HSVM_GetVMGroupId(struct HSVM *vm, char *dest, unsigned room)
{
        START_CATCH_VMEXCEPTIONS
        VMGroup *group = GetVirtualMachine(vm)->GetVMGroup();
        std::string const &groupid = group->GetJobManager()->GetGroupId(group);
        if (room > groupid.size())
        {
                std::copy(groupid.begin(), groupid.end(), dest);
                dest[groupid.size()] = '\0';
        }
        return groupid.size();
        END_CATCH_VMEXCEPTIONS
        return 0;
}

void HSVM_GetAuthenticationRecord(struct HSVM *vm, HSVM_VariableId write_to)
{
        START_CATCH_VMEXCEPTIONS
        VirtualMachine *hsvm = GetVirtualMachine(vm);

        HSVM_SetDefault(vm, write_to, HSVM_VAR_Record);
        std::unique_ptr< MarshalPacket > copy;
        {
                VirtualMachine::LockedProtectedData::ReadRef lock(hsvm->protected_data);
                if (lock->authenticationrecord.get())
                    lock->authenticationrecord->TryClone(&copy);
        }

        if (copy.get())
        {
                hsvm->authrec_marshaller.ReadMarshalPacket(write_to, &copy);
        }
        else
            HSVM_SetDefault(vm, write_to, HSVM_VAR_Record);

        END_CATCH_VMEXCEPTIONS
}

void HSVM_SetAuthenticationRecord(struct HSVM *vm, HSVM_VariableId var)
{
        START_CATCH_VMEXCEPTIONS
        VirtualMachine *hsvm = GetVirtualMachine(vm);

        std::unique_ptr< MarshalPacket > copy(hsvm->authrec_marshaller.WriteToNewPacket(var));
        {
                VirtualMachine::LockedProtectedData::WriteRef lock(hsvm->protected_data);
                lock->authenticationrecord.reset(copy.release());
        }

        hsvm->GetVMGroup()->GetJobManager()->GetDebugger().OnScriptAuthenticationRecordChanged(*hsvm->GetVMGroup());

        END_CATCH_VMEXCEPTIONS
}

void HSVM_SetConsoleArguments(struct HSVM *vm, int numargs, const char *args[])
{
        START_CATCH_VMEXCEPTIONS

        Baselibs::SystemContext context(GetVirtualMachine(vm)->GetContextKeeper());

        if(numargs<0)
            numargs=0;

        context->os.console_args.resize(numargs);
        for(int i=0;i<numargs;++i)
                context->os.console_args[i] = args[i];

        END_CATCH_VMEXCEPTIONS
}

int HSVM_GetConsoleExitCode(struct HSVM *vm)
{
        START_CATCH_VMEXCEPTIONS

        Baselibs::SystemContext context(GetVirtualMachine(vm)->GetContextKeeper());
        return context->os.exitcode;

        END_CATCH_VMEXCEPTIONS
        return -1;
}

int HSVM_ClearCaches()
{
        try
        {
                Baselibs::TCPIPContext::ClearCache();
                DynamicLinkManager::ExecuteSoftResetCallbacks();
        }
        catch (std::exception &e)
        {
                return 1;
        }
        return 0;
}

int HSVM_HasSystemRedirect(HSVM *vm)
{
        START_CATCH_VMEXCEPTIONS
        return VM.HasSystemRedirect();
        END_CATCH_VMEXCEPTIONS
        return 0;
}

int HSVM_AllowStdStreamSharing(HSVM *vm)
{
        START_CATCH_VMEXCEPTIONS
        return VM.GetEnvironment().AllowStdStreamSharing();
        END_CATCH_VMEXCEPTIONS
        return 0;
}

} // End of "C" linkage

// Needs to be defined in root namespace
void BLEXLIB_PUBLIC HSVM_ScheduleCallback_cpp(struct HSVM *vm, std::function< void(bool) > const &callback)
{
        START_CATCH_VMEXCEPTIONS
        HareScript::GetVirtualMachine(vm)->PushTailcallFrame(callback);
        END_CATCH_VMEXCEPTIONS
}

void HSVM_GetStackTrace(struct HSVM *vm, std::string *lines)
{
        lines->clear();
        std::vector< HareScript::StackTraceElement > elements;
        HareScript::GetVirtualMachine(vm)->GetStackTrace(&elements, false, false);
        for (std::vector< HareScript::StackTraceElement >::const_iterator it = elements.begin(), end = elements.end(); it != end; ++it)
            *lines += it->filename + " at " + Blex::AnyToString(it->position.line) + ":" + Blex::AnyToString(it->position.column) + ": " + it->func + "\n";
}

namespace HareScript
{

void RegisterDllInterface(BuiltinFunctionsRegistrator &, Blex::ContextRegistrator &creg)
{
        DllInterfaceContext::Register(creg);
        DllInterfaceExternalOutputContext::Register(creg);
}

namespace Interface
{

InputStream::InputStream(HSVM *vm, HSVM_VariableId id)
: Stream(false)
, vm(vm)
, blobhandle(HSVM_BlobOpen(vm,id))
{
}
InputStream::~InputStream()
{
        HSVM_BlobClose(vm, blobhandle);
}
std::size_t InputStream::DirectRead(Blex::FileOffset startpos,void *buf,std::size_t maxbufsize)
{
        return HSVM_BlobDirectRead (vm, blobhandle, startpos, maxbufsize, buf);
}
std::size_t InputStream::DirectWrite(Blex::FileOffset ,const void *,std::size_t )
{
        throw std::runtime_error("HSVMInputStream is not writable");
}
bool InputStream::SetFileLength(Blex::FileOffset )
{
        throw std::runtime_error("HSVMInputStream is not writable");
}
Blex::FileOffset InputStream::GetFileLength()
{
        return HSVM_BlobOpenedLength (vm, blobhandle);
}

OutputStream::OutputStream(HSVM *vm, int32_t streamid)
: Stream(false)
, vm(vm)
, streamid(streamid)
{
}

OutputStream::~OutputStream()
{
}

std::size_t OutputStream::Read(void *,std::size_t )
{
        throw std::runtime_error("HSVMOutputStream is not readable");
}
bool OutputStream::EndOfStream()
{
        throw std::runtime_error("HSVMOutputStream is not readable");
}
std::size_t OutputStream::Write(void const *buf, std::size_t bufsize)
{
        return HSVM_PrintTo(vm, streamid, bufsize, buf) ? bufsize : 0;
}

Blex::RandomStream * GetRandomStreamOfTempFile(HSVM *vm, int streamid)
{
        DllInterfaceContext dll(VM.GetContextKeeper());
        DllInterfaceContextData::TempFiles::iterator tempfile = dll->tempfiles.find(streamid);
        if (tempfile == dll->tempfiles.end())
            throw VMRuntimeError(Error::IllegalBlobStream);

        return tempfile->second->file.get();
}

} // End of namespace Interface
} // End of namespace HareScript

void HSVM_InternalThrowObjectContextError()
{
        throw HareScript::VMRuntimeError(Error::InternalError, "Object parameter does not have the right type");
}
