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
        return HareScript::GetVirtualMachine(hsvm)->GetVMGroup()->jmdata.environment.get();
}

void EMSCRIPTEN_KEEPALIVE GetEnvironment(HSVM *hsvm, HSVM_VariableId id_set) {
        Blex::Environment env;
        std::shared_ptr< const Blex::Environment > override = HareScript::GetVirtualMachine(hsvm)->GetVMGroup()->jmdata.environment;

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

        HareScript::GetVirtualMachine(hsvm)->GetVMGroup()->jmdata.environment = override;
}

void EMSCRIPTEN_KEEPALIVE GetLoadedLibrariesInfo(HSVM *hsvm, HSVM_VariableId id_set, bool onlydirectloaded)
{
        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_Record);
        HSVM_VariableId var_errors = HSVM_RecordCreate(hsvm, id_set, HSVM_GetColumnId(hsvm, "ERRORS"));
        HSVM_SetDefault(hsvm, var_errors, HSVM_VAR_RecordArray);

        HSVM_VariableId var_libraries = HSVM_RecordCreate(hsvm, id_set, HSVM_GetColumnId(hsvm, "LIBRARIES"));
        HSVM_SetDefault(hsvm, var_libraries, HSVM_VAR_RecordArray);

        std::vector< HareScript::LibraryInfo > info;
        try
        {
                if (onlydirectloaded)
                    HareScript::GetVirtualMachine(hsvm)->GetLoadedLibrariesInfo(&info);
                else
                    HareScript::GetVirtualMachine(hsvm)->GetAllLibrariesInfo(&info);
        }
        catch (HareScript::VMRuntimeError &e)
        {
                HareScript::GetVirtualMachine(hsvm)->GetErrorHandler().AddMessage(e);
                HSVM_GetMessageList(hsvm, var_errors, 0);

                HareScript::GetVirtualMachine(hsvm)->GetErrorHandler().Reset();
        }

        for (std::vector< HareScript::LibraryInfo >::iterator it = info.begin(); it != info.end(); ++it)
        {
                HSVM_VariableId var_elt = HSVM_ArrayAppend(hsvm, var_libraries);

                HSVM_StringSetSTD(hsvm, HSVM_RecordCreate(hsvm, var_elt, HSVM_GetColumnId(hsvm, "LIBURI")),  it->uri);
                HSVM_BooleanSet(hsvm, HSVM_RecordCreate(hsvm, var_elt, HSVM_GetColumnId(hsvm, "OUTOFDATE")), it->outofdate);
                HSVM_DateTimeSet(hsvm, HSVM_RecordCreate(hsvm, var_elt, HSVM_GetColumnId(hsvm, "COMPILE_ID")), it->compile_id.GetDays(), it->compile_id.GetMsecs());
        }
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

} // extern "C"
