#include <harescript/vm/allincludes.h>

#include <emscripten.h>
#include <emscripten/val.h>
#include <emscripten/bind.h>

#include <iostream>

#include <blex/utils.h>
#include <blex/path.h>
#include <blex/getopt.h>
#include <harescript/compiler/diskfilesystem.h>
#include <harescript/vm/hsvm_context.h>
#include <harescript/vm/hsvm_debugsupport.h>

namespace HareScript
{
void GetVMStackTrace(VirtualMachine *vm, HSVM_VariableId var_stacktrace, VirtualMachine *testvm, bool full);
void GetVMLibraries(VirtualMachine *vm, HSVM_VariableId var_resultlibs, VirtualMachine *testvm);
namespace Baselibs
{
void EncodeFunctionProfileData(ProfileData const &profiledata, VirtualMachine *vm, VarId id_set);
void EncodeHandleList(VirtualMachine *source_vm, VirtualMachine *vm, VarId id_set);
}
}
#include <ap/libwebhare/wh_filesystem.h>
#include <harescript/vm/wasm-tools.h>
#include <harescript/vm/baselibs.h>
#include <harescript/vm/outputobject.h>
#include <harescript/vm/hsvm_environment.h>
#include <harescript/vm/wasm-harescript.h>

using namespace WebHare::WASM;

EM_JS(char*, supportGetTempDir, (), {
  return stringToNewUTF8(Module.getTempDir());
});

EM_JS(char*, supportGetWHResourceDir, (), {
  return stringToNewUTF8(Module.getWHResourceDir());
});

EM_JS(char*, supportGetDataRoot, (), {
  return stringToNewUTF8(Module.getDataRoot());
});

EM_JS(char*, supportGetInstallationRoot, (), {
  return stringToNewUTF8(Module.getInstallationRoot());
});

EM_JS(char*, supportGetCompileCache, (), {
  return stringToNewUTF8(Module.getCompileCache());
});

class WASMEventListener : public Blex::NotificationEventReceiver
{
    public:
        WASMEventListener(Blex::NotificationEventManager &eventmgr);
        ~WASMEventListener();

        EventCallback callback;

        void ReceiveNotificationEvent(std::string const &event, uint8_t const *hsvmdata, unsigned hsvmdatalen, Blex::NotificationEventSource source);
};

WASMEventListener::WASMEventListener(Blex::NotificationEventManager &eventmgr)
: NotificationEventReceiver(eventmgr)
, callback(nullptr)
{
        Register();
}

WASMEventListener::~WASMEventListener()
{
}

void WASMEventListener::ReceiveNotificationEvent(std::string const &event, uint8_t const *hsvmdata, unsigned hsvmdatalen, Blex::NotificationEventSource source)
{
        if (source != Blex::NotificationEventSource::External && callback)
            callback(event.c_str(), hsvmdata, hsvmdatalen, source == Blex::NotificationEventSource::LocalProcessOnly);
}

class Context
{
    public:
        WHFileSystem filesystem;
        Blex::ContextRegistrator creg;
        Blex::NotificationEventManager eventmgr;
        HareScript::GlobalBlobManager blobmgr;
        HareScript::Environment environment;
        WASMEventListener eventlistener;

        Context(std::string const &tmpdir, std::string const &whresdir, std::string const &dataroot, std::string const &compilecache);
};

Context::Context(std::string const &tmpdir, std::string const &whresdir, std::string const &installationroot, std::string const &compilecache)
: filesystem(tmpdir, whresdir, installationroot, compilecache, false)
, creg()
, eventmgr()
, blobmgr("/tmp/emscripten/tmpdir/")
, environment(eventmgr, filesystem, blobmgr)
, eventlistener(eventmgr)
{
        filesystem.Register(creg);
}

std::unique_ptr< Context > storedcontext;

