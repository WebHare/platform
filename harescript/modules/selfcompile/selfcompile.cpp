//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>

#include <harescript/compiler/compilecontrol.h>
#include <harescript/compiler/engine.h>
#include <harescript/vm/hsvm_context.h>
#include <harescript/vm/hsvm_dllinterface.h>
//---------------------------------------------------------------------------

namespace HareScript
{
namespace Selfcompile
{

class Context
{
        public:
        Context();
        ~Context();

        void InitEngine(HSVM *hsvm);

        std::unique_ptr<HareScript::Compiler::Engine> engine;
        std::unique_ptr<HareScript::Compiler::CompileControl> compilecontrol;
};

const unsigned ContextId = 24343; //FIXME context id!


Context::Context()
{
}

Context::~Context()
{
}

void Context::InitEngine(HSVM *hsvm)
{
        HareScript::FileSystem &filesys=HareScript::GetVirtualMachine(hsvm)->GetFileSystem();
        engine.reset(new HareScript::Compiler::Engine(filesys, ""));
        compilecontrol.reset(new HareScript::Compiler::CompileControl(*engine, filesys));
}

void DoCompile(HSVM *hsvm, HSVM_VariableId id_set)
{
        std::string filename = HSVM_StringGetSTD(hsvm, HSVM_Arg(0));
        HareScript::FileSystem &filesys = HareScript::GetVirtualMachine(hsvm)->GetFileSystem();

        Context &context = *static_cast<Context*>(HSVM_GetContext(hsvm,ContextId,true));
        if(!context.engine.get())
            context.InitEngine(hsvm);

        Blex::ContextRegistrator creg;
        filesys.Register(creg);
        Blex::ContextKeeper keeper(creg);

        //force recompilation
        HareScript::FileSystem::FilePtr file = filesys.OpenLibrary(keeper, filename);
        if (file)
            file->RemoveClib();

        context.compilecontrol->CompileLibrary(keeper, filename);
        HareScript::GetVirtualMachine(hsvm)->GetEnvironment().EjectLibraryFromCache(filename);
        HareScript::GetMessageList(hsvm, id_set, context.engine->GetErrorHandler(), false);
}

int MyWriteData(void *opaque_ptr, int numbytes, void const *data, int /*allow_partial*/, int *errorcode)
{
        std::string *output = static_cast<std::string *>(opaque_ptr);
        output->insert(output->end(), static_cast<char const*>(data), static_cast<char const*>(data) + numbytes);
        *errorcode = 0;
        return numbytes;
}

void DoRun(HSVM *hsvm, HSVM_VariableId id_set)
{
        std::string filename = HSVM_StringGetSTD(hsvm, HSVM_Arg(0));
        std::vector<std::string> args;
        std::string output;

        args.resize(HSVM_ArrayLength(hsvm, HSVM_Arg(1)));
        for(unsigned i=0;i<args.size();++i)
            args[i] = HSVM_StringGetSTD(hsvm, HSVM_ArrayGetRef(hsvm, id_set, i));

        Environment &env = HareScript::GetVirtualMachine(hsvm)->GetEnvironment();

        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_Record);
        HSVM_VariableId errors = HSVM_RecordCreate(hsvm, id_set, HSVM_GetColumnId(hsvm, "ERRORS"));
        HSVM_SetDefault(hsvm, errors, HSVM_VAR_RecordArray);

        std::unique_ptr<HareScript::VMGroup> cif;
        cif.reset (env.ConstructVMGroup(true));
        HSVM *vm = cif->CreateVirtualMachine();
        HSVM_SetOutputCallback(vm, &output, MyWriteData);
        HSVM_SetOutputBuffering(vm, 1);
        cif->SetupConsole(vm, args);

        if (!HSVM_LoadScript(vm, filename.c_str()) || !HSVM_ExecuteScript(vm, /*deinit*/1,/*Suspend*/0))
            HareScript::GetMessageList(hsvm, errors, cif->GetErrorHandler(), false);

        HSVM_VariableId output_id = HSVM_RecordCreate(hsvm, id_set, HSVM_GetColumnId(hsvm, "OUTPUT"));
        HSVM_StringSetSTD(hsvm, output_id, output);
}

} // End of namespace Selfcompile
} // End of namespace HareScript

//---------------------------------------------------------------------------

extern "C" {

static void* CreateContext(void *)
{
        return new HareScript::Selfcompile::Context;
}
static void DestroyContext(void*, void *context_ptr)
{
        delete static_cast<HareScript::Selfcompile::Context*>(context_ptr);
}

BLEXLIB_PUBLIC int HSVM_ModuleEntryPoint(HSVM_RegData *regdata,void*)
{
        //HSVM_RegisterFunction(regdata, "PARSEWTEDATAFILE:WH_XML:I:X", HareScript::Wte::ParseWTEDataFile);
        HSVM_RegisterFunction(regdata, "DOCOMPILE:WH_SELFCOMPILE:RA:S", HareScript::Selfcompile::DoCompile);
        HSVM_RegisterFunction(regdata, "DORUN:WH_SELFCOMPILE:R:SSA", HareScript::Selfcompile::DoRun);
        HSVM_RegisterContext (regdata, HareScript::Selfcompile::ContextId, NULL, &CreateContext, &DestroyContext);
        return 1;
}

} //end extern "C"

/* Example command lines:

*/
