#ifndef blex_webhare_compiler_codelibrarywriter
#define blex_webhare_compiler_codelibrarywriter
//---------------------------------------------------------------------------

#include "il.h"
#include "codeblocklinker.h"
#include "../vm/hsvm_librarywrapper.h"

namespace HareScript
{
namespace Compiler
{

class CodeLibraryWriter
{
        CompilerContext &context;

        IL::Module *module;
        CodeBlockLinker *cblinker;
        CodeRegisterAllocator *callocator;

        std::map<Symbol *, unsigned> addedvars;
        std::map<Symbol *, unsigned> addedfuncs;
        std::map<SymbolDefs::Library *, unsigned> addedlibs;

        signed AddLibrary(HareScript::WrappedLibrary &wrapper, SymbolDefs::Library *library);
        void AddGlobal(HareScript::WrappedLibrary &wrapper, HareScript::Marshaller &marshaller, Symbol *symbol);
        void AddGlobals(HareScript::WrappedLibrary &wrapper, HareScript::Marshaller &marshaller);
        void AddCodedFunctions(HareScript::WrappedLibrary &wrapper, HareScript::Marshaller &marshaller, std::vector<std::string> &columnnames, std::map< unsigned, unsigned > *imapping);
        void AddDebugInfo(HareScript::WrappedLibrary &wrapper, std::map< unsigned, unsigned > *imapping);
        void ProcessTypeInfo(HareScript::WrappedLibrary &wrapper);
        void GatherObjectFields(SymbolDefs::ObjectDef *objdef, std::map< std::string, SymbolDefs::ObjectField * > *fields);
        uint32_t GetColumnIdByNameId(std::vector< std::string > *columnnames, ColumnNameId nameid);

    public:
        CodeLibraryWriter(CompilerContext &context);
        ~CodeLibraryWriter();
        void Execute(IL::Module *_module, CodeBlockLinker *_cblinker, CodeRegisterAllocator *_callocator, std::string const &libname, Blex::DateTime sourcetime, Blex::RandomStream &outlib);
        void PrepareSymbolDef(HareScript::WrappedLibrary &wrapper, SymbolDef *out, Symbol const &in);
};

} // end of namespace Compiler
} // end of namespace HareScript
//---------------------------------------------------------------------------
#endif
