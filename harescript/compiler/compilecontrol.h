#ifndef blex_harescript_compiler_compilecontrol
#define blex_harescript_compiler_compilecontrol

#include "compiler.h"
#include "engine.h"

namespace HareScript
{
namespace Compiler
{

/** Not multithread safe  */
class BLEXLIB_PUBLIC CompileControl
{
    public:
        /** Constructor for compilecontrol
            @param engine Engine to use for compilation
            @param filesystem Filesystem to uyse for library retrieval */
        CompileControl(Engine &engine, FileSystem &filesystem)
        : engine(engine)
        , filesystem(filesystem)
        {}

        /** Compiles a libary (and it's recursive loadlibs)
            @param keeper Contextkeeper that keeps the context which this compilation takes place
            @param liburi URI of library to compile */
        void CompileLibrary(Blex::ContextKeeper &keeper, std::string const &liburi);

        /** Compiles a libary (and it's recursive loadlibs) from manually provided source
            @param keeper Contextkeeper that keeps the context which this compilation takes place
            @param source source source of library
            @param liburi URI of library to compile */
        void CompileLibraryFromSource(Blex::ContextKeeper &keeper, std::shared_ptr< Blex::RandomStream > const &source, std::string const &liburi);

        void ReadLibraryLoadLibs(Blex::ContextKeeper &keeper, std::shared_ptr< Blex::RandomStream > const &source, std::string const &liburi, std::vector<LoadlibInfo> &loadlibs);

    private:
        /** Engine that is used for compilation */
        Engine &engine;

        /** Filesystem used for file access */
        FileSystem &filesystem;

        /** Structure describing a library and the context in it was added */
        struct Library
        {
                Library(LoadlibInfo const &llibinfo);

                /// High-level info about the library (name, location of request)
                LoadlibInfo llibinfo;

                /// Indicates whether the loadlibs of this library have been added already
                bool loadlibsdone;

                FilePtr file;
                std::shared_ptr< Blex::RandomStream > source;
                Blex::DateTime sourcetime;
        };

        /** An assignment describes a assignment to compile a single library. Multiple
            assignments can be active at the same time */
        struct Assignment
        {
                /// Context keeper for this assignment
                Blex::ContextKeeper *keeper;

                /// Queue of libraries to compile. Compilation occurs front-to-back
                std::list<Library> queue;

                /// Libraries that have already been checked or recompiled
                std::set<std::string> okcheckcache;

                /// Libraries currently compiling
                std::set<std::string> compiling;
        };

        /** Moves (or adds if not present) a library to the front of the queue (so it
            will be compiled next). Also checks for recursive loading.
            Warning: destroys all iterators to the queue! */
        void AddToQueue(Assignment &assignment, Library const &lib);

        /** Checks the dependencies of the libary in libstream
            @param keeper Contextkeeper with current context
            @param liburi Name of library
            @param libstream Stream with current library
            @return TRUE if all used libraries are locally up to date, and older than maxtime */
        bool CheckDependencies(Assignment &assignment, std::string const &liburi, Blex::RandomStream *libstream, bool showmsgs);

        /** Checks if a library is valid (valid and compiled from current source, used libraries also valid and compiled from current source
            @param keeper Contextkeeper with current context
            @param file File access object
            @param liburi Name of library
            @param show_debug Show debug info
            @return Returns whether library is valid */
        bool CheckLibraryValidity(Assignment &assignment, Library const &library, bool show_debug);

        /** Returns file access object. Throws if none could be supplied (usually when name is malformed or prefix does not support compiled files without source
            @param lib Loadlib info
            @param show_debug Show debug information
            @return File access object */
        FilePtr GetLibraryFile(Assignment &assignment, LoadlibInfo const &lib, bool show_debug);

        /** Returns a file with the source of a library, or throws otherwise
            @param lib Loadlib info
            @param show_debug Show debug information
            @param modtime Filled with modification time stamp of source file
            @return File with source data */
        std::unique_ptr< Blex::RandomStream > GetSource(LoadlibInfo const &lib, FilePtr const &file, Blex::DateTime &modtime, bool show_debug);

        /** Sets the file and location in a message according to the loadlibinfo */
        Message SetMessagePositions(Message const &m, LoadlibInfo const &lib);

        /** Executes a task from the assignment queue (either getting loadlibs, or compiling)
            @param assignment to execute a task from
            @return Returns whether any more items remain. On error, either a throw happens or the engine contains errors */
        bool CompileLibraryIterate(Assignment &assignment);
};

} // End of namespace Compiler
} // End of namespace HareScript

#endif