Context & EnsureContext()
{
        if (!storedcontext.get())
        {
                std::string tempdir = ConvertCharPtrAndDelete(supportGetTempDir());
                std::string whresdir = ConvertCharPtrAndDelete(supportGetWHResourceDir());
                std::string dataroot = ConvertCharPtrAndDelete(supportGetDataRoot());
                std::string installationroot = ConvertCharPtrAndDelete(supportGetInstallationRoot());
                std::string compilecache = ConvertCharPtrAndDelete(supportGetCompileCache());

                storedcontext.reset(new Context(tempdir, whresdir, installationroot, compilecache));
        }
        return *storedcontext;
}

/** WebHare input/output object */
class BLEXLIB_PUBLIC EMWrappedOutputObject: public HareScript::OutputObject
{
    private:
        Blex::StatefulEvent event_read;
        Blex::StatefulEvent event_write;

        emscripten::val obj;
    public:
        EMWrappedOutputObject(HSVM *vm, const char *type, emscripten::val &&_obj);
        ~EMWrappedOutputObject();
        std::pair< Blex::SocketError::Errors, unsigned > Read(unsigned numbytes, void *data);
        std::pair< Blex::SocketError::Errors, unsigned > Write(unsigned numbytes, const void *data, bool allow_partial);
        bool IsAtEOF();
        bool AddToWaiterRead(Blex::PipeWaiter &/*waiter*/);
        SignalledStatus IsReadSignalled(Blex::PipeWaiter * /*waiter*/);
        bool AddToWaiterWrite(Blex::PipeWaiter &/*waiter*/);
        SignalledStatus IsWriteSignalled(Blex::PipeWaiter * /*waiter*/);
        void SetReadSignalled(bool readsignalled);
        void SetWriteSignalled(bool writesignalled);
};

EMWrappedOutputObject::EMWrappedOutputObject(HSVM *vm, const char *type, emscripten::val &&_obj)
: HareScript::OutputObject(vm, type)
, obj(_obj)
{
        event_read.SetSignalled(true);
        event_write.SetSignalled(true);
}

EMWrappedOutputObject::~EMWrappedOutputObject()
{
        obj.call<void>("_closed");
}

std::pair< Blex::SocketError::Errors, unsigned > EMWrappedOutputObject::Read(unsigned numbytes, void *data)
{
        auto res = obj.call<emscripten::val>("_read", numbytes, (long)data);
        if (!res["signalled"].isUndefined())
            event_read.SetSignalled(res["signalled"].as<bool>());
        auto error = res["error"].isUndefined() ? Blex::SocketError::NoError : static_cast<Blex::SocketError::Errors>(res["error"].as<int32_t>());
        return std::make_pair(error, res["bytes"].as<unsigned>());
}

std::pair< Blex::SocketError::Errors, unsigned > EMWrappedOutputObject::Write(unsigned numbytes, const void *data, bool allow_partial)
{
        auto res = obj.call<emscripten::val>("_write", numbytes, (long)data, allow_partial);
        if (!res["signalled"].isUndefined())
            event_write.SetSignalled(res["signalled"].as<bool>());
        auto error = res["error"].isUndefined() ? Blex::SocketError::NoError : static_cast<Blex::SocketError::Errors>(res["error"].as<int32_t>());
        return std::make_pair(error, res["bytes"].as<unsigned>());
}

bool EMWrappedOutputObject::IsAtEOF()
{
        return obj.call<emscripten::val>("isAtEOF").as<bool>();
}

bool EMWrappedOutputObject::AddToWaiterRead(Blex::PipeWaiter &waiter)
{
        if (event_read.IsSignalled())
            return true;
        waiter.AddEvent(event_read);
        return false;
}

HareScript::OutputObject::SignalledStatus EMWrappedOutputObject::IsReadSignalled(Blex::PipeWaiter *)
{
        obj.call<emscripten::val>("syncUpdateReadSignalled");
        return event_read.IsSignalled() ? Signalled : NotSignalled;
}

