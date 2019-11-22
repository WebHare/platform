#ifndef blex_parsers_office_msword_docx_parse
#define blex_parsers_office_msword_docx_parse

#include <blex/xml.h>
#include <parsers/base/formatter.h>
#include "word_base.h"
#include "docx_parse.h"

namespace Parsers {
namespace Office {
namespace Word {
namespace DocX {

std::string GetAttr(Blex::XML::Node node, const char *attrname);
int32_t GetS32Attr(Blex::XML::Node node, const char *attrname);
int32_t GetS32HexAttr(Blex::XML::Node node, const char *attrname);
int32_t GetOnOffAttr(Blex::XML::Node node, const char *attrname, bool defaultvalue);
Word::Brc ParseDocXBorder(Blex::XML::Node tablenode);
DrawLib::Pixel32 ParseShading(Blex::XML::Node newnode); //pg 1800: 2.18.85.
std::string GetST_Lang(Blex::XML::Node node, const char *attrname); // 2.18.51
Parsers::HorizontalAlignment GetST_Jc(Blex::XML::Node node, const char *attrname); //2.18.50
DrawLib::Pixel32 GetST_HexColor(Blex::XML::Node node, const char *attrname); //2.18.43
DrawLib::Pixel32 GetST_HighlightColor(Blex::XML::Node node, const char *attrname); //pp 1738: 2.18.46
void ParseDocXMargins(Blex::XML::Node marginnode, Parsers::Distance *distance);
unsigned GetST_NumberFormat(Blex::XML::Node node, const char *attrname); //2.18.66. pg 1771

} // End of namespace DocX
} // End of namespace Word
} // End of namespace Office
} // End of namespace Parsers

#endif
