#include <ap/libwebhare/allincludes.h>


#include <blex/zstream.h>
#include "docx_parse.h"

namespace Parsers {
namespace Office {
namespace Word {
namespace DocX {

Blex::XML::Namespace xmlns_wordml("w","http://schemas.openxmlformats.org/wordprocessingml/2006/main");

std::string GetAttr(Blex::XML::Node node, const char *attrname)
{
        return node.GetAttr(&xmlns_wordml, attrname);
}

int32_t GetOnOffAttr(Blex::XML::Node node, const char *attrname, bool defaultvalue)
{
        std::string in = node.GetAttr(&xmlns_wordml, attrname);
        if(in.empty())
           return defaultvalue;
        return in=="on" || in=="1" || in=="true";
}

int32_t GetS32Attr(Blex::XML::Node node, const char *attrname)
{
        std::string after = node.GetAttr(&xmlns_wordml, attrname);
        return Blex::DecodeSignedNumber<int32_t>(after.begin(), after.end(), 10).first;
}
int32_t GetS32HexAttr(Blex::XML::Node node, const char *attrname)
{
        std::string after = node.GetAttr(&xmlns_wordml, attrname);
        uint32_t decval = Blex::DecodeUnsignedNumber<uint32_t>(after.begin(), after.end(), 16).first;
        return decval;
}

Brc::BorderTypeCode GetST_Border(Blex::XML::Node node, const char *attrname) //pg1631  2.18.4: ST_Border
{
        //Missing?    None  DashLargeGap Hairline

        std::string border = GetAttr(node, attrname);
        if(border=="thick")
            return Brc::Single;
        else if(border=="thickThinLargeGap")
             return Brc::ThickThinLargeGap;
        else if(border=="thickThinMediumGap")
             return Brc::ThickThinMediumGap;
        else if(border=="thickThinSmallGap")
             return Brc::ThickThinSmallGap;
        else if(border=="thinThickLargeGap")
             return Brc::ThinThickLargeGap;
        else if(border=="thinThickMediumGap")
             return Brc::ThinThickMediumGap;
        else if(border=="thinThickSmallGap")
             return Brc::ThinThickSmallGap;
        else if(border=="thinThickThinLargeGap")
             return Brc::ThinThickThinLargeGap;
        else if(border=="thinThickThinMediumGap")
             return Brc::ThinThickThinMediumGap;
        else if(border=="thinThickThinSmallGap")
             return Brc::ThinThickThinSmallGap;
        else if(border=="threeDEmboss")
             return Brc::Emboss3D;
        else if(border=="threeDEngrave")
             return Brc::Engrave3D;
        else if(border=="triple")
             return Brc::Triple;
        else if(border=="wave")
             return Brc::Wave;
        else if(border=="double")
             return Brc::Double;
        else if(border=="dotDash")
             return Brc::DotDash;
        else if(border=="dotted")
             return Brc::Dot;
        else if(border=="dotDotDash")
             return Brc::DotDotDash;
        else if(border=="dashSmallGap")
             return Brc::DashSmallGap;
        else if(border=="dashDotStroked")
             return Brc::DashDotStroked;
        else if(border=="doubleWave")
             return Brc::DoubleWave;

        return Brc::Single;
}

unsigned GetST_NumberFormat(Blex::XML::Node node, const char *attrname) //2.18.66. pg 1771
{
        //ADDME: DocX spec defines more than us
        std::string nfc = GetAttr(node, attrname);
        if(nfc == "upperRoman")
            return 1;
        if(nfc == "lowerRoman")
            return 2;
        if(nfc == "upperLetter")
            return 3;
        if(nfc == "lowerLetter")
            return 4;
        if(nfc == "ordinal")
            return 5;
        if(nfc == "decimalZero")
            return 22;
        if(nfc == "decimal")
            return 0;
        DEBUGPRINT("Unsupported numbering format [" << attrname << "]");
        return 0;
}

DrawLib::Pixel32 GetST_HighlightColor(Blex::XML::Node node, const char *attrname) //pp 1738: 2.18.46
{
        std::string color = node.GetAttr(&xmlns_wordml, attrname);
        if(color=="black")
            return DrawLib::Pixel32(0,0,0);
        if(color=="blue")
            return DrawLib::Pixel32(0,0,255);
        if(color=="cyan")
            return DrawLib::Pixel32(0,255,255);
        if(color=="darkBlue")
            return DrawLib::Pixel32(0,0,128);
        if(color=="darkCyan")
            return DrawLib::Pixel32(0,128,128);
        if(color=="darkGray")
            return DrawLib::Pixel32(128,128,128);
        if(color=="darkGreen")
            return DrawLib::Pixel32(0,128,0);
        if(color=="darkMagenta")
            return DrawLib::Pixel32(128,0,128);
        if(color=="darkRed")
            return DrawLib::Pixel32(128,0,0);
        if(color=="darkYellow")
            return DrawLib::Pixel32(128,128,0);
        if(color=="green")
            return DrawLib::Pixel32(0,255,0);
        if(color=="lightGray")
            return DrawLib::Pixel32(0xC0,0xC0,0xC0);
        if(color=="magenta")
            return DrawLib::Pixel32(255,0,255);
        if(color=="none")
            return DrawLib::Pixel32();
        if(color=="red")
            return DrawLib::Pixel32(255,0,0);
        if(color=="white")
            return DrawLib::Pixel32(255,255,255);
        if(color=="yellow")
            return DrawLib::Pixel32(255,255,0);
        DEBUGPRINT("Unrecognized color " << color);
        return DrawLib::Pixel32();
}

DrawLib::Pixel32 GetST_HexColor(Blex::XML::Node node, const char *attrname) //2.18.43
{
        std::string val = node.GetAttr(&xmlns_wordml, attrname);
        if(val=="auto")
            return DrawLib::Pixel32(0,0,0,0);
        else
        {
                uint32_t decval = Blex::DecodeUnsignedNumber<uint32_t>(val.begin(), val.end(), 16).first;
                return DrawLib::Pixel32((decval>>16)&0xFF,(decval>>8)&0xFF,decval&0xFF);
        }
}

::Parsers::HorizontalAlignment GetST_Jc(Blex::XML::Node node, const char *attrname) //2.18.50
{
        std::string val = node.GetAttr(&xmlns_wordml, attrname);
        if(val=="both" || val=="distribute") //distribute also implies letter-spacing
            return ::Parsers::Justified;
        if(val=="right")
            return Parsers::Right;
        if(val=="center")
            return Parsers::Center;
        return Parsers::Left;
}

std::string GetST_Lang(Blex::XML::Node node, const char *attrname) // 2.18.51
{
        std::string in = node.GetAttr(&xmlns_wordml, attrname);
        if(in.length()>=3 && in[2]=='-') //ISO 639-1 code
            return in;
        //Lookup the hexadecimal code
        uint16_t langcode = Blex::DecodeUnsignedNumber<uint16_t>(in.begin(), in.end(), 16).first;
        return GetLanguageCode(langcode);
}

DrawLib::Pixel32 ParseShading(Blex::XML::Node newnode) //pg 1800: 2.18.85.
{
        DrawLib::Pixel32 front = GetST_HexColor(newnode, "color");
        DrawLib::Pixel32 back = GetST_HexColor(newnode, "fill");

        std::string pattern = newnode.GetAttr(&xmlns_wordml, "val");
        if(pattern == "nil" || pattern=="clear")
            return back;
        else if(Blex::StrLike(pattern,"pct??"))
        {
                unsigned pct = Blex::DecodeUnsignedNumber<unsigned>(pattern.begin()+3, pattern.begin()+5,10).first;
                return Word::MixColors2(pct*10, front, back);
        }
        else if(pattern == "solid")
            return front;

        return DrawLib::Pixel32();
}

Brc ParseDocXBorder(Blex::XML::Node tablenode) //pg 408: 2.4.38 tblBorders  example pg 475 2.4.71: top
{
        Brc retval;
        retval.bordertype = GetST_Border(tablenode, "val");
        retval.linewidth = GetS32Attr(tablenode, "sz");
        retval.borderspace = GetS32Attr(tablenode, "space");
        retval.shadow = GetOnOffAttr(tablenode, "shadow", false);
        if(tablenode.HasAttr(&xmlns_wordml, "color"))
                retval.color = GetST_HexColor(tablenode, "color");
        return retval;
}

void ParseDocXMargins(Blex::XML::Node marginnode, Parsers::Distance *distance)
{
        for(Blex::XML::Node itr = marginnode.GetFirstChild();itr;itr=itr.GetNextSibling())
        {
                if(GetAttr(itr,"type")!="dxa")
                {
                        DEBUGPRINT("Misunderstood celmargin type " << GetAttr(itr,"type"));
                }
                unsigned margin = GetS32Attr(itr,"w");
                if(itr.LocalNameIs("top"))
                    distance->top=margin;
                else if(itr.LocalNameIs("left"))
                    distance->left=margin;
                else if(itr.LocalNameIs("bottom"))
                    distance->bottom=margin;
                else if(itr.LocalNameIs("right"))
                    distance->right=margin;
                else
                    DEBUGPRINT("Misunderstood cellmargin node " << itr.GetLocalName());
        }
}

} // End of namespace DocX
} // End of namespace Word
} // End of namespace Office
} // End of namespace Parsers
