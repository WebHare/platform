#ifndef blex_harescript_hsvm_environment
#define blex_harescript_hsvm_environment

#include "hsvm_constants.h"
#include "hsvm_externals.h"
#include "hsvm_librarywrapper.h"
#include "hsvm_marshalling.h"
#include <blex/notificationevents.h>

namespace HareScript
{


class Debugger;
class VMGroup;
class JobManager;

/** Class that gives access to a library file. Instances of these classes will
    be stored to refer to the files later on. */
class LibraryFile
{
    public:
        /// Destructor
        virtual ~LibraryFile();
        /** Open the script for reading. The caller will be responsible for deleting this stream */
        virtual Blex::Stream * Open() = 0;
        /** Check if a script has expired and must be updated
            @param curtime Current time */
        virtual bool IsInvalid(Blex::DateTime curtime) = 0;

        LibraryFile(LibraryFile const &) = delete;
        LibraryFile& operator=(LibraryFile const &) = delete;
};

class Environment;
class Library;

/** Library get function. Based on a sanatized path, this function must return
    a stream that contains the library, or NULL if the library could not be
    located for some reason (ADDME: exception support must be added!)  */
typedef std::function< LibraryFile *(std::string const &, bool) > GetLibraryFunction;

/** This class gives out unique ids. Max 2^32 ids may be in use simultaneously. Fully threadsafe.
*/
class IdGenerator
{
    private:

        class Data
        {
            public:
                /// This id and all ids after that are free
                unsigned free_from;

                /// Set of all free ids below free_from
                std::set< unsigned > holes;
        };

        typedef Blex::InterlockedData< Data, Blex::Mutex > LockedData;

        LockedData data;

    public:
        /// Create a new id generator
        IdGenerator();

        /// Allocate an id
        unsigned AllocateId();

        /// Free an id
        void FreeId(unsigned id);
};

/// Linked Library holds library that has been loaded (indirectly) by a script.
/** A linked library holds for all functions and imported global variables a
    pointer to the definition in the library it the function or variable is
    defined.
    This object is threadsafe only when calls are serialized */
class LinkedLibrary
{
    public:
        typedef uint32_t VariableId;

        /// Structure holding the definition of a resolved function.
        struct ResolvedFunctionDef
        {
                Library* lib;                           ///< Library in which the (imported) function is to internal
                const FunctionDef* def;                 ///< Definition of the function
                FunctionId id;                          ///< FunctionId, native to library lib.
                ResolvedFunctionDef(Library* lib, const FunctionDef* def, FunctionId id) : lib(lib), def(def), id(id) { }
        };
        /// Structure holding the definition of a resolved variable.
        struct ResolvedVariableDef
        {
                Library* lib;                           ///< Library in which the (imported) function is to internal
                const VariableDef* def;                 ///< Definition of the function
                VariableId id;                          ///< VariableId, native to library lib
                ResolvedVariableDef(Library* lib, const VariableDef* def, VariableId id) : lib(lib), def(def), id(id) { }
        };

        /// Structure holding an entry of the vtable of an object
        struct ObjectVTableEntry
        {
                bool is_private;                        ///< Is this a private member?
                bool is_update;                         ///< Is this an updated member?
                bool is_toplevel;                       ///< Is this a toplevel member (not part of base)?
                ColumnNameId nameid;                    ///< Name of the entry
                ObjectCellType::_type type;             ///< Type of the entry (only methods for now)
                VariableTypes::Type var_type;           ///< Variable type of variable members
                ResolvedFunctionDef *method;            ///< Function (for methods only)
                ColumnNameId getter_nameid;             ///< Name of the getter (only for properties). 0 for not readable
                ColumnNameId setter_nameid;             ///< Name of the setter (only for properties). 0 for not writable
        };

        struct LinkedObjectDef
        {
                /// Name of the object
                std::string name;

                /// UIDs of the object
                std::vector< std::string > uids;

                ObjectTypeDef const *def;

                /// VTable entries, sorted on nameid
                Blex::PodVector< ObjectVTableEntry > entries;
                ResolvedFunctionDef *constructor;

                ObjectVTableEntry const * GetEntry(ColumnNameId name) const;
                ObjectVTableEntry const * GetEntryByNr(int32_t nr) const;
        };

        typedef std::vector< ResolvedFunctionDef > ResolvedFunctionDefList;
        typedef std::vector< ResolvedVariableDef > ResolvedVariableDefList;
        typedef std::vector< LinkedObjectDef > LinkedObjectDefs;

        /** List of resolved columnnames. A columnname in an instruction is an index into the columnname section. The
            corresponding element in this array gives back the columnnameid. */
        std::vector< ColumnNameId > resolvedcolumnnames;

