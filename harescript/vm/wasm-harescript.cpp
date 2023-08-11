#include <harescript/vm/allincludes.h>

#include <emscripten.h>


#include <iostream>

#include <blex/utils.h>
#include <blex/path.h>
#include <blex/getopt.h>
#include <harescript/compiler/diskfilesystem.h>
#include <harescript/vm/hsvm_context.h>
#include <harescript/vm/hsvm_dllinterface.h>
#include <ap/libwebhare/wh_filesystem.h>
#include <harescript/vm/wasm-tools.h>

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
        Blex::ContextKeeper keeper;
        Blex::NotificationEventManager eventmgr;
        HareScript::GlobalBlobManager blobmgr;
        HareScript::Environment environment;

        Context(std::string const &tmpdir, std::string const &whresdir, std::string const &dataroot, std::string const &compilecache);
};

Context::Context(std::string const &tmpdir, std::string const &whresdir, std::string const &installationroot, std::string const &compilecache)
: filesystem(tmpdir, whresdir, installationroot, compilecache, CompilationPriority::ClassInteractive, false)
, creg()
, keeper(creg)
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

} // extern "C"
