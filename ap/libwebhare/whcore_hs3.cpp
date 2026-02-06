#include <ap/libwebhare/allincludes.h>

#include <blex/path.h>
#include <blex/utils.h>
#include <harescript/vm/hsvm_dllinterface.h>
#include "whcore_hs3.h"
#include "wh_filesystem.h"
#include <sstream>
#include <blex/logfile.h>

// Enable for much mumbo-jumbo
//#define ADHOCPRINTS

#ifdef ADHOCPRINTS
 #define ADHOCPRINT(x) DEBUGPRINT(x)
#else
 #define ADHOCPRINT(x) (void)0
#endif

namespace
{
inline std::string EncodeHash(std::string const &hash)
{
        std::string result;
        Blex::EncodeBase16(hash.begin(), hash.end(), std::back_inserter(result));
        return result;
}
} // End of anonymous namespace

namespace WHCore
{
//FIXME: All WHCore functions that might access the database transaction, should catch & translate exceptions!


ScriptContextData::ScriptContextData(ScriptEnvironment *_env)
: traceadhoccache(false)
, webhare(_env->whconn)
, env(*_env)
{
}

AdhocCache & ScriptContextData::GetAdhocCache()
{
        return env.GetAdhocCache();
}

ScriptContextData::~ScriptContextData()
{
}

ScriptGroupContextData::ScriptGroupContextData()
{
}
ScriptGroupContextData::~ScriptGroupContextData()
{

}
void ScriptContextData::UpdateAuthenticationRecord(HSVM *vm)
{
        HSVM_VariableId authrec = HSVM_AllocateVariable(vm);
        HSVM_GetAuthenticationRecord(vm, authrec);

        HSVM_VariableId dbase = HSVM_RecordCreate(vm, authrec, HSVM_GetColumnId(vm, "DATABASE"));
        HSVM_SetDefault(vm, dbase, HSVM_VAR_Record);

        HSVM_SetAuthenticationRecord(vm, authrec);
        HSVM_DeallocateVariable(vm, authrec);
}

AdhocCache::AdhocCache(Connection &conn)
: NotificationEventReceiver(conn.GetNotificationEventMgr())
{
        {
                LockedCacheData::WriteRef lock(lockedcachedata);
                lock->requests = 0;
                lock->hits = 0;
                lock->max_entries = 1024;
                lock->min_entries_per_library = 64;
        }

        Register();
}

AdhocCache::~AdhocCache()
{
        Unregister();
}

bool AdhocCache::GetEntry(HareScript::VirtualMachine *vm, HSVM_VariableId cachetag, LibraryURI const &library, Blex::DateTime const &librarymodtime, HSVM_VariableId result, HashTag *store_hash)
{
        HareScript::StackMachine &stackm = vm->GetStackMachine();
        HareScript::Marshaller &marshaller = vm->GetCacheMarshaller();

        HashTag hash = stackm.CalculateHash(cachetag, &librarymodtime);
        if (store_hash)
           *store_hash = hash;

        ADHOCPRINT("Adhoc: Finding entry " << EncodeHash(hash) << " in libary " << library);

        std::shared_ptr< HareScript::MarshalPacket const > data;
        std::unique_ptr< HareScript::MarshalPacket > copy;

        {
                LockedCacheData::WriteRef lock(lockedcachedata);

                ++lock->requests;

                // Find the library
                Libraries::iterator lit = lock->libraries.find(library);
                if (lit == lock->libraries.end())
                {
                        ADHOCPRINT("Adhoc: No entries for library");
                        return false;
                }

                // Find the entry within the library
                LibraryEntries::iterator it = lit->second.entries.find(hash);
                if (it == lit->second.entries.end())
                {
                        ADHOCPRINT("Adhoc: Entry does not exist for this library");
                        return false;
                }

                // Copy the packet (but only if the entry hasn't expired yet)
                if (it->second.expires >= Blex::DateTime::Now())
                    data = it->second.data; // No need for lock to copy once we have the shared_ptr to the (immutable) data

                // Any error getting the data (expired or otherwise: remove the entry)
                if (!data.get())
                {
                        ADHOCPRINT("Adhoc: Error retrieving entry");
                        RemoveEntry(lock, library, hash);
                        return false;
                }

                ++it->second.hits;
                ++lock->hits;
        }

        data->TryClone(&copy);
        if (!copy.get())
        {
                ADHOCPRINT("Adhoc: Entry is not readable!");

                // Race: the entry might have been replaced. Very low chance, no correctness effects, only performance.
                LockedCacheData::WriteRef lock(lockedcachedata);
                RemoveEntry(lock, library, hash);

                return false;
        }

        marshaller.ReadMarshalPacket(result, &copy);

        ADHOCPRINT("Adhoc: Got entry");
        return true;
}

void AdhocCache::CullEntries(LockedCacheData::WriteRef &lock)
{
        ADHOCPRINT("Adhoc: Culling entries");

        unsigned min_entries_per_library;
        if (lock->libraries.empty())
            min_entries_per_library = lock->min_entries_per_library;
        else
        {
                min_entries_per_library = lock->max_entries / lock->libraries.size();
                if (min_entries_per_library > lock->min_entries_per_library)
                    min_entries_per_library = lock->min_entries_per_library;
        }

        Blex::DateTime now = Blex::DateTime::Now();
        Expiries::iterator eit = lock->expiries.begin();

        while (eit != lock->expiries.end() && (lock->expiries.size() > lock->max_entries || eit->first < now))
        {
                Libraries::iterator lit = lock->libraries.find(eit->second.first);

                if (eit->first < now || lit->second.entries.size() > min_entries_per_library)
                {
                        // Removing the entry will delete eit, so save a copy of the library & hash, then increase eit
                        std::string library = eit->second.first;
                        std::string hash = eit->second.second;
                        ++eit;
                        RemoveEntry(lock, library, hash);
                }
                else
                    ++eit;
        }
}

bool AdhocCache::RemoveEntry(LockedCacheData::WriteRef &lock, LibraryURI const &library, HashTag const &hash)
{
        ADHOCPRINT("Adhoc: Removing entry " << EncodeHash(hash) << " for library " << library);

        Libraries::iterator lit = lock->libraries.find(library);
        if (lit == lock->libraries.end())
        {
                ADHOCPRINT("Adhoc: Library does not exist");
                return false;
        }

        LibraryEntries::iterator it = lit->second.entries.find(hash);
        if (it == lit->second.entries.end())
        {
                ADHOCPRINT("Adhoc: No such entry for this library");
                return true;
        }

        for (EventMasks::const_iterator eit = it->second.eventmasks.begin(); eit != it->second.eventmasks.end(); ++eit)
        {
                EventMaskInvalidations::iterator mit = lock->eventmasks.find(*eit);
                ADHOCPRINT("Adhoc: Removing registration for eventmask " << *eit);
                mit->second.erase(std::make_pair(library, hash));
                if (mit->second.empty())
                {
                        ADHOCPRINT("Adhoc: Removing eventmask, no more entries");
                        lock->eventmasks.erase(mit);
                }
        }

        //  hash & library may be a reference to the expiry or library entry
        lock->expiries.erase(std::make_pair(it->second.expires, std::make_pair(library, hash)));
        lit->second.entries.erase(it);

        if (lit->second.entries.empty())
        {
                ADHOCPRINT("Adhoc: Last entry removed, removing library");
                lock->libraries.erase(lit);
                return false;
        }

        ADHOCPRINT("Adhoc: Removed entry");
        return true;
}

void AdhocCache::SetEntry(HareScript::VirtualMachine *vm, HSVM_VariableId cachetag, int32_t eventcollector, LibraryURI const &library, Blex::DateTime const &librarymodtime, HSVM_VariableId data, Blex::DateTime expiry, EventMasks const &eventmasks, Blex::DateTime creationdate, std::shared_ptr< HareScript::AsyncStackTrace > const &stacktrace)
{
        HareScript::StackMachine &stackm = vm->GetStackMachine();
        HareScript::Marshaller &marshaller = vm->GetCacheMarshaller();

        HashTag hash = stackm.CalculateHash(cachetag, &librarymodtime);

        std::shared_ptr< HareScript::MarshalPacket const > packet;
        packet.reset(marshaller.WriteToNewPacket(data));
        if (packet->AnyDiskPathBlobs())
        {
                // Limit expiry to 1 hour from now
                Blex::DateTime maxExpires = Blex::DateTime::Now() + Blex::DateTime::Hours(1);
                ADHOCPRINT("Adhoc: Limit expiry of " << EncodeHash(hash) << " for library " << library << " from " << expiry.ToString() << " to " << maxExpires.ToString() << " due to disk-based blobs");
                if (expiry > maxExpires)
                    expiry = maxExpires;
        }

        HareScript::OutputObject *collector = eventcollector != 0 ? vm->GetOutputObject(eventcollector, false) : nullptr;

        Blex::NotificationEventManager::EventLock lock;
        if (collector)
        {
                // Get a lock on event dispatching so there won't be events that are delivered to the adhoccache but not to the collector
                lock = eventmgr.GetTemporaryEventLock();
                if (collector->IsReadSignalled(nullptr) != HareScript::OutputObject::NotSignalled)
                    return;
        }

        {
                LockedCacheData::WriteRef lock(lockedcachedata);

                ADHOCPRINT("Adhoc: Setting entry " << EncodeHash(hash) << " for library " << library);

                // Remove stale entries first. FIXME: move to timer thread, garbage collect
                CullEntries(lock);

                Library &lib = lock->libraries[library];
                CacheEntry &entry = lib.entries[hash];


                if (entry.expires != Blex::DateTime::Invalid())
                    lock->expiries.erase(std::make_pair(entry.expires, std::make_pair(library, hash)));

                if (!entry.eventmasks.empty())
                {
                        for (EventMasks::const_iterator eit = entry.eventmasks.begin(); eit != entry.eventmasks.end(); ++eit)
                        {
                                EventMaskInvalidations::iterator mit = lock->eventmasks.find(*eit);
                                ADHOCPRINT("Adhoc: Removing registration for eventmask " << *eit);
                                mit->second.erase(std::make_pair(library, hash));
                                if (mit->second.empty())
                                {
                                        ADHOCPRINT("Adhoc: Removing eventmask, no more entries");
                                        lock->eventmasks.erase(mit);
                                }
                        }
                }

                entry.expires = expiry;
                entry.data = packet;
                entry.hits = 0;
                entry.eventmasks = eventmasks;
                entry.creationdate = creationdate;
                entry.stacktrace = std::move(stacktrace);

                lock->expiries.insert(std::make_pair(expiry, std::make_pair(library, hash)));
                for (EventMasks::const_iterator it = eventmasks.begin(); it != eventmasks.end(); ++it)
                {
                        ADHOCPRINT("Adhoc: Adding to event mask " << *it);
                        lock->eventmasks[*it].insert(std::make_pair(library, hash));
                }
                ADHOCPRINT("Adhoc: Entry set");
        }
}

void AdhocCache::GetStats(HareScript::VirtualMachine *vm, HSVM_VariableId id_set)
{
        LockedCacheData::WriteRef lock(lockedcachedata);

        // Remove stale entries, looks better for stats
        CullEntries(lock);

        HSVM_SetDefault(*vm, id_set, HSVM_VAR_Record);
        HSVM_IntegerSet(*vm, HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, "CACHESIZE")), lock->expiries.size());
        HSVM_IntegerSet(*vm, HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, "REQUESTS")), lock->requests);
        HSVM_IntegerSet(*vm, HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, "HITS")), lock->hits);
        if (lock->expiries.empty())
            HSVM_SetDefault(*vm, HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, "OLDESTITEM")), HSVM_VAR_DateTime);
        else
        {
                std::set< std::pair< Blex::DateTime, std::pair< std::string, std::string > > >::iterator it = lock->expiries.end();
                --it;
                Blex::DateTime value = it->first;
                HSVM_DateTimeSet(*vm, HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, "OLDESTITEM")), value.GetDays(), value.GetMsecs());
        }
}