bool EMWrappedOutputObject::AddToWaiterWrite(Blex::PipeWaiter &waiter)
{
        if (event_write.IsSignalled())
            return true;
        waiter.AddEvent(event_write);
        return false;
}

HareScript::OutputObject::SignalledStatus EMWrappedOutputObject::IsWriteSignalled(Blex::PipeWaiter *)
{
        obj.call<emscripten::val>("syncUpdateWriteSignalled");
        return event_write.IsSignalled() ? Signalled : NotSignalled;
}

void EMWrappedOutputObject::SetReadSignalled(bool readsignalled)
{
        event_read.SetSignalled(readsignalled);
}

void EMWrappedOutputObject::SetWriteSignalled(bool writesignalled)
{
        event_write.SetSignalled(writesignalled);
}

namespace {

emscripten::val StoreMessageForWASM(HareScript::Message const &msg, bool is_trace, bool is_error) {
        emscripten::val message = emscripten::val::object();
        message.set("iserror", is_error && !is_trace);
        message.set("iswarning", !is_error && !is_trace);
        message.set("istrace", is_trace);
        message.set("filename", msg.filename);
        message.set("line", msg.position.line);
        message.set("col", msg.position.column);
        message.set("code", msg.code);
        message.set("param1", msg.msg1);
        message.set("param2", msg.msg2);
        message.set("func", msg.func);
        if (msg.code < 0) {
                message.set("message", "");
        } else {
                message.set("message", GetMessageString(msg));
        }
        return message;
}

void StoreMessagesForWASM(emscripten::val &messages, HareScript::ErrorHandler::MessageList const &msgs, bool is_error) {
        for (auto &msg: msgs) {
                messages.call<emscripten::val>("push", StoreMessageForWASM(msg, false, is_error));
        }
}

emscripten::val BuildMessageList(HSVM *vm, bool with_trace) {
        auto &errhandler = HareScript::GetVirtualMachine(vm)->GetErrorHandler();

        emscripten::val messages = emscripten::val::array();
        StoreMessagesForWASM(messages, errhandler.GetWarnings(), false);
        StoreMessagesForWASM(messages, errhandler.GetErrors(), true);
        if (with_trace)
        {
                int tracecount = -1;
                for (HareScript::ErrorHandler::StackTrace::const_iterator itr = errhandler.GetStackTrace().begin();
                     itr != errhandler.GetStackTrace().end();
                     ++itr)
                {
                        HareScript::Message tracemsg(true, tracecount, itr->func);
                        tracemsg.func = itr->func;
                        tracemsg.filename = itr->filename;
                        tracemsg.position = itr->position;

                        messages.call<emscripten::val>("push", StoreMessageForWASM(tracemsg, true, false));
                        --tracecount;
                }
        }
        return messages;
}

}

