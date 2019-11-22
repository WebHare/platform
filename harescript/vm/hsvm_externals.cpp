#include <harescript/vm/allincludes.h>


#include "baselibs.h"
#include "hsvm_dllinterface.h"
#include <blex/path.h>
#include "hsvm_externals.h"
#include "hsvm_sqllib.h"
#include "hsvm_recorddbprovider.h"
#include "hsvm_loopbackdbprovider.h"

namespace HareScript
{

// -----------------------------------------------------------------------------
//              DL Manager
// -----------------------------------------------------------------------------

DynamicLinkManager::LockedManagerList DynamicLinkManager::managerlist;

DynamicLinkManager::DynamicLinkManager(FileSystem &_filesystem, Externals &_externals)
: filesystem(_filesystem)
, externals(_externals)
{
        LockedManagerList::WriteRef(managerlist)->managers.insert(this);
}

DynamicLinkManager::~DynamicLinkManager()
{
        LockedManagerList::WriteRef(managerlist)->managers.erase(this);

        LockedState::WriteRef lock(state);
        if(!lock->no_hsmod_unload)
          for (DataMap::iterator it = lock->data.begin(); it != lock->data.end(); ++it)
            Blex::ReleaseDynamicLib(it->second);
}

void* DynamicLinkManager::DynamicContext_Construct(void *dynreg_ptr)
{
        DynamicRegistration *dynreg = static_cast<DynamicRegistration*>(dynreg_ptr);
        return dynreg->constructor(dynreg->opaque_ptr);
}
void DynamicLinkManager::DynamicContext_Destruct(void *dynreg_ptr, void *context_ptr)
{
        DynamicRegistration *dynreg = static_cast<DynamicRegistration*>(dynreg_ptr);
        return dynreg->destructor(dynreg->opaque_ptr, context_ptr);
}

bool DynamicLinkManager::GetRegistrationInfo(unsigned context_id, DynamicRegistration *receiver) const
{
        LockedState::ReadRef lock(state);
        for (std::list<DynamicRegistration>::const_iterator itr = dynamic_regs.begin(); itr!=dynamic_regs.end();++itr)
          if (itr->context_id==context_id)
          {
                *receiver=*itr;
                return true;
          }
        return false;
}

void DynamicLinkManager::RegModuleContext(unsigned int context_id,
                               void *opaque_ptr,
                               HSVM_ConstructorPtr constructor,
                               HSVM_DestructorPtr destructor)
{
        //The lock _should_ be taken here already... (ADDME: streamline registration
        //procedure to atomically register functions & contexts, store new stuff
        //in a registration structure first instead of immediately adding, as
        //current situation complicates 'stable' rollback) )

        DynamicRegistration newreg;
        newreg.context_id = context_id;
        newreg.constructor = constructor;
        newreg.destructor = destructor;
        newreg.opaque_ptr = opaque_ptr;

        dynamic_regs.push_back(newreg);
        externals.creg.RegisterContext(context_id,DynamicContext_Construct,DynamicContext_Destruct,&dynamic_regs.back());
}

void DynamicLinkManager::RegSoftResetCallback(HSVM_SoftResetCallback callback)
{
        //The lock _should_ be taken here already... (ADDME: streamline registration
        //procedure to atomically register functions & contexts, store new stuff
        //in a registration structure first instead of immediately adding, as
        //current situation complicates 'stable' rollback) )

        softresetcallbacks.push_back(callback);
}

void DynamicLinkManager::RegGarbageCollectionCallback(HSVM_GarbageCollectionCallback callback)
{
        //The lock _should_ be taken here already... (ADDME: streamline registration
        //procedure to atomically register functions & contexts, store new stuff
        //in a registration structure first instead of immediately adding, as
        //current situation complicates 'stable' rollback) )

        garbagecollectioncallbacks.push_back(callback);
}

void DynamicLinkManager::ExecuteSoftResetCallbacks()
{
        LockedManagerList::ReadRef lock(managerlist);
        for (std::set< DynamicLinkManager * >::const_iterator mit = lock->managers.begin(); mit != lock->managers.end(); ++mit)
        {
                LockedState::ReadRef cblock((*mit)->state);
                for (std::vector< HSVM_SoftResetCallback >::const_iterator it = (*mit)->softresetcallbacks.begin(); it != (*mit)->softresetcallbacks.end(); ++it)
                    (*it)();
        }
}

void DynamicLinkManager::ExecuteGarbageCollectionCallbacks(HSVM *hsvm)
{
        std::vector< HSVM_GarbageCollectionCallback > callbacks;

        // gather callbacks
        {
                LockedManagerList::ReadRef lock(managerlist);
                for (auto &itr: lock->managers)
                    callbacks.insert(callbacks.end(), itr->garbagecollectioncallbacks.begin(), itr->garbagecollectioncallbacks.end());
        }

        for (auto callback: callbacks)
            callback(hsvm);
}

std::pair<void*,Error::Codes> DynamicLinkManager::LoadHarescriptModule(std::string const &name, std::string *error)
{
        LockedState::WriteRef lock(state);
        DataMap::iterator itr = lock->data.find(name);
        if (itr != lock->data.end())
            return std::make_pair(itr->second, (Error::Codes)0);

        std::string path = filesystem.GetDynamicModuleFullPath(name);
        if (!Blex::PathStatus(path).Exists())
            return std::make_pair((void*)0, Error::CantFindModule);

        void *lib = Blex::LoadDynamicLib(path, error);
        if (!lib) //dependent DLL load failure ?
            return std::make_pair((void*)0, Error::ModuleLoadFailed);

        HSVM_ModuleEntryPointPtr registerfunc;
        registerfunc = (HSVM_ModuleEntryPointPtr)Blex::FindDynamicFunction(lib, "HSVM_ModuleEntryPoint"); //Unix and BCC entry point

        if (!registerfunc)
        {
                Blex::ReleaseDynamicLib(lib);
                return std::make_pair((void*)0, Error::NoModuleRegistration);
        }
        if (!InvokeModuleRegistration(registerfunc, NULL)) //FIXME: Shouldn't call registration under lock, so that we can perhaps permit the module to load more modules
        {
                Blex::ReleaseDynamicLib(lib);
                return std::make_pair((void*)0, Error::ModuleInitFailed);
        }

        //succesful load, so register this library
        lock->data.insert(std::make_pair(name,lib));
        return std::make_pair(lib, (Error::Codes)0);
}

bool DynamicLinkManager::InvokeModuleRegistration(HSVM_ModuleEntryPointPtr entrypoint, void *context_ptr)
{
        if (!entrypoint((HSVM_RegData*)this, context_ptr)) //ADDME: DON'T give them direct registration access, but temporarily store all their new registrations in a structure, and commit them all at once
            return false;

        return true;
}

void DynamicLinkManager::AddReferences(std::vector<std::string> const &requested_links)
{
        for (std::vector<std::string>::const_iterator it = requested_links.begin(); it != requested_links.end(); ++it)
        {
                std::string error;
                std::pair<void*,Error::Codes> retval = LoadHarescriptModule(*it, &error);
                if (!retval.first) //load failure
                    throw VMRuntimeError(retval.second, *it, error);
        }
}

void DynamicLinkManager::NoHSModUnload()
{
        LockedState::WriteRef (state)->no_hsmod_unload=true;
}

// -----------------------------------------------------------------------------
//              BuiltinFunctionsRegistrator
// -----------------------------------------------------------------------------

BuiltinFunctionsRegistrator::BuiltinFunctionsRegistrator()
{
        //ADDME: We might want to separate this code from the function registrator,
        //       but then we should first create a better Facade around the
        //       environment and the vm, and move the code there

        // ADDME? DEBUGONLY(lockeddata.SetupDebugging("BuiltinFunctionsRegistrator lock"));
        //System::InitSystem(*this);
}

BuiltinFunctionsRegistrator::~BuiltinFunctionsRegistrator()
{
}

void BuiltinFunctionsRegistrator::RegisterBuiltinFunction(const BuiltinFunctionDefinition &definition)
{
        std::string name(definition.name);
        Blex::ToUppercase(name.begin(), name.end());

        LockedData::WriteRef ref(lockeddata);
        ref->insert(std::make_pair(name, definition));
}

BuiltinFunctionDefinition const * BuiltinFunctionsRegistrator::GetBuiltinFunction(std::string const &name) const
{
        LockedData::ReadRef ref(lockeddata);

        //ADDME: MapVectors supporting direct StringPair compare might be faster?
        BuiltinFunctions::const_iterator it = ref->find(name);
        if (it == ref->end())
            throw VMRuntimeError (Error::BuiltinSymbolNotFound, name, std::string());

        return &it->second;
}

// -----------------------------------------------------------------------------
//              Environment
// -----------------------------------------------------------------------------
void RegisterDllInterface(BuiltinFunctionsRegistrator &bifreg, Blex::ContextRegistrator &creg);

Externals::Externals(FileSystem &filesystem)
: linkmanager(filesystem, *this)
{
        filesystem.Register(creg);
        linkmanager.InvokeModuleRegistration(&BaselibsEntryPoint, (void*)0);


        //ADDME: We might want to separate this code from the function registrator,
        //       but then we should first create a better Facade around the
        //       environment and the vm, and move the code there
        RegisterDeprecatedBaseLibs(bifreg,creg);
        RegisterDllInterface(bifreg,creg);
        SQLSupport::Register(bifreg, creg);
        SQLLib::RecordDB::Register(bifreg, creg);
        SQLLib::LoopbackDB::Register(bifreg, creg);
}

Externals::~Externals()
{
}

} //end namespace HareScript