void AdhocCache::ListAllItems(std::vector< StatItem > *output)
{
        LockedCacheData::WriteRef lock(lockedcachedata);

        // Remove stale entries, looks better for stats
        CullEntries(lock);

        for (auto libitr = lock->libraries.begin(); libitr != lock->libraries.end(); ++libitr)
        {
                for (auto itemitr = libitr->second.entries.begin(); itemitr != libitr->second.entries.end(); ++itemitr)
                {
                        StatItem item;
                        item.library = libitr->first;
                        auto sizedata = itemitr->second.data->GetSize();
                        item.datasize = sizedata.datasize;
                        item.blobsize = sizedata.blobsize;
                        item.diskblobsize = sizedata.diskblobsize;
                        item.objects = sizedata.objects;
                        item.expires = itemitr->second.expires;
                        item.hits = itemitr->second.hits;
                        item.eventmasks = itemitr->second.eventmasks;
                        item.creationdate = itemitr->second.creationdate;
                        item.stacktrace = itemitr->second.stacktrace;
                        output->push_back(item);
                }
        }
}

void AdhocCache::InvalidateAll()
{
        ADHOCPRINT("Adhoc: Invalidating all");

        LockedCacheData::WriteRef lock(lockedcachedata);

        lock->libraries.clear();
        lock->expiries.clear();
        lock->eventmasks.clear();
        lock->requests = 0;
        lock->hits = 0;
}

void AdhocCache::TwistKnobs(int32_t max_entries, int32_t min_entries_per_library)
{
        if (max_entries < 0)
            max_entries = 0;
        if (min_entries_per_library < 0)
            min_entries_per_library = 0;

        LockedCacheData::WriteRef lock(lockedcachedata);
        lock->max_entries = max_entries;
        lock->min_entries_per_library = min_entries_per_library;

        CullEntries(lock);
}

void AdhocCache::ReceiveNotificationEvent(std::string const &event, uint8_t const */*hsvmdata*/, unsigned /*hsvmdatalen*/, Blex::NotificationEventSource /*source*/)
{
        if (event == "system:clearcaches")
        {
                InvalidateAll();
                return;
        }

        LockedCacheData::WriteRef lock(lockedcachedata);

        for (std::map< std::string, std::set< std::pair< std::string, std::string > > >::iterator eit = lock->eventmasks.begin(); eit != lock->eventmasks.end();)
        {
                if (Blex::StrCaseLike(event.begin(), event.end(), eit->first.begin(), eit->first.end()))
                {
                        /* Removing an event may potentially remove all eventsmasks, so there is no safe iterator reference
                           to save - saving the name and using that to reposition instead
                        */
                        std::set< std::pair< std::string, std::string > > &entries = eit->second;
                        std::string eventmask = eit->first;

                        // Need hard copies of library and hash to remove
                        std::string library, hash;

                        // Caching end value must be done, may not use the list after the last removeentry
                        for (unsigned i = 0, e = entries.size(); i != e; ++i)
                        {
                                library = entries.begin()->first;
                                hash = entries.begin()->second;
                                RemoveEntry(lock, library, hash);
                        }

                        // Restore the iterator
                        eit = lock->eventmasks.lower_bound(eventmask);
                }
                else
                {
                        ++eit;
                }
        }
}


