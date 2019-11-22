//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>


#include "baselibs.h"
#include "hsvm_environment.h"
#include "hsvm_context.h"
#include "hsvm_events.h"

/* We want the following from a proper Librarian:
   - Reference counted libraries - any library we hold a reference to, cannot
     be discarded from memory, and all const members must be safe to use
     (this allows us to safely run and continue running code from a library in
      use by one or more VMs)
   - Member functions that take care of all necessary locking themselves
   - Libraries that are out-of-date must be automatically recompiled
   - Two threads hitting an out-of-date or non-existing library shouldn't both
     try to recompile/load the out-of-date library.
   - The publishing processes recompiling shouldn't interfere with webserver
     recompiling
*/

//#define PRINT_LINKINFO
//#define PRINT_LINKREFERENCEINFO

#ifdef PRINT_LINKINFO
 #define LINKPRINT(x) DEBUGPRINT(x)
#else
 #define LINKPRINT(x) (void)0
#endif

#ifdef PRINT_LINKREFERENCEINFO
 #define LINKREFPRINT(x) DEBUGPRINT(x)
#else
 #define LINKREFPRINT(x) (void)0
#endif

namespace HareScript
{

static const Blex::DateTime CacheDelay = Blex::DateTime::Seconds(1);

// -----------------------------------------------------------------------------
//
// Id generator
//

IdGenerator::IdGenerator()
{
        // First given out id is 1
        LockedData::WriteRef(data)->free_from = 1;
}

unsigned IdGenerator::AllocateId()
{
        LockedData::WriteRef lock(data);

        // Allocate lowest hole first if present, keep ids low
        if (!lock->holes.empty())
        {
                unsigned retval = *lock->holes.begin();
                lock->holes.erase(lock->holes.begin());

                return retval;
        }

        // No holes, allocate a new id by increasing free_from
        return lock->free_from++;
}

void IdGenerator::FreeId(unsigned id)
{
        // Guard against freeing 0
        if (!id)
            return;

        LockedData::WriteRef lock(data);

        if (id != lock->free_from - 1)
        {
                // It is a new hole
                lock->holes.insert(id);
        }
        else
        {
                // We can lower free_from to mark id as free
                --lock->free_from;

                // See if we can now consolidate other holes
                while (lock->free_from != 1)
                {
                        std::set< unsigned >::iterator it = lock->holes.find(lock->free_from - 1);
                        if (it == lock->holes.end())
                            break;

                        lock->holes.erase(it);
                        --lock->free_from;
                }
        }
}

// -----------------------------------------------------------------------------
//
// LinkedLibrary
//

LinkedLibrary::ObjectVTableEntry const * LinkedLibrary::LinkedObjectDef::GetEntry(ColumnNameId name) const
{
        signed cur_begin = 0, cur_end = entries.size();

        while (cur_begin != cur_end)
        {
                unsigned middle = ((cur_begin + cur_end) >> 1);
                ObjectVTableEntry const *pos = entries.begin() + middle;
                if (name < pos->nameid)
                    cur_end = middle;
                else if (name > pos->nameid)
                    cur_begin = middle + 1;
                else
                    return pos;
        }
        return 0;
}

LinkedLibrary::ObjectVTableEntry const * LinkedLibrary::LinkedObjectDef::GetEntryByNr(int32_t id) const
{
        return entries.begin() + id;
}


LibraryFile::~LibraryFile()
{
}

Environment::Environment(Blex::NotificationEventManager &_eventmgr, FileSystem &_filesystem, GlobalBlobManager &_blobmanager, bool allow_std_sharing)
: eventmgr(_eventmgr)
, filesystem(_filesystem)
, blobmanager(_blobmanager)
, externals(_filesystem)
, allow_std_sharing(allow_std_sharing)
{
        InvokeModuleRegistration(&DocgenEntryPoint, (void*)0);
        //ADDME? DEBUGONLY(cache.SetupDebugging("Environment lock"));
}

Environment::~Environment()
{
        LockedCache::WriteRef cachelock(cache);

        //std::vector<std::string> names;

        for (LibraryPtrs::reverse_iterator itr=cachelock->libs.rbegin(); itr != cachelock->libs.rend(); ++itr)
          if (*itr)
        {
                //names.push_back((*itr)->liburi);
                LockedReleaseRef(*itr);
        }
}

void* Environment::LoadHarescriptModule(std::string const &name)
{
        std::pair<void*,Error::Codes> retval = externals.linkmanager.LoadHarescriptModule(name, NULL);
        return retval.first;
}

VMGroup* Environment::ConstructVMGroup(bool highpriority)
{
        return new VMGroup(*this, externals.creg, highpriority);
}

void Environment::EjectLibraryFromCache(std::string const &liburi) //used by the compiler
{
        LockedCache::WriteRef cachelock(cache);

        Library *lib=cachelock->FindLibrary(liburi);
        if(lib)
        {
                cachelock->RemoveFromCache(lib);
                LockedReleaseRef(lib);
        }
}

void Environment::RegisterVMCreationHandler(std::function< void(HSVM *) > const &func)
{
        if (func)
            creation_handlers.push_back(func);
}

/** GetUptodateRef: returns a up to date (or unloaded) library.

    Adds the library to cache if not found. If someone else is loading it, it waits until the
    one loading is has finished. A not loaded library will have a refcount of 2 when returned; one for the caller, one for the cache.

    @param keeper Contextkeeper with current context
    @param liburi Library name
    @param isloadlib Whether this library must be treated as a loadlibbed one
    @return
        first Pointer to library
        second Wether library is loaded (and up to date) */
std::pair<Library *, bool> Environment::GetUptodateRef(Blex::ContextKeeper &keeper, std::string const &liburi, Blex::DateTime curtime)
{
        while (true) //is 'ie in de cache?
        {
                LockedCache::WriteRef cachelock(cache);

                // Locate the library in the cache
                Library *lib=cachelock->FindLibrary(liburi);

                if (lib && lib->cm_isloaded)
                {
                        //Is it up to date? (in-memory version matches on-disk version)
                        if (lib->IsUpTodate(filesystem, keeper, curtime, nullptr))
                        {
                                ++lib->cm_refcount;
                                LINKREFPRINT("refcount " << lib->liburi << " incremented to " << lib->cm_refcount);
                                return std::make_pair(lib,true);
                        }
                        //Not up to date, evict it from the cache and have us build a new version
                        cachelock->RemoveFromCache(lib);
                        LockedReleaseRef(lib);
                        lib=NULL;
                }

                // Invariant: library is not in cache, or library is in cache AND currently loading (in another thread)
                if (!lib)
                {
                        //Find a location to insert the lib into the cache
                        //Is there a NULL to replace in the cache?
                        unsigned newlib_location = std::find(cachelock->libs.begin(), cachelock->libs.end(), (Library*)NULL) - cachelock->libs.begin();
                        if (newlib_location == cachelock->libs.size())
                        {
                                cachelock->libs.push_back(NULL); //nope, add a NULL
                        }

                        cachelock->libs[newlib_location] = new Library(liburi); //throwing is no problem here
                        lib = cachelock->libs[newlib_location];
                        lib->id = idgenerator.AllocateId();
                        lib->cm_refcount+=2; //1 ref for the cache, 1 ref for the returned
                        LINKREFPRINT("refcount " << lib->liburi << " 2x incremented to " << lib->cm_refcount);

                        return std::make_pair(lib,false);
                }

                DEBUGPRINT("Somebody is processing the lib we want too: " << liburi);
                cachelock.Wait(); //the lib is being loaded, so wait for it.
        }
}

void Environment::LoadLibraryData(Blex::ContextKeeper &/*keeper*/, Library *lib, FileSystem::FilePtr const &file)
{
//        FileSystem::File *file = filesystem.OpenLibrary(keeper, lib->liburi);
//        if (!file)
//            throw VMRuntimeError(Error::CannotFindCompiledLibrary, lib->GetLibURI());

        // Load the stream with the source
        std::unique_ptr< Blex::RandomStream > indata;
        file->GetClibData(&indata, &lib->clibtime);

        if (!indata.get())
            throw VMRuntimeError(Error::CannotFindCompiledLibrary, lib->GetLibURI());

        // Read id's, returns stream at offset 0

        WrappedLibrary::ReadLibraryIds(indata.get(), &lib->clib_ids);

        // Read the library into memory
        std::vector<uint8_t> data;
        Blex::ReadStreamIntoVector(*indata,&data);
        Blex::MemoryReadStream mstream(&data[0], data.size());
        lib->wrappedlibrary.ReadLibrary(lib->liburi, &mstream);
        lib->clibpath = file->GetClibPath();

//      lib->clib_id = lib->wrappedlibrary.resident.compile_id;
}

namespace
{
BuiltinFunctionDefinition const * ResolveIfExternal2(BuiltinFunctionsRegistrator &bifreg, Library &library, Blex::Lexer::LineColumn position, std::string const &name)
{
        try
        {
                return bifreg.GetBuiltinFunction(name);
        }
        catch (VMRuntimeError &e)
        {
                e.position = position;
                e.filename = library.GetLibURI();
                throw e;
        }
}
} // End of anonymous namespace

void Environment::HandleModulesAndExternals(Library *lib)
{
        // Load needed dynamic modules, and resolve builtin functions
        LoadDynamicModules(*lib);
        try
        {
                lib->wrappedlibrary.LookupBuiltinDefinitions(std::bind(&ResolveIfExternal2, std::ref(GetBifReg()), std::ref(*lib), std::placeholders::_1, std::placeholders::_2));
        }
        catch (VMRuntimeError &e)
        {
                lib->SetLinkError(e);
        }
}

void Environment::InvokeModuleRegistration(HSVM_ModuleEntryPointPtr entrypoint, void *context_ptr)
{
        externals.linkmanager.InvokeModuleRegistration(entrypoint, context_ptr);
}

Library *LibraryCache::FindLibrary(std::string const &liburi)
{
        for (std::vector<Library*>::iterator itr=libs.begin(); itr != libs.end(); ++itr)
          if ( *itr && (*itr)->liburi == liburi)
            return *itr;

        return NULL;
}


/** A library contains all the used libraries in its librarylist, in initialisation order. We
    use that in here.

    First: get a reference to the library. If already loaded and up to date, return it.

    If not loaded:
        Load the library
        for all dependencies:
            Get a reference to the sublibrary
            if not loaded, load and link the sublibrary (all the dependents must have been loaded already, due to ordering of library list)
        Link the library
*/
//ADDME: Add currenttime as a parameter
Library const * Environment::InternalGetLibRef(Blex::ContextKeeper &keeper, std::string const &name, ErrorHandler &handler, Blex::DateTime currenttime)
{
        LINKPRINT("Request to get reference to " << name);

        Library *mainlib(0);

        try
        {
                // Get a loaded version of the library we need
                std::pair<Library*,bool> retval = GetUptodateRef(keeper, name, currenttime);
                mainlib=retval.first;

                // Get the library, for access checks
                FileSystem::FilePtr file = filesystem.OpenLibrary(keeper, mainlib->liburi);

                if (!file)
                    throw VMRuntimeError(Error::CannotFindCompiledLibrary, mainlib->GetLibURI());

                if (retval.second) //library already linked and up-to-date, just return the reference
                    return retval.first;

                LoadLibraryData(keeper, mainlib, file);

                // Load and link dependent libraries
                LoadDependencies(keeper, mainlib, handler, currenttime);
                Library const *modifiedlib = nullptr;
                if (!mainlib->IsUpTodate(filesystem, keeper, currenttime, &modifiedlib))
                    throw VMRuntimeError (Error::InvalidLibrary, mainlib->liburi, "Library out of date - used library " + (modifiedlib ? modifiedlib->liburi : "") + " modified during linking");

                // Load modules and set external functions
                HandleModulesAndExternals(mainlib);

                // Go link.
                LinkLibrary(mainlib);

                LINKPRINT("Cleaning up after linking of " << name);

                cache.SignalAll();
        }
        catch (...)
        {
                // Destroy the reference to the mainlib
                if (mainlib)
                {
                        LockedCache::WriteRef cachelock(cache);
                        if (cachelock->IsInCache(mainlib))
                        {
                                cachelock->RemoveFromCache(mainlib);
                                LockedReleaseRef(mainlib); //remove the cache reference
                        }

                        // Remove the last ref to the library
                        LockedReleaseRef(mainlib); //our own reference to the not yet loaded/linked mainlib
                }

                //if other threads were trying to load this library too, they would be waiting.
                //just signal them, they will figure out by themselves that the library was broken
                cache.SignalAll();

                throw;
        }

        return mainlib;
}

void Environment::LockedReleaseRef(Library *lib)
{
        if (lib->cm_refcount==0)
            throw std::runtime_error("Internal error: releasing reference from library with no references yet");

        if (--lib->cm_refcount==0)
        {
                LINKREFPRINT("refcount " << lib->liburi << " decremented to " << lib->cm_refcount);

                // Remove all references to used libraries
                for (LibraryPtrs::iterator itr = lib->usedlibraries.begin(); itr != lib->usedlibraries.end(); ++itr)
                    LockedReleaseRef(*itr);

                LINKPRINT("library " << lib->liburi << " destroyed");

                if (lib->GetId() != 0)
                    idgenerator.FreeId(lib->GetId());

                //Destroy the lib itself, if not referenced anymore
                delete lib;
        }
        else
        {
                LINKREFPRINT("refcount " << lib->liburi << " decremented to " << lib->cm_refcount);
        }
}

bool LibraryCache::IsInCache(Library *lib)
{
        return std::find(libs.begin(), libs.end(), lib) != libs.end();
}

void LibraryCache::RemoveFromCache(Library *lib)
{
        std::vector<Library*>::iterator itr=std::find(libs.begin(), libs.end(), lib);
        if (itr == libs.end())
            throw std::runtime_error("Internal error: releasing library that was never in the cache");
        if (lib->cm_refcount==0)
            throw std::runtime_error("Internal error: releasing library from cache no references yet");

        *itr=NULL;
}

void Environment::ReleaseLibRef(Library const *constlib)
{
        //We gave our clients const Libraries, but we need the non-const version!
        Library *lib = const_cast<Library*>(constlib);
        LockedCache::WriteRef cachelock(cache);
        LockedReleaseRef(lib);
}

Library const * Environment::GetLibRef(Blex::ContextKeeper &keeper, std::string const &name, ErrorHandler &handler)
{
        try
        {
                Blex::DateTime curtime = Blex::DateTime::Now();

                // Load the library
                Library const *lib = InternalGetLibRef(keeper, name, handler, curtime);

                // Release filesystem resources.
                //filesystem.ReleaseResources(keeper); ADDME readd? but it fails when a VM is already running and has created Other resources (eg, a GetHarescriptReosurce followed by a MakeFunctionPtr)

                return lib;
        }
        catch (Message &m)
        {
                DEBUGPRINT("Recompiling " << name);
                // Try to recompile. If that fails, just throw the error
                // FIXME: we now recompile on ExecutionEnvNotAvailable, because the changes to detect out-of-date BEFORE the that are TOOOO much.
                // When compile-server stuff that administrates library-validity is implemented, it can be shot down.
                if (m.iserror && (m.code == Error::CannotFindCompiledLibrary || m.code == Error::InvalidLibrary))
                    switch (filesystem.Recompile(keeper, name, false, &handler))
                    {
                    case FileSystem::RecompileSuccess:
                        {
                                try
                                {
                                        Blex::DateTime curtime = Blex::DateTime::Now();

                                        handler=ErrorHandler(); //clear all errors
                                        Library const *lib = InternalGetLibRef(keeper, name, handler, curtime);

                                        // Release filesystem resources.
                                        //filesystem.ReleaseResources(keeper); ADDME readd? but it fails when a VM is already running and has created Other resources (eg, a GetHarescriptReosurce followed by a MakeFunctionPtr)

                                        return lib;
                                }
                                catch (Message &e)
                                {
                                        // If failure has something to do with builtin functions or dll's rethrow
                                        if (e.iserror)
                                            switch (e.code)
                                            {
                                            case Error::BuiltinSymbolNotFound:
                                            case Error::BuiltinTypeMismatch:
                                            case Error::CantFindModule:
                                            case Error::NoModuleRegistration:
                                            case Error::ModuleInitFailed:
                                                throw;
                                            default: ;
                                            }

                                        // Add the new error
                                        handler.AddMessage(e);
                                        Blex::SleepThread(1000); //wait one second
                                }
                        }
                    case FileSystem::RecompileError:
                        {
                                throw VMRuntimeError(Error::CompilationFailed, name);
                        }
                    default: ;
                    }

                throw;
        }
}

void Environment::LoadDependencies(Blex::ContextKeeper &keeper, Library *lib, ErrorHandler &handler, Blex::DateTime currenttime)
{
        LINKPRINT("Load dependency libraries " << lib->liburi);

        const LoadedLibraryDefList &liblist = lib->GetWrappedLibrary().LibraryList();
        lib->usedlibraries.clear();
        lib->usedlibraries.reserve(liblist.size());

        /* We want to have the minimum number of direct dependencies on other
           libs (reducing lock counts and simplifying debugging?). We can do
           this by walking our dependency order right (most demanding) to left,
           and only add direct references to libs we didn't indirectly reference
           yet */

        for (LoadedLibraryDefList::const_iterator sublibit = liblist.begin(); sublibit != liblist.end(); ++sublibit)
        {
                //FIXME: Are deadlocks possible (waiting on ourselves) and how to avoid them?
                Library const *sublib = InternalGetLibRef(keeper, lib->GetLinkinfoNameStr(sublibit->liburi_index), handler, currenttime);
                assert(sublib);

                // Add the library to the list of used libraries (no-throw due to reserve)
                lib->usedlibraries.push_back(const_cast<Library*>(sublib));//ADDME: fix const-cast

                // Verify the compilation time! (ADDME: Harescript was missing indirect updates, is this a proper fix Rob? (Arnold, 28-feb-05)
                if (sublibit->clib_id != sublib->clib_ids.clib_id)
                    throw VMRuntimeError (Error::InvalidLibrary, lib->liburi, "Library out of date - dependent library changed");
        }
}

void Environment::LinkLibrary(Library *lib)
{
        //DEBUGPRINT("Now link " << lib->liburi);

        //Set the used libraries
        lib->initorder.clear();
//        lib->initorder.reserve(liblist.size());

        //Resolve links to the libs we LOADLIBed.. (can throw)
        ResolveVariablesAndFunctions(*lib);

        /* Build a complete list of libraries we need (both direct and indirect)
           and put the list in the recommended load order. This is easy, because
           all the sublists are in the right load order as well - we just need
           to merge them */
        for (LibraryPtrs::iterator sublib = lib->usedlibraries.begin(); sublib != lib->usedlibraries.end(); ++sublib)
          for (LibraryConstPtrs::iterator subdep = (*sublib)->initorder.begin(); subdep != (*sublib)->initorder.end(); ++subdep)
        {
                Library const *new_dependency = *subdep;

                //If it's not in the list yet, append it
                if (std::find(lib->initorder.begin(), lib->initorder.end(), new_dependency) == lib->initorder.end())
                    lib->initorder.push_back(new_dependency);

                if (!lib->link_error.get() && new_dependency->link_error.get())
                    lib->link_error = new_dependency->link_error;
        }

        //Cache/library setup
        lib->initorder.push_back(lib);
        lib->linkedlibrary.globalareastart = lib->id << 16;

        //We may only change the 'isloaded' flag while holding the cache lock
        {
                LockedCache::WriteRef lock(cache);
                lib->cm_isloaded=true;
        }
}

Library::Library(const std::string &_liburi)
: cm_isloaded(false)
, cm_refcount(0)
, liburi(_liburi)
, last_udt_check(Blex::DateTime::Invalid())
{
}

Library::~Library()
{
        assert(cm_refcount == 0);
}

bool Library::IsLocalUpTodate(FileSystem &filesystem, Blex::ContextKeeper &keeper, Blex::DateTime currenttime)
{
        FileSystem::FilePtr file = filesystem.OpenLibrary(keeper, liburi);
        if (!file)
            return false;

        // The library data has already been read in.
        if (last_udt_check >= currenttime - CacheDelay)
            return true;

        // Invalid: source file exists and current source time != recorded sourcetime
        Blex::DateTime sourcetime = file->GetSourceModTime();
        std::string currentclibpath = file->GetClibPath();

        if (wrappedlibrary.resident.sourcetime != sourcetime || clibpath != currentclibpath)
        {
                // Release resources, we may be looking a file from an old transaction or from a context file cache (fastcache!)
                filesystem.ReleaseResources(keeper);

                file = filesystem.OpenLibrary(keeper, liburi);
                if (!file)
                    return false;

                sourcetime = file->GetSourceModTime();
                currentclibpath = file->GetClibPath();

                if (wrappedlibrary.resident.sourcetime != sourcetime || clibpath != currentclibpath)
                    return false;
        }

        // Invalid: clib compile-id != recorded id
        std::unique_ptr< Blex::RandomStream > clib;
        Blex::DateTime clibmodtime;
        file->GetClibData(&clib, &clibmodtime);
        if (!clib.get())
            return false;

        // Did the time stamp of the library change? If not, we think it's ok.
        if (clibtime == clibmodtime)
            return true;

        LINKPRINT("Reading ids from library " << liburi);
        LibraryCompileIds new_ids;
        WrappedLibrary::ReadLibraryIds(clib.get(), &new_ids);

        bool has_same_id = clib_ids.clib_id == new_ids.clib_id;

        clib_ids = new_ids;
        clibtime = clibmodtime;

        return has_same_id;
}

bool Library::IsUpTodate(FileSystem &filesystem, Blex::ContextKeeper &keeper, Blex::DateTime currenttime, Library const **modifiedlibrary)
{
        // The library data has already been read in.
        if (last_udt_check >= currenttime - CacheDelay)
            return true;

        if (!IsLocalUpTodate(filesystem, keeper, currenttime))
        {
                if (modifiedlibrary)
                    *modifiedlibrary = this;
                return false;
        }

        for (LibraryPtrs::iterator it = usedlibraries.begin(); it != usedlibraries.end(); ++it)
        {
                if ((*it)->last_udt_check >= currenttime - CacheDelay)
                    continue;

               if (!(*it)->IsLocalUpTodate(filesystem, keeper, currenttime))
               {
                        if (modifiedlibrary)
                            *modifiedlibrary = *it;
                        return false;
               }

                // This library (and its loadlibs) are all ok
                (*it)->last_udt_check = currenttime;
        }

        // Up to date check done for this library
        last_udt_check = currenttime;

        return true;
}

void Library::SetLinkError(VMRuntimeError &e)
{
        link_error.reset(new VMRuntimeError(e));
}

void Library::CheckForLinkErrors() const
{
        if (link_error.get())
            throw *link_error;
}


// -----------------------------------------------------------------------------
// Symbol resolving
// -----------------------------------------------------------------------------

template <class DefList, class ResolvedDefList>
        void Environment::ResolveSymbols(
                Library &library,
                const DefList& (WrappedLibrary::*GetList)() const,
                ResolvedDefList LinkedLibrary::*resolvedlist) const

{
        for (typename DefList::const_iterator it = (library.GetWrappedLibrary().*GetList)().begin();
                it != (library.GetWrappedLibrary().*GetList)().end(); ++it)
        {
                Blex::StringPair name=library.GetLinkinfoName(it->name_index);

                typedef typename ResolvedDefList::value_type resolved_type;
                if (!(it->symbolflags & SymbolFlags::Imported))
                {
                        (library.linkedlibrary.*resolvedlist).push_back(resolved_type(&library, &*it, std::distance((library.GetWrappedLibrary().*GetList)().begin(), it)));
                }
                else
                {
                        if (it->library >= static_cast<int32_t>(library.GetWrappedLibrary().LibraryList().size()))
                            throw VMRuntimeError (Error::InvalidLibrary, library.liburi, "Library is corrupt");

                        Library& referencedlibrary = *library.usedlibraries[it->library];
                        if (&referencedlibrary == &library)
                            throw VMRuntimeError (Error::InvalidLibrary, library.liburi, "Circular library reference involving library");

                        const DefList& referencedlist = (referencedlibrary.GetWrappedLibrary().*GetList)();

                        bool found = false;
                        for (typename DefList::const_iterator searchit = referencedlist.begin();
                                searchit != referencedlist.end(); ++searchit)
                        {
                                // We won't check for publicness, the compiler makes references to non-public symbols (eg for inherited constructors)
                                Blex::StringPair searchname=referencedlibrary.GetLinkinfoName(searchit->name_index);
                                if (Blex::StrCaseCompare(name.begin, name.end, searchname.begin, searchname.end)==0)
                                {
                                        (library.linkedlibrary.*resolvedlist).push_back(resolved_type(&referencedlibrary, &*searchit, std::distance(referencedlist.begin(), searchit)));
                                        found = true;
                                }
                        }
                        // ADDME: better error
                        if (!found)
                            throw VMRuntimeError (Error::InvalidLibrary, library.liburi, "Could not find '" + name.stl_str() + "' in library '" + referencedlibrary.liburi + "'");
                }
        }
}

void Environment::ResolveColumnNames(Library &library)
{
        //ADDME: We should just get a total lock on the global column name mapper
        //       Perhaps just logically merge the column mapper code with the
        //       linking librarian and make us friends of the global mapper?
        //       After all, column name/id mapping is also a form of Link-ing..

        ColumnNames::LocalMapper local(externals.columnnamemapper);
        SectionLinkInfo const &linkinfo = library.GetWrappedLibrary().linkinfo;
        //FIXME: Mark the names that were used as _column names_, and _ONLY_ resolve those
        //       (we broke this when merging column names into names)
        for (unsigned i=0;i<linkinfo.columnidx.size();++i)
        {
                Blex::StringPair colname = library.GetLinkinfoName(linkinfo.columnidx[i]);
                library.linkedlibrary.resolvedcolumnnames.push_back(local.GetMapping(colname.size(),colname.begin));
        }

        //FIXME: Resolve immediately so we can keep this all const
        SectionResident &resident = const_cast<SectionResident&>(library.GetWrappedLibrary().resident);
        for (auto it = resident.types.begin(); it != resident.types.end(); ++it)
        {
                for (auto it2 = it->columnsdef.begin(); it2 != it->columnsdef.end(); ++it2)
                {
                        //ADDME: Also switch to StringPair etc for this job? Perhaps
                        //      move this to link fase
                        it2->nameid = local.GetMapping(it2->name);
                }
                for (auto it2 = it->tablesdef.begin(); it2 != it->tablesdef.end(); ++it2)
                    for (auto it3 = it2->columnsdef.begin(); it3 != it2->columnsdef.end(); ++it3)
                    {
                            //ADDME: Also switch to StringPair etc for this job? Perhaps
                            //      move this to link fase
                            it3->nameid = local.GetMapping(it3->name);
                    }
        }
}

namespace
{
struct OrderVtableEntires
{
        bool operator()(LinkedLibrary::ObjectVTableEntry const &lhs, LinkedLibrary::ObjectVTableEntry const &rhs) const { return lhs.nameid < rhs.nameid; }
};
} // End of anonymous namespace

void Environment::ResolveVtables(Library &library)
{
        ColumnNames::LocalMapper local(externals.columnnamemapper);
        SectionLinkInfo const &linkinfo = library.GetWrappedLibrary().linkinfo;

        for (std::vector< ObjectTypeDef >::const_iterator it = linkinfo.objecttypes.begin(), end = linkinfo.objecttypes.end(); it != end; ++it)
        {
                LinkedLibrary::LinkedObjectDef objdef;
                objdef.constructor = &library.linkedlibrary.functiondefs[it->constructor];
                objdef.def = &*it;
                objdef.name = linkinfo.GetNameStr(it->name_index);

                for (std::vector< uint32_t >::const_iterator it2 = it->uid_indices.begin(), end = it->uid_indices.end(); it2 != end; ++it2)
                    objdef.uids.push_back(linkinfo.GetNameStr(*it2));

                for (std::vector< ObjectCellDef >::const_iterator it2 = it->cells.begin(), end = it->cells.end(); it2 != end; ++it2)
                {
                        LinkedLibrary::ObjectVTableEntry entry;
                        entry.type = it2->type;
                        entry.var_type = it2->resulttype;
                        entry.nameid = local.GetMapping(linkinfo.GetNameStr(it2->name_index));
                        entry.is_private = it2->is_private;
                        entry.is_update = it2->is_update;
                        entry.is_toplevel = it2->is_toplevel;
                        if (it2->method != -1)
                            entry.method = &library.linkedlibrary.functiondefs[it2->method];
                        else
                            entry.method = 0;

                        std::string getter_name = linkinfo.GetNameStr(it2->getter_name_index);
                        entry.getter_nameid = getter_name.empty() ? 0 : local.GetMapping(getter_name);
                        std::string setter_name = linkinfo.GetNameStr(it2->setter_name_index);
                        entry.setter_nameid = setter_name.empty() ? 0 : local.GetMapping(setter_name);

                        objdef.entries.push_back(entry);
                }

                std::sort(objdef.entries.begin(), objdef.entries.end(), OrderVtableEntires());
                library.linkedlibrary.localobjects.push_back(objdef);
        }
}

void Environment::ResolveVariablesAndFunctions(Library &library)
{
        library.linkedlibrary.Clear();

        ResolveSymbols(library, &WrappedLibrary::VariableList, &LinkedLibrary::variabledefs);
        ResolveSymbols(library, &WrappedLibrary::FunctionList, &LinkedLibrary::functiondefs);
        ResolveColumnNames(library);
        ResolveVtables(library);
}

void Environment::LoadDynamicModules(Library &library)
{
        FunctionDefList const &list = library.GetWrappedLibrary().linkinfo.functions;

        std::set<std::string> sorted_modules;

        //ADDME: Avoid unnecessary dupe insertions. Perhaps just build a separate dllname list in the code file with unique dllnames (let the compiler do the work)
        for (FunctionDefList::const_iterator it = list.begin(); it != list.end(); ++it)
          if (it->dllname_index)
            sorted_modules.insert(library.GetLinkinfoNameStr(it->dllname_index));

        std::vector<std::string> modules(sorted_modules.begin(), sorted_modules.end());
        if (!modules.empty())
            externals.linkmanager.AddReferences(modules);
}

void Environment::OnNewVM(HSVM *vm)
{
        for (std::vector< std::function< void(HSVM *) > >::iterator it = creation_handlers.begin(); it != creation_handlers.end(); ++it)
            (*it)(vm);
}

void Environment::NoHSModUnload()
{
        externals.linkmanager.NoHSModUnload();
}

LibraryLoader::LibraryLoader(Environment &llib, ErrorHandler &_errorhandler)
: llib(llib)
, errorhandler(_errorhandler)
, initcount(0)
{
}

LibraryLoader::~LibraryLoader()
{
        for (LibraryConstPtrs::iterator itr=loaded_libs.begin();itr!=loaded_libs.end();++itr)
            llib.ReleaseLibRef(*itr);
}

Library const* LibraryLoader::GetNextUninitializedLibrary()
{
        return initcount == mustinit.size() ? NULL : mustinit[initcount];
}

Library const* LibraryLoader::GetNextInitializedLibrary()
{
        return initcount == 0 ? NULL : mustinit[initcount-1];
}

void LibraryLoader::PopUninitializedLibrary()
{
        ++initcount;
}

/** Pop the library which we need to de-initialize now. Returns NULL if no more de-inits are necessary*/
void LibraryLoader::PopInitializedLibrary()
{
        --initcount;
}

void LibraryLoader::PushDeferredInitialization(Library const *lib)
{
        deferred_inits.push_back(lib);
}

void LibraryLoader::PopDeferredInitialization()
{
        deferred_inits.pop_back();
}

void LibraryLoader::GetWHLibraryInfo(Blex::ContextKeeper &keeper, std::string const &liburi, LibraryInfo *info)
{
        info->uri = liburi;
        info->outofdate = true;
        info->compile_id = Blex::DateTime::Invalid();

        Library const *curlib = NULL;
        for (LibraryConstPtrs::iterator itr=loaded_libs.begin();itr!=loaded_libs.end() && !curlib;++itr)
            if ( (*itr)->GetLibURI() == liburi)
                curlib = *itr;
        for (LibraryConstPtrs::iterator itr=mustinit.begin();itr!=mustinit.end() && !curlib;++itr)
            if ( (*itr)->GetLibURI() == liburi)
                curlib = *itr;

        info->loaded = curlib;

        Library const *lib = llib.GetLibRef(keeper, liburi, errorhandler); //any
        try
        {
                if (lib)
                    info->compile_id = lib->GetWrappedLibrary().resident.compile_id;

                info->outofdate = curlib && lib != curlib;

                // See if we already have another version of its dependents
                LibraryConstPtrs const &to_init = lib->GetInitializationOrder();

                for (LibraryConstPtrs::const_iterator it = to_init.begin(); it != to_init.end(); ++it)
                {
                        // A problemn is there when a library with the same name and another library pointer is present
                        for (LibraryConstPtrs::iterator itr=loaded_libs.begin();itr!=loaded_libs.end();++itr)
                            if ( (*itr)->GetLibURI() == (*it)->GetLibURI() && *itr != *it)
                                info->outofdate = true;
                        for (LibraryConstPtrs::iterator itr=mustinit.begin();itr!=mustinit.end();++itr)
                            if ( (*itr)->GetLibURI() == (*it)->GetLibURI() && *itr != *it)
                                info->outofdate = true;
                }

                llib.ReleaseLibRef(lib);
        }
        catch (std::exception &e)
        {
                info->compile_id = Blex::DateTime::Invalid();
                llib.ReleaseLibRef(lib);
                throw e;
        }
}

void LibraryLoader::GetLoadedWHLibrariesInfo(Blex::ContextKeeper &keeper, std::vector< LibraryInfo > *infos)
{
        for (LibraryConstPtrs::iterator itr=loaded_libs.begin();itr!=loaded_libs.end();++itr)
        {
                LibraryInfo info;
                GetWHLibraryInfo(keeper, (*itr)->GetLibURI(), &info);
                infos->push_back(info);
        }
}

void LibraryLoader::GetAllWHLibrariesInfo(Blex::ContextKeeper &keeper, std::vector< LibraryInfo > *infos)
{
        for (auto &itr: mustinit)
        {
                LibraryInfo info;
                GetWHLibraryInfo(keeper, itr->GetLibURI(), &info);
                infos->push_back(info);
        }
}

Library const* LibraryLoader::LoadWHLibrary(Blex::ContextKeeper &keeper, std::string const &liburi, Library const *current_init_lib)
{
        //First, put the library on our lib list. This can be done safely, we won't return on error (we throw!)
        loaded_libs.reserve(loaded_libs.size()+1);

        Library const *new_lib = llib.GetLibRef(keeper, liburi, errorhandler);

        loaded_libs.push_back(new_lib);

        try
        {
                // Get initilization order for new library
                LibraryConstPtrs const &to_init = new_lib->GetInitializationOrder();

                // Check if any of the libraries has another version in the current library lists (o(n^2))
                for (LibraryConstPtrs::const_iterator it = to_init.begin(); it != to_init.end(); ++it)
                {
                        // A problem is there when a library with the same name and another library pointer is present
                        for (LibraryConstPtrs::iterator itr=loaded_libs.begin();itr!=loaded_libs.end();++itr)
                            if ( (*itr)->GetLibURI() == (*it)->GetLibURI() && *itr != *it)
                                throw VMRuntimeError(Error::LibraryUpdatedDuringRun, liburi, (*it)->GetLibURI());
                        for (LibraryConstPtrs::iterator itr=mustinit.begin();itr!=mustinit.end();++itr)
                            if ( (*itr)->GetLibURI() == (*it)->GetLibURI() && *itr != *it)
                                throw VMRuntimeError(Error::LibraryUpdatedDuringRun, liburi, (*it)->GetLibURI());
                }

                // Not currently initializing at all? We are SO done!
                if (!current_init_lib)
                {
                        for (LibraryConstPtrs::const_iterator it = to_init.begin(); it != to_init.end(); ++it)
                        {
                                if (std::find(mustinit.begin(), mustinit.end(), *it) == mustinit.end())
                                    mustinit.push_back(*it);
                        }
                        return new_lib;
                        //SPEEDUP: look only at libraries that were already present in mustinit, not in added libs
                }

                // Check if the new library is any of the libs that are currently initializing (current or deferred)
                // We may safely return them, because the compiler has taken care of safe calling of functions whose data isn't explicity initialized yet (only within the current library!)
                if (current_init_lib == new_lib || std::find(deferred_inits.begin(), deferred_inits.end(), new_lib) != deferred_inits.end())
                    return new_lib;

                // A library is safe to initialize if it isn't dependent on any library that is still initializing.
                if (std::find(to_init.begin(), to_init.end(), current_init_lib) != to_init.end())
                    throw VMRuntimeError(Error::CircularReference, new_lib->GetLibURI(), current_init_lib->GetLibURI());
                for (LibraryConstPtrs::iterator it = deferred_inits.begin(); it != deferred_inits.end(); ++it)
                    if (std::find(to_init.begin(), to_init.end(), *it) != to_init.end())
                        throw VMRuntimeError(Error::CircularReference, new_lib->GetLibURI(), current_init_lib->GetLibURI());

                // Ok, the library itself is safe. Build the new initialization order by inserting all libraries at current initialization position.
                LibraryConstPtrs new_mustinit = mustinit;
                for (LibraryConstPtrs::const_reverse_iterator it = to_init.rbegin(); it != to_init.rend(); ++it)
                {
                        LibraryConstPtrs::iterator initpos = new_mustinit.begin() + initcount;
                        Library const *lib = *it;

                        // Nothing to do when the library is already initialized.
                        if (std::find(new_mustinit.begin(), initpos, lib) != initpos)
                            continue;

                        // Check if the library is already know under another name (o(n^2))
                        for (LibraryConstPtrs::iterator itr=loaded_libs.begin();itr!=loaded_libs.end();++itr)
                            if ( (*itr)->GetLibURI() == (*it)->GetLibURI() && *itr != *it)
                                throw VMRuntimeError(Error::LibraryUpdatedDuringRun, liburi, (*it)->GetLibURI());
                        for (LibraryConstPtrs::iterator itr=new_mustinit.begin();itr!=new_mustinit.end();++itr)
                            if ( (*itr)->GetLibURI() == (*it)->GetLibURI() && *itr != *it)
                                throw VMRuntimeError(Error::LibraryUpdatedDuringRun, liburi, (*it)->GetLibURI());

                        LibraryConstPtrs::iterator oldpos = std::find(initpos, new_mustinit.end(), lib);
                        if (oldpos != new_mustinit.end())
                            new_mustinit.erase(oldpos);

                        new_mustinit.insert(initpos, lib);
                }

                // The library is correctly loaded, nothing can go wrong anymore. Update the mustinit list.
                new_mustinit.swap(mustinit);
        }
        catch (VMRuntimeError &)
        {
                // Get us back in a valid state
                llib.ReleaseLibRef(loaded_libs.back());
                loaded_libs.pop_back();

                throw;
        }

        return new_lib;
}

Library const* LibraryLoader::GetWHLibrary(std::string const &liburi) const
{
        // Also look at current initializing library, so take 'initcount + 1' as limit.
        unsigned max_libs = std::min<unsigned>(initcount + 1, mustinit.size());

        for (unsigned i = 0; i < max_libs; ++i)
            if (mustinit[i]->GetLibURI() == liburi)
                return mustinit[i];

        return 0;
}

Library const* LibraryLoader::GetWHLibraryById(LibraryId id) const
{
        // Also look at current initializing library, so take 'initcount + 1' as limit.
        unsigned max_libs = std::min<unsigned>(initcount + 1, mustinit.size());

        for (unsigned i = 0; i < max_libs; ++i)
            if (mustinit[i]->GetId() == id)
                return mustinit[i];

        return 0;
}

} //end namespace harescript
