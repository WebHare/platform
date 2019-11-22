#ifndef blex_webhare_shared_whfilesystem
#define blex_webhare_shared_whfilesystem

#include "whcore.h"
#include <harescript/vm/filesystem.h>
#include <blex/threads.h>

const unsigned WHFileSystemContextId = 258;

/** Filesystem class that handles file access for libraries for the VM and the
    compiler.

    Multithreading considerations:
    - All context is kept in contextkeepers, so calling exported functions (not constructors/destructors)
      is considered multithread safe.
    - While writing a clib file, it cannot be opened. When trying to access in that period, it will be marked
      not existing for some time (maximally until close-time + refresh interval)  */
class BLEXLIB_PUBLIC WHFileSystem : public HareScript::FileSystem
{
    private:
        class ContextData;
        /** Context data for webhare file system */
        typedef Blex::Context<ContextData, WHFileSystemContextId, WHCore::Connection> Context;

        /// Path for the data root
        std::string const dataroot;

        /// Compile cache directory
        std::string const compilecache;

        /// Compile cache directory
        std::string const dynamicmodulepath;

        /// Priority
        CompilationPriority::Class const priorityclass;

        WHCore::Connection *conn;

        class DirectFile;

        /** Returns a unique file-name for a compiled library, based on an uri and a prefix
            @param prefix Prefix to use
            @param uri Path to library
            @return Unique filename for this prefix and uri */
        std::string GetLibraryCompiledName(Blex::ContextKeeper &keeper, std::string const &prefix, std::string const &uri) const;

        // Returns a direct file object for a give liburi. Also handles caching
        HareScript::FileSystem::FilePtr const &GetDirectFile(Blex::ContextKeeper &keeper, std::string const &liburi) const;

        HareScript::FileSystem::FilePtr const &GetDirectClibFile(Blex::ContextKeeper &keeper, std::string const &liburi) const;

        ///Allow us to directly invoke whcompile
        bool allow_direct_compilations;

        static bool ParseError(const char* start, const char* limit, HareScript::ErrorHandler *handler);

        bool ManualRecompile(std::string const &_liburi, HareScript::ErrorHandler *handler, bool force);

        RecompileResult RecompileInternal(Blex::ContextKeeper &keeper, std::string const &_liburi, bool /*isloadlib*/, CompilationPriority::Class priorityclass, bool allow_manual_recompilation, bool force, HareScript::ErrorHandler *errorhandler);

    public:

        /** Constructs this filesystem
            @param priorityclass Priority class for our compilations */
        WHFileSystem(WHCore::Connection &conn, CompilationPriority::Class priorityclass, bool allow_direct_compilations);

        /** Returns a file object for a file
            @param keeper ContextKeeper with the current context
            @param liburi Uri to the library
            @param isloadlib True if this getlibrary originated from a loadlib
            @return File object. Can be 0 if an error occurred (file doesn't exist), but that is not mandatory! Caller may NOT delete the file object. */
        virtual HareScript::FileSystem::FilePtr OpenLibrary(Blex::ContextKeeper &keeper, std::string const &liburi) const;

        /** Tries to recompile this library (and all dependent libraries, if necessary)
            @param keeper ContextKeeper with the current context
            @param liburi Uri to the library
            @param isloadlib True if this getlibrary originated from a loadlib
            @param preloads List of preloads for this library
            @return TRUE if successful. If compile fails, the errorhandler is given the errors */
        virtual RecompileResult Recompile(Blex::ContextKeeper &keeper, std::string const &_liburi, bool isloadlib,HareScript::ErrorHandler *errorhandler);

        /** Registers context data
            @param reg Registrator to register context with
            @param conn WHCore connection to use */
        void Register(Blex::ContextRegistrator &reg);

        /** Resets the transaction used to access the database, forcing a new transaction to be opened when used again. Further
            operations will see the database state at the time the new transaction was allocated
            @param keeper ContextKeeper with the current context */
        void ReleaseResources(Blex::ContextKeeper &keeper);

        /** Returns the path to a file  */
        std::string ReturnPath(Blex::ContextKeeper &keeper, std::string const &filename);

        virtual std::string GetDynamicModuleFullPath(std::string const &modulename) const;

        virtual void ResolveAbsoluteLibrary(Blex::ContextKeeper &keeper, std::string const &loader, std::string *libname) const;

        // Translates direct:: and fileid:: to module::, site:: stuff.
        virtual std::string TranslateLibraryURI(Blex::ContextKeeper &keeper, std::string const &libname) const;

        /// Recompiles via the publisher
        RecompileResult RecompileExternal(Blex::ContextKeeper &keeper, std::string const &_liburi, bool force,HareScript::ErrorHandler *errorhandler);

        friend class DirectFile;
};

void BLEXLIB_PUBLIC DisplayMessage(WHFileSystem &fsys, Blex::ContextKeeper *keeper, HareScript::Message const &m);
void BLEXLIB_PUBLIC DisplayStackLocation(WHFileSystem &fsys, Blex::ContextKeeper *keeper, HareScript::StackTraceElement const &elt);

//---------------------------------------------------------------------------
#endif // Sentry