/* we have a 'child' and 'parent' scriptenvironment, because the parent
   environment is often extended (eg. with SHTML functions) and the child would
   be unable to support those - so we must keep the function registrations
   separate */

ScriptEnvironment::ScriptEnvironment(Connection &whconn, bool allow_direct_compilations)
 : whconn(whconn)
 , filesystem ( whconn, allow_direct_compilations)
 , blobmgr(filesystem.GetTempDir())
 , environment (whconn.GetNotificationEventMgr(), filesystem, blobmgr)
 , adhoccache(whconn)
{
        if(!Blex::GetEnvironVariable("WEBHARE_HARESCRIPT_OFF").empty() || !Blex::GetEnvironVariable("WEBHARE_HARESCRIPT_WASMONLY").empty())
                throw new std::runtime_error("Native HareScript has been disabled");

        Init();
}

HareScript::VMGroup *ScriptEnvironment::CreateVMGroup(bool highpriority)
{
        return environment.ConstructVMGroup(highpriority);
}

void ListAdhocCacheItems(HSVM *vm, HSVM_VariableId id_set);
void SetAdhocCachDebugTags(HSVM *vm, std::vector< std::string > const &tags);

void ScriptEnvironment::Init()
{
        //ADDME: Restore pimpl of HareScript stuff?
        environment.InvokeModuleRegistration(WHCore_ModuleEntryPoint, this);

        //Try to load the drawlib interface
        void *graphicsmodule = environment.LoadHarescriptModule("whmod_graphics");
        if (graphicsmodule)
        {
                Blex::DynamicFunction func = Blex::FindDynamicFunction(graphicsmodule,"HSDRAWLIBINTERFACE_AddFontDir");
                if (func)
                {
                        typedef void (*AddFontDirFunc)(const char *);
                        AddFontDirFunc addfontdir = (AddFontDirFunc)func;
                        addfontdir( (whconn.GetWebHareRoot() + "fonts").c_str() );
                        addfontdir( (whconn.GetBaseDataRoot() + "fonts").c_str() );
                }

                DEBUGPRINT("Got a handle to the graphics library");
        }

        environment.RegisterVMCreationHandler(std::bind(&ScriptEnvironment::OnNewVM, this, std::placeholders::_1));
//        cache_vm.reset(ConstructWHVM(&cache_errorhandler));

        environment.RegisterDebugStatFunction("adhoccache-listitems", &ListAdhocCacheItems, SetAdhocCachDebugTags);
}


ScriptEnvironment::~ScriptEnvironment()
{
        environment.UnregisterDebugStatFunction("adhoccache-listitems");
}

/** Load and setup a WebHare-enhanced script */
HSVM* ScriptEnvironment::ConstructWHVM(HareScript::VMGroup *group)
{
        return group->CreateVirtualMachine();
}

void ScriptEnvironment::OnNewVM(HSVM *)
{
}

JobManagerIntegrator::JobManagerIntegrator(ScriptEnvironment &/*scriptenv*/, Connection &conn, HareScript::JobManager *jobmgr)
: mcregistrar(conn.mgrconn, jobmgr)
{
}

JobManagerIntegrator::~JobManagerIntegrator()
{
}

WHFileSystem::RecompileResult ScriptContextData::RecompileLibary(HareScript::ErrorHandler &handler, std::string const &uri, bool force)
{
        Blex::ContextKeeper keeper(env.GetEnvironment().GetContextReg());

        WHFileSystem::RecompileResult recompileresult = env.GetFileSystem().RecompileExternal(keeper, uri, force, &handler);

        // Don't forget to release transactions and such allocated by the filesystem
        env.GetFileSystem().ReleaseResources(keeper);

        return recompileresult;
}

std::string ScriptContextData::GetLibaryPath(std::string const &uri)
{
        Blex::ContextKeeper keeper(env.GetEnvironment().GetContextReg());
        std::string path = env.GetFileSystem().ReturnPath(keeper, uri);
        env.GetFileSystem().ReleaseResources(keeper);
        return path;
}

void PUB_ValidName(HSVM *vm, HSVM_VariableId id_set)
{
        Blex::StringPair namepair;
        HSVM_StringGet(vm, HSVM_Arg(0), &namepair.begin, &namepair.end);
        bool slashes_ok = HSVM_BooleanGet(vm, HSVM_Arg(1));
        HSVM_BooleanSet(vm, id_set, WHCore::ValidName(namepair.begin,namepair.end,slashes_ok));
}

void SYSTEM_GetIntalledModuleNames(HSVM *vm, HSVM_VariableId id_set)
{
        ScriptContextData *scriptcontext=static_cast<ScriptContextData*>(HSVM_GetContext(vm, ScriptContextId,true));
        std::vector<std::string> modulenames;
        scriptcontext->GetWebHare().GetModuleNames(&modulenames);

        HSVM_SetDefault(vm, id_set, HSVM_VAR_StringArray);
        for (unsigned i=0;i<modulenames.size();++i)
            HSVM_StringSetSTD(vm, HSVM_ArrayAppend(vm, id_set), modulenames[i]);
}

void SYSTEM_GetModuleInstallationRoot(HSVM *vm, HSVM_VariableId id_set)
{
        ScriptContextData *scriptcontext=static_cast<ScriptContextData*>(HSVM_GetContext(vm, ScriptContextId,true));
        std::string modulename = HSVM_StringGetSTD(vm, HSVM_Arg(0));
        HSVM_StringSetSTD(vm, id_set, scriptcontext->GetWebHare().GetModuleFolder(modulename));
}

namespace
{
std::string TryGetPath(ScriptContextData *scriptcontext, std::string filename)
{
        try
        {
                return scriptcontext->GetLibaryPath(filename);
        }
        catch (HareScript::Message &)
        {
                return filename;
        }
}
} // End of anonymous namespace

void SYSTEM_RecompileLibrary(HSVM *vm, HSVM_VariableId id_set)
{
        ScriptContextData *scriptcontext=static_cast<ScriptContextData*>(HSVM_GetContext(vm, ScriptContextId,true));

        std::string uri = HSVM_StringGetSTD(vm, HSVM_Arg(0));
        bool force = HSVM_BooleanGet(vm, HSVM_Arg(1));

        HareScript::ErrorHandler handler;
        bool success = false;
        try
        {
                WHFileSystem::RecompileResult result = scriptcontext->RecompileLibary(handler, uri, force);
                success = result == WHFileSystem::RecompileSuccess;
        }
        catch (HareScript::Message &msg)
        {
                handler.AddMessage(msg);
        }

        HSVM_ColumnId c_result = HSVM_GetColumnId(vm, "RESULT");
        HSVM_ColumnId c_messages = HSVM_GetColumnId(vm, "MESSAGES");
        HSVM_ColumnId c_path = HSVM_GetColumnId(vm, "PATH");
        HSVM_ColumnId c_filename = HSVM_GetColumnId(vm, "FILENAME");

        HSVM_SetDefault(vm, id_set, HSVM_VAR_Record);
        HSVM_BooleanSet(vm, HSVM_RecordCreate(vm, id_set, c_result), success);
        HSVM_VariableId messages = HSVM_RecordCreate(vm, id_set, c_messages);

        GetMessageList(vm, messages, handler, false);

        unsigned len = HSVM_ArrayLength(vm, messages);
        for (unsigned i = 0; i < len; ++i)
        {
                HSVM_VariableId rec = HSVM_ArrayGetRef(vm, messages, i);
                HSVM_VariableId file = HSVM_RecordGetRef(vm, rec, c_filename);

                std::string filename = HSVM_StringGetSTD(vm, file);
                HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, rec, c_path), TryGetPath(scriptcontext, filename));
        }
}

