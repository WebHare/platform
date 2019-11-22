#ifndef blex_harescript_compiler_engine
#define blex_harescript_compiler_engine

#include <string>
#include <blex/stream.h>
#include <blex/context.h>
#include "../vm/hsvm_constants.h"
#include "../vm/errors.h"
#include "compiler.h"

namespace HareScript {
namespace Compiler {

class EngineImpl;

/** Debug options for compiler engine */
struct DebugOptions
{
        bool show_timings;
        bool show_files;
        bool show_compilecontrol;

        bool generate_dots;
        std::string dots_dir;

        DebugOptions()
        : show_timings(false), show_files(false), show_compilecontrol(false), generate_dots(false)
        {}
};

/** Compiler engine. Controls and drives the various compilation stages.

    This class is a firewall to avoid exposing/exporting internal classes to the end
    user. We could probably just as well build a C interface,
    by simply supplying Engine classes with an explicit 'this' parameter,
    filtering exceptions and using simpler parameters.
*/
class BLEXLIB_PUBLIC Engine
{
        public:
        ///Create a compiler engine
        Engine(FileSystem &filesystem, std::string const &nonwhpreload);
        ///Destroy compiler engine
        ~Engine();

        /** Sets debug options */
        void SetDebugOptions(DebugOptions const &options);

        /** Returns current debug options */
        DebugOptions const & GetDebugOptions();

        /** Compile
            @param keeper ContextKeeper that keeps the external context for this compile (needed for the filesystem)
            @param library URI to the library that must be compiled */
        void Compile(Blex::ContextKeeper &keeper, std::string const &library, Blex::DateTime source_time, Blex::RandomStream &inlib, Blex::RandomStream &outlib);

        /** Parses the loadlibs from a source file
            @param keeper ContextKeeper that keeps the external context for this compile (needed for the filesystem)
            @param library URI to the library that must be compiled */
        std::vector<LoadlibInfo> GetLoadLibs(Blex::ContextKeeper &keeper, std::string const &library, Blex::RandomStream &inlib);

        ErrorHandler & GetErrorHandler();

        private:
        FileSystem &filesystem;
        EngineImpl *impl;
        std::string const nonwhpreload;

        Engine(Engine const&); //not implemented
        Engine& operator=(Engine const&); //not implemented
};

} //end namespace Compiler
} //end namespace HareScript

#endif //sentry