extern "C"
{

HSVM* EMSCRIPTEN_KEEPALIVE CreateHSVM()
{
        Context &context = EnsureContext();

        HareScript::VMGroup * group = context.environment.ConstructVMGroup(false);
        //HSVM_SetErrorCallback(myvm, 0, &StandardErrorWriter);
        //cif->SetupConsole(myvm, args);
        return group->CreateVirtualMachine();
}

void EMSCRIPTEN_KEEPALIVE ReleaseHSVMResources(HSVM *vm)
{
        HareScript::GetVirtualMachine(vm)->GetVMGroup()->CloseHandles();
}

void EMSCRIPTEN_KEEPALIVE ReleaseHSVM(HSVM *byebye) //assumes the VM was created by CreateHSVM, it won't be safe to delete random VMs..
{
        delete HareScript::GetVirtualMachine(byebye)->GetVMGroup();
}

void EMSCRIPTEN_KEEPALIVE RegisterHareScriptMacro(const char *name, unsigned id, bool async)
{
        HareScript::BuiltinFunctionDefinition reg(name, async ? HareScript::BuiltinFunctionDefinition::JSAsyncMacro : HareScript::BuiltinFunctionDefinition::JSMacro, id);
        Context &context = EnsureContext();
        context.environment.GetBifReg().RegisterBuiltinFunction(reg);
}

void EMSCRIPTEN_KEEPALIVE RegisterHareScriptFunction(const char *name, unsigned id, bool async)
{
        HareScript::BuiltinFunctionDefinition reg(name, async ? HareScript::BuiltinFunctionDefinition::JSAsyncFunction : HareScript::BuiltinFunctionDefinition::JSFunction, id);
        Context &context = EnsureContext();
        context.environment.GetBifReg().RegisterBuiltinFunction(reg);
}

int EMSCRIPTEN_KEEPALIVE CreateWASMOutputObject(HSVM *vm, emscripten::EM_VAL obj_handle, const char *type)
{
        HareScript::Baselibs::SystemContext context(HareScript::GetVirtualMachine(vm)->GetContextKeeper());
        std::shared_ptr<HareScript::OutputObject> outputobject(new EMWrappedOutputObject(vm, type, emscripten::val::take_ownership(obj_handle)));
        context->other_outputobjects[outputobject->GetId()] = outputobject;
        return outputobject->GetId();
}

void EMSCRIPTEN_KEEPALIVE SetWASMOutputObjectReadSignalled(HSVM *vm, int id, bool readsignalled)
{
        HareScript::Baselibs::SystemContext context(HareScript::GetVirtualMachine(vm)->GetContextKeeper());
        auto obj = dynamic_cast<EMWrappedOutputObject *>(HareScript::GetVirtualMachine(vm)->GetOutputObject(id, false));
        if (obj)
            obj->SetReadSignalled(readsignalled);
}

void EMSCRIPTEN_KEEPALIVE SetWASMOutputObjectWriteSignalled(HSVM *vm, int id, bool writesignalled)
{
        HareScript::Baselibs::SystemContext context(HareScript::GetVirtualMachine(vm)->GetContextKeeper());
        auto obj = dynamic_cast<EMWrappedOutputObject *>(HareScript::GetVirtualMachine(vm)->GetOutputObject(id, false));
        if (obj)
            obj->SetWriteSignalled(writesignalled);
}

void EMSCRIPTEN_KEEPALIVE CloseWASMOutputObject(HSVM *vm, int id)
{
        HareScript::Baselibs::SystemContext context(HareScript::GetVirtualMachine(vm)->GetContextKeeper());
        auto obj = dynamic_cast<EMWrappedOutputObject *>(HareScript::GetVirtualMachine(vm)->GetOutputObject(id, false));
        if (obj)
            context->other_outputobjects.erase(id);
}

void EMSCRIPTEN_KEEPALIVE SetEventCallback(EventCallback callback)
{
        Context &context = EnsureContext();
        context.eventlistener.callback = callback;
}

void EMSCRIPTEN_KEEPALIVE InjectEvent(HSVM *, const char *name, uint8_t const *payloadstart, int32_t payloadlen)
{
        Context &context = EnsureContext();
        auto event = std::make_shared<Blex::NotificationEvent>(name, payloadstart, payloadlen);
        context.eventmgr.QueueEventNoExport(event, Blex::NotificationEventSource::External);
}

bool EMSCRIPTEN_KEEPALIVE HasEnvironmentOverride(HSVM *hsvm) {
        return HareScript::LockedLocalGroupData::ReadRef(HareScript::GetVirtualMachine(hsvm)->GetVMGroup()->localdata)->environment.get();
        }

void EMSCRIPTEN_KEEPALIVE GetEnvironment(HSVM *hsvm, HSVM_VariableId id_set) {
        Blex::Environment env;
        auto override = HareScript::LockedLocalGroupData::ReadRef(HareScript::GetVirtualMachine(hsvm)->GetVMGroup()->localdata)->environment;

        Blex::Environment const *useenv;
        if (override)
            useenv = override.get();
        else
        {
                useenv = &env;
                Blex::ParseEnvironment(&env);
        }

        HSVM_ColumnId col_name =   HSVM_GetColumnId(hsvm, "NAME");
        HSVM_ColumnId col_value =  HSVM_GetColumnId(hsvm, "VALUE");

        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_RecordArray);
        for (auto itr : *useenv)
        {
                HSVM_VariableId newrec = HSVM_ArrayAppend(hsvm, id_set);

                HSVM_StringSetSTD(hsvm, HSVM_RecordCreate(hsvm, newrec, col_name), itr.first);
                HSVM_StringSetSTD(hsvm, HSVM_RecordCreate(hsvm, newrec, col_value), itr.second);
        }
}

