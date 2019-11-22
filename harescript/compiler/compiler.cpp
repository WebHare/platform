//---------------------------------------------------------------------------
#include <harescript/compiler/allincludes.h>

//---------------------------------------------------------------------------

#include "compiler.h"
#include "symboltable.h"

namespace HareScript
{
namespace Compiler
{

std::string BinaryOperatorType::ToSTLStr(BinaryOperatorType::Types t)
{
        switch (t)
        {
        case BinaryOperatorType::OpAnd:             return "AND";
        case BinaryOperatorType::OpOr:              return "OR";
        case BinaryOperatorType::OpXor:             return "XOR";

        case BinaryOperatorType::OpAdd:             return "+";
        case BinaryOperatorType::OpSubtract:        return "-";
        case BinaryOperatorType::OpMultiply:        return "*";
        case BinaryOperatorType::OpDivide:          return "/";
        case BinaryOperatorType::OpModulo:          return "%";

        case BinaryOperatorType::OpLess:            return "<";
        case BinaryOperatorType::OpLessEqual:       return "<=";
        case BinaryOperatorType::OpEqual:           return "=";
        case BinaryOperatorType::OpUnEqual:         return "!=";
        case BinaryOperatorType::OpGreater:         return ">";
        case BinaryOperatorType::OpGreaterEqual:    return ">=";

        case BinaryOperatorType::OpBitAnd:          return "BITAND";
        case BinaryOperatorType::OpBitOr:           return "BITOR";
        case BinaryOperatorType::OpBitXor:          return "BITXOR";
        case BinaryOperatorType::OpBitLShift:       return "BITLSHIFT";
        case BinaryOperatorType::OpBitRShift:       return "BITRSHIFT";

        case BinaryOperatorType::OpMerge:           return "||";
        case BinaryOperatorType::OpConcat:          return "CONCAT";
        case BinaryOperatorType::OpLike:            return "LIKE";
        case BinaryOperatorType::OpIn:              return "IN";

        case BinaryOperatorType::OpNullCoalesce:    return "??";
        }
        return "";
}

std::string UnaryOperatorType::ToSTLStr(UnaryOperatorType::Types t)
{
        switch (t)
        {
        case UnaryOperatorType::OpNot:          return "NOT";
        case UnaryOperatorType::OpNeg:          return "NEG";
        case UnaryOperatorType::OpBitNeg:       return "BITNEG";
        case UnaryOperatorType::OpPlus:         return "PLUS";
        case UnaryOperatorType::OpMakeExisting: return "MAKEEXISTING";
        }
        return "";
}

CompilerContext::CompilerContext()
: columnmapper(globalcolumnmapper)
, stackm(columnmapper)
{
}

void CompilerContext::Reset()
{
        errorhandler.Reset();
        // The symboltable allocs new objects on reset, so we have the clear the owner first
        owner.Clear();
        symboltable->Reset();
        is_system_library = false;
        nonwhpreload.clear();
}

LoadlibInfo::LoadlibInfo()
{
}

LoadlibInfo::~LoadlibInfo()
{
}

} // End of namespace Compiler
} // End of namespace HareScript