void GetWHCoreParameters(HSVM *vm, HSVM_VariableId id_set)
{
        ScriptContextData *scriptcontext=static_cast<ScriptContextData*>(HSVM_GetContext(vm, ScriptContextId,true));
        Connection const &webhare = scriptcontext->GetWebHare();

        HSVM_SetDefault(vm, id_set, HSVM_VAR_Record);

        HSVM_ColumnId c_installationroot = HSVM_GetColumnId(vm, "INSTALLATIONROOT");
        HSVM_ColumnId c_moduledirs = HSVM_GetColumnId(vm, "MODULEDIRS");
        HSVM_ColumnId c_basedataroot = HSVM_GetColumnId(vm, "BASEDATAROOT");
        HSVM_ColumnId c_varroot = HSVM_GetColumnId(vm, "VARROOT");
        HSVM_ColumnId c_ephemeralroot = HSVM_GetColumnId(vm, "EPHEMERALROOT");
        HSVM_ColumnId c_logroot = HSVM_GetColumnId(vm, "LOGROOT");

        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, id_set, c_installationroot), webhare.GetWebHareRoot());
        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, id_set, c_basedataroot), webhare.GetBaseDataRoot());
        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, id_set, c_varroot), webhare.GetBaseDataRoot());
        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, id_set, c_ephemeralroot), webhare.GetEphemeralRoot());
        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, id_set, c_logroot), webhare.GetLogRoot());

        HSVM_VariableId moduledirsvar = HSVM_RecordCreate(vm, id_set, c_moduledirs);
        HSVM_SetDefault(vm, moduledirsvar, HSVM_VAR_StringArray);

        for(unsigned i=0;i<webhare.GetModuleDirs().size();++i)
        {
                HSVM_VariableId dirvar = HSVM_ArrayAppend(vm, moduledirsvar);
                HSVM_StringSetSTD(vm, dirvar, webhare.GetModuleDirs()[i]);
        }
        HSVM_VariableId rootdirvar = HSVM_ArrayAppend(vm, moduledirsvar);
        HSVM_StringSetSTD(vm, rootdirvar, Blex::MergePath(webhare.GetWebHareRoot(), "modules") + "/");
}

void GetProcessInfo(HSVM *vm, HSVM_VariableId id_set)
{
        ScriptContextData *scriptcontext=static_cast<ScriptContextData*>(HSVM_GetContext(vm, ScriptContextId,true));
        Connection const &webhare = scriptcontext->GetWebHare();

        HSVM_SetDefault(vm, id_set, HSVM_VAR_Record);

        HSVM_ColumnId c_clientname = HSVM_GetColumnId(vm, "CLIENTNAME");
        HSVM_ColumnId c_pid = HSVM_GetColumnId(vm, "PID");
        HSVM_ColumnId c_processcode = HSVM_GetColumnId(vm, "PROCESSCODE");

        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, id_set, c_clientname), webhare.GetClientName());
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, id_set, c_pid), getpid());
        HSVM_Integer64Set(vm, HSVM_RecordCreate(vm, id_set, c_processcode), webhare.GetProcessCode());
}

void DetermineCacheCallingLibrary(HSVM *vm, std::string *library, Blex::DateTime *modtime)
{
        const char cachelib[] = "wh::adhoccache.whlib";

        int daysvalue, msecsvalue;
        const char *cache_librarystr = HSVM_GetCallingLibrary(vm, 0, false);
        const char *calling_librarystr = HSVM_GetCallingLibraryWithCompileTime(vm, 1, false, &daysvalue, &msecsvalue);

        if (!cache_librarystr || !calling_librarystr || Blex::StrCompare(cache_librarystr, cache_librarystr + strlen(cache_librarystr), cachelib, cachelib + sizeof(cachelib) - 1) != 0)
        {
                *library = "";
                HSVM_ReportCustomError(vm, "Calling-library dependent adhoccache functions may only be called from wh::adhoccache.whlib");
                return;
        }

        *modtime = Blex::DateTime(daysvalue, msecsvalue);
        *library = calling_librarystr;
}

void GetAdhocCacheData(HSVM *vm, HSVM_VariableId id_set)
{
        ScriptContextData *scriptcontext=static_cast<ScriptContextData*>(HSVM_GetContext(vm, ScriptContextId,true));

        DetermineCacheCallingLibrary(vm, &scriptcontext->adhoclibrary, &scriptcontext->adhoclibrarymodtime);
        ADHOCPRINT("GetAdhocCacheData: Calling library: " << scriptcontext->adhoclibrary << ", modtime " << scriptcontext->adhoclibrarymodtime);

        AdhocCache &cache = scriptcontext->GetAdhocCache();

        HSVM_SetDefault(vm, id_set, HSVM_VAR_Record);

        HSVM_VariableId result = HSVM_RecordCreate(vm, id_set, HSVM_GetColumnId(vm,"VALUE"));
        HSVM_VariableId found = HSVM_RecordCreate(vm, id_set, HSVM_GetColumnId(vm,"FOUND"));
        HSVM_VariableId hash = HSVM_RecordCreate(vm, id_set, HSVM_GetColumnId(vm,"HASH"));

        std::string calculated_hash;
        bool have_value = cache.GetEntry(HareScript::GetVirtualMachine(vm), HSVM_Arg(0), scriptcontext->adhoclibrary, scriptcontext->adhoclibrarymodtime, result, &calculated_hash);
        if (!have_value)
            HSVM_BooleanSet(vm, result, false);

        std::string calculated_hash_base16;
        Blex::EncodeBase16(calculated_hash.begin(), calculated_hash.end(), std::back_inserter(calculated_hash_base16));

        HSVM_BooleanSet(vm, found, have_value);
        HSVM_StringSetSTD(vm, hash, calculated_hash_base16);
}

void SetAdhocCacheData(HSVM *vm)
{
        ScriptContextData *scriptcontext=static_cast<ScriptContextData*>(HSVM_GetContext(vm, ScriptContextId,true));

        DetermineCacheCallingLibrary(vm, &scriptcontext->adhoclibrary, &scriptcontext->adhoclibrarymodtime);
        ADHOCPRINT("SetAdhocCacheData: Calling library: " << scriptcontext->adhoclibrary << ", modtime " << scriptcontext->adhoclibrarymodtime);

        AdhocCache &cache = scriptcontext->GetAdhocCache();

        int daysvalue, msecsvalue;
        std::vector< std::string > eventmasks;
        HSVM_DateTimeGet(vm, HSVM_Arg(2), &daysvalue, &msecsvalue);

        for (unsigned idx = 0, e = HSVM_ArrayLength(vm, HSVM_Arg(3)); idx != e; ++idx)
            eventmasks.push_back(HSVM_StringGetSTD(vm, HSVM_ArrayGetRef(vm, HSVM_Arg(3), idx)));

        // Sort & remove duplicates from eventmasks. Rest of the code assumes every eventmasks is mentioned once.
        std::sort(eventmasks.begin(), eventmasks.end());
        eventmasks.erase(std::unique(eventmasks.begin(), eventmasks.end()), eventmasks.end());

        std::shared_ptr< HareScript::AsyncStackTrace > stacktrace;
        Blex::DateTime creationdate = Blex::DateTime::Invalid();
        if (scriptcontext->traceadhoccache)
        {
                stacktrace.reset(new HareScript::AsyncStackTrace);
                HareScript::GetVirtualMachine(vm)->GetRawAsyncStackTrace(stacktrace.get(), 0, nullptr);
                creationdate = Blex::DateTime::Now();
        }

        cache.SetEntry(HareScript::GetVirtualMachine(vm), HSVM_Arg(0), HSVM_IntegerGet(vm, HSVM_Arg(4)), scriptcontext->adhoclibrary, scriptcontext->adhoclibrarymodtime, HSVM_Arg(1), Blex::DateTime(daysvalue, msecsvalue), eventmasks, creationdate, stacktrace);
}