void EMSCRIPTEN_KEEPALIVE SetEnvironment(HSVM *hsvm, HSVM_VariableId data)
{
        HSVM_ColumnId col_name =   HSVM_GetColumnId(hsvm, "NAME");
        HSVM_ColumnId col_value =  HSVM_GetColumnId(hsvm, "VALUE");

        auto override = std::make_shared< Blex::Environment >();
        unsigned numvars = HSVM_ArrayLength(hsvm, data);
        for (unsigned i = 0; i < numvars; ++i)
        {
                HSVM_VariableId rec = HSVM_ArrayGetRef(hsvm, data, i);

                HSVM_VariableId var_name = HSVM_RecordGetRequiredTypedRef(hsvm, rec, col_name, HSVM_VAR_String);
                HSVM_VariableId var_value = HSVM_RecordGetRequiredTypedRef(hsvm, rec, col_value, HSVM_VAR_String);
                if (!var_name || !var_value)
                    return;

                (*override)[HSVM_StringGetSTD(hsvm, var_name)] = HSVM_StringGetSTD(hsvm, var_value);
        }

        HareScript::LockedLocalGroupData::WriteRef(HareScript::GetVirtualMachine(hsvm)->GetVMGroup()->localdata)->environment = override;
}

emscripten::EM_VAL EMSCRIPTEN_KEEPALIVE GetLoadedLibrariesInfo(HSVM *hsvm, bool onlydirectloaded)
{
        auto retval = emscripten::val::object();
        auto errors = emscripten::val::array();
        auto libraries = emscripten::val::array();

        retval.set("errors", errors);
        retval.set("libraries", libraries);

        std::vector< HareScript::LibraryInfo > info;
        try {
                if (onlydirectloaded)
                    HareScript::GetVirtualMachine(hsvm)->GetLoadedLibrariesInfo(&info);
                else
                    HareScript::GetVirtualMachine(hsvm)->GetAllLibrariesInfo(&info);
        } catch (HareScript::VMRuntimeError &e) {
                HareScript::GetVirtualMachine(hsvm)->GetErrorHandler().AddMessage(e);
                retval.set("errors", BuildMessageList(hsvm, false));
                HareScript::GetVirtualMachine(hsvm)->GetErrorHandler().Reset();
        }

        emscripten::val Date = emscripten::val::global("Date");
        for (auto &itr: info) {
                emscripten::val libinfo = emscripten::val::object();
                libinfo.set("uri", itr.uri);
                libinfo.set("outofdate", itr.outofdate);
                libinfo.set("compile_id", Date.new_(static_cast<double>(itr.compile_id.GetDays() - 719163) * 86400000 + itr.compile_id.GetMsecs()));
                libraries.call<void>("push", libinfo);
        }
        return retval.release_ownership();
}

static std::string lasthash;

