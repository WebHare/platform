#ifndef blex_harescript_compiler_diskfilesystem
#define blex_harescript_compiler_diskfilesystem

#include <blex/getopt.h>
#include <harescript/vm/filesystem.h>
#include "compilecontrol.h"

namespace HareScript
{

/* A diskfilesystem allows us to manually configure where all the namespaces are */
class BLEXLIB_PUBLIC DiskFileSystem : public FileSystem
{
        struct Data;
        typedef Blex::Context<Data, 6, void> Context; //registered in 'Bestaande WebHare modules.doc'

        class DiskFile : public FileSystem::File
        {
                std::string path;
                std::string cpath;
                bool never_recompile;

                virtual Blex::DateTime GetSourceModTime();
                virtual void GetSourceData(std::unique_ptr< Blex::RandomStream > *str, Blex::DateTime *modtime);
                virtual void GetClibData(std::unique_ptr< Blex::RandomStream > *str, Blex::DateTime *modtime);
                virtual std::string GetClibPath();
                virtual void RemoveClib();
                virtual bool CreateClib(Blex::RandomStream &str);
                virtual std::string GetDescription();

                friend class DiskFileSystem;
        };

        void SetupCompiledName(DiskFile *file, std::string const &uri) const;

        typedef std::map<std::string, std::string> NamespaceMap;
        NamespaceMap namespaces;
        std::string compilecache;
        std::string dynamicmodulepath;
        std::string precompilecache;
        unsigned lockwaitsecs;

    public:
        /** Initialize a disk file system, allowing us to manually configure namespaces.
            Note that the 'direct' namespace is always present, is not allowed for loadlibs
            and allows direct disk access
            @param _tempdir Directory for temporary file (use a per-user or per-process temp file where possible to prevent security problems)
            @param _compilecache Directory to store compiled files
            @param _precompilecache Directory where precompiled files are stored
            @param _hsresdir HareScript resources directory */
        DiskFileSystem(std::string const &_compilecache,std::string const &_tempdir, std::string const &_precompilecache, std::string const &_hsresdir);
        DiskFileSystem(Blex::OptionParser const &options);
        ~DiskFileSystem();

        Compiler::Engine compile_engine;
        Compiler::CompileControl control;

        /** Setup a namespace. The namespace will be alllowed for loadlibs
            @param prefix Prefix for this namespace (eg 'wh')
            @param location Location for this namespace (eg 'q:/harescript').
                    Leave empty to make a path global (like "direct::", but it will allow loadlibs) */
        void SetupNamespace(std::string const &prefix, std::string const &location);

        /** Setup the directory for dynamic loaded modules
            @param location Path where dynamic loaded modules can be found (default: '.') */
        void SetupDynamicModulePath(std::string const &location);

        // Registers the context of the test file system in this registrator
        virtual void Register(Blex::ContextRegistrator &creg);

        virtual FilePtr OpenLibrary(Blex::ContextKeeper &keeper, std::string const &liburi) const;

        virtual std::string GetDynamicModuleFullPath(std::string const &modulename) const;

        virtual std::string TranslateLibraryURI(Blex::ContextKeeper &keeper, std::string const &directuri) const;


        RecompileResult Recompile(Blex::ContextKeeper &keeper, std::string const &_liburi, bool isloadlib, HareScript::ErrorHandler *errorhandler);

        std::string ResolveLibraryName(std::string const &liburi) const;
};

} // End of namespace HareScript

#endif // Sentry