void GetAdhocCacheStats(HSVM *vm, HSVM_VariableId id_set)
{
        ScriptContextData *scriptcontext=static_cast<ScriptContextData*>(HSVM_GetContext(vm, ScriptContextId,true));

        AdhocCache &cache = scriptcontext->GetAdhocCache();
        cache.GetStats(HareScript::GetVirtualMachine(vm), id_set);
}

void InvalidateAdhocCache(HSVM *vm)
{
        ScriptContextData *scriptcontext=static_cast<ScriptContextData*>(HSVM_GetContext(vm, ScriptContextId,true));

        AdhocCache &cache = scriptcontext->GetAdhocCache();
        cache.InvalidateAll();
}

void SetupAdhocCache(HSVM *vm)
{
        ScriptContextData *scriptcontext=static_cast<ScriptContextData*>(HSVM_GetContext(vm, ScriptContextId,true));

        AdhocCache &cache = scriptcontext->GetAdhocCache();

        cache.TwistKnobs(HSVM_IntegerGet(vm, HSVM_Arg(0)), HSVM_IntegerGet(vm, HSVM_Arg(1)));
}

void ListAdhocCacheItems(HSVM *vm, HSVM_VariableId id_set)
{
        ScriptContextData *scriptcontext=static_cast<ScriptContextData*>(HSVM_GetContext(vm, ScriptContextId,true));

        AdhocCache &cache = scriptcontext->GetAdhocCache();

        std::vector< AdhocCache::StatItem > output;
        cache.ListAllItems(&output);

        HSVM_ColumnId col_items = HSVM_GetColumnId(vm, "ITEMS");
        HSVM_ColumnId col_library = HSVM_GetColumnId(vm, "LIBRARY");
        HSVM_ColumnId col_datasize = HSVM_GetColumnId(vm, "DATASIZE");
        HSVM_ColumnId col_blobsize = HSVM_GetColumnId(vm, "BLOBSIZE");
        HSVM_ColumnId col_diskblobsize = HSVM_GetColumnId(vm, "DISKBLOBSIZE");
        HSVM_ColumnId col_objects = HSVM_GetColumnId(vm, "OBJECTS");
        HSVM_ColumnId col_hits = HSVM_GetColumnId(vm, "HITS");
        HSVM_ColumnId col_expires = HSVM_GetColumnId(vm, "EXPIRES");
        HSVM_ColumnId col_eventmasks = HSVM_GetColumnId(vm, "EVENTMASKS");
        HSVM_ColumnId col_creationdate = HSVM_GetColumnId(vm, "CREATIONDATE");
        HSVM_ColumnId col_stacktrace = HSVM_GetColumnId(vm, "STACKTRACE");

        HSVM_SetDefault(vm, id_set, HSVM_VAR_Record);
        HSVM_VariableId items = HSVM_RecordCreate(vm, id_set, col_items);

        HSVM_SetDefault(vm, items, HSVM_VAR_RecordArray);
        for (auto &itr: output)
        {
                HSVM_VariableId elt = HSVM_ArrayAppend(vm, items);
                HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, elt, col_library), itr.library);
                HSVM_Integer64Set(vm, HSVM_RecordCreate(vm, elt, col_datasize), itr.datasize);
                HSVM_Integer64Set(vm, HSVM_RecordCreate(vm, elt, col_blobsize), itr.blobsize);
                HSVM_Integer64Set(vm, HSVM_RecordCreate(vm, elt, col_diskblobsize), itr.diskblobsize);
                HSVM_Integer64Set(vm, HSVM_RecordCreate(vm, elt, col_objects), itr.objects);
                HSVM_Integer64Set(vm, HSVM_RecordCreate(vm, elt, col_hits), itr.hits);
                HSVM_DateTimeSetBlex(vm, HSVM_RecordCreate(vm, elt, col_expires), itr.expires);
                HSVM_VariableId eventmasks = HSVM_RecordCreate(vm, elt, col_eventmasks);
                HSVM_SetDefault(vm, eventmasks, HSVM_VAR_StringArray);
                for (auto &eitr: itr.eventmasks)
                    HSVM_StringSetSTD(vm, HSVM_ArrayAppend(vm, eventmasks), eitr);
                HSVM_VariableId stacktrace = HSVM_RecordCreate(vm, elt, col_stacktrace);
                if (itr.stacktrace.get())
                {
                        std::vector< HareScript::StackTraceElement > elements;
                        HareScript::GetVirtualMachine(vm)->BuildAsyncStackTrace(*itr.stacktrace, &elements);
                        GetVMStackTraceFromElements(HareScript::GetVirtualMachine(vm), stacktrace, elements, false);
                }
                else
                    HSVM_SetDefault(vm, stacktrace, HSVM_VAR_RecordArray);
                HSVM_DateTimeSetBlex(vm, HSVM_RecordCreate(vm, elt, col_creationdate), itr.creationdate);
        }
}

void SetAdhocCachDebugTags(HSVM *vm, std::vector< std::string > const &tags)
{
        ScriptContextData *scriptcontext=static_cast<ScriptContextData*>(HSVM_GetContext(vm, ScriptContextId,true));
        scriptcontext->traceadhoccache = std::find(tags.begin(), tags.end(), "traceadhoccache") != tags.end();
}

bool GetCell(HSVM *vm, HSVM_VariableId id, HSVM_ColumnId cid, bool const &defval)
{
        HSVM_VariableId file = HSVM_RecordGetRef(vm, id, cid);
        if (!file || HSVM_GetType(vm, file) != HSVM_VAR_Boolean)
            return defval;
        return HSVM_BooleanGet(vm, file);
}
int32_t GetCell(HSVM *vm, HSVM_VariableId id, HSVM_ColumnId cid, int32_t const &defval)
{
        HSVM_VariableId file = HSVM_RecordGetRef(vm, id, cid);
        if (!file || HSVM_GetType(vm, file) != HSVM_VAR_Integer)
            return defval;
        return HSVM_IntegerGet(vm, file);
}
std::string GetCell(HSVM *vm, HSVM_VariableId id, HSVM_ColumnId cid, const char *defval)
{
        HSVM_VariableId file = HSVM_RecordGetRef(vm, id, cid);
        if (!file || HSVM_GetType(vm, file) != HSVM_VAR_String)
            return defval;
        return HSVM_StringGetSTD(vm, file);
}