bool EMSCRIPTEN_KEEPALIVE GetAdhocCacheKeyData(HSVM *hsvm, const char **library, uint64_t *modtime, HSVM_VariableId cachetag, const char **store_hash)
{
        const char cachelib[] = "wh::adhoccache.whlib";

        int daysvalue, msecsvalue;
        const char *cache_librarystr = HSVM_GetCallingLibrary(hsvm, 0, false);
        const char *calling_librarystr = HSVM_GetCallingLibraryWithCompileTime(hsvm, 1, false, &daysvalue, &msecsvalue);

        if (!cache_librarystr || !calling_librarystr || Blex::StrCompare(cache_librarystr, cache_librarystr + strlen(cache_librarystr), cachelib, cachelib + sizeof(cachelib) - 1) != 0)
            return false;

        if (modtime)
            *modtime = static_cast< uint64_t >(daysvalue) * 86400000 + msecsvalue;
        if (library)
            *library = calling_librarystr;

        Blex::DateTime bmodtime(daysvalue, msecsvalue);
        lasthash = HareScript::GetVirtualMachine(hsvm)->GetStackMachine().CalculateHash(cachetag, &bmodtime);
        if (store_hash)
           *store_hash = lasthash.c_str();

        return true;
}

const void * EMSCRIPTEN_KEEPALIVE WriteMarshalPacket(HSVM *vm, HSVM_VariableId var, bool allow_disk_paths, emscripten::EM_VAL stats_handle) {
        auto hsvm = HareScript::GetVirtualMachine(vm);

        std::unique_ptr<HareScript::MarshalPacket> packet(hsvm->cache_marshaller.WriteToNewPacket(var));
        HareScript::MarshalPacket::PacketSizeData stats;
        const void *ptr = packet->WriteToNewBuffer(&hsvm->GetBlobManager(), allow_disk_paths, &stats).first;

        auto statsvar = emscripten::val::take_ownership(stats_handle);

        statsvar.set("totalsize", stats.totalsize);
        statsvar.set("datasize", stats.datasize);
        statsvar.set("blobsectionsize", stats.blobsectionsize);
        statsvar.set("blobsize", stats.blobsize);
        statsvar.set("diskblobsize", stats.diskblobsize);
        statsvar.set("diskblobcount", stats.diskblobcount);
        statsvar.set("objects", stats.objects);
        statsvar.set("with_diskpaths", stats.with_diskpaths);
        return ptr;
}

void EMSCRIPTEN_KEEPALIVE ReadMarshalPacket(HSVM *vm, HSVM_VariableId var, uint8_t *start, uint8_t *end) {
        auto hsvm = HareScript::GetVirtualMachine(vm);
        std::unique_ptr<HareScript::MarshalPacket> packet(new HareScript::MarshalPacket);
        packet->Read(start, end, &hsvm->GetBlobManager());

        hsvm->cache_marshaller.ReadMarshalPacket(var, &packet);
}


bool EMSCRIPTEN_KEEPALIVE GetEventCollectorSignalled(HSVM *hsvm, int32_t eventcollector)
{
        HareScript::OutputObject *collector = eventcollector != 0 ? HareScript::GetVirtualMachine(hsvm)->GetOutputObject(eventcollector, false) : nullptr;

        return collector && collector->IsReadSignalled(nullptr) != HareScript::OutputObject::NotSignalled;
}

const char * EMSCRIPTEN_KEEPALIVE GetVMStackTrace(HSVM *hsvm)
{
        std::string trace;
        HSVM_GetStackTrace(hsvm, &trace);
        char *buf = static_cast< char * >(malloc(trace.size() + 1));
        memcpy(buf, trace.c_str(), trace.size() + 1); // include null terminator
        return buf;
}

emscripten::EM_VAL EMSCRIPTEN_KEEPALIVE GetMessageList(HSVM *vm, bool with_trace) {
        return BuildMessageList(vm, with_trace).release_ownership();
}

