#ifndef blex_parsers_office_word_drawingml
#define blex_parsers_office_word_drawingml

#include <blex/xml.h>
#include <parsers/base/parserinterface.h>
#include "docx.h"

namespace Parsers {
namespace Office {
namespace DrawingML {

extern Blex::XML::Namespace xmlns_drawing_wp;
extern Blex::XML::Namespace xmlns_drawing_main;

void BLEXLIB_PUBLIC RenderDrawingML(Parsers::FormattedOutput &, Blex::XML::Node node, Parsers::Office::OOXML::OOXMLPackageRef const &packageref, Blex::XML::Document const &maindoc);

} // End of namespace VML
} // End of namespace Office
} // End of namespace Parsers

#endif
