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

class Context
{
    public:
        WHFileSystem filesystem;
        Blex::ContextRegistrator creg;
        Blex::NotificationEventManager eventmgr;
        HareScript::GlobalBlobManager blobmgr;
        HareScript::Environment environment;

        Context(std::string const &tmpdir, std::string const &whresdir, std::string const &dataroot, std::string const &compilecache);
};

Context::Context(std::string const &tmpdir, std::string const &whresdir, std::string const &installationroot, std::string const &compilecache)
: filesystem(tmpdir, whresdir, installationroot, compilecache, CompilationPriority::ClassInteractive, false)
, creg()
, eventmgr()
, blobmgr("/tmp/emscripten/tmpdir/")
, environment(eventmgr, filesystem, blobmgr, true)
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

typedef void (*EventCallback)(const char *name, const void *payload, unsigned payloadlength);

void HandleEvent(EventCallback callback, std::shared_ptr< Blex::NotificationEvent > const &event)
{
        unsigned char *payload = event->payload.size() ? &event->payload[0] : nullptr;
        callback(event->name.c_str(), payload, event->payload.size());
}

void EMSCRIPTEN_KEEPALIVE SetEventCallback(HSVM *, EventCallback callback)
{
        Context &context = EnsureContext();
        context.eventmgr.SetExportCallback(std::bind(&HandleEvent, callback, std::placeholders::_1));
}

void EMSCRIPTEN_KEEPALIVE InjectEvent(HSVM *, const char *name, uint8_t const *payloadstart, int32_t payloadlen)
{
        Context &context = EnsureContext();
        auto event = std::make_shared<Blex::NotificationEvent>(name, payloadstart, payloadlen);
        context.eventmgr.QueueEventNoExport(event);
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


} // extern "C"
