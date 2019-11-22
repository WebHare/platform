#include <ap/libwebhare/allincludes.h>


#include "rendering.h"
#include <parsers/base/xmlformats.h>

namespace Parsers {
namespace Formats {
namespace XML {

using namespace Parsers;


/** Render distances as efficient as possible (Eg, padding, margin, take advantage of left-right top-bottom optimizations) */
void HTML_Distance(std::string &str, Parsers::Distance const &distance)
{
        //Convert to points first, rounding may give a bigger chance of a valid optimization
        int left=TwipsToPoints100(distance.left);
        int right=TwipsToPoints100(distance.right);
        int bottom=TwipsToPoints100(distance.bottom);
        int top=TwipsToPoints100(distance.top);

        if (left!=right)
        {
                //Cannot combine anything
                EncodePoints100(str,top);
                str+=' ';
                EncodePoints100(str,right);
                str+=' ';
                EncodePoints100(str,bottom);
                str+=' ';
                EncodePoints100(str,left);
        }
        else if (top!=bottom) //left right equal,only top & bottom differ
        {
                EncodePoints100(str,top);
                str+=' ';
                EncodePoints100(str,right);
                str+=' ';
                EncodePoints100(str,bottom);
        }
        else if (top!=right) //left right equal, top bottom equal, width en height differ
        {
                EncodePoints100(str,top);
                str+=' ';
                EncodePoints100(str,right);
        }
        else //all margins equal
        {
                EncodePoints100(str,top);
        }
}

void EncodePaddingStyle(std::string &str, Parsers::Distance const &basepadding, Parsers::Distance const &newpadding)
{
        if (basepadding.top == newpadding.top
            && basepadding.right == newpadding.right
            && basepadding.bottom == newpadding.bottom
            && basepadding.left== newpadding.left)
                return; //nothing changed

        std::string full_set_version = "padding:";
        HTML_Distance(full_set_version, newpadding);
        full_set_version +=";";
        str+=full_set_version;

}

void EncodeBorderStyle(std::string &str, const char *border, Parsers::Table::BorderType const &style)
{
        str += border;
        str += ":";
        if (style.thickness_twips == 0)
        {
                str += "0;";
                return;
        }

        int32_t borderwidth = TwipsToPixels(style.thickness_twips);
        if (borderwidth == 0)
          borderwidth = 1;
        EncodeNumber(str, borderwidth);
        str += "px solid";
        if (!style.color.IsFullyTransparent())
        {
                str += " ";
                CreateHTMLColor(str,style.color);
        }
        str+=";";
}


TagRendering::TagRendering (HSVM *template_vm, int32_t outputfile, StandardLevels lvl, bool strictcompliance)
: template_vm(template_vm)
, outputfile(outputfile)
, lvl(lvl)
, strictcompliance(strictcompliance)
{
        output_curpos=0;
        indentsize=0;
}

void TagRendering::FlushTags()
{
        RawWrite(tags.size(), &tags[0]);
        tags.clear();
}

void TagRendering::RawWrite(unsigned size,const void* bytes)
{
        HSVM_PrintTo(template_vm, outputfile, size, bytes);
}

//FIXME: What units are these values in?!
void TagRendering::OpenTable(unsigned border, unsigned cellspacing, int width, unsigned cellpadding, bool bordercollapse, Parsers::HorizontalAlignment halign)
{
        Indent(+1);

        tags += "<table";
        EncodeNumberAttribute(tags,"cellspacing",cellspacing);
        EncodeNumberAttribute(tags,"cellpadding",cellpadding);

        std::string style;
        if (bordercollapse && lvl >= HTML4)
            style += "border-collapse:collapse;";

        if(halign != Parsers::Left && lvl >= HTML4)
            style += (halign == Parsers::Right ? "margin: 0 0 0 auto;" : "margin: 0 auto;");

        if (strictcompliance && lvl >= HTML4)
            EncodePixelsStyle(style,"border",border);
        else
            EncodeNumberAttribute(tags,"border",border);

        if (width < 0)
        {
              if (strictcompliance)
                  EncodePercentageStyle(style, "width", -width);
              else
                  EncodePercentageAttribute(tags, "width", -width);
        }

        if (width > 0)
        {
              if (strictcompliance)
                  EncodePixelsStyle(style, "width", width);
              else
                  EncodeNumberAttribute(tags, "width", width);
        }

        if (!style.empty())
           EncodeValueAttribute(tags,"style",style);

        tags += ">";
}

void TagRendering::OpenTr()
{
        Indent(+1);
        tags += "<tr>";
}

void TagRendering::OpenTd(unsigned height, int width, unsigned colspan, unsigned rowspan,
                 bool transparent_bg, DrawLib::Pixel32 bgcolor,
                 Parsers::Table::BorderType top, Parsers::Table::BorderType right,
                 Parsers::Table::BorderType bottom, Parsers::Table::BorderType left,
                 bool set_valign, Parsers::VerticalAlignment valign,
                 Wrappings wrap,
                 bool tableheader,
                 Parsers::Distance const &cellpadding)
{
        Indent(+1);
        tags += (tableheader ? "<th" : "<td");

        //Browser workaround: All browsers except Opera will not compress a NOWRAP tablecell. Opera requires a 'width: 1;' to do it.

        //Should we open a style= tag?
        std::string styleinfo;

        if (width < 0)
        {
                if (strictcompliance)
                    EncodePercentageStyle(styleinfo, "width", -width);
                else
                    EncodePercentageAttribute(tags, "width", -width);
        }

        if (width > 0)
        {
              if (strictcompliance)
                  EncodePixelsStyle(styleinfo, "width", width);
              else
                  EncodeNumberAttribute(tags, "width", width);
        }

        if (height)
        {
              if (strictcompliance)
                  EncodePixelsStyle(styleinfo, "height", height);
              else
                  EncodeNumberAttribute(tags, "height", height);
        }

        if (wrap == Nowrap)
        {
                if (strictcompliance)
                    styleinfo += "white-space:nowrap;";
                else if (lvl==XHTML)
                    tags += " nowrap=\"nowrap\"";
                else
                    tags += " nowrap";

                if(width>0)
                    EncodePixelsStyle(styleinfo, "min-width", width);
        }

        if (!transparent_bg) //ADDME: Just support drawlib style border transparancy
        {
              if (strictcompliance)
                  EncodeColorStyle(styleinfo, "background-color", bgcolor);
              else
                  EncodeColorAttribute(tags, "bgcolor", bgcolor);
        }

        //Compress borders if all 4 sides are the same
        if (top==bottom && top==right && top==left && top.thickness_twips > 0)
        {
                EncodeBorderStyle(styleinfo, "border", top);
        }
        else
        {
                if (top.thickness_twips > 0 && !top.overlapped)
                    EncodeBorderStyle(styleinfo, "border-top", top);

                if (right.thickness_twips > 0 && !right.overlapped)
                    EncodeBorderStyle(styleinfo, "border-right", right);

                if (bottom.thickness_twips > 0 && !bottom.overlapped)
                    EncodeBorderStyle(styleinfo, "border-bottom", bottom);

                if (left.thickness_twips > 0 && !left.overlapped)
                    EncodeBorderStyle(styleinfo, "border-left", left);
        }

        if (lvl >= HTML4)
            EncodePaddingStyle(styleinfo, Parsers::Distance(), cellpadding);

        if (colspan>1)
            EncodeNumberAttribute(tags, "colspan", colspan);
        if (rowspan>1)
            EncodeNumberAttribute(tags, "rowspan", rowspan);

        if (set_valign)
        {
                switch (valign)
                {
                case Parsers::Top:
                        tags += " valign=\"top\"";
                        break;
                case Parsers::Middle:
                        tags += " valign=\"middle\"";
                        break;
                case Parsers::Bottom:
                        tags += " valign=\"bottom\"";
                        break;
                }
        }

        if (!styleinfo.empty())
            tags += " style=\"" + styleinfo + "\"";

        tags += '>';
}

void TagRendering::CloseTd(bool tableheader)
{
        tags += (tableheader ? "</th>" : "</td>");
        --indentsize; //we don't want an empty line...
}

void TagRendering::CloseTr()
{
        Indent(-1);
        tags += "</tr>";
}

void TagRendering::CloseTable()
{
        Indent(-1);
        tags += "</table>";
}

void TagRendering::ColspanTd(unsigned colspan, int width, Wrappings wrap,
                 Parsers::Table::BorderType top, Parsers::Table::BorderType right,
                 Parsers::Table::BorderType bottom, Parsers::Table::BorderType left)
{
        OpenTd(0,width,colspan,1,true,DrawLib::Pixel32(),top,right,bottom,left,false,Parsers::VerticalAlignment(),wrap,false,Parsers::Distance());
        CloseTd(false);
}

void TagRendering::Indent(signed change)
{
        output_curpos=0;

        tags+='\n';

        if (change<0 && (signed)indentsize>=-change)
            indentsize+=change;
        for (unsigned i=0;i<indentsize;++i)
            tags+=' ';
        if (change>0)
            indentsize+=change;
}

void TagRendering::SoftCr()
{
        if (lvl == XHTML)
            tags += "<br />";
        else
            tags += "<br>";
}

} //end namespace XML
} //end namespace Formats
} //end namespace Parsers