void ConfigureRemoteLogs(HSVM *vm, HSVM_VariableId id_set)
{
        std::vector< LogConfig > config;

        HSVM_ColumnId c_tag = HSVM_GetColumnId(vm, "TAG");
        HSVM_ColumnId c_logroot = HSVM_GetColumnId(vm, "LOGROOT");
        HSVM_ColumnId c_logname = HSVM_GetColumnId(vm, "LOGNAME");
        HSVM_ColumnId c_logextension = HSVM_GetColumnId(vm, "LOGEXTENSION");
        HSVM_ColumnId c_autoflush = HSVM_GetColumnId(vm, "AUTOFLUSH");
        HSVM_ColumnId c_rotates = HSVM_GetColumnId(vm, "ROTATES");
        HSVM_ColumnId c_errors = HSVM_GetColumnId(vm, "ERRORS");
        HSVM_ColumnId c_msg = HSVM_GetColumnId(vm, "MSG");
        HSVM_ColumnId c_timestamps = HSVM_GetColumnId(vm, "TIMESTAMPS");

        unsigned len = HSVM_ArrayLength(vm, HSVM_Arg(0));
        for (unsigned i = 0; i < len; ++i)
        {
                  HSVM_VariableId rec = HSVM_ArrayGetRef(vm, HSVM_Arg(0), i);
                  LogConfig c;
                  c.tag = GetCell(vm, rec, c_tag, "");
                  DEBUGPRINT("ctag " << c.tag);
                  c.logroot = GetCell(vm, rec, c_logroot, "");
                  c.logname = GetCell(vm, rec, c_logname, "");
                  c.logextension = GetCell(vm, rec, c_logextension, "");
                  c.autoflush = GetCell(vm, rec, c_autoflush, false);
                  c.rotates = GetCell(vm, rec, c_rotates, 0);
                  c.timestamps = GetCell(vm, rec, c_timestamps, false);

                  config.push_back(c);
        }

        std::vector< bool > results;

        HSVM_SetDefault(vm, id_set, HSVM_VAR_Record);
        HSVM_VariableId errors = HSVM_RecordCreate(vm, id_set, c_errors);
        HSVM_SetDefault(vm, errors, HSVM_VAR_RecordArray);

        ScriptContextData *scriptcontext=static_cast<ScriptContextData*>(HSVM_GetContext(vm, ScriptContextId,true));
        bool result = scriptcontext->ConfigureRemoteLogs(config, &results);

        if (!result)
        {
                HSVM_VariableId error = HSVM_ArrayAppend(vm, errors);
                HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, error, c_msg), "Can't reach whmanager");
                HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, error, c_tag), "");
        }
        else
        {
                // Can't be the case, but just be secure
                if (results.size() < len)
                    len = results.size();

                for (unsigned i = 0; i < len; ++i)
                    if (!results[i])
                    {
                            HSVM_VariableId error = HSVM_ArrayAppend(vm, errors);
                            HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, error, c_msg), "Can't open log '" + config[i].tag + "'");
                            HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, error, c_tag), config[i].tag);
                    }
        }
}
void RemoteLog(HSVM *vm)
{
        ScriptContextData *scriptcontext=static_cast<ScriptContextData*>(HSVM_GetContext(vm, ScriptContextId,true));
        scriptcontext->RemoteLog(HSVM_StringGetSTD(vm,HSVM_Arg(0)), HSVM_StringGetSTD(vm,HSVM_Arg(1)));
}

void FlushRemoteLog(HSVM *vm, HSVM_VariableId id_set)
{
        ScriptContextData *scriptcontext=static_cast<ScriptContextData*>(HSVM_GetContext(vm, ScriptContextId,true));
        bool result = scriptcontext->FlushRemoteLog(HSVM_StringGetSTD(vm,HSVM_Arg(0)));

        HSVM_BooleanSet(vm, id_set, result);
}

void GetSystemConfig(HSVM *vm, HSVM_VariableId id_set)
{
        ScriptContextData *scriptcontext=static_cast<ScriptContextData*>(HSVM_GetContext(vm, ScriptContextId,true));

        std::shared_ptr< Blex::PodVector< uint8_t > const > systemconfig;
        scriptcontext->GetSystemConfig(&systemconfig);

        HSVM_SetDefault(vm, id_set, HSVM_VAR_Record);
        if (systemconfig.get() && systemconfig->size())
        {
                HareScript::Marshaller &marshaller = HareScript::GetVirtualMachine(vm)->authrec_marshaller;

                marshaller.ReadFromVector(id_set, *systemconfig);
        }
}

void SetSystemConfig(HSVM *vm)
{
        ScriptContextData *scriptcontext=static_cast<ScriptContextData*>(HSVM_GetContext(vm, ScriptContextId,true));

        HareScript::Marshaller &marshaller = HareScript::GetVirtualMachine(vm)->authrec_marshaller;

        Blex::PodVector< uint8_t > data;
        marshaller.WriteToPodVector(HSVM_Arg(0), &data);

        scriptcontext->SetSystemConfig(&data[0], data.size());
}


SHTMLCallbacks::~SHTMLCallbacks()
{

}
SHTMLWebserverCallbacks::~SHTMLWebserverCallbacks()
{

}
void ThrowNoShtmlException(HSVM *hsvm)
{
        // Call the ThrowDomException helper function in HareScript
        HSVM_OpenFunctionCall(hsvm, 0);
        HSVM_CallFunction(hsvm, "mod::system/lib/internal/webserver/support.whlib", "THROWNOSHTMLEXCEPTION", 0, 0, 0);
        HSVM_CloseFunctionCall(hsvm);
}

void LogHarescriptError(Connection &conn, std::string const &source, std::string const &groupid, std::string const &externalsessiondata, HareScript::ErrorHandler const &errorhandler, std::map< std::string, std::string > const &params)
{
        using Blex::AnyToJSON;

        //Build ISO ms precision timestamp
        char out[80]; // Is a lot more than the 26 characters needed
        Blex::DateTime now = Blex::DateTime::Now();
        struct std::tm time = now.GetTM();
        std::sprintf(out ,"%04d-%02d-%02dT%02d:%02d:%02d.%03dZ",
                time.tm_year+1900,
                time.tm_mon + 1,
                time.tm_mday,
                time.tm_hour,
                time.tm_min,
                time.tm_sec,
                int(now.GetMsecs() % 1000));

        std::string info = "{\"@timestamp\":\"";
        info.append(out);
        info += "\",\"type\":\"script-error\",\"groupid\":" + AnyToJSON(groupid) + ",";
        if(!externalsessiondata.empty())
            info += "\"session\":" + AnyToJSON(externalsessiondata) + ",";
        if(!source.empty())
            info += "\"source\":" + AnyToJSON(source) + ",";

        for (auto itr: params)
            info += AnyToJSON(itr.first) + ":" + itr.second + ",";

        auto errors = errorhandler.GetErrors();
        if (errors.size())
        {
                std::string msg = HareScript::GetMessageString(*errors.begin());
                if (info.size() + msg.size() > 100*1024)
                  msg = msg.substr(0, 100*1024 + 100 - info.size()) + "...";
                info += "\"message\":" + AnyToJSON(msg) + ",";
        }

        info += "\"errors\":[";
        for (auto it = errors.begin(); it != errors.end(); ++it)
        {
                if (info.size() > 127 * 1024)
                    break;

                std::string msg = HareScript::GetMessageString(*it);
                if (info.size() + msg.size() > 100*1024)
                  msg = msg.substr(0, 100*1024 - info.size()) + "...";

                if (it != errors.begin())
                    info += ",";
                info += "{\"filename\":" + AnyToJSON(it->filename);
                info += ",\"line\":" + AnyToJSON(it->position.line);
                info += ",\"column\":" + AnyToJSON(it->position.column);
                info += ",\"message\":" + AnyToJSON(msg) + "}";
        }
        info += "],\"trace\":[";
        for (auto it = errorhandler.GetStackTrace().begin(); it!=errorhandler.GetStackTrace().end();++it)
        {
                if (info.size() > 127 * 1024)
                    break;

                if (it != errorhandler.GetStackTrace().begin())
                    info += ",";
                info += "{\"filename\":" + AnyToJSON(it->filename);
                info += ",\"line\":" + AnyToJSON(it->position.line);
                info += ",\"column\":" + AnyToJSON(it->position.column);
                info += ",\"functionname\":" + AnyToJSON(it->func) + "}";
        }
        info += "]}";

        conn.RemoteLog("system:notice", info);
}