        /// Start of storage for global variables.
        VarId globalareastart;

        /// List of resolved functions.
        ResolvedFunctionDefList functiondefs;

        /// List of resolved variables.
        ResolvedVariableDefList variabledefs;

        /// Local object definitions
        LinkedObjectDefs localobjects;

        /** Reads the library through the wrapper. Definitions are not resolved */
        LinkedLibrary() {}

        /** Empty destructor */
        ~LinkedLibrary() {}

        void Clear()
        {
                functiondefs.clear();
                variabledefs.clear();
                resolvedcolumnnames.clear();
        }

        LinkedLibrary(LinkedLibrary const &) = delete;
        LinkedLibrary& operator=(LinkedLibrary const &) = delete;
};

typedef std::vector<Library*> LibraryPtrs;
typedef std::vector<Library const *> LibraryConstPtrs;

/** Structure that keeps all information about a particular library, including the
    wrapped library, and optionally a linked version */
class Library
{
        /// Has this library been completely loaded into memory? (must hold cache mutex to access this var!)
        bool cm_isloaded;

        /// How many references are there to this library (must hold cache mutex to access this var!)
        unsigned cm_refcount;

        /// Uri of the library
        std::string const liburi;

        /// Clib id's of the library (with id, and source modtime)
        LibraryCompileIds clib_ids;

        /// Path for clib (to detect relocations due to module updates)
        std::string clibpath;

        /// Modtime of library at the time the utd check was done, Invalid if file didn't exist. Set in LoadLibraryData, updated in IsLocalUpTodate.
        Blex::DateTime clibtime;

        /// Compile id of this library (read from clib)
//      Blex::DateTime clib_id;

        /// Last successfull up-to-date check
        Blex::DateTime last_udt_check;

        /// The wrapped library, containing the read version of the library
        WrappedLibrary wrappedlibrary;

        /// Unique ID of this library (is based on its cache location, since that is unique for every validated library)
        LibraryId id;

        /// Linked version of this library
        LinkedLibrary linkedlibrary;

        /// All library objects that this library depends upon
        LibraryPtrs usedlibraries;

        /// Initialisation order required to execute this library (includes 'this' !)
        LibraryConstPtrs initorder;

        /// Link errors are stored here
        std::shared_ptr< VMRuntimeError > link_error;

        /** Is this library locally up to date (only comparing loadlib data, clib and source, not dependents)
            (must hold cache mutex to call this function)
            @param currenttime Current time
            @param isjob Whether this library is being loaded as a job
            @return true if the library is localy up to date */
        bool IsLocalUpTodate(FileSystem &filesystem, Blex::ContextKeeper &keeper, Blex::DateTime currenttime);

        /** Are this library and its dependents up to date? (must hold cache mutex to call this function)
            @param now Current time
            @param isjob Whether this library is being loaded as a job
            @return true if the library is up to date */
        bool IsUpTodate(FileSystem &filesystem, Blex::ContextKeeper &keeper, Blex::DateTime now, Library const **modifiedlibrary);

        ~Library();  //only the cache can safely delete us and deal with our references

    public:
        explicit Library(std::string const &name);

        inline std::string const & GetLibURI() const { return liburi; }
        inline LibraryId GetId() const { return id; }
        inline WrappedLibrary const & GetWrappedLibrary() const { return wrappedlibrary; }
        inline LinkedLibrary const & GetLinkedLibrary() const { return linkedlibrary; }
        inline LibraryCompileIds const &GetLibraryCompileIds() const { return clib_ids; }

        LibraryConstPtrs const & GetInitializationOrder() const { return initorder; }

        /** Given a name index, resolve the actual name */
        Blex::StringPair GetLinkinfoName(unsigned idx) const
        { return wrappedlibrary.linkinfo.GetName(idx); }

        std::string GetLinkinfoNameStr(unsigned idx) const
        { return wrappedlibrary.linkinfo.GetNameStr(idx); }

        void SetLinkError(VMRuntimeError &e);

        void CheckForLinkErrors() const;

    private:
        Library(Library const &) = delete;
        Library& operator=(Library const &) = delete;

        friend struct LibraryCache;
        friend class Environment;
        friend class Debugger;
};

struct LibraryCache
{
        std::vector<Library*> libs;

