#include <ap/libwebhare/allincludes.h>


#include "docx.h"
#include "docx_parse.h"

namespace Parsers {
namespace Office {
namespace Word {

namespace DocX
{
extern Blex::XML::Namespace xmlns_wordml;

///////////////////////////////////////////////////////////
//
// CHP
//
const DocXDoc::ChpParserTable DocXDoc::chpparsertable[]=
{ { "b", &DocXDoc::ChpBold }
, { "u", &DocXDoc::ChpUnderline }
, { "i", &DocXDoc::ChpItalic }
, { "shadow", &DocXDoc::ChpShadow }
, { "emboss", &DocXDoc::ChpEmboss }
, { "imprint", &DocXDoc::ChpImprint }
, { "outline", &DocXDoc::ChpOutline }
, { "sz", &DocXDoc::ChpFontSize }
, { "lang", &DocXDoc::ChpLanguage }
, { "color", &DocXDoc::ChpColor }
, { "shd", &DocXDoc::ChpShading }
, { "highlight", &DocXDoc::ChpHighlight }
, { "caps", &DocXDoc::ChpCaps }
, { "smallCaps", &DocXDoc::ChpSmallCaps }
, { "strike", &DocXDoc::ChpStrike }
, { "dstrike", &DocXDoc::ChpDStrike }
, { "vanish", &DocXDoc::ChpVanish }
, { "vertAlign", &DocXDoc::ChpVertAlign }
, { "rFonts", &DocXDoc::ChpRFonts }
, { "rStyle", &DocXDoc::ChpRStyle }

#ifdef DEBUG
, { "szCs", &DocXDoc::ChpComplexFontSize }
#endif

, { 0, 0 }
};

void DocXDoc::ApplyChpProps(Chp *chp, Blex::XML::Node ppr, bool direct) const
{
        for(Blex::XML::NodeIterator cur = ppr.GetChildNodeIterator(&xmlns_wordml); cur; ++cur)
            ApplySingleChpProp(chp, *cur, direct);
        chp->Fixup();
}

void DocXDoc::ApplySingleChpProp(Chp *chp, Blex::XML::Node newnode, bool direct) const
{
        ChpParserTable const *entry = chpparsertable;
        for (;entry->entry;++entry)
          if(newnode.LocalNameIs(entry->entry))
          {
                (this->*(entry->parser))(chp, newnode, direct);
                return;
          }
        DEBUGPRINT("Didn't understand character property " << newnode.GetLocalName());
}

void DocXDoc::ChpBold(Chp *chp, Blex::XML::Node newnode, bool direct) const //pg 160. 2.3.2.1
{
        //'toggle' property - when used inside stylesheet, toggles instead of directly sets
        bool newstate = direct ? GetOnOffAttr(newnode, "val", true)
                               : (GetOnOffAttr(newnode, "val", true) ^ (!!(chp->formatted.format_bits & Parsers::Character::Bold)));
        if(newstate)
            chp->formatted.format_bits |= Parsers::Character::Bold;
        else
            chp->formatted.format_bits &= ~Parsers::Character::Bold;
}
void DocXDoc::ChpItalic(Chp *chp, Blex::XML::Node newnode, bool direct) const //pg 186. 2.3.2.14
{
        //'toggle' property - when used inside stylesheet, toggles instead of directly sets
        bool newstate = direct ? GetOnOffAttr(newnode, "val", true)
                               : (GetOnOffAttr(newnode, "val", true) ^ (!!(chp->formatted.format_bits & Parsers::Character::Italic)));
        if(newstate)
            chp->formatted.format_bits |= Parsers::Character::Italic;
        else
            chp->formatted.format_bits &= ~Parsers::Character::Italic;
}
void DocXDoc::ChpUnderline(Chp *chp, Blex::XML::Node newnode, bool) const //pg 232. 2.3.2.38. val, color, themeColor, themeShade, themeTint
{
        //val is of type ST_Underline, 2.18.107
        if(newnode.HasAttr(&xmlns_wordml,"val"))
        {
                std::string underline_setting = newnode.GetAttr(&xmlns_wordml,"val");
                if(underline_setting == "none")
                        chp->formatted.underlining = Parsers::Character::NoUnderline;
                else
                        chp->formatted.underlining = Parsers::Character::SingleUnderline;
        }
}
void DocXDoc::ChpShadow(Chp *chp, Blex::XML::Node newnode, bool direct) const //pg 214. 2.3.2.29
{
        //'toggle' property - when used inside stylesheet, toggles instead of directly sets
        bool newstate = direct ? GetOnOffAttr(newnode, "val", true)
                               : (GetOnOffAttr(newnode, "val", true) ^ (!!(chp->formatted.format_bits & Parsers::Character::Shadow)));
        if(newstate)
            chp->formatted.format_bits |= Parsers::Character::Shadow;
        else
            chp->formatted.format_bits &= ~Parsers::Character::Shadow;
}
void DocXDoc::ChpEmboss(Chp *chp, Blex::XML::Node newnode, bool direct) const //pg . 2.3.2.11
{
        //'toggle' property - when used inside stylesheet, toggles instead of directly sets
        bool newstate = direct ? GetOnOffAttr(newnode, "val", true)
                               : (GetOnOffAttr(newnode, "val", true) ^ (!!(chp->formatted.format_bits & Parsers::Character::Emboss)));
        if(newstate)
            chp->formatted.format_bits |= Parsers::Character::Emboss;
        else
            chp->formatted.format_bits &= ~Parsers::Character::Emboss;
}
void DocXDoc::ChpImprint(Chp *chp, Blex::XML::Node newnode, bool direct) const //pg 196. 2.3.2.16
{
        //'toggle' property - when used inside stylesheet, toggles instead of directly sets
        bool newstate = direct ? GetOnOffAttr(newnode, "val", true)
                               : (GetOnOffAttr(newnode, "val", true) ^ (!!(chp->formatted.format_bits & Parsers::Character::Imprint)));
        if(newstate)
            chp->formatted.format_bits |= Parsers::Character::Imprint;
        else
            chp->formatted.format_bits &= ~Parsers::Character::Imprint;
}
void DocXDoc::ChpOutline(Chp *chp, Blex::XML::Node newnode, bool direct) const
{
        //'toggle' property - when used inside stylesheet, toggles instead of directly sets
        bool newstate = direct ? GetOnOffAttr(newnode, "val", true)
                               : (GetOnOffAttr(newnode, "val", true) ^ (!!(chp->formatted.format_bits & Parsers::Character::Outline)));
        if(newstate)
            chp->formatted.format_bits |= Parsers::Character::Outline;
        else
            chp->formatted.format_bits &= ~Parsers::Character::Outline;
}
void DocXDoc::ChpFontSize(Chp *chp, Blex::XML::Node newnode, bool) const //2.3.2.36. attribute 'val'
{
        int32_t newsize = GetS32Attr(newnode, "val");
        chp->formatted.font_halfpoint_size=newsize;
}
#ifdef DEBUG
void DocXDoc::ChpComplexFontSize(Chp */*chp*/, Blex::XML::Node newnode, bool) const //2.3.2.37. attribute 'val
{
        int32_t newsize = GetS32Attr(newnode, "val");
        DEBUGPRINT("Complex font size set to " << newsize << " halfpoints (and ignored)");
}
#endif
void DocXDoc::ChpLanguage(Chp *chp, Blex::XML::Node newnode, bool) const //2.3.2.18. attributes:  bidi (complex scripts), eastAsia, val (latin)
{
        //If this attribute is omitted, then the languages for the contents of this run using Latin characters shall be automatically determined based on their contents using any appropriate method.
        chp->formatted.languagecode = GetST_Lang(newnode, "val");
}
void DocXDoc::ChpColor(Chp *chp, Blex::XML::Node newnode, bool) const //pg170: 2.3.2.5. themeColor, themeShade, themeTint, val
{
        chp->formatted.foreground_color = GetST_HexColor(newnode, "val");
        chp->pod.internal_bits &= ~Chp::FGAutomatic;
}
void DocXDoc::ChpHighlight(Chp *chp, Blex::XML::Node newnode, bool) const //pg185: 2.3.2.13. val
{
        chp->formatted.background_color = GetST_HighlightColor(newnode, "val");
        chp->pod.internal_bits |= Chp::Highlight;
}
void DocXDoc::ChpShading(Chp *chp, Blex::XML::Node newnode, bool ) const //pg216: 2.3.2.30. color,fill,themeColor,themeFill,themeFillShade,themeFillTint,themeShade,themeTint,val
{
        if(!(chp->pod.internal_bits & Chp::Highlight))
            chp->formatted.background_color = ParseShading(newnode);
}
void DocXDoc::ChpCaps(Chp *chp, Blex::XML::Node newnode, bool direct) const //pg169: 2.3.2.4
{
        bool newstate = direct ? GetOnOffAttr(newnode, "val", true)
                               : (GetOnOffAttr(newnode, "val", true) ^ (!!(chp->pod.internal_bits & Chp::Caps)));
        if(newstate)
            chp->pod.internal_bits |= Chp::Caps;
        else
            chp->pod.internal_bits &= ~Chp::Caps;
}
void DocXDoc::ChpSmallCaps(Chp *chp, Blex::XML::Node newnode, bool direct) const //pg223: 2.3.2.31
{
        bool newstate = direct ? GetOnOffAttr(newnode, "val", true)
                               : (GetOnOffAttr(newnode, "val", true) ^ (!!(chp->formatted.format_bits & Parsers::Character::Smallcaps)));
        if(newstate)
            chp->formatted.format_bits |= Parsers::Character::Smallcaps;
        else
            chp->formatted.format_bits &= ~Parsers::Character::Smallcaps;
}
void DocXDoc::ChpStrike(Chp *chp, Blex::XML::Node newnode, bool direct) const //pg228: 2.3.2.35
{
        bool newstate = direct ? GetOnOffAttr(newnode, "val", true)
                               : (GetOnOffAttr(newnode, "val", true) ^ (!!(chp->formatted.format_bits & Parsers::Character::Strikethrough)));
        if(newstate)
            chp->formatted.format_bits |= Parsers::Character::Strikethrough;
        else
            chp->formatted.format_bits &= ~Parsers::Character::Strikethrough;
}
void DocXDoc::ChpDStrike(Chp *chp, Blex::XML::Node newnode, bool direct) const //pg174: 2.3.2.7
{
        //Doublestrike is NOT documented as a 'toggle' prop, but let's just assume....
        bool newstate = direct ? GetOnOffAttr(newnode, "val", true)
                               : (GetOnOffAttr(newnode, "val", true) ^ (!!(chp->formatted.format_bits & Parsers::Character::DoubleStrike)));
        if(newstate)
            chp->formatted.format_bits |= Parsers::Character::DoubleStrike;
        else
            chp->formatted.format_bits &= ~Parsers::Character::DoubleStrike;
}
void DocXDoc::ChpVanish(Chp *chp, Blex::XML::Node newnode, bool direct) const //pg236: 2.3.2.39
{
        bool newstate = direct ? GetOnOffAttr(newnode, "val", true)
                               : (GetOnOffAttr(newnode, "val", true) ^ (!!(chp->pod.internal_bits & Chp::Vanish)));
        if(newstate)
            chp->pod.internal_bits |= Chp::Vanish;
        else
            chp->pod.internal_bits &= ~Chp::Vanish;
}
void DocXDoc::ChpVertAlign(Chp *chp, Blex::XML::Node newnode, bool /*direct*/) const //pg237: 2.3.2.40
{
        std::string aligntype = newnode.GetAttr(&xmlns_wordml, "val");
        if(aligntype=="subscript")
            chp->formatted.subsuper=Parsers::Character::SubScript;
        else if(aligntype=="superscript")
            chp->formatted.subsuper=Parsers::Character::SuperScript;
        else
            chp->formatted.subsuper=Parsers::Character::NormalScript;
}
void DocXDoc::ChpRFonts(Chp *chp, Blex::XML::Node newnode, bool /*direct*/) const //pg201: 2.3.2.24 rFonts (run Fonts)
{
        if(newnode.HasAttr(&xmlns_wordml, "asciiTheme"))
        {
                /* ADDME: Support separate fonts for highAnsi, complex,
                   eastasian and ascii chars (eg we can't really get away with
                   setting font_face, we need to actively scan the char to output) */

                chp->SetFont(GetFontByTheme(newnode.GetAttr(&xmlns_wordml, "asciiTheme")));
        }
        else if(newnode.HasAttr(&xmlns_wordml, "ascii"))
        {
                /* ADDME: Support separate fonts for highAnsi, complex,
                   eastasian and ascii chars (eg we can't really get away with
                   setting font_face, we need to actively scan the char to output) */

                chp->SetFont(GetFontByName(newnode.GetAttr(&xmlns_wordml, "ascii")));
        }
}
void DocXDoc::ChpRStyle(Chp *chp, Blex::XML::Node newnode, bool /*direct*/) const //17.3.2.29 rStyle (referenced character style) 2nd pg: 333
{
        std::string stylename = newnode.GetAttr(&xmlns_wordml, "val");
        StyleBase const*style = GetStyleByDocXId(stylename);
        if(!style)
        {
                DEBUGPRINT("No such DocX style: " << stylename);
                return;
        }
        if(style->type != StyleBase::CharacterStyle)
        {
                DEBUGPRINT("Wrong type, expected a character DocX style: " << stylename);
                return;
        }

        for (std::vector<StyleBase const*>::const_iterator itr=style->stylehistory.begin();
             itr!=style->stylehistory.end();
             ++itr)
            static_cast<ParaCharStyle const*>(*itr)->ApplyStyle(NULL, chp);
}
}
using namespace DocX; //ADDME: Split Pap structure into Biff and DocX..

///////////////////////////////////////////////////////////
//
// PAP
//

const Pap::ParserTable Pap::parsertable[]=
{ { "pStyle", 0 }
, { "spacing", &Pap::DoSpacing }
, { "shd", &Pap::DoShading }
, { "jc", &Pap::DoJC }
, { "outlineLvl", &Pap::DoOutlineLevel }
, { "ind", &Pap::DoIndentation}
, { "numPr", &Pap::DoNumPr}
, { "contextualSpacing", &Pap::DoContextualSpacing }
, { 0, 0 }
};

void Pap::ApplyDocXProps(DocX::DocXDoc const &docx, Blex::XML::Node ppr)
{
        for(Blex::XML::NodeIterator cur = ppr.GetChildNodeIterator(&xmlns_wordml); cur; ++cur)
            ApplySingleDocXProp(docx, *cur);
}

void Pap::ApplySingleDocXProp(DocX::DocXDoc const &docx, Blex::XML::Node newnode)
{
        ParserTable const *entry = parsertable;
        for (;entry->entry;++entry)
          if(newnode.LocalNameIs(entry->entry))
          {
                if(entry->parser)
                    (this->*(entry->parser))(docx, newnode);
                return ;
          }
        DEBUGPRINT("Didn't understand paragraph property " << newnode.GetLocalName());
        return ;
}

void Pap::DoSpacing(DocX::DocXDoc const &, Blex::XML::Node newnode)
{
        paddingbeforeauto = GetOnOffAttr(newnode, "beforeAutospacing", false);
        paddingafterauto = GetOnOffAttr(newnode, "afterAutospacing", false);

        formatted.padding.bottom = GetS32Attr(newnode, "after");
        formatted.padding.top = GetS32Attr(newnode, "before");
}

void Pap::DoJC(DocX::DocXDoc const &, Blex::XML::Node newnode) //2.3.1.13 - attr: 'val', possible values defined in 2.18.50
{
        formatted.jc = GetST_Jc(newnode, "val");
}
void Pap::DoShading(DocX::DocXDoc const &, Blex::XML::Node ) //2.3.1.31 - color, fill, themeColor, themeFill, themeFillShade, themeFillTint, themeShade, themeTint, val
{
        DEBUGPRINT("Pap shd (shading) - not implemented");
}
void Pap::DoOutlineLevel(DocX::DocXDoc const &, Blex::XML::Node newnode) //2.3.1.20
{
        int32_t outline_level = GetS32Attr(newnode,"val") + 1;
        if(outline_level < 1 || outline_level >= 10)
            outline_level=0;

        DEBUGPRINT("Pap outline level " << outline_level );//spec says, no effect on formatting, just on generated TOCs
}
void Pap::DoIndentation(DocX::DocXDoc const &, Blex::XML::Node newnode) //pg75: 2.3.1.12  firstLine, firstLineChars, hanging, hangingChars, left, leftChars, right, rightChars
{
        if(newnode.HasAttr(&xmlns_wordml,"firstLineChars")
           || newnode.HasAttr(&xmlns_wordml,"leftChars")
           || newnode.HasAttr(&xmlns_wordml,"hangingChars")
           || newnode.HasAttr(&xmlns_wordml,"rightChars"))
        {
                DEBUGPRINT("Indentation in Chars units, which are currently not supported!"); //ADDME?
        }

        if(newnode.HasAttr(&xmlns_wordml, "hanging"))
            formatted.first_indent = -GetS32Attr(newnode, "hanging");
        else
            formatted.first_indent = GetS32Attr(newnode, "firstLine");

        formatted.padding.left = GetS32Attr(newnode, "left");
        formatted.padding.right = GetS32Attr(newnode, "right");
}
void Pap::DoNumPr(DocX::DocXDoc const &docx, Blex::XML::Node newnode) //pg94: 2.3.1.19 numPr
{
        for(Blex::XML::NodeIterator cur = newnode.GetChildNodeIterator(&xmlns_wordml); cur; ++cur)
        {
                if(cur->LocalNameIs("ilvl"))
                    listlevel = GetS32Attr(*cur, "val");
                else if(cur->LocalNameIs("numId"))
                    listovr = docx.GetListOverride(GetS32Attr(*cur, "val"));
                else
                    DEBUGPRINT("Didn't understand numPr subproperty " << newnode.GetLocalName());
        }

        //Must be applied right away at this point...
        if(listovr)
        {
                ListLevel const *ll = listovr->GetLevel(listlevel);
                if(ll)
                    ll->ApplyPap(this);
        }
}
void Pap::DoContextualSpacing(DocX::DocXDoc const &, Blex::XML::Node )
{
        contextualspacing = 1;
}

///////////////////////////////////////////////////////////
//
// TAP
//
const Tap::ParserTable Tap::parsertable[]=
{ { "tblCellMar", &Tap::DoCellMar }
, { "tblBorders", &Tap::DoBorders }
, { "tblW",       &Tap::DoTableWidth }
, { "jc",         &Tap::DoJC }
, { 0, 0 }
};


void Tap::ApplyDocXProps(Blex::XML::Node ppr)
{
        for(Blex::XML::NodeIterator cur = ppr.GetChildNodeIterator(&xmlns_wordml); cur; ++cur)
            ApplySingleDocXProp(*cur);
}

void Tap::ApplySingleDocXProp(Blex::XML::Node newnode)
{
        ParserTable const *entry = parsertable  ;
        for (;entry->entry;++entry)
          if(newnode.LocalNameIs(entry->entry))
          {
                if(entry->parser)
                    (this->*(entry->parser))(newnode);
                return ;
          }
        DEBUGPRINT("Didn't understand paragraph property " << newnode.GetLocalName());
        return ;
}
void Tap::DoBorders(Blex::XML::Node itr)
{
        for (Blex::XML::NodeIterator borderitr = itr.GetChildNodeIterator(&xmlns_wordml);borderitr;++borderitr)
          if(borderitr->LocalNameIs("top"))
            default_topborder = ParseDocXBorder(*borderitr);
          else if(borderitr->LocalNameIs("left"))
            default_leftborder = ParseDocXBorder(*borderitr);
          else if(borderitr->LocalNameIs("right"))
            default_rightborder = ParseDocXBorder(*borderitr);
          else if(borderitr->LocalNameIs("bottom"))
            default_bottomborder = ParseDocXBorder(*borderitr);
          else if(borderitr->LocalNameIs("insideH")) //2.4.18
            default_innerhorizontalborder = ParseDocXBorder(*borderitr);
          else if(borderitr->LocalNameIs("insideV"))
            default_innerverticalborder = ParseDocXBorder(*borderitr);
}
void Tap::DoCellMar(Blex::XML::Node newnode)
{
        ParseDocXMargins(newnode, &default_cellpadding);
}

void Tap::DoJC(Blex::XML::Node newnode)
{
        table_jc = GetST_Jc(newnode, "val");
}

void Tap::DoTableWidth(Blex::XML::Node itr) //2.4.61 tblW (Preferred Table Width) pg. 452
{
        //ADDME support 'nil'? (but how?)
        if(itr.GetAttr(&xmlns_wordml,"type") == "dxa") //twips
            wWidth = GetS32Attr(itr, "w");
        else if (itr.GetAttr(&xmlns_wordml,"type") == "pct") //percentage in fiftieths
            wWidth = -GetS32Attr(itr, "w") / 50;
        else
            wWidth = 0; //auto, ?nil?
}

} // End of namespace Word
} // End of namespace Office
} // End of namespace Parsers
