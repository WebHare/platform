#ifndef blex_webhare_harescript_parser_parser_tools
#define blex_webhare_harescript_parser_parser_tools

#include "parser.h"

//Debugging options
//#define PARSERDEBUGGING         //Debug parse rule invokations

#ifdef PARSERDEBUGGING
#define PARSERULE(x) DEBUGPRINT("Applying rule: "<<x<<std::endl<<"Lookahead: "<< LexerLookahead()<<std::endl)
//#define PARSERULE(x) DEBUGPRINT("Applying rule: "<<x<<std::endl)
#else
#define PARSERULE(x)
#endif

namespace HareScript
{
namespace Compiler
{

} // End of namespace Compiler
} // End of namespace HareScript

#endif // Sentry