#define FORWARD_FUNCTION(x)   \
void WHS_ ## x(HSVM *vm, HSVM_VariableId id_set)       \
{                                                                           \
        ScriptGroupContextData *scriptcontext=static_cast<ScriptGroupContextData*>(HSVM_GetGroupContext(vm, ScriptGroupContextId,true));  \
        if(scriptcontext->shtml.get())                                                                                \
                scriptcontext->shtml->x(vm, id_set);                                                                  \
        else                                                                                                          \
                ThrowNoShtmlException(vm);                                                                            \
}
#define FORWARD_MACRO(x)   \
void WHS_ ## x(HSVM *vm)                                                                         \
{                                                                                                                     \
        ScriptGroupContextData *scriptcontext=static_cast<ScriptGroupContextData*>(HSVM_GetGroupContext(vm, ScriptGroupContextId,true));  \
        if(scriptcontext->shtml.get())                                                                                \
                scriptcontext->shtml->x(vm);                                                                          \
        else                                                                                                          \
                ThrowNoShtmlException(vm);                                                                            \
}

#define FORWARD_MGR_FUNCTION(x)   \
void WHMGR_ ## x(HSVM *vm, HSVM_VariableId id_set)       \
{                                                                           \
        ScriptContextData *scriptcontext=static_cast<ScriptContextData*>(HSVM_GetContext(vm, ScriptContextId,true));  \
        Connection const &webhare = scriptcontext->GetWebHare();                                                      \
        if(webhare.shtmlcallbacks.get())                                                                              \
                webhare.shtmlcallbacks->x(vm, id_set);                                                                \
        else                                                                                                          \
                ThrowNoShtmlException(vm);                                                                            \
}
#define FORWARD_MGR_MACRO(x)   \
void WHMGR_ ## x(HSVM *vm)                                                                         \
{                                                                                                                     \
        ScriptContextData *scriptcontext=static_cast<ScriptContextData*>(HSVM_GetContext(vm, ScriptContextId,true));  \
        Connection const &webhare = scriptcontext->GetWebHare();                                                      \
        if(webhare.shtmlcallbacks.get())                                                                              \
                webhare.shtmlcallbacks->x(vm);                                                                        \
        else                                                                                                          \
                ThrowNoShtmlException(vm);                                                                            \
}

FORWARD_MGR_FUNCTION(ConfigureWebServer)
FORWARD_MGR_FUNCTION(GetHTTPEventListenerCounts)
FORWARD_MGR_MACRO(FlushLogFiles)

FORWARD_MGR_MACRO(ClearHTTPEventMessages)


FORWARD_FUNCTION(GetRequestBody)

FORWARD_FUNCTION(Header)
FORWARD_FUNCTION(Variable)
FORWARD_FUNCTION(AllVariables)
FORWARD_FUNCTION(AllHeaders)

FORWARD_FUNCTION(RequestUrl)
FORWARD_FUNCTION(ClientRequestUrl)
FORWARD_FUNCTION(RequestMethod)
FORWARD_FUNCTION(ClientLocalWebserver)
FORWARD_FUNCTION(ClientLocalBinding)
FORWARD_FUNCTION(ClientLocalIp)
FORWARD_FUNCTION(ClientRemoteIp)
FORWARD_FUNCTION(ClientLocalPort)
FORWARD_FUNCTION(ClientRemotePort)
FORWARD_FUNCTION(ClientLocalAddress)
FORWARD_FUNCTION(CreateWebSession)
FORWARD_FUNCTION(UpdateWebSession)
FORWARD_FUNCTION(FlushWebResponse)
FORWARD_FUNCTION(GetErrorInfo)
FORWARD_FUNCTION(GetWebSessionData)
FORWARD_FUNCTION(GetWebSessionUser)
FORWARD_FUNCTION(GetSRHErrors)
FORWARD_FUNCTION(GetWebhareAccessRuleId)
FORWARD_FUNCTION(GetWebhareAccessRules)
FORWARD_FUNCTION(GetAuthenticatedWebhareUser)
FORWARD_FUNCTION(GetAuthenticatedWebhareUserEntityId)
FORWARD_FUNCTION(SetupWebsocketInput)

FORWARD_MACRO(Sendfile)
FORWARD_MACRO(AddHeader)
FORWARD_MACRO(AuthenticateWebSession)
FORWARD_MACRO(AuthenticateWebhareUser)
FORWARD_MACRO(SetRequestUserName)
FORWARD_MACRO(AcceptBasicAuthCredentials)
FORWARD_MACRO(CloseWebSession)
FORWARD_MACRO(ResetWebResponse)
FORWARD_MACRO(StoreWebSessionData)
FORWARD_MACRO(DetachScriptFromRequest)

void WHS_LogWebserverError(HSVM *vm)
{
      ScriptGroupContextData *scriptgroupcontext=static_cast<ScriptGroupContextData*>(HSVM_GetGroupContext(vm, ScriptGroupContextId,true));
      if(scriptgroupcontext->shtml.get())
          scriptgroupcontext->shtml->LogWebserverError(vm);
      else
      {
              ScriptContextData *scriptcontext=static_cast<ScriptContextData*>(HSVM_GetContext(vm, ScriptContextId,true));
              Connection const &webhare = scriptcontext->GetWebHare();
              if(webhare.shtmlcallbacks.get())
                  webhare.shtmlcallbacks->LogWebserverError(vm);
              else
                  ThrowNoShtmlException(vm);
      }
}


// -----------------------------------------------------------------------------
//
// Contexts & registration
//

static void* CreateWHCoreContext(void *env)
{
        return new ScriptContextData((ScriptEnvironment*)env);
}
static void DestroyWHCoreContext(void*, void *context_ptr)
{
        delete static_cast<ScriptContextData*>(context_ptr);
}
static void* CreateWHCoreGroupContext(void *)
{
        return new ScriptGroupContextData;
}
static void DestroyWHCoreGroupContext(void*, void *context_ptr)
{
        delete static_cast<ScriptGroupContextData*>(context_ptr);
}

