#include <ft2build.h>
#include FT_FREETYPE_H

#include "fontmanager.h"

namespace DrawLib
{

struct Font::Data
{
        inline Data()
        : face(0)
        {
        }

        FT_Face                 face;
        std::string             fontfullpath;
        Pixel32                 fontcolor;
        bool                    use_private_area;
        double                   EMSize;
};

}