void EMSCRIPTEN_KEEPALIVE DebugGetStatus(HSVM *hsvm, HSVM_VariableId id_set)
{
        HareScript::VirtualMachine *vm = HareScript::GetVirtualMachine(hsvm);
        HareScript::VMGroup *group = vm->GetVMGroup();
        HareScript::ColumnNameCache const &cn_cache = vm->cn_cache;

        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_Record);
        // Set every cell right after creating it, creating a cell may invalidate the ids of earlier cells
        HSVM_IntegerSet(hsvm, HSVM_RecordCreate(hsvm, id_set, cn_cache.col_stacksize), group->GetCallStackSize());
        HareScript::GetVMStackTrace(vm, HSVM_RecordCreate(hsvm, id_set, cn_cache.col_stacktrace), group->GetCurrentVM() ? group->GetCurrentVM() : vm, true);
        HSVM_GetVMStatistics(hsvm, HSVM_RecordCreate(hsvm, id_set, cn_cache.col_statistics), hsvm);
}

void EMSCRIPTEN_KEEPALIVE DebugGetVariables(HSVM *hsvm, HSVM_VariableId requests, HSVM_VariableId id_set)
{
        HareScript::VirtualMachine *vm = HareScript::GetVirtualMachine(hsvm);
        HareScript::ColumnNameCache const &cn_cache = vm->cn_cache;
        HareScript::StackMachine &stackm = vm->GetStackMachine();

        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_RecordArray);
        uint32_t len = HSVM_ArrayLength(hsvm, requests);
        for (unsigned i = 0; i < len; ++i)
        {
                HSVM_VariableId var_req = stackm.ArrayElementGet(requests, i);
                uint32_t id = HSVM_IntegerGet(hsvm, stackm.RecordCellTypedGetByName(var_req, cn_cache.col_id, HareScript::VariableTypes::Integer, true));
                HSVM_VariableId var_result = HSVM_ArrayAppend(hsvm, id_set);
                HareScript::VarId toget = HareScript::GetDebugVariable(vm, id);
                if (!toget)
                {
                        HSVM_SetDefault(hsvm, var_result, HSVM_VAR_Record);
                        HSVM_IntegerSet(hsvm, HSVM_RecordCreate(hsvm, var_result, cn_cache.col_type), -1);
                        HSVM_IntegerSet(hsvm, HSVM_RecordCreate(hsvm, var_result, cn_cache.col_id), id);
                        continue;
                }
                HareScript::RetrieveDebugValue(vm, var_result, vm, toget, var_req, 1);
        }
}

void EMSCRIPTEN_KEEPALIVE DebugGetLibraries(HSVM *hsvm, HSVM_VariableId id_set)
{
        HareScript::VirtualMachine *vm = HareScript::GetVirtualMachine(hsvm);
        HareScript::GetVMLibraries(vm, id_set, vm);
}

void EMSCRIPTEN_KEEPALIVE DebugGetDebugInfo(HSVM *hsvm, const char *liburi, HSVM_VariableId id_set)
{
        HareScript::VirtualMachine *vm = HareScript::GetVirtualMachine(hsvm);
        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_Record);
        HareScript::EncodeLibraryDebugInfo(vm, id_set, vm, liburi);
}

void EMSCRIPTEN_KEEPALIVE DebugGetHandleList(HSVM *hsvm, HSVM_VariableId id_set)
{
        HareScript::VirtualMachine *vm = HareScript::GetVirtualMachine(hsvm);
        HareScript::Baselibs::EncodeHandleList(vm, vm, id_set);
}

void EMSCRIPTEN_KEEPALIVE DebugSetFunctionProfiling(HSVM *hsvm, bool enable, bool reset)
{
        HareScript::VirtualMachine *vm = HareScript::GetVirtualMachine(hsvm);
        if (!enable)
            vm->DisableFunctionProfiling();
        if (reset)
            vm->ResetFunctionProfile();
        if (enable)
            vm->EnableFunctionProfiling();
}

void EMSCRIPTEN_KEEPALIVE DebugGetFunctionProfile(HSVM *hsvm, HSVM_VariableId id_set)
{
        HareScript::VirtualMachine *vm = HareScript::GetVirtualMachine(hsvm);
        HareScript::Baselibs::EncodeFunctionProfileData(vm->GetProfileData(), vm, id_set);
}