int WHCore_ModuleEntryPoint(HSVM_RegData *regdata, void *context_ptr)
{
        HSVM_RegisterContext (regdata, ScriptContextId, context_ptr, &CreateWHCoreContext, &DestroyWHCoreContext);
        HSVM_RegisterContext (regdata, ScriptGroupContextId, context_ptr, &CreateWHCoreGroupContext, &DestroyWHCoreGroupContext);

        HSVM_RegisterFunction(regdata, "ISVALIDWHFSNAME::B:SB", PUB_ValidName);

        HSVM_RegisterFunction(regdata, "__SYSTEM_RECOMPILELIBRARY::R:SB", SYSTEM_RecompileLibrary);

        HSVM_RegisterFunction(regdata, "__SYSTEM_GETINSTALLEDMODULENAMES::SA:",SYSTEM_GetIntalledModuleNames);
        HSVM_RegisterFunction(regdata, "__SYSTEM_GETMODULEINSTALLATIONROOT::S:S",SYSTEM_GetModuleInstallationRoot);

        HSVM_RegisterFunction(regdata,"__SYSTEM_WHCOREPARAMETERS::R:", GetWHCoreParameters);
        HSVM_RegisterFunction(regdata,"__SYSTEM_GETPROCESSINFO::R:", GetProcessInfo);

        HSVM_RegisterFunction(regdata,"GETADHOCCACHEDATA::R:R", GetAdhocCacheData);
        HSVM_RegisterMacro(regdata,"SETADHOCCACHEDATA:::RVDSAI", SetAdhocCacheData);
        HSVM_RegisterFunction(regdata,"GETADHOCCACHESTATS::R:", GetAdhocCacheStats);
        HSVM_RegisterMacro(regdata,"INVALIDATEADHOCCACHE:::", InvalidateAdhocCache);
        HSVM_RegisterMacro(regdata,"__SYSTEM_SETUPADHOCCACHE:::II", SetupAdhocCache);
        HSVM_RegisterFunction(regdata,"__SYSTEM_GETADHOCCACHEITEMMETADATA::R:", ListAdhocCacheItems);

        HSVM_RegisterFunction(regdata,"__SYSTEM_CONFIGUREREMOTELOGS::R:RA", ConfigureRemoteLogs);
        HSVM_RegisterMacro(regdata,"__SYSTEM_REMOTELOG:::SS", RemoteLog);
        HSVM_RegisterFunction(regdata,"__SYSTEM_FLUSHREMOTELOG::B:S", FlushRemoteLog);
        HSVM_RegisterFunction(regdata,"__SYSTEM_GETSYSTEMCONFIG::R:", GetSystemConfig);
        HSVM_RegisterMacro(regdata,"__SYSTEM_SETSYSTEMCONFIG:::R", SetSystemConfig);

        HSVM_RegisterFunction(regdata, "CONFIGUREWEBSERVER::R:R",WHMGR_ConfigureWebServer);
        HSVM_RegisterMacro(regdata, "__WHS_FLUSHLOGFILES:::",WHMGR_FlushLogFiles);

        HSVM_RegisterFunction(regdata, "GETREQUESTBODY::X:",WHS_GetRequestBody);

        HSVM_RegisterFunction(regdata, "GETWEBHEADER::S:S",WHS_Header);
        HSVM_RegisterFunction(regdata, "GETWEBVARIABLE::S:S",WHS_Variable);
        HSVM_RegisterFunction(regdata, "__SYSTEM_WHS_WEBVARS::RA:",WHS_AllVariables);
        HSVM_RegisterFunction(regdata, "GETALLWEBHEADERS::RA:",WHS_AllHeaders);
        HSVM_RegisterMacro(regdata, "__WHS_SENDWEBFILE:::X",WHS_Sendfile);
        HSVM_RegisterMacro(regdata, "__WHS_ADDHTTPHEADER:::SSB",WHS_AddHeader);
        HSVM_RegisterFunction(regdata, "GETREQUESTURL::S:",WHS_RequestUrl);
        HSVM_RegisterFunction(regdata, "GETCLIENTREQUESTURL::S:",WHS_ClientRequestUrl);
        HSVM_RegisterFunction(regdata, "GETREQUESTMETHOD::S:",WHS_RequestMethod);
        HSVM_RegisterFunction(regdata, "GETCLIENTWEBSERVER::I:",WHS_ClientLocalWebserver);
        HSVM_RegisterFunction(regdata, "GETCLIENTBINDING::I:",WHS_ClientLocalBinding);
        HSVM_RegisterFunction(regdata, "GETCLIENTLOCALIP::S:",WHS_ClientLocalIp);
        HSVM_RegisterFunction(regdata, "GETCLIENTREMOTEIP::S:",WHS_ClientRemoteIp);
        HSVM_RegisterFunction(regdata, "GETCLIENTLOCALPORT::I:",WHS_ClientLocalPort);
        HSVM_RegisterFunction(regdata, "GETCLIENTREMOTEPORT::I:",WHS_ClientRemotePort);
        HSVM_RegisterFunction(regdata, "GETCLIENTLOCALADDRESS::S:",WHS_ClientLocalAddress);

        HSVM_RegisterMacro(regdata, "__WHS_AUTHENTICATEWEBSESSION:::SSSBIIB",WHS_AuthenticateWebSession);
        HSVM_RegisterMacro(regdata, "__WHS_SETREQUESTUSERNAME:::S",WHS_SetRequestUserName);

        HSVM_RegisterMacro(regdata, "ACCEPTBASICAUTHCREDENTIALS:::SII",WHS_AcceptBasicAuthCredentials);
        HSVM_RegisterMacro(regdata, "__WHS_CLOSEWEBSESSION:::SS",WHS_CloseWebSession);
        HSVM_RegisterFunction(regdata, "__WHS_CREATEWEBSESSION::S:SRIBS",WHS_CreateWebSession);
        HSVM_RegisterFunction(regdata, "__UPDATEWEBSESSION::B:SSRBI",WHS_UpdateWebSession);
        HSVM_RegisterFunction(regdata, "__WHS_FLUSHWEBRESPONSE::R:D",WHS_FlushWebResponse);
        HSVM_RegisterMacro(regdata, "RESETWEBRESPONSE:::",WHS_ResetWebResponse);
        HSVM_RegisterFunction(regdata, "__WHS_GETERRORINFO::R:",WHS_GetErrorInfo);
        HSVM_RegisterFunction(regdata, "__WHS_GETWEBSESSIONUSERID::I:SS",WHS_GetWebSessionUser);
        HSVM_RegisterFunction(regdata, "__WHS_GETWEBSESSIONDATA::R:SS",WHS_GetWebSessionData);
        HSVM_RegisterMacro(regdata, "__WHS_STOREWEBSESSIONDATA:::SSR",WHS_StoreWebSessionData);
        HSVM_RegisterMacro(regdata, "__WHS_LOGWEBSERVERERROR:::S",WHS_LogWebserverError);

        HSVM_RegisterFunction(regdata, "GETWEBHAREACCESSRULEID::I:",WHS_GetWebhareAccessRuleId);
        HSVM_RegisterFunction(regdata, "GETWEBHAREACCESSRULES::RA:",WHS_GetWebhareAccessRules);
        HSVM_RegisterFunction(regdata, "GETAUTHENTICATEDWEBHAREUSER::I:",WHS_GetAuthenticatedWebhareUser);
        HSVM_RegisterFunction(regdata, "GETAUTHENTICATEDWEBHAREUSERENTITYID::I:",WHS_GetAuthenticatedWebhareUserEntityId);

        HSVM_RegisterMacro   (regdata, "DETACHSCRIPTFROMREQUEST:::", WHS_DetachScriptFromRequest);
        HSVM_RegisterFunction(regdata, "GETSRHERRORS::RA:S", WHS_GetSRHErrors);

        HSVM_RegisterFunction(regdata, "__WHS_SETUPWEBSOCKETINPUT::I:", WHS_SetupWebsocketInput);

        HSVM_RegisterFunction(regdata, "GETHTTPEVENTLISTENERCOUNTS::RA:S", WHMGR_GetHTTPEventListenerCounts);
        HSVM_RegisterMacro   (regdata, "CLEARHTTPEVENTMESSAGES:::S", WHMGR_ClearHTTPEventMessages);

        return 1;
}

} //end of namespace WHCore
