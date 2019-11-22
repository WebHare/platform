#ifndef blex_webhare_hare_output_html_render
#define blex_webhare_hare_output_html_render

#include "writer.h"

namespace Parsers {
namespace Formats {
namespace XML {

void EncodePaddingStyle(std::string &str, Parsers::Distance const &basepadding, Parsers::Distance const &newpadding);

/** Tagrendering encapsulates HTML / XHTML tag rendering. It will cache tags,
    and flush its tag buffer after a call to FlushTags */
class TagRendering
{
        public:
        TagRendering (HSVM *template_vm, int32_t outputfile, StandardLevels lvl, bool strictcompliance);

        void FlushTags();

        /** Create a 'open table' tag <TABLE>
            @param border Requested border thickness
            @param cellspacing Requested cell spacing
            @param width (negative: percentage, 0: unspecified, positive: pixels) */
        void OpenTable(unsigned border, unsigned cellspacing, int width, unsigned celpladding, bool bordercollapse, Parsers::HorizontalAlignment halign);

        /** Create a 'open table row' tag <TR> */
        void OpenTr();

        /** Create open/close TD to span a few rows */
        void ColspanTd(unsigned colspan, int width, Wrappings wrap,
                                Parsers::Table::BorderType top, Parsers::Table::BorderType right,
                                Parsers::Table::BorderType bottom, Parsers::Table::BorderType left);

        void OpenTd(unsigned height, int width,
                             unsigned colspan, unsigned rowspan,
                             bool transparent_bg, DrawLib::Pixel32 bgcolor,
                             Parsers::Table::BorderType top, Parsers::Table::BorderType right,
                             Parsers::Table::BorderType bottom, Parsers::Table::BorderType left,
                             bool set_valign, Parsers::VerticalAlignment valign,
                             Wrappings wrap, bool tableheader, Parsers::Distance const &cellpadding);

        void CloseTd(bool tableheader);
        void CloseTr();
        void CloseTable();

        void SoftCr();

        void Indent(signed change);

        ///Tag temporary output stream (FIXME: should be private)
        std::string tags;

        void RawWrite(unsigned size,const void* bytes);

        private:

        HSVM *template_vm;

        int32_t outputfile;

        ///Current indent size
        unsigned indentsize;

        ///The cursor position in the output file
        unsigned output_curpos;

        ///Standard level
        StandardLevels lvl;
        ///Standard compliance level
        bool strictcompliance;
};

} //end namespace XML
} //end namespace Formats
} //end namespace Parsers

#endif
