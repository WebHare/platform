#include <blex/blexlib.h>

#include "lexer.h"

namespace Blex {
namespace Lexer {

 std::string ParseTokenString(const std::string &srcdata)
{
        //Skip the actual quotes
        if (srcdata.size() < 2
            || srcdata.begin()[0]!=srcdata.end()[-1])
            return std::string();

        std::string retval;
        Blex::DecodeJava(srcdata.begin()+1,srcdata.end()-1,std::back_inserter(retval));
        return retval;
}

} //end namespace Lexer
} //end namespace Blex
