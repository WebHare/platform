#ifndef blex_webhare_shared_publisher_wordstyles
#define blex_webhare_shared_publisher_wordstyles

#include <blex/blexlib.h>

namespace Parsers {
namespace Office {
namespace Word {
namespace Styles {

        /** Microsoft word pre-defined styles */
        struct Style
        {
                const char *name;
                signed wordid;
                signed toclevel;
        };

        /** Iterator over Microsoft word pre-defined styles */
        typedef Style const * Iterator;

        /** Get the first pre-defined style */
        Iterator Begin();
        /** Get the past-the-end pre-defined style */
        Iterator End();
        /** Find a style by its MS id
            @param wordid Word ID to look up
            @return Iterator to the style, or End() if the style was not found */
        Iterator Find(signed wordid);
        /** Find a style by its name
            @param wordid Word ID to look up
            @return Iterator to the style, or End() if the style was not found */
        Iterator Find(std::string const &name);

} //end namespace Styles
} // End of namespace Word
} // End of namespace Office
} // End of namespace Parsers



#endif
