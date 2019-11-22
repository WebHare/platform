#ifndef blex_webhare_compiler_compiler
#define blex_webhare_compiler_compiler

/** General definitions for compiler. Contains
    error reporting mechanisms */

#ifndef COMPILER_PREINCLUDES_DONE
 #include <blex/objectowner.h>
 #include "../vm/errors.h"
 #include "../vm/filesystem.h"
 #include "../vm/hsvm_stackmachine.h"
 #include "../vm/hsvm_columnnamemapper.h"
 #include "../vm/hsvm_marshalling.h"
 #include "blex/logfile.h"
#endif

namespace HareScript
{
namespace Compiler
{
using HareScript::GetTypeName; //BCB workaround
using HareScript::ToNonArray;
using HareScript::ToArray;

enum PrintType
{
        PrintNormal,
        PrintDominator
};
enum PrintSort
{
        PrintIntermediateLanguage,
        PrintCode
};

namespace BinaryOperatorType
{
        enum Types
        {
                OpAnd,
                OpOr,
                OpXor,

                OpAdd,
                OpSubtract,
                OpMultiply,
                OpDivide,
                OpModulo,

                OpLess,
                OpLessEqual,
                OpEqual,
                OpUnEqual,
                OpGreater,
                OpGreaterEqual,
                OpLike,

                OpBitAnd,
                OpBitOr,
                OpBitXor,
                OpBitLShift,
                OpBitRShift,

                OpMerge,
                OpConcat,
                OpIn,

                OpNullCoalesce
        };
        std::string ToSTLStr(BinaryOperatorType::Types t);
//        BinaryOperatorType::Types ConvertFromX(Lexer::Type t);
} // End of namespace BinaryOperator

namespace UnaryOperatorType
{
        enum Types
        {
                OpNot,
                OpNeg,
                OpPlus,
                OpBitNeg,
                OpMakeExisting
        };
        std::string ToSTLStr(UnaryOperatorType::Types t);
//        UnaryOperatorType::Types ConvertFromX(Lexer::Type t);
} // End of namespace UnaryOperator



class SymbolTable;

/** Function callback to resolve a LOADLIB request. Should return a stream that
    the caller will delete, or NULL if the file cannot be opened
    @param 1 Context keeper with current context
    @param 2 Name of library to return
    @param 3 Reference to std::time_t that will be filled with the modtime of the loaded library
    @return Stream with library (NULL if not found */
//typedef std::function<std::unique_ptr<Blex::RandomStream>(Blex::ContextKeeper &, std::string const &, std::time_t &) > LoadlibCallback;

struct BLEXLIB_PUBLIC CompilerContext
{
        CompilerContext();

        // Owning of objects
        Blex::GenericOwner owner;

        // Storing constants
        ColumnNames::GlobalMapper globalcolumnmapper;
        ColumnNames::LocalMapper columnmapper;
        StackMachine stackm;
        std::unique_ptr< Marshaller > marshaller;

        // Errors
        ErrorHandler errorhandler;
        SymbolTable *symboltable;
        Blex::ContextKeeper *keeper;
        std::string currentlibrary;
        //If set to true, don't preload wh::system.whlib
        bool is_system_library;
        FileSystem *filesystem;
        //Preload library for any non-wh:: libraries not using (*ISSYSTEMLIBRARY*)
        std::string nonwhpreload;
//        LoadlibCallback loadlibcallback;

        /** Resets entire context */
        void Reset();
};

/** Per-library information about how to load it - we need the additional info
    so that the compilecontrol can give proper file/line info about failing
    libraries */
struct LoadlibInfo
{
        LoadlibInfo();
        ~LoadlibInfo();

        ///Library to load
        std::string loadlib;
        ///Library requesting this load
        std::string requester;
        ///Location where this load was requested
        Blex::Lexer::LineColumn loc;
};

class CCostream
{
    public:
        Blex::ErrStream errstream;
        CompilerContext &context;

        CCostream(CompilerContext &_context)
        : context(_context)
        {
        }
};

template < class A >
  CCostream & operator<<(CCostream &out, A const &a)
{
        out.errstream << a;
        return out;
}

// Need a specific override for std::endl to force one of the overloads to be matched
inline CCostream & operator<<(CCostream &out, std::ostream& (*f)( std::ostream& ))
{
        out.errstream << f;
        return out;
}

#ifdef DEBUG
  #define CONTEXT_DEBUGPRINT(x) do { ::HareScript::Compiler::CCostream s(context); s << x ; } while (0)
#else
  #define CONTEXT_DEBUGPRINT(x) BLEX_NOOP_STATEMENT
#endif

} // End of namespace Compiler
} // End of namespace HareScript

#endif