void EMSCRIPTEN_KEEPALIVE DebugSetBreakpoints(HSVM *hsvm, HSVM_VariableId config)
{
        HareScript::VirtualMachine *vm = HareScript::GetVirtualMachine(hsvm);
        HareScript::ColumnNameCache const &cn_cache = vm->cn_cache;
        HareScript::StackMachine &stackm = vm->GetStackMachine();
        HareScript::VMGroup *group = vm->GetVMGroup();

        unsigned min_stack = stackm.GetInteger(stackm.RecordCellTypedGetByName(config, HSVM_GetColumnId(hsvm, "MINSTACKSIZE"), HareScript::VariableTypes::Integer, true));
        unsigned max_stack = stackm.GetInteger(stackm.RecordCellTypedGetByName(config, HSVM_GetColumnId(hsvm, "MAXSTACKSIZE"), HareScript::VariableTypes::Integer, true));
        bool break_on_exception = stackm.GetBoolean(stackm.RecordCellTypedGetByName(config, HSVM_GetColumnId(hsvm, "BREAKONEXCEPTION"), HareScript::VariableTypes::Boolean, true));

        std::vector< HareScript::DebugBreakpointSpec > breakpoints;
        HSVM_VariableId var_breakpoints = stackm.RecordCellTypedGetByName(config, HSVM_GetColumnId(hsvm, "BREAKPOINTS"), HareScript::VariableTypes::RecordArray, true);
        uint32_t len = HSVM_ArrayLength(hsvm, var_breakpoints);
        for (unsigned i = 0; i < len; ++i)
        {
                HSVM_VariableId var_bp = stackm.ArrayElementGet(var_breakpoints, i);
                HareScript::DebugBreakpointSpec bp;
                bp.liburi = HSVM_StringGetSTD(hsvm, stackm.RecordCellTypedGetByName(var_bp, cn_cache.col_liburi, HareScript::VariableTypes::String, true));
                bp.compile_id = stackm.GetDateTime(stackm.RecordCellTypedGetByName(var_bp, cn_cache.col_compile_id, HareScript::VariableTypes::DateTime, true));
                bp.codeptr = HSVM_IntegerGet(hsvm, stackm.RecordCellTypedGetByName(var_bp, cn_cache.col_codeptr, HareScript::VariableTypes::Integer, true));
                bp.stacksize = HSVM_IntegerGet(hsvm, stackm.RecordCellTypedGetByName(var_bp, cn_cache.col_stacksize, HareScript::VariableTypes::Integer, true));
                bp.manual = HSVM_BooleanGet(hsvm, stackm.RecordCellTypedGetByName(var_bp, cn_cache.col_manual, HareScript::VariableTypes::Boolean, true));
                breakpoints.push_back(bp);
        }

        HareScript::VMGroupDebuggerData &dbg = group->GetDebuggerData();
        bool was_debugging = dbg.IsDebugging();
        HareScript::ApplyDebugBreakpoints(*group, group->GetCurrentVM() ? group->GetCurrentVM() : vm, breakpoints, min_stack, max_stack, break_on_exception);
        if (was_debugging != dbg.IsDebugging())
            group->RequestDebugModeSwitch();
}

void EMSCRIPTEN_KEEPALIVE DebugSetAttached(HSVM *hsvm, bool attached)
{
        HareScript::VMGroup *group = HareScript::GetVirtualMachine(hsvm)->GetVMGroup();
        HareScript::VMGroupDebuggerData &dbg = group->GetDebuggerData();
        bool was_debugging = dbg.IsDebugging();
        dbg.attached = attached;
        dbg.poll_countdown = 1;
        if (!attached)
        {
                dbg.breakpoints.clear();
                dbg.min_stack = 0;
                dbg.max_stack = -1;
                dbg.break_on_exception = false;
        }
        if (was_debugging != dbg.IsDebugging())
            group->RequestDebugModeSwitch();
}


} // extern "C"
