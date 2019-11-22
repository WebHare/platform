#ifndef blex_parsers_base_xmlformats
#define blex_parsers_base_xmlformats

#include "formatter.h"

namespace Parsers {

inline int TwipsToPoints100(int twips)
{
        return twips*5;
}

void BLEXLIB_PUBLIC EncodePoints100(std::string &str, int val);
void BLEXLIB_PUBLIC EncodeNumberAttribute(std::string &str, const char *attrname, int32_t val);
void BLEXLIB_PUBLIC EncodePercentageAttribute(std::string &str, const char *attrname, int32_t val);
void BLEXLIB_PUBLIC EncodeColorAttribute(std::string &str, const char *attrname, DrawLib::Pixel32 color);
void BLEXLIB_PUBLIC EncodeValueAttribute(std::string &str, const char *attrname, std::string const &invalue);
void BLEXLIB_PUBLIC EncodeNumber(std::string &str, int32_t val);
void BLEXLIB_PUBLIC CreateHTMLColor(std::string &str, DrawLib::Pixel32 color);
void BLEXLIB_PUBLIC EncodePercentageStyle(std::string &str, const char *attrname, int32_t val);
void BLEXLIB_PUBLIC EncodePixelsStyle(std::string &str, const char *attrname, int32_t val);
void BLEXLIB_PUBLIC EncodePoints100Style(std::string &str, const char *attrname, int val);
void BLEXLIB_PUBLIC EncodeColorStyle(std::string &str, const char *attrname, DrawLib::Pixel32 color);
void BLEXLIB_PUBLIC EncodeValueStyle(std::string &str, const char *attrname, std::string const &invalue);

} //end namespace parsers

#endif
