#include <ap/libwebhare/allincludes.h>


#include "biff.h"
#include <blex/utils.h>

using namespace Blex;

namespace Parsers {
namespace Office {
namespace Word {

void ApplyPaddingToDistance(uint16_t newdistance, uint8_t bitmask, Distance *distance)
{
        if (bitmask&1)
            distance->top = newdistance;
        if (bitmask&2)
            distance->left = newdistance;
        if (bitmask&4)
            distance->bottom = newdistance;
        if (bitmask&8)
            distance->right = newdistance;
}


inline Parsers::Character::SubSuperScript MapSubSuper(unsigned sub_super)
{
        if (sub_super==1)
            return Parsers::Character::SuperScript;
        else if (sub_super==2)
            return Parsers::Character::SubScript;
        else
            return Parsers::Character::NormalScript;
}

DrawLib::Pixel32 MixColors(uint8_t pattern, DrawLib::Pixel32 forecolor, DrawLib::Pixel32 backcolor)
{
        //defines the promille of foreground color you need
        static const uint16_t percentages[63]={
                                0,1000,  50, 100, 200, 250, 300, 400, 500, 600,
                              700, 750, 800, 900,   0,   0,   0,   0,   0,   0,
                                0,   0,   0,   0,   0,   0,   0,   0,   0,   0,
                                0,   0,   0,   0,   0,  25,  75, 125, 150, 175,
                              225, 275, 325, 350, 375, 425, 450, 475, 525, 550,
                              575, 625, 650, 675, 725, 775, 825, 850, 875, 925,
                              950, 975, 970};

        if (pattern>=(sizeof(percentages)/sizeof(*percentages)))
            pattern=0;

        return MixColors2(percentages[pattern], forecolor, backcolor);
}

DrawLib::Pixel32 ParseSHD(uint16_t lsb_shd)
{
        DrawLib::Pixel32 front = Colors::GetRGBA(lsb_shd & 0x1F);
        DrawLib::Pixel32 back = Colors::GetRGBA((lsb_shd & 0x3E0)>>5);

        if (front.IsFullyTransparent()) //automatic? (ADDME: Use outer background colors?)
            front = DrawLib::Pixel32(0,0,0,255); //black

        return MixColors(lsb_shd>>10, front, back);
}

DrawLib::Pixel32 ParseSHD2000(uint8_t const *data) //must be a 10-byte buffer
{
        DrawLib::Pixel32 foreground = DrawLib::Pixel32::GetRedFirstInverseAlpha(data);
        DrawLib::Pixel32 background = DrawLib::Pixel32::GetRedFirstInverseAlpha(data+4);

        if (foreground.IsFullyTransparent()) //automatic? (ADDME: Use outer background colors?)
            foreground = DrawLib::Pixel32(0,0,0,255); //black

        DEBUGONLY(if (data[9]) DEBUGPRINT("Unknown word2000 shading value " << data[9]));
        return MixColors(data[8], foreground, background);
}

//For all the parent-tricky-bits
//Data==0: disable bit
//Data==1: enable bit
//Data==128: set bit to same as parent
//Data==129: set bit to opposite of parent
//We don't really care about corrupted values killing our properties
template <int bit> void Chp::SetFormattingBit(const Chp &parent_chp, uint8_t setting)
{
        if(setting==128)
            setting = parent_chp.formatted.format_bits & bit; //same as parent
        else if(setting==129)
            setting = !(parent_chp.formatted.format_bits & bit); //opposite of parent

        if(setting)
            formatted.format_bits |= bit;
        else
            formatted.format_bits &= ~bit;
}
template <int bit> void Chp::SetInternalBit(const Chp &parent_chp, uint8_t setting)
{
        if(setting==128)
            setting = parent_chp.pod.internal_bits & bit; //same as parent
        else if(setting==129)
            setting = !(parent_chp.pod.internal_bits & bit); //opposite of parent

        if(setting)
            pod.internal_bits |= bit;
        else
            pod.internal_bits &= ~bit;
}

template <int bit> void Chp::CopyParentFormattingBit(const Chp &parent_chp,Chp &tempchp)
{
        if ( (formatted.format_bits & bit) == (tempchp.formatted.format_bits & bit) )
            formatted.format_bits = (formatted.format_bits & ~bit) | (parent_chp.formatted.format_bits & bit);
}
template <int bit> void Chp::CopyParentInternalBit(const Chp &parent_chp,Chp &tempchp)
{
        if ( (pod.internal_bits & bit) == (tempchp.pod.internal_bits & bit) )
            pod.internal_bits = (pod.internal_bits & ~bit) | (parent_chp.pod.internal_bits & bit);
}

//return 0 if all is ok, 1 for error, 2 for unsupported (yet) sprm
int Chp::Sprm (BiffDoc const &parent, Chp const &base_style_chp, Chp *cur_style_chp, const SprmData &sprm)
{
        switch (sprm.CommandCode())
        {
            case 0x00:
                //SetFormattingBit<Parsers::Character::Deletion>(*cur_style_chp,sprm.GetValue<uint8_t>());
                SetInternalBit<RMarkDel>(*cur_style_chp, sprm.GetValue<uint8_t>());
                return 0;

            case 0x01:
                //SetFormattingBit<Parsers::Character::Insertion>(*cur_style_chp,sprm.GetValue<uint8_t>());
                SetInternalBit<RMarkIns>(*cur_style_chp, sprm.GetValue<uint8_t>());
                return 0;

            case 0x02:  //sprmCFFldVanish - doesn't seem interesting, this probably only means whether to Hide Fields or not
                return 0;

            case 0x03:  //sprmCPicLocation
                pod.internal_bits |= Special;
                pod.fcPicObjTag=sprm.GetValue<uint32_t>();
                return 0;

            case 0x06:  //sprmCFData
                if (sprm.GetValue<uint8_t>())
                    pod.internal_bits |= Data;
                else
                    pod.internal_bits &= ~Data;
                return 0;

            case 0x09:  //sprmCSymbol
                if (sprm.OpSize()<3)
                    return 1;

                pod.ftcSym=getu16lsb(sprm.Data(0));
                pod.xchSym=sprm.OpSize()==3 ? getu8(sprm.Data(2)) : getu16lsb(sprm.Data(2));
                pod.internal_bits |= Special;
                return 0;

            case 0x0A:  //sprmCFOle2
                if (sprm.GetValue<uint8_t>())
                    pod.internal_bits |= Ole2;
                else
                    pod.internal_bits &= ~Ole2;
                return 0;

            case 0xC: //
                pod.icohighlight = Colors::GetRGBA(sprm.GetValue<uint8_t>());
                formatted.background_color = pod.icohighlight;
                pod.internal_bits |= Highlight;
                return 0;

            case 0x30:
                /*ARGH: Possible bug in this code?! We should not reset _all_ properties
                  FIXME: Figure out why this is so, and what other properties we are missing
                  Perhaps we don't need to update our properties at all, but only
                  start referring to the style's properties?
                {
                        *this=parent.GetStyle(sprm.GetValue<uint16_t>())->cached_stylechp;
                        pod.fcPicObjTag=save_fcPicObjTag;
                        //return 0;
                }*/

                /* We probably shouldn't have enabled this code!
                *this=parent.GetStyle(sprm.GetValue<uint16_t>())->cached_stylechp;
                */

                {
                        uint32_t save_fcPicObjTag = pod.fcPicObjTag;
                        *this = base_style_chp;

                        //uint16_t savestyleid = pod.istd;
                        uint16_t newstyleid = sprm.GetValue<uint16_t>();
                        ParaCharStyle const *newstyle = parent.GetStyle(newstyleid);
                        if (newstyle->type != ParaCharStyle::CharacterStyle)
                        {
                                DEBUGPRINT("Corrupted Word document: Trying to apply a paragraph style to a range of characters");
                                return 1;
                        }

                        for (std::vector<StyleBase const*>::const_iterator itr=newstyle->stylehistory.begin();
                             itr!=newstyle->stylehistory.end();
                             ++itr)
                        {
                                static_cast<ParaCharStyle const*>(*itr)->ApplyStyle(NULL, this);
                                pod.istd_style = static_cast<ParaCharStyle const*>(*itr);
                        }

                        *cur_style_chp = *this;
                        pod.fcPicObjTag=save_fcPicObjTag;
                }
                return 0;

            case 0x35:
                SetFormattingBit<Parsers::Character::Bold>(*cur_style_chp,sprm.GetValue<uint8_t>());
                //SetFormattingBit<Parsers::Character::Bold>(parent.GetStyle(parentstyleid)->cached_stylechp,sprm.GetValue<uint8_t>());
                return 0;

            case 0x36:
                SetFormattingBit<Parsers::Character::Italic>(*cur_style_chp,sprm.GetValue<uint8_t>());
                return 0;

            case 0x38:
                SetFormattingBit<Parsers::Character::Outline>(*cur_style_chp, sprm.GetValue<uint8_t>());
                return 0;

            case 0x3A:
                SetFormattingBit<Parsers::Character::Smallcaps>(*cur_style_chp, sprm.GetValue<uint8_t>());
                return 0;

            case 0x3B:
                SetInternalBit<Caps>(*cur_style_chp, sprm.GetValue<uint8_t>());
                return 0;

            case 0x3C:
                SetInternalBit<Vanish>(*cur_style_chp, sprm.GetValue<uint8_t>());
                return 0;

            case 0x37:
                SetFormattingBit<Parsers::Character::Strikethrough>(*cur_style_chp, sprm.GetValue<uint8_t>());
                return 0;

            case 0x39:
                SetFormattingBit<Parsers::Character::Shadow>(*cur_style_chp, sprm.GetValue<uint8_t>());
                return 0;

            case 0x3E: //kul (underline)
                formatted.underlining=MapUnderlines(sprm.GetValue<uint8_t>());
                return 0;

            case 0x3F: //sprmCSizePos
                if (sprm.OpSize()!=3)
                    return 1;
                if (getu8(sprm.Data(0)))
                    formatted.font_halfpoint_size=getu8(sprm.Data(0));
                if (getu8(sprm.Data(1)))
                    return 1; //don't understand this
                if (getu8(sprm.Data(2))!=128)
                    return 1;//don't understand this

                return 0;

            case 0x42: //ico
                formatted.foreground_color=Colors::GetRGBA(sprm.GetValue<Colors::Word97Colors>());
                if (formatted.foreground_color.IsFullyTransparent()) //transparant - automatic
                {
                        formatted.foreground_color = DrawLib::Pixel32 (0,0,0,255); //black
                        pod.internal_bits |= FGAutomatic;
                }
                else
                {
                        pod.internal_bits &= ~FGAutomatic;
                }

                return 0;

            case 0x43: //hps
                formatted.font_halfpoint_size=sprm.GetValue<uint16_t>();
                return 0;

            case 0x47: //CMajority - a tricky one(tested with Snowboard.doc)
                    {
                        //Apply the sprms to a standard CHP
                        Chp const &parent_chp = pod.istd_style->cached_stylechp;
                        Chp tempchp(parent);
                        tempchp.SetFont(&parent.GetFont(0));

                        SprmIterator itr(parent, sprm.Data(0),sprm.OpSize());
                        parent.ApplyChpSprms(&itr, tempchp, &tempchp, &tempchp); //ADDME: which to pick as base style?

                        //If one of these properties is the same in the tempchp
                        //as in the original chp, set them to the value of
                        //their style chp
                        CopyParentFormattingBit<Parsers::Character::Bold>(parent_chp,tempchp);
                        CopyParentFormattingBit<Parsers::Character::Italic>(parent_chp,tempchp);
                        CopyParentFormattingBit<Parsers::Character::Strikethrough>(parent_chp,tempchp);
                        CopyParentFormattingBit<Parsers::Character::Smallcaps>(parent_chp,tempchp);
                        CopyParentFormattingBit<Parsers::Character::Outline>(parent_chp,tempchp);
                        CopyParentFormattingBit<Parsers::Character::Shadow>(parent_chp,tempchp);

                        CopyParentInternalBit<Caps>(parent_chp,tempchp);

                        if (formatted.font_halfpoint_size==tempchp.formatted.font_halfpoint_size)               //seems to fail
                            formatted.font_halfpoint_size=parent_chp.formatted.font_halfpoint_size;

                        if (formatted.fonttype==tempchp.formatted.fonttype)
                            formatted.fonttype=parent_chp.formatted.fonttype;

                        if (formatted.underlining==tempchp.formatted.underlining)
                            formatted.underlining=parent_chp.formatted.underlining;

                        if (formatted.foreground_color==tempchp.formatted.foreground_color) //actually ,the docs say only do this for Word97 ico
                            formatted.foreground_color=parent_chp.formatted.foreground_color;

                        if (formatted.languagecode==tempchp.formatted.languagecode)
                            formatted.languagecode=parent_chp.formatted.languagecode;

                        //Documentation mentions hpsPOs and qpsSpace as well,
                        //but can't find those in CHP
                    }
                return 0;

            case 0x48:
                if (sprm.GetValue<uint8_t>()>2)
                    return 1;
                formatted.subsuper=MapSubSuper(sprm.GetValue<uint8_t>());
                return 0;

            case 0x4F: //font for ascii text
                SetFont(&parent.GetFont(sprm.GetValue<uint16_t>()));
                DEBUGPRINT("Font is now " << formatted.fonttype->font_face);
                return 0;

            case 0x50: //font for Far east text
                pod.ftcFE=sprm.GetValue<int16_t>();
                return 0;

            case 0x51: //font for non Far east text
                pod.ftcOther=sprm.GetValue<int16_t>();
                return 0;

            case 0x53: //set doublestrikethrough (sprmCFDStrike)
                SetFormattingBit<Parsers::Character::DoubleStrike>(*cur_style_chp, sprm.GetValue<uint8_t>());
                return 0;

            case 0x54: //set imprimt (sprmCFImprint)
                SetFormattingBit<Parsers::Character::Imprint>(*cur_style_chp, sprm.GetValue<uint8_t>());
                return 0;

            case 0x55:
                if (sprm.GetValue<uint8_t>())
                    pod.internal_bits |= Special;
                else
                    pod.internal_bits &= ~Special;
                return 0;

            case 0x56:
                if (sprm.GetValue<bool>())
                    pod.internal_bits |= EmbeddedObj;
                else
                    pod.internal_bits &= ~EmbeddedObj;
                return 0;

            case 0x58: //set emboss (sprmCFEmboss)
                SetFormattingBit<Parsers::Character::Emboss>(*cur_style_chp, sprm.GetValue<uint8_t>());
                return 0;

            case 0x59: //sprmCSfxText - Set text animation
                pod.sfxtText=sprm.GetValue<uint8_t>();
                return 0;

            case 0x5A:

            case 0x5C: //set bold bidirectional?? (sprmCFBoldBi)
                SetInternalBit<BoldBi>(*cur_style_chp, sprm.GetValue<uint8_t>());
                return 0;

            case 0x5D: //set italic bidirectional?? (sprmCFItalicBi)
                SetInternalBit<ItalicBi>(*cur_style_chp, sprm.GetValue<uint8_t>());
                return 0;

            case 0x5E: //Font code for bidirectional texts - WebHare doesn't support BiDi
                {
                        DEBUGPRINT("Bidi font code is set to " << sprm.GetValue<uint16_t>() << ": " << parent.GetFont(sprm.GetValue<uint16_t>()).formatted.font_face);
                        return 0;
                }

            case 0x5F: //Language ID for bidirectional texts - WebHare doesn't support BiDi
            case 0x61: //HPS for bidirectional texts - WebHare doesn't support BiDi
                return 0;

            case 0x65:
                if (sprm.OpSize() != 4)
                    return 1;

                {
                        Brc brc;
                        brc.PackedRead97(sprm.Data(0));
                        DEBUGPRINT(brc.color);
                }
                return 0;

            case 0x66: //Character SHD
                if (sprm.OpSize()!=2)
                    return 1;

                pod.backgroundcolor = ParseSHD(sprm.GetValue<uint16_t>());
                if (! (pod.internal_bits & Highlight) )
                    formatted.background_color = pod.backgroundcolor;
                return 0;

            case 0x68: //UsePgsuSettings - undocumented what this actually does, probably internal stuff though...
                return 0;

            case 0x6D: //Language ID for non-far east text
                formatted.languagecode = GetLanguageCode(sprm.GetValue<uint16_t>());
                return 0;

            case 0x6E: //Language ID for far east text - We don't need this for anything
                return 0;

            case 0x70: //This is a Word 2000 property: The full RGB specification of the color
                if (sprm.OpSize()!=4)
                    return 1;
                formatted.foreground_color=DrawLib::Pixel32::GetRedFirstInverseAlpha(sprm.Data(0));
                return 0;

            case 0x71:
                if (sprm.OpSize()!=10)
                    return 1;
                pod.backgroundcolor = ParseSHD2000(sprm.Data(0));
                if (! (pod.internal_bits & Highlight) )
                    formatted.background_color = pod.backgroundcolor;
                return 0;

            case 0x73: /* This is a Word 2000 property: it seems to be some
                sort of language specifier. Size is 2, and one possible value is
                0x413 (Dutch). It might be the autodetected language */
                return 0;
        }
        DEBUGPRINT("Undocumented CHP sprm " << std::hex << sprm.CommandCode() << std::dec << " len " << sprm.OpSize() << " data " << std::hex << sprm.GetValue<uint32_t>() << std::dec);
        return 2;
}
//return 0 if all is ok, 1 for error, 2 for unsupported (yet) sprm
int Pap::Sprm (BiffDoc const &parent, const SprmData &sprm, Tap *tap)
{
        /* ADDME: These huge switches are ugly. Should try to use a jump table
                  and create seperate functions for each sprm */
        switch (sprm.CommandCode())
        {
            case 0: //sprmPIstd - the evil opcode :-(
            {
                unsigned istd = sprm.GetValue<uint16_t>();
                if(!parent.GetStyle(istd))
                {
                        DEBUGPRINT("Skipping set to nonexisting style " << istd << "\a");
                }

                istd_style = parent.GetStyle(istd);
                DEBUGPRINT("Reset istd to " << istd);

                //this is all very experimental, no docs on which props should be overwritten and which should be saved.. :-(
                unsigned save_tablelevel=tablelevel;
                bool save_ttp=ttp;
                *this = istd_style->cached_stylepap;
                tablelevel=save_tablelevel;
                ttp=save_ttp;

                return 0;
            }

            case 3: //sprmPJc - change justification
                formatted.jc=MapHorizontalAlignment(sprm.GetValue<uint8_t>());
                return 0;

            case 0x61: //Set 'flush right' - apparently a Word2 or WP heritage?
                switch (sprm.GetValue<uint8_t>())
                {
                case 2: //???
                        formatted.jc = Parsers::Right;
                        break;
                default:
                        DEBUGPRINT("PAP 0x61 SPRM with unknown value " << (int)sprm.GetValue<uint8_t>());
                        break;
                }
                return 0;

            case 6: //sprmPFKeepFollow - how paragraphs are kept together is defined in the Profile and can hardly be influenced here
                return 0;

            case 0xA: //sprmPIlvl
                listlevel=sprm.GetValue<uint8_t>();
                return 0;

            case 0xB: //sprmPilfo (note: ilfo always comes after ilvl)
                //ADDME: ATtempet to fix suddent_indent.cpp, delay ApplyIlfo until all props are read
                //ADDME: Attempt to get both sudden_indent2.cpp and suddent_indent to work, interpret outline level == 0 as a reset of formatting :(
                ilfo=sprm.GetValue<int16_t>();
                ApplyIlfo(parent,ilfo);
                return 0;

            case 0xD: //sprmPChgTabsPapx
                {
                        if (sprm.OpSize() < 2)
                            return 1; //failure in sprmPChgTabsPapx: missing tab delete/tab add info

                        unsigned tabs_to_delete = getu8(sprm.Data(0));
                        if (sprm.OpSize() < 2+tabs_to_delete*2)
                            return 1; //failure in sprmPChgTabsPapx: missing tab add info

                        unsigned tabs_to_add = getu8(sprm.Data(1 + tabs_to_delete*2));
                        if (sprm.OpSize() < 2 + tabs_to_delete*2 + tabs_to_add*3)
                            return 1; //failure in sprmPChgTabsPapx: missing tab add info

                        //Delete tabs
                        const uint8_t *const delete_positions = sprm.Data(1);
                        for (unsigned tab=0;tab<tabs_to_delete;++tab)
                            DelTab(gets16lsb(delete_positions+ 2*tab));

                        //Add tabs
                        const uint8_t *const add_positions = delete_positions + tabs_to_delete*2 + 1;
                        const uint8_t *const add_descriptors = add_positions + tabs_to_add*2;
                        for (unsigned tab=0;tab<tabs_to_add;++tab)
                            AddTab(gets16lsb(add_positions + 2*tab),
                                   getu8(add_descriptors + 1*tab));
                        return 0;
                }

            case 0xE: //sprmPDxaRight
                formatted.padding.right=std::max<int32_t>(0,sprm.GetValue<int32_t>());
                return 0;

            case 0xF: //sprmPDxaLeft
                formatted.padding.left=std::max<int32_t>(0,sprm.GetValue<int32_t>());
                return 0;

            case 0x10: //sprmPNest
                formatted.padding.left=std::max<int32_t>(0,formatted.padding.left+sprm.GetValue<int32_t>());
                return 0;

            case 0x11: //sprmPDxaLeft1
                formatted.first_indent=sprm.GetValue<int32_t>();
                return 0;

            case 0x12: //sprmPDyaLine
                dyaline = Blex::gets16lsb(sprm.Data(0));
                multilinespace = Blex::gets16lsb(sprm.Data(2)) != 0;
                if (dyaline < 0)
                {
                    formatted.exactheight = true;
                    dyaline = -dyaline;
                }
                if (multilinespace) //Specify a percentage
                    formatted.lineheight = -(dyaline * 100)/240;
                else
                    formatted.lineheight = dyaline;

                return 0;

            case 0x13: //sprmPDyaBefore
                formatted.padding.top=sprm.GetValue<uint32_t>();
                return 0;

            case 0x14: //sprmPDyaAfter
                formatted.padding.bottom=sprm.GetValue<uint32_t>();
                return 0;

            case 0x15: //sprmPChgTabs
                {
                        if (sprm.OpSize() < 2)
                            return 1; //failure in sprmPChgTabs: missing tab delete/tab add info

                        unsigned tabs_to_delete = getu8(sprm.Data(0));
                        if (sprm.OpSize() < 2+tabs_to_delete*2)
                            return 1; //failure in sprmPChgTabsPapx: missing tab add info

                        unsigned tabs_to_add = getu8(sprm.Data(1 + tabs_to_delete*4));

                        if (sprm.OpSize() < 2 + tabs_to_delete*2 + tabs_to_add*3)
                            return 1; //failure in sprmPChgTabsPapx: missing tab add info

                        //Delete tabs
                        const uint8_t *const delete_positions = sprm.Data(1);
                        const uint8_t *const delete_tolerances = delete_positions + 4*tabs_to_delete;
                        for (unsigned tab=0;tab<tabs_to_delete;++tab)
                            DelTab(gets16lsb(delete_positions+4*tab),
                                   gets16lsb(delete_tolerances+4*tab));

                        //Add tabs
                        const uint8_t *const add_positions = delete_tolerances + 1 + tabs_to_delete*2;
                        const uint8_t *const add_descriptors = add_positions + tabs_to_add*2;
                        for (unsigned tab=0;tab<tabs_to_add;++tab)
                            AddTab(gets16lsb(add_positions + 2*tab),
                                   getu8(add_descriptors + 1*tab));

                        return 0;
                }

            case 0x16: //sprmPFinTable
                tablelevel=std::max(tablelevel,1u); //up tablelevel, but only if now outside a table
                return 0;

            case 0x17: //sprmPFTTP
                ttp=sprm.GetValue<bool>();
                return 0;

        case 0x2A: //no auto hyphentation
                return 0;

        case 0x2D: //sprmPShd
                DEBUGPRINT("Unimplemented: SHD"); //ADDME: Support!
                return 0;

            //NOTE when implementing 0x24-0x29. Word60 gives a 2-byte parameter,
            //and Word97+ give 4-byte parameters, corresponding to either's
            //BRC sizes. Take that into account when redefining BRCs!

            case 0x31: //sprmPFWidowControl - We never split paragraphs halfway so ignore this
                return 0;

        case 0x3E: //sprmPAnld
        {
                if (sprm.OpSize()<Anld::DiskSize)
                    return 1;

                anld=Anld(sprm.Data(0));
                return 0;

        }

        case 0x40: //sprmPOutLvl
                /* FIXME: This code was here but apparently does the wrong
                   thing in Word97 - it's supposed to set lvl not ilvl.
                ilvl=sprm.GetValue<uint8_t>();
                   (lvl is at positiion 130d in PAPs and must be somehow
                    related to ANLDs) */
                //listlevel =sprm.GetValue<uint8_t>();
                //ApplyIlfo(parent,ilfo);

                //ADDME: ATtempet to fix suddent_indent.cpp, delay ApplyIlfo until all props are read
                DEBUGPRINT("Ignoring outline level " << (int)sprm.GetValue<uint8_t>());

                //ADDME: Attempt to get both sudden_indent2.cpp and suddent_indent to work, interpret outline level as a reset of formatting :(
                //ADDME: The workaroundd breaks outline_level_paddingleft_break.doc - NEED BETTER FIX
/*                formatted.padding.left=0;
                formatted.first_indent=0;*/
                return 0;

        case 0x41: //PFBidi - something releated to bidirectional text
                return 0;


            case 0x46: //Huge Papx
                {
                        GrpprlPointer hugepapx=parent.GetHugePapx(sprm.GetValue<uint32_t>());
                        if (hugepapx.Length())
                        {
                                SprmIterator sprmitr(parent, hugepapx);
                                parent.ApplySprms(&sprmitr,this,0,tap);
                        }
                        else
                            DEBUGPRINT("cannot resolve hugepapx");
                }
                return 0;

        case 0x49: //Word2000 undocumented sprm
                tablelevel = sprm.GetValue<int32_t>();
                if(tablelevel >= 256)
                    tablelevel = 0; //sanity check
                return 0;

        case 0x4A: //Word2000 undocumented sprm
                tablelevel += sprm.GetValue<int32_t>();
                if(tablelevel >= 256)
                    tablelevel = 0; //sanity check
                return 0;

        case 0x4B: //Word2000 end-of-cel
                cellend = sprm.GetValue<bool>();
                return 0;

        case 0x4C: //Word2000 ttp
                ttp = sprm.GetValue<bool>();
                return 0;

        case 0x4D: //Background fill color
                DEBUGPRINT("Unimplemented: SHD background fill color"); //ADDME: Support!
                return 0;

        case 0x5B:
                paddingbeforeauto = sprm.GetValue<uint8_t>() != 0;
                return 0;

        case 0x5C:
                paddingafterauto = sprm.GetValue<uint8_t>() != 0;
                return 0;

        case 0x6D:
                contextualspacing = sprm.GetValue<uint8_t>() != 0;
                DEBUGPRINT("Contextual spacing = " << contextualspacing);
                return 0;
        }

        DEBUGPRINT("Undocumented PAP sprm " << std::hex << sprm.CommandCode() << std::dec << " len " << sprm.OpSize() << " data " << std::hex << sprm.GetValue<uint32_t>() << std::dec);
        return 2;
}

//return 0 if all is ok, 1 for error, 2 for unsupported (yet) sprm
int Sep::Sprm (BiffDoc const &/*parent*/, const SprmData &sprm)
{
        switch (sprm.CommandCode())
        {
        case 0x2: //sprmSOlstAnm
                if (sprm.OpSize() < Olst::DiskSize)
                    return 1;
                olstAnm=Olst(sprm.Data(0));
                DEBUGPRINT("Olst 0: startat: " << olstAnm.anlv[0].startat);
                DEBUGPRINT("Olst 1: startat: " << olstAnm.anlv[1].startat);
                DEBUGPRINT("Olst 2: startat: " << olstAnm.anlv[2].startat);
                return 0;

        case 0x3: //sprmSDxaColWidth
                pod.dxaColumnWidth=sprm.GetValue<int32_t>();
                return 0;

            case 0x4: //sprmSDxaColSpacing
                DEBUGPRINT("Hit badly documented sprmSDxaColSpacing - don't know what to do");
                return 1;

            case 0x9: //sprmSBkc
                pod.bkc=sprm.GetValue<uint8_t>();
                return 0;

            case 0xC: //sprmSDxaColumns
                pod.dxaColumns=sprm.GetValue<int32_t>();
                return 0;

            case 0xB: //ccolM1 (number of columns minus one)
                pod.ccolM1=sprm.GetValue<int16_t>();
                return 0;

            case 0x19:
                pod.fLBetween=sprm.GetValue<uint8_t>();
                return 0;

            case 0x1F:
                pod.xaPage=sprm.GetValue<uint32_t>();
                return 0;

            case 0x20:
                pod.yaPage=sprm.GetValue<uint32_t>();
                return 0;

            case 0x21:
                pod.dxaLeft=sprm.GetValue<uint32_t>();
                return 0;

            case 0x22:
                pod.dxaRight=sprm.GetValue<uint32_t>();
                return 0;

            case 0x23:
                pod.dyaTop=sprm.GetValue<uint32_t>();
                return 0;

            case 0x24:
                pod.dyaBottom=sprm.GetValue<uint32_t>();
                return 0;

            case 0x25:
                pod.dzaGutter=sprm.GetValue<uint32_t>();
                return 0;

            case 0x26:
                //dmPaperReq=sprm.GetValue<uint16_t>();
                return 0;

            case 0x31:
                pod.dyaLinePitch=sprm.GetValue<uint32_t>();
                return 0;
            }
        return 2;
}


int ParsePercOrTwips(const SprmData &sprm)
{
        if(Blex::getu8(sprm.Data(0)) == 2) //%
            return -(Blex::getu16lsb(sprm.Data(1)) / 50);

        if(Blex::getu8(sprm.Data(0)) == 3)
            return Blex::getu16lsb(sprm.Data(1));

        return 0; //ADDME separate Nil from Auto
}

//return 0 if all is ok, 1 for error, 2 for unsupported (yet) sprm
int Tap::Sprm (BiffDoc const &parent, const SprmData &sprm)
{
        const uint8_t *ptr;

        switch (sprm.CommandCode())
        {
        case 0x00:  //sprmTJC
                table_jc = MapHorizontalAlignment(sprm.GetValue<uint8_t>());
                return 0;

        case 0x01: //sprmTDxaLeft (shift entire table left by addingdxaNew - (rgdxaCenter[0] + tap.dxaGapHalf)
                {
                        if (margins.size() == 0)
                        {
                                DEBUGPRINT("sprmTDxaLeft without columns to shift");
                                return 1;
                        }
                        int to_add = sprm.GetValue<int16_t>() - (margins[0] + dxaGapHalf);
                        for (unsigned i=0; i<margins.size(); ++i)
                            margins[i] += to_add;
                        return 0;
                }

        case 0x02: // (updates space between columns - might want this for COLSPACING someday?)
                dxaGapHalf_delta = dxaGapHalf-sprm.GetValue<uint16_t>();
                if (margins.size()>0)
                    margins[0]+=dxaGapHalf-sprm.GetValue<uint16_t>();
                dxaGapHalf=sprm.GetValue<uint16_t>();
                return 0;

        case 0x03: //sprmTFCantSplit
                cantsplit=sprm.GetValue<uint8_t>()!=0;
                return 0;

        case 0x04: //sprmTTableHeader
                tableheader=sprm.GetValue<uint8_t>()!=0;
                return 0;

        case 0x05: //sprmTTableBorders
                return ParseTableBorders(sprm);

        case 0x07: //row height
                dyaRowHeight=sprm.GetValue<uint32_t>();
                return 0;

        case 0x08:  //TDefTable
        {
                //Size of TC structures
                unsigned tc_size = 20;

                //There can be no more widths than (sprm.OpSize()-1)/2,
                //and there can be no more cells than #widths + 1
                DEBUGPRINT("Parsed tablerow " << int(getu8(sprm.Data(0))) << " * " << int((sprm.OpSize()-3)/2));

                cells.resize(std::min<unsigned> (getu8(sprm.Data(0)),(sprm.OpSize()-3)/2), TableCell());
                margins.resize(cells.size()+1);
                margins[0]=gets16lsb(sprm.Data(1)); //FIXME? + dxaGapHalf_delta;

                unsigned tc_start = 1 + (cells.size()+1)*sizeof(uint16_t);

                for (unsigned cell=0;cell<cells.size();++cell)
                {
                        margins[cell+1] = gets16lsb(sprm.Data(3+cell*sizeof(uint16_t)));

                        //Does the data exist?
                        if (sprm.OpSize() >= tc_start + tc_size)
                        {
                                cells[cell].PackedRead(sprm.Data(tc_start));
                                tc_start += tc_size;
                        }
                }
                return 0;
            }

        case 0x09: //TDefTableShd
        {
                unsigned num_updates = std::min<unsigned>(cells.size(),(sprm.OpSize())/2);

                for (unsigned cell=0;cell<num_updates;++cell)
                    cells[cell].bgcolor = ParseSHD(getu16lsb(sprm.Data(cell*2)));
                return 0;
        }

        case 0xA: //Table look specifier
                if (sprm.OpSize()==4)
                {
                        DEBUGPRINT("Set table look: style " << Blex::getu16lsb(sprm.Data(0)) << " set flags: " << Blex::getu16lsb(sprm.Data(2)));
                        return 0;
                }
                DEBUGPRINT("Table look specifier of unexpected size " << sprm.OpSize());
                return 1;

        case 0x10: //don't know which is which
        case 0x1E:
                DEBUGPRINT("Table distance from surrounding text, left or right: " << sprm.GetValue<uint16_t>());
                return 0;

        case 0x11:
                DEBUGPRINT("Table distance from surrounding text, top: " << sprm.GetValue<uint16_t>());
                return 0;

        case 0x12:
            {   /* Word 2000 extended table shadings. Ten bytes per cell,
                ForeRed(8),ForeGreen(8),ForeBlue(8),Unknown(8),
                BackRed(8),BackGreen(8),BackBlue(8),Unknown(8),
                Shading(8),Unknown(8) */

                //Get the number of cells that are defined here
                unsigned num_updates = std::min<unsigned>(cells.size(),sprm.OpSize()/10);

                for (unsigned cell=0;cell<num_updates;++cell)
                {
                        ptr=sprm.Data(cell*10);
                        cells[cell].bgcolor=ParseSHD2000(ptr);
                }
                return 0;
            }

        case 0x13: //Word2000 sprmTTableBorders
                return ParseTableBorders2000(parent,sprm);

        case 0x14: //Word2000 Table preferred width
                wWidth = ParsePercOrTwips(sprm);
                return 0;

        case 0x15: //Word2000 table ???
                DEBUGPRINT("Prop 15 ?? value=" << (int)sprm.GetValue<uint8_t>());
                return 0;

        case 0x17: //sprmTWidthBefore (first byte is ftsWidth, remainder 2 are wWidth)
                wWidthBefore = ParsePercOrTwips(sprm);
                return 0;

        case 0x18: //sprmTWidthAfter (first byte is ftsWidth, remainder 2 are wWidth)
                wWidthAfter = ParsePercOrTwips(sprm);
                return 0;

        case 0x1A: //For every cell, the overriden TOP border color
            {
                //Get the number of cells that are defined here
                unsigned num_updates = std::min<unsigned>(cells.size(),sprm.OpSize()/4);
                for (unsigned cell=0;cell<num_updates;++cell)
                    cells[cell].bordertop.color = DrawLib::Pixel32::GetRedFirstInverseAlpha(sprm.Data(cell*4));
                return 0;
            }

        case 0x1B: //For every cell, the overriden LEFT border color
            {
                //Get the number of cells that are defined here
                unsigned num_updates = std::min<unsigned>(cells.size(),sprm.OpSize()/4);
                for (unsigned cell=0;cell<num_updates;++cell)
                    cells[cell].borderleft.color = DrawLib::Pixel32::GetRedFirstInverseAlpha(sprm.Data(cell*4));
                return 0;
            }

        case 0x1C: //For every cell, the overriden BOTTOM border color
            {
                //Get the number of cells that are defined here
                unsigned num_updates = std::min<unsigned>(cells.size(),sprm.OpSize()/4);
                for (unsigned cell=0;cell<num_updates;++cell)
                    cells[cell].borderbottom.color = DrawLib::Pixel32::GetRedFirstInverseAlpha(sprm.Data(cell*4));
                return 0;
            }

        case 0x1D: //For every cell, the overriden RIGHT border color
            {
                //Get the number of cells that are defined here
                unsigned num_updates = std::min<unsigned>(cells.size(),sprm.OpSize()/4);
                for (unsigned cell=0;cell<num_updates;++cell)
                    cells[cell].borderright.color = DrawLib::Pixel32::GetRedFirstInverseAlpha(sprm.Data(cell*4));
                return 0;
            }

        case 0x1F:
                DEBUGPRINT("Table distance from surrounding text, bottom: " << sprm.GetValue<uint16_t>());
                return 0;

        case 0x20: //sprmTSetBrc - override BRC
        {
                if (sprm.OpSize() < 7)
                {
                        DEBUGPRINT("sprmTSetBrc command too short");
                        return 1;
                }

                unsigned update = Blex::Bound<unsigned>(0,cells.size()-1,getu8(sprm.Data(0)));
                unsigned update_limit = Blex::Bound<unsigned>(update,cells.size(),getu8(sprm.Data(1)));

                for (;update<update_limit;++update)
                {
                        if (getu8(sprm.Data(2)) & 8) //set BRC right
                            cells[update].borderright.PackedRead97(sprm.Data(3));
                        if (getu8(sprm.Data(2)) & 4) //set BRC bottom
                            cells[update].borderbottom.PackedRead97(sprm.Data(3));
                        if (getu8(sprm.Data(2)) & 2) //set BRC left
                            cells[update].borderleft.PackedRead97(sprm.Data(3));
                        if (getu8(sprm.Data(2)) & 1) //set BRC top
                            cells[update].bordertop.PackedRead97(sprm.Data(3));
                }
                return 0;
        }

        case 0x22: //sprmTDelete - delete table cells
        {
                //Remove cells data[0] through data[1]-1
                if (sprm.OpSize()!=2)
                    return 1;

                unsigned delete_begin = Blex::Bound<unsigned>(0,cells.size()-1,getu8(sprm.Data(0)));
                unsigned delete_limit = Blex::Bound<unsigned>(delete_begin,cells.size(),getu8(sprm.Data(1)));

                if (delete_begin<delete_limit)
                {
                        cells.erase(cells.begin()+delete_begin,cells.begin()+delete_limit);
                        margins.erase(margins.begin()+delete_begin,margins.begin()+delete_limit);
                }
                return 0;
        }

        case 0x23: //sprmTDxaCol
        {
                if (sprm.OpSize()!=4)
                    return 1;

                unsigned change_begin = Blex::Bound<unsigned>(0, cells.size(), getu8(sprm.Data(0)));
                unsigned change_limit = Blex::Bound<unsigned>(0, cells.size(), getu8(sprm.Data(1)));

                /* Bytes 4 and 5 contain the new width of the cell, call it dxaCol. This sprm causes
                   the itcLim - itcFirst entries of tap.rgdxaCenter to be adjusted so that
                   tap.rgdxaCenter[i+1] = tap.rgdxaCenter[i] + dxaCol. Any tap.rgdxaCenter entries
                   that exist beyond itcLim are adjusted to take into account the amount added to
                   or removed from the previous columns */
                if (change_begin<change_limit)
                {
                        int32_t totalchange = 0;

                        for (unsigned i=change_begin;i<change_limit;++i)
                        {
                                int32_t new_width = margins[i] + getu16lsb(sprm.Data(2));
                                totalchange += new_width - margins[i+1];
                                margins[i+1]=new_width;
                        }

                        for (unsigned i=change_limit;i<cells.size();++i)
                            margins[i+1] += totalchange;
                    }
                return 0;
        }

        case 0x2D:
        {     /* Word 2000 extended table shadings override.
                 First element: start cell index. Second element: limit cell index
                 And then:
                ForeRed(8),ForeGreen(8),ForeBlue(8),Unknown(8),
                BackRed(8),BackGreen(8),BackBlue(8),Unknown(8),
                Shading(8),Unknown(8)

                The implementation of this property is pure guesswork, unfortunately.
                I'm guessing this is a combination between 0x12 (Word 2000
                32-bit table cell backgrounds) and 0x22 (update a range of cells) */

                if (sprm.OpSize() != 12)
                {
                        DEBUGPRINT("SprmT Word 2000 extended table shadings command bad len");
                        return 1;
                }

                unsigned update = Blex::Bound<unsigned>(0,cells.size()-1,getu8(sprm.Data(0)));
                unsigned update_limit = Blex::Bound<unsigned>(update,cells.size(),getu8(sprm.Data(1)));

                DrawLib::Pixel32 foreground = DrawLib::Pixel32::GetRedFirstInverseAlpha(sprm.Data(2));
                DrawLib::Pixel32 background = DrawLib::Pixel32::GetRedFirstInverseAlpha(sprm.Data(6));
                if (foreground.IsFullyTransparent()) //automatic? (ADDME: Instead, set the FGAutomatic bit?)
                    foreground = DrawLib::Pixel32(0,0,0,255); //black

                DrawLib::Pixel32 cellbgcolour = MixColors(*sprm.Data(10)/*pattern*/,foreground,background);
                DEBUGONLY(if (*sprm.Data(11)) DEBUGPRINT("Unknown word2000 table shading value " << *sprm.Data(11)));

                for (;update<update_limit;++update)
                    cells[update].bgcolor = cellbgcolour;

                return 0;
        }

        case 0x2F: //sprmTSetBrc2000 - override BRC for word 2000
        {
                if (sprm.OpSize() < 3 + 8)
                {
                        DEBUGPRINT("sprmTSetBrc2000 command too short");
                        return 1;
                }

                unsigned update = Blex::Bound<unsigned>(0,cells.size()-1,getu8(sprm.Data(0)));
                unsigned update_limit = Blex::Bound<unsigned>(update,cells.size(),getu8(sprm.Data(1)));

                for (;update<update_limit;++update)
                {
                        if (getu8(sprm.Data(2)) & 8) //set BRC right
                            cells[update].borderright.PackedRead2000(sprm.Data(3));
                        if (getu8(sprm.Data(2)) & 4) //set BRC bottom
                            cells[update].borderbottom.PackedRead2000(sprm.Data(3));
                        if (getu8(sprm.Data(2)) & 2) //set BRC left
                            cells[update].borderleft.PackedRead2000(sprm.Data(3));
                        if (getu8(sprm.Data(2)) & 1) //set BRC top
                            cells[update].bordertop.PackedRead2000(sprm.Data(3));
               }
               return 0;
        }

            case 0x32:
                /* 0x32: SET CELL MARGIN
                   byte 0: First cell to set
                   byte 1: Limit cell to set
                   byte 2: Property to overwrite (bit 0: top, bit 1: bottom, bit 2: left, bit 3: right)
                   byte 3: unknown: always 3?
                   byte 4/5: uint16_t: Margin to apply (twips) */
                if (sprm.OpSize() != 6 || Blex::getu8(sprm.Data(2))>15 || Blex::getu8(sprm.Data(3))!=3)
                {
                        DEBUGPRINT("ODD SET CELL MARGIN!!! (we found a new type of 0x32 TAP SPRM)");
                        //DEBUGPRINT("TAP 32: %x %x %x %x %x %x",sprm.Data(0)[0],sprm.Data(0)[1],sprm.Data(0)[2],sprm.Data(0)[3],sprm.Data(0)[4],sprm.Data(0)[5]));
                        return 1;
                }
                else
                {
                        unsigned update = Blex::Bound<unsigned>(0,cells.size()-1,getu8(sprm.Data(0)));
                        unsigned update_limit = Blex::Bound<unsigned>(update,cells.size(),getu8(sprm.Data(1)));

                        for (;update<update_limit;++update)
                            ApplyPaddingToDistance(getu16lsb(sprm.Data(4)), getu8(sprm.Data(2)), &cells[update].cellpadding);
                }
                return 0;

            case 0x33:
                if (sprm.OpSize() == 6)
                {
                        DEBUGPRINT("TAP 33: " << (unsigned)sprm.Data(0)[0] << " " << (unsigned)sprm.Data(0)[1] << " " << (unsigned)sprm.Data(0)[2]<< " " << (unsigned)sprm.Data(0)[3]<< " " << (unsigned)sprm.Data(0)[4]<< " " << (unsigned)sprm.Data(0)[5]);
                        cellspacing = Blex::getu16lsb(sprm.Data(4));
                }
                else
                {
                        DEBUGPRINT("TAP 33 unexpected len " << sprm.OpSize());
                }
                return 1;

            case 0x34: //Set default cell margins for table
                if (sprm.OpSize() != 6 || Blex::getu8(sprm.Data(0)) != 0 || Blex::getu8(sprm.Data(1)) != 1 || Blex::getu8(sprm.Data(2))>15 || Blex::getu8(sprm.Data(3))!=3)
                {
                        DEBUGPRINT("ODD SET DEFAULT CELL MARGIN!!! (we found a new type of 0x34 TAP SPRM)");
                        //DEBUGPRINT("TAP 34: " << sprm.Data(0)[0] << " " << sprm.Data(0)[1] << " " << sprm.Data(0)[2]<< " " << sprm.Data(0)[3]<< " " << sprm.Data(0)[4]<< " " << sprm.Data(0)[5]);
                        return 1;
                }
                else
                {
                        ApplyPaddingToDistance(getu16lsb(sprm.Data(4)), getu8(sprm.Data(2)), &default_cellpadding);
                        return 0;
                }

        case 0x61:
                wWidthIndent = ParsePercOrTwips(sprm);
                return 0;

        #ifdef DEBUG
/*            case 0x15:
                if (sprm.OpSize() == 1)
                    DEBUGPRINT("TAP 15: %x",sprm.Data(0)[0]));
                else
                    DEBUGPRINT("TAP 15 unexpected len " << sprm.OpSize()));
                return 1;                       */
            case 0x62:
                if (sprm.OpSize() == 1)
                    DEBUGPRINT("TAP 62: " << (unsigned)sprm.Data(0)[0]);
                else
                    DEBUGPRINT("TAP 62 unexpected len " << sprm.OpSize());
                return 1;
            case 0x65:
                if (sprm.OpSize() == 1)
                    DEBUGPRINT("TAP 65: " << (unsigned)sprm.Data(0)[0]);
                else
                    DEBUGPRINT("TAP 65 unexpected len " << sprm.OpSize());
                return 1;
#endif
            }
        DEBUGPRINT("Undocumented TAP sprm " << std::hex << sprm.CommandCode() << std::dec << " len " << sprm.OpSize() << " data " << std::hex << sprm.GetValue<uint32_t>() << std::dec);
        return 2;
}



} // End of namespace Word
} // End of namespace Office
} // End of namespace Parsers
