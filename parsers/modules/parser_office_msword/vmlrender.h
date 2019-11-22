#ifndef blex_parsers_office_word_vmlrender
#define blex_parsers_office_word_vmlrender

#include <blex/xml.h>
#include <parsers/base/parserinterface.h>
#include "docx.h" //ADDME we so far only need OOXML Generic stuff though

namespace Parsers {
namespace Office {
namespace VML {

extern Blex::XML::Namespace xmlns_vml;

void RenderVMLPicture(Parsers::FormattedOutput &, Blex::XML::Node node, Parsers::Office::OOXML::OOXMLPackageRef const &packageref);

} // End of namespace VML
} // End of namespace Office
} // End of namespace Parsers

#endif
