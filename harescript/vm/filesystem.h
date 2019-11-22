#ifndef blex_harescript_vm_filesystem
#define blex_harescript_vm_filesystem

#include <blex/context.h>
#include <blex/stream.h>
#include "errors.h"

namespace HareScript
{

/** Is the specified path an acceptable loadlib path (no .. tricks etc) */
bool BLEXLIB_PUBLIC IsValidFilesystemPath(std::string const &path);

/** Filesystem class that handles file access for libraries for the VM and the
    compiler.

    File objects that are given out are owned by the filesystem, and _can_ be
    destroyed when the context in which they were given out is destroyed.

    When inheriting, make SURE to keep ownership of all file objects!

    Multithreading considerations:
    - All context is kept in contextkeepers, so calling exported functions (not constructors/destructors)
      is considered multithread safe.
    - While writing a clib file, it cannot be opened. When trying to access in that period, it will be marked
      not existing for some time (maximally until close-time + refresh interval)  */
class BLEXLIB_PUBLIC FileSystem
{
    protected:
        std::string tempdir;
        std::string whresdir;

    public:
        enum RecompileResult
        {
                RecompileSuccess,
                RecompileError,
                RecompileNotSupported
        };

        /** Class that provides access to a specific file. The FileSystem is
            owner of all filesystem objects. */
        class File
        {
            protected:
                /// Protected constructor, so this object cannot be instantiated directly. The pure functions would help there, too.
                File();
            public:
                /// Virtual destructor, for polymorphic deletinh
                virtual ~File();

                /** Get the modification time of the source.
                    @returns Modification time stamp of source file, Blex::DateTime::Invalid() if the source file does not exist */
                virtual Blex::DateTime GetSourceModTime() = 0;

                /** Returns a stream with the source file, together with the modification time stamp of that file
                    @param str Filled with stream if the file exists and can be opened, NULL otherwise
                    @param modtime Modification time stamp of the source file, DateTime::Invalid if it didn't exist */
                virtual void GetSourceData(std::unique_ptr< Blex::RandomStream > *str, Blex::DateTime *modtime) = 0;

                /** Returns a stream with the compiled library file, together with the modification time stamp of that file
                    @param str Filled with stream if the file exists and can be opened, NULL otherwise
                    @param modtime Modification time stamp of the source file, DateTime::Invalid if it didn't exist */
                virtual void GetClibData(std::unique_ptr< Blex::RandomStream > *str, Blex::DateTime *modtime) = 0;

                /** Returns the path of the clib file */
                virtual std::string GetClibPath() = 0;

                /// Removes the compiled library file
                virtual void RemoveClib() = 0;

                /** Creates the compiled library file
                    @param str Stream containing the contents of the new clib file
                    @param TRUE if successfull (FALSE if could not open file) */
                virtual bool CreateClib(Blex::RandomStream &str) = 0;

                /** Return a description for this file
                */
                virtual std::string GetDescription() = 0;
        };

        typedef std::shared_ptr<File> FilePtr;

        FileSystem(std::string const &tempdir, std::string const &whresdir);

        virtual ~FileSystem();

        /** Register a library with a context registrator. This function is called
            by the HareScript Externals (LinkingLibrarian / Environment) as soon
            as a filesystem is passed to it. The default implementation doesn't
            register anything */
        virtual void Register(Blex::ContextRegistrator &creg);

        /** Locates and returns a library
            @param keeper ContextKeeper where information can be stored
            @param liburi Name of the library
            @return Returns a file object (or !optionally! NULL if not found). Caller may NOT delete the file object */
        virtual FilePtr OpenLibrary(Blex::ContextKeeper &keeper, std::string const &liburi) const = 0;

        /** Tries to recompile this library (and all dependent libraries, if necessary). If not overridden,
            it will return NotSupported
            @param keeper ContextKeeper with the current context
            @param liburi Uri to the library
            @param isloadlib True if this getlibrary originated from a loadlib
            @param preloads List of preloads for this library
            @return TRUE if successful, NotSupported if recompile is not supported. If compile fails, the errorhandler is given the errors */
        virtual RecompileResult Recompile(Blex::ContextKeeper &keeper, std::string const &_liburi, bool isloadlib, HareScript::ErrorHandler *errorhandler);

        /** Returns the path to a dynamic loaded module, based on it's name
            @param keeper ContextKeeper with the current context
            @param modulename Name of the module
            @return Direct path to module (including filename) */
        virtual std::string GetDynamicModuleFullPath(std::string const &modulename) const = 0;

        /** Resolve possible relative name to absolute URI
            @param keeper ContextKeeper where information can be stored
            @param loader Library loading this file
            @param libname Library to resolve */
        virtual void ResolveAbsoluteLibrary(Blex::ContextKeeper &keeper, std::string const &loader, std::string *libname) const;

        // Translates direct:: and fileid:: to module::, site:: stuff.
        virtual std::string TranslateLibraryURI(Blex::ContextKeeper &keeper, std::string const &libname) const = 0;

        /** Returns the directory for temporary files (ADDME: It would probably be 'cleaner' to offer
            a 'CreateTempStream' or something like that, instead of forcing a disk filesystem dependency) */
        std::string const & GetTempDir() const
        {
                return tempdir;
        }

        /** Returns the directory for harescript resource files  */
        std::string const & GetWHResDir() const
        {
                return whresdir;
        }

        /** Signals that loading of libraries has probably finished, and that resources for accessing files
            may be released. Though, there may still be accesses after this, due to hooks */
        virtual void ReleaseResources(Blex::ContextKeeper &keeper);
};

typedef FileSystem::FilePtr FilePtr;


} // End of namespace HareScript

#endif // Sentry