        bool IsInCache(Library *lib);
        void RemoveFromCache(Library *lib);
        Library *FindLibrary(std::string const &uri);
};

/** Structure describing the status of a library, seen from a particular VM
*/
struct LibraryInfo
{
        std::string uri;
        bool outofdate;
        bool loaded;
        Blex::DateTime compile_id;
};


/** The linking librarian is the objects that holds and caches all used libraries
    It also links them together, and keeps copies of the linked versions.

    Status:
    - Loading and linking of libraries has been done.
    - Support for statically linked libraries (INTERNAL libaries) has NOT been implemented
    - ADDME: timestamp checking (and error reporting)

    The environment handles registration of all built-in functions, and provides
    the interface of the VM to the outside world.

    All member functions can be called from different threads simultaneously
*/
class BLEXLIB_PUBLIC Environment
{
    private:
        typedef Blex::InterlockedData<LibraryCache, Blex::ConditionMutex> LockedCache;
        LockedCache cache;

        /// Notification event manager
        Blex::NotificationEventManager &eventmgr;

        /// Function used to get library files.
        FileSystem &filesystem;

        /// Blob manager
        GlobalBlobManager &blobmanager;

        /// Links to 'externals'
        Externals externals;

        /// Handlers for new vm creation
        std::vector< std::function< void(HSVM *) > > creation_handlers;

        IdGenerator idgenerator;

        /** Get a reference to the library, and verify that it is up to date.
            If the library doesn't exist, it will be created.
            @param liburi Library to look up
            @param isloadlib Set tpo true if this library must be treated as a loadlib
            @return first: pointer to the library.
                    second: true if the library is loaded and linked, false if it was just created */
        std::pair<Library *,bool> GetUptodateRef(Blex::ContextKeeper &keeper, std::string const &liburi, Blex::DateTime currenttime);

        /** Load the library contents from disk/dbase */
        void LoadLibraryData(Blex::ContextKeeper &keeper, Library *lib, FileSystem::FilePtr const &file);

        /** Load needed dynamic modules and resolve external functions */
        void HandleModulesAndExternals(Library *lib);

        /** Load dependency libraries from disk/dbase */
        void LoadDependencies(Blex::ContextKeeper &keeper, Library *lib, ErrorHandler &handler, Blex::DateTime currenttime);

        /** Link the loaded library to its dependencies. Adds references to all used libraries. */
        void LinkLibrary(Library *lib);

        /** This is the function that is used for resolving the imported variables
            or the imported functions in a linked library.
            @param instance Linked library which definitions must be resolved
            @param GetList Pointer to the function in the wrapped library where the definitions reside (variables or functions)
            @param resolvedlist Pointer to the member in which the resolved definitions must be put */
        template <class DefList, class ResolvedDefList>
        void ResolveSymbols(
                Library &library,
                const DefList& (WrappedLibrary::*GetList)() const,
                ResolvedDefList LinkedLibrary::*resolvedlist) const;

        /** Resolve columnnames */
        void ResolveColumnNames(Library &library);

        /** Resolve vtables */
        void ResolveVtables(Library &library);

        /** Resolves all variables and function imports */
        void ResolveVariablesAndFunctions(Library &library);

        /** Lower a library's refcount and if it hits 0, delete it and
            unreference any used libraries - assume a cachelock is already in
            effect */
        void LockedReleaseRef(Library *lib);

        /** Get a reference to the requested library, loading it into memory
            if necessary. The received library must be released using ReleaseLibRef.
            This function will throw an exception if it cannot load the library.
            @param keeper ContextKeeper with current context
            @param liburi Library to load
            @return The requested library. Never NULL.*/
        Library const * InternalGetLibRef(Blex::ContextKeeper &keeper, std::string const &liburi, ErrorHandler &handler, Blex::DateTime curtime);

        /** Load any dynamic modules referenced by 'library' */
        void LoadDynamicModules(Library &library);

        bool const allow_std_sharing;

    public:
        Environment(Blex::NotificationEventManager &eventmgr, FileSystem &filesystem, GlobalBlobManager &blobmanager, bool allow_std_sharing);

        ~Environment();

        VMGroup* ConstructVMGroup(bool highpriority);

        /** Get a reference to the requested library, loading it into memory. Also tries to recompile one time
            when the library is not found or invalid.
            if necessary. The received library must be released using ReleaseLibRef.
            This function will throw an exception if it cannot load the library.
            @param keeper ContextKeeper with current context
            @param liburi Library to load
            @param handler Error handler
            @return The requested library. Never NULL.*/
        Library const * GetLibRef(Blex::ContextKeeper &keeper, std::string const &liburi, ErrorHandler &handler);

        /** Release a library pointer obtained using GetLibRef
            @param lib Library to release */
        void ReleaseLibRef(Library const *lib);

