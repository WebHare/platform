#ifndef blex_lexer
#define blex_lexer

#ifndef blex_blexlib
#include "blexlib.h"
#endif
#include <iostream>

namespace Blex {

namespace Lexer {

/** The position of source code in the source code file. Location information
    is essential when reporting errors and warnings */
struct LineColumn
{
        LineColumn(uint32_t line,uint32_t column) : line(line), column(column)
        {
        }

        LineColumn() : line(1), column(1)
        {
        }

        ///1-based line number
        uint32_t line;
        ///1-based column number
        uint32_t column;
};

inline bool operator==(LineColumn const &lhs, LineColumn const &rhs)
{ return lhs.line==rhs.line && lhs.column==rhs.column; }
inline bool operator!=(LineColumn const &lhs, LineColumn const &rhs)
{ return !(lhs==rhs); }
inline bool operator<(LineColumn const &lhs, LineColumn const &rhs)
{ return lhs.line<rhs.line || (lhs.line == rhs.line && lhs.column<rhs.column); }

inline std::ostream &operator<<(std::ostream &out, LineColumn const &rhs) { return out << "(" << rhs.line << ":" << rhs.column << ")"; }

///Return true if the specified character is a valid as a Harescript keywords start
inline bool ValidKeywordStart(char c)
{
        return ((c&0xdf)>='A' && (c&0xdf)<='Z') || c=='_';
}
///REturnt rue if the sepcified character is valid as  a Harescript keywords character
inline bool ValidKeywordChar(char c)
{
        return ValidKeywordStart(c) || (c>='0' && c<='9');
}

/** Fill a string class by decoding a constant string token (JavaDecode)
    @param source String to parse, still surrounded by its qutoes
    @return Decoded string */
std::string BLEXLIB_PUBLIC ParseTokenString(const std::string &srcdata);

} //end namespace Lexer
} //end namespace Blex

#endif
