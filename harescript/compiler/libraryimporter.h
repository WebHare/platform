//---------------------------------------------------------------------------
#ifndef blex_webhare_compiler_libraryimporter
#define blex_webhare_compiler_libraryimporter
//---------------------------------------------------------------------------

#include "compiler.h"
#include "../vm/hsvm_librarywrapper.h"
#include "astcoder.h"

namespace HareScript
{
namespace Compiler
{

/** The libraryimporter loads the symbols of wh-libraries into the symbol table */
class LibraryImporter
{
        template <class A> A* Adopt(A* a) { context.owner.Adopt(a); return a; }
        CompilerContext &context;

        Marshaller marshaller;

        std::vector< ColumnNameId > columnnamelist;

        /** @param clib_id The id of the library
            @param source_time The expected source time, as recorded by the filesystem
        */
        SymbolDefs::Library * AddLibrary(std::string const &libname, LineColumn position, bool ispreload, bool indirect, Blex::DateTime clib_id, Blex::DateTime source_time, AST::Module *mdl);

        /// Read a single function
        Symbol* ReadFunctionSymbol(LineColumn position, WrappedLibrary const &lib, FunctionDef const &src, AstCoder *coder);

        /// Read a single argument for a function
        SymbolDefs::FunctionDef::Argument ReadFunctionArgument(LineColumn position, WrappedLibrary const &lib, FunctionDef::Parameter const &src, AstCoder *coder);

        void ReadSymbolDef(Symbol *outsymbol, SymbolDef const &insymbol, WrappedLibrary const &lib, AstCoder *coder);

        Symbol* ReadObjectSymbol(LineColumn position, WrappedLibrary const &lib, ObjectTypeDef const &src, AstCoder *coder, std::map< unsigned, Symbol * > &function_mapping);
    public:
        SymbolDefs::Library* library;
        LibraryImporter(CompilerContext &context) : context(context), marshaller(context.stackm, MarshalMode::SimpleOnly) {}

        /** @param clibtime The expected clib time, as recorded by the filesystem
        */
        void Execute(LineColumn position, Blex::Stream &library, std::string const &liburi, Blex::DateTime clibtime, AstCoder *coder, bool ispreload);
};

} // end of namespace Compiler
} // end of namespace HareScript

//---------------------------------------------------------------------------
#endif