        /** Load a harescript module.
            @return Handle to the module if the load was succesful, or NULL if
                   the load failed. */
        void* LoadHarescriptModule(std::string const &name);

        BuiltinFunctionsRegistrator & GetBifReg() { return externals.bifreg; }
        Blex::ContextRegistrator& GetContextReg() { return externals.creg; }
        //FIXME: Temp needed for objects
        DynamicLinkManager const& GetDLLManager() const { return externals.linkmanager; }
        HSVM_RegData* GetHSVMRegData() { return (HSVM_RegData*)(static_cast<void*>(&externals.linkmanager)); }

        ColumnNames::GlobalMapper & GetColumnNameMapper() { return externals.columnnamemapper; }

        FileSystem & GetFileSystem() { return filesystem; }

        Blex::NotificationEventManager & GetNotificationEventMgr() { return eventmgr; }

        /** Eject a library from the cache if we still have it (used when we will
            force a recompile) */
        void EjectLibraryFromCache(std::string const &liburi);

        /** This function registers a function that will be called when a new VM
            is created
            @param func Function that will be called with the new VM when it is created.
        */
        void RegisterVMCreationHandler(std::function< void(HSVM *) > const &func);

        /** Called when a new vm is created. Calls all creation handlers.
            @param vm Newly created VM
        */
        void OnNewVM(HSVM *vm);

        /** Manually invoke a module's entry point (used to set up directly
            linked HareScript modules) */
        void InvokeModuleRegistration(HSVM_ModuleEntryPointPtr entrypoint, void *context_ptr);

        /** Broadcast a message locally
        */
        void BroadcastMessageLocally(std::string const &eventname, uint8_t const *data, size_t datalen);

        void NoHSModUnload();

        bool AllowStdStreamSharing() const
        {
                return allow_std_sharing;
        }
        inline GlobalBlobManager & GetBlobManager() { return blobmanager; }

        friend class JobManager;
};

/*  LibraryLoader is the is the class that contains the code for loading a library
    into a virtual machine. It depends on the linkinglibrarian to get the linked versions.
*/
class LibraryLoader
{
    private:
        typedef std::vector<LibraryId> LibraryIdList;

        /// The library linker that must be used for the retrieving of linked libraries
        Environment &llib;

        /// Error handler to use
        ErrorHandler &errorhandler;

        /// The linked libraries currently directly loaded
        LibraryConstPtrs loaded_libs;

        /// Pointers to the libraries that must still be initialized
        LibraryConstPtrs mustinit;

        /// Number of libraries that have been returned for initialization
        unsigned initcount;

        /// Deferrred initializations (because of calling a function in an as yet uninitialized library, usually hooks)
        LibraryConstPtrs deferred_inits;

    public:
        /** Initializes the LibraryLoader */
        LibraryLoader(Environment &llib, ErrorHandler &errorhandler);

        /** Deinitializes the library loader (discard all loaded libraries) */
        ~LibraryLoader();

        /** Retrieve info about a particular library, from the context of a VM */
        void GetWHLibraryInfo(Blex::ContextKeeper &keeper, std::string const &liburi, LibraryInfo *info);

        /** Retrieve info about all loaded libraries, from the context of a VM */
        void GetLoadedWHLibrariesInfo(Blex::ContextKeeper &keeper, std::vector< LibraryInfo > *info);

        /** Retrieve info about all libraries, from the context of a VM */
        void GetAllWHLibrariesInfo(Blex::ContextKeeper &keeper, std::vector< LibraryInfo > *infos);

        /** Adds an extra library. */
        Library const * LoadWHLibrary(Blex::ContextKeeper &keeper, std::string const &liburi, Library const *current_init_lib);

        /** Returns loaded library by name */
        Library const* GetWHLibrary(std::string const &liburi) const;

        /** Returns loaded library by id */
        Library const* GetWHLibraryById(LibraryId id) const;

        /** Get the next library to initialize. Returns NULL if no more inits
            are necessary */
        Library const * GetNextUninitializedLibrary();

        /** Get the next library to deinitialize. Returns NULL if no more deinits
            are necessary */
        Library const * GetNextInitializedLibrary();

        /** Pop the library to init (the one GetnextUniitalizedLbrary returned) */
        void PopUninitializedLibrary();

        /** Pop the library which we need to de-initialize now.*/
        void PopInitializedLibrary();

        /** Indicate that library initialization was deferred because of calling a hook */
        void PushDeferredInitialization(Library const *lib);

        /** Indicate that library initialization is resumed */
        void PopDeferredInitialization();

        LibraryConstPtrs GetAllLibraries() const { return mustinit; }

        friend class Tests;
};

} // End of namespace HareScript

#endif
