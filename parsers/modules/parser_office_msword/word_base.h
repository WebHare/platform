#ifndef blex_webhare_hare_msword_word
#define blex_webhare_hare_msword_word

#include <blex/docfile.h>
#include <blex/objectowner.h>
#include <blex/xml.h>
#include <parsers/office_escher/escher.h>
#include "word_lists.h"
#include <parsers/base/formatter.h>
#include <parsers/base/filtering.h>
#include <stack>

namespace Parsers {
namespace Office {
namespace Word {

namespace DocX {
class DocXDoc;
} //end namespace DocX

class EscherDataStore;
typedef std::shared_ptr<EscherDataStore> EscherDataStorePtr;
/** Word character coordinate (Cp's are based from the document text
    beginning, and are affected by character size (8 or 16bit) and
    the piece table (fast-saved documents) */
typedef uint32_t Cp;

//Forward declarations
//class BiffDoc;
class DocBase;
class OutputObject;
struct Pap;
struct Tap;
struct Chp;
struct ComplexRecord;
class DocPart;
struct ParaCharStyle;
class ParagraphWalker;
class DocPart;

///Word file coordinate (Fc's are based from the OLE stream beginning)
typedef uint32_t Fc;
///Word Style Id
typedef uint16_t StyleId;


namespace Colors
{

enum Word97Colors
{
        Auto=-1, Word97Auto=0,
        Black=1, Blue=2, Cyan=3,
        Green=4, Magenta=5, Red=6, Yellow=7,
        White=8, Darkblue=9, Darkcyan=10,
        Darkgreen=11, Darkmagenta=12, Darkred=13,
        Darkyellow=14, Darkgray=15, Lightgray=16
};

// Note: This table is a duplicate of the palette table in escher_util.cpp,
// in the 'publishing' project.
// ADDME: Cleanup.
extern const DrawLib::Pixel32 colormap[16];

inline DrawLib::Pixel32 GetRGBA (signed color)
{
        return color<=Word97Auto || color>Lightgray ? DrawLib::Pixel32(0,0,0,0) : colormap[color-1];
}

} //end namespace Colors

/** Border code */
struct Brc
{
        enum BorderTypeCode
        {
                None=0, Single=1, Double=3, Hairline=5, Dot=6, DashLargeGap=7,
                DotDash=8, DotDotDash=9, Triple=10,
                ThinThickSmallGap=11, ThickThinSmallGap=12, ThinThickThinSmallGap=13,
                ThinThickMediumGap=14, ThickThinMediumGap=15, ThinThickThinMediumGap=16,
                ThinThickLargeGap=17, ThickThinLargeGap=18, ThinThickThinLargeGap=19,
                Wave=20, DoubleWave=21, DashSmallGap=22, DashDotStroked=23, Emboss3D=24, Engrave3D=25,
                Undocumented255=255
        };

        Brc()
        : color(0,0,0,255)
        {
                linewidth=0;
                bordertype=None;
                borderspace=0;
                shadow=false;
        }

        ///Does this BRC indicate that the default value must be used (used for TCs - speculative coding)
        bool IsDefault() const
        {
                return linewidth == 0 && bordertype == None;
        }

        void PackedRead97(uint8_t const *packed_brc);
        void PackedRead2000(uint8_t const *packed_brc);

        ///Width of a single line in 1/8 pt, max of 32pt.
        unsigned linewidth;
        ///Border type code
        BorderTypeCode bordertype;
        ///Border color
        DrawLib::Pixel32 color;
        ///Width of space to maintain between border and text within border
        unsigned borderspace;
        //Draw border with shadow?
        unsigned shadow : 1;
};

inline Parsers::Character::Underlines MapUnderlines(unsigned underlining)
{
        //ADDME: Support for other underlining styles
        if (underlining==0)
            return Parsers::Character::NoUnderline;
        else
            return Parsers::Character::SingleUnderline;
}

inline Parsers::HorizontalAlignment MapHorizontalAlignment(unsigned alignment)
{
        if(alignment==1)
            return Parsers::Center;
        if(alignment==2)
            return Parsers::Right;
        if(alignment==3)
            return Parsers::Justified;
        return Parsers::Left;
}

inline Parsers::VerticalAlignment MapVerticalAlignment(unsigned alignment)
{
        if (alignment==1)
            return Parsers::Middle;
        else if (alignment==2)
            return Parsers::Bottom;
        else
            return Parsers::Top;
}

class SprmData
{
        uint32_t packed_sprm;
        const uint8_t *sprm_data;

        public:
        inline SprmData()
        {
        }
        inline SprmData(uint32_t sprm,const uint8_t *data) : packed_sprm(sprm),sprm_data(data)
        {
        }

        inline const uint8_t* Data(unsigned position) const
        { return sprm_data+position; }
        inline uint16_t Category() const
        { return uint16_t((packed_sprm&0x1C00) >> 10); } //sgc
        inline uint16_t CommandCode() const //_ispmd
        { return uint16_t(packed_sprm&0x1ff); }
        inline bool Special() const //_fspec
        { return bool(packed_sprm&0x200); }
        inline unsigned OpSize() const //_opsize
        { return uint16_t(packed_sprm>>16); }
        template <class ValueType> ValueType GetValue() const
        {
                if (OpSize()>=4)
                    return ValueType(Blex::gets32lsb(sprm_data));
                else if (OpSize()>=2)
                    return ValueType(Blex::gets16lsb(sprm_data));
                else
                    return ValueType(Blex::gets8(sprm_data));
        }
};

/** Word document header.

    ADDME: We're not entirely following the spec, because some groups of fields are
           actually dynamic and have their offset determined somewhere else in
           the header. Honouring these pointers (in Word97 files) may increase
           our robustness in reading future file versions (although hasn't appeared
           to be necessary up to 2003)*/
class Header
{
        uint8_t data[0x30A];

        bool IsWord97() const   { return Blex::getu16lsb(data+2) >= 0x69; }

        public:
        bool IsWord2000() const { return IsWord97() && Blex::getu16lsb(data+4) >= 0x200B; } //Word97 docs reported at least 0047 on one occasion

        inline uint16_t Ident() const                        { return Blex::getu16lsb(data+0); }     // 0000 Magic number
        inline uint16_t Version() const                      { return Blex::getu16lsb(data+2); }     // 0002 FIB version written
        inline uint16_t Product() const                      { return Blex::getu16lsb(data+4); }   // 0004 Product version written by

        //booleans
        inline bool IsTemplate() const                  { return Blex::getu16lsb(data+0xA)&1; }
        inline bool IsGlossary() const                  { return Blex::getu16lsb(data+0xA)&2; }
        inline bool IsComplex() const                   { return Blex::getu16lsb(data+0xA)&4; }
        inline bool HasPictures() const                 { return Blex::getu16lsb(data+0xA)&8; }
        inline bool IsEncrypted() const                 { return Blex::getu16lsb(data+0xA)&0x100; }
        inline bool IsWriteReserved() const             { return Blex::getu16lsb(data+0xA)&0x800; }
        inline bool IsExtendedCharset() const           { return Blex::getu16lsb(data+0xA)&0x1000; }
        inline bool IsLastSaveMac() const               { return Blex::getu8    (data+0x13)&1; }
        inline bool IsTable1() const                    { return Blex::getu16lsb(data+0xA)&0x200; }
        inline bool IsTable0() const                    { return !IsTable1(); }

        /** FC of first character */
        inline Fc OffsetFirstCharacter() const  { return Blex::gets32lsb(data+0x18); }
        /** FC of last character (NOTE: Can't be trusted, doesn't consider pieces moved past the end) */
        inline Fc OffsetLimitCharacter() const  { return Blex::gets32lsb(data+0x1C); }
        inline int32_t MainDocLength() const                { return IsWord97() ? Blex::gets32lsb(data+0x4c) : Blex::gets32lsb(data+0x34); }
        inline int32_t FootnoteDocLength() const            { return IsWord97() ? Blex::gets32lsb(data+0x50) : Blex::gets32lsb(data+0x38); }
        inline int32_t HeaderDocLength() const              { return IsWord97() ? Blex::gets32lsb(data+0x54) : Blex::gets32lsb(data+0x3C); }
        inline int32_t MacroDocLength() const               { return IsWord97() ? Blex::gets32lsb(data+0x58) : Blex::gets32lsb(data+0x40); }
        inline int32_t AnnotationDocLength() const          { return IsWord97() ? Blex::gets32lsb(data+0x5C) : Blex::gets32lsb(data+0x44); }
        inline int32_t EndnoteDocLength() const             { return IsWord97() ? Blex::gets32lsb(data+0x60) : Blex::gets32lsb(data+0x48); }
        inline int32_t TextboxDocLength() const             { return IsWord97() ? Blex::gets32lsb(data+0x64) : Blex::gets32lsb(data+0x4C); }
        inline int32_t HeaderTextboxDocLength() const       { return IsWord97() ? Blex::gets32lsb(data+0x68) : Blex::gets32lsb(data+0x50); }

        inline Cp MainDocStart() const                  { return 0; }
        inline Cp FootnoteDocStart() const              { return MainDocStart() + MainDocLength(); }
        inline Cp HeaderDocStart() const                { return FootnoteDocStart() + FootnoteDocLength(); }
        inline Cp MacroDocStart() const                 { return HeaderDocStart() + HeaderDocLength(); }
        inline Cp AnnotationDocStart() const            { return MacroDocStart() + MacroDocLength(); }
        inline Cp EndnoteDocStart() const               { return AnnotationDocStart() + AnnotationDocLength(); }
        inline Cp TextboxDocStart() const               { return EndnoteDocStart() + EndnoteDocLength(); }
        inline Cp HeaderTextboxDocStart() const         { return TextboxDocStart() + TextboxDocLength(); }

        ///Document length (end position of the last text part)
        inline Cp DocumentLimitCp() const              { return HeaderTextboxDocStart() +HeaderTextboxDocLength(); }

        inline int32_t FirstChpPage() const                 { return IsWord97() ? Blex::gets32lsb(data+0x70) : Blex::gets16lsb(data+0x18A); }
        inline int32_t CountChpPages() const                { return IsWord97() ? Blex::gets32lsb(data+0x74) : Blex::gets16lsb(data+0x18E); }
        inline int32_t FirstPapPage() const                 { return IsWord97() ? Blex::gets32lsb(data+0x7C) : Blex::gets16lsb(data+0x18C); }
        inline int32_t CountPapPages() const                { return IsWord97() ? Blex::gets32lsb(data+0x80) : Blex::gets16lsb(data+0x190); }
        inline int32_t FirstLvcPage() const                 { return IsWord97() ? Blex::gets32lsb(data+0x88) : 0; }
        inline int32_t CountLvcPages() const                { return IsWord97() ? Blex::gets32lsb(data+0x8C) : 0; }

        inline int32_t OffsetOriginalStylesheet() const     { return IsWord97() ? Blex::gets32lsb(data+0x9A) : Blex::gets32lsb(data+0x58); }
        inline uint32_t LengthOriginalStylesheet() const     { return IsWord97() ? Blex::getu32lsb(data+0x9E) : Blex::getu32lsb(data+0x5C); }
        inline int32_t OffsetStylesheet() const             { return IsWord97() ? Blex::gets32lsb(data+0xA2) : Blex::gets32lsb(data+0x60); }
        inline uint32_t LengthStylesheet() const             { return IsWord97() ? Blex::getu32lsb(data+0xA6) : Blex::getu32lsb(data+0x64); }

        inline int32_t OffsetFootnoteFRDs() const           { return IsWord97() ? Blex::gets32lsb(data+0xAA) : 0; }
        inline uint32_t LengthFootnoteFRDs() const           { return IsWord97() ? Blex::getu32lsb(data+0xAE) : 0; }
        inline int32_t OffsetFootnoteTexts() const          { return IsWord97() ? Blex::gets32lsb(data+0xB2) : 0; }
        inline uint32_t LengthFootnoteTexts() const          { return IsWord97() ? Blex::getu32lsb(data+0xB6) : 0; }
        inline int32_t OffsetAnnotationATRDs() const        { return IsWord97() ? Blex::gets32lsb(data+0xBA) : 0; }
        inline uint32_t LengthAnnotationATRDs() const        { return IsWord97() ? Blex::getu32lsb(data+0xBE) : 0; }
        inline int32_t OffsetAnnotationTexts() const        { return IsWord97() ? Blex::gets32lsb(data+0xC2) : 0; }
        inline uint32_t LengthAnnotationTexts() const        { return IsWord97() ? Blex::getu32lsb(data+0xC6) : 0; }
        inline int32_t OffsetEndnoteFRDs() const            { return IsWord97() ? Blex::gets32lsb(data+0x20A) : 0; }
        inline uint32_t LengthEndnoteFRDs()  const           { return IsWord97() ? Blex::getu32lsb(data+0x20E) : 0; }
        inline int32_t OffsetEndnoteTexts() const           { return IsWord97() ? Blex::gets32lsb(data+0x212) : 0; }
        inline uint32_t LengthEndnoteTexts() const           { return IsWord97() ? Blex::getu32lsb(data+0x216) : 0; }

        inline int32_t OffsetChpxTable() const              { return IsWord97() ? Blex::gets32lsb(data+0xFA) : Blex::gets32lsb(data+0xB8); }
        inline uint32_t LengthChpxTable() const              { return IsWord97() ? Blex::getu32lsb(data+0xFE) : Blex::getu32lsb(data+0xBC); }
        inline int32_t OffsetPapxTable() const              { return IsWord97() ? Blex::gets32lsb(data+0x102) : Blex::gets32lsb(data+0xC0); }
        inline uint32_t LengthPapxTable() const              { return IsWord97() ? Blex::getu32lsb(data+0x106) : Blex::getu32lsb(data+0xC4); }

        inline int32_t OffsetSedPlc() const                 { return IsWord97() ? Blex::gets32lsb(data+0xCA) : Blex::gets32lsb(data+0x88); }
        inline uint32_t LengthSedPlc() const                 { return IsWord97() ? Blex::getu32lsb(data+0xCE) : Blex::getu32lsb(data+0x8C); }

        inline int32_t OffsetFontSttbf() const              { return IsWord97() ? Blex::gets32lsb(data+0x112) : Blex::gets32lsb(data+0xD0); }
        inline uint32_t LengthFontSttbf() const              { return IsWord97() ? Blex::getu32lsb(data+0x116) : Blex::gets32lsb(data+0xD4); }

        inline int32_t OffsetComplexTable() const           { return IsWord97() ? Blex::gets32lsb(data+0x1A2) : Blex::gets32lsb(data+0x160); }
        inline uint32_t LengthComplexTable() const           { return IsWord97() ? Blex::getu32lsb(data+0x1A6) : Blex::getu32lsb(data+0x164); }

        inline int32_t OffsetFspaPlcMainDoc() const         { return IsWord97() ? Blex::gets32lsb(data+0x1DA) : 0; }
        inline uint32_t LengthFspaPlcMainDoc() const         { return IsWord97() ? Blex::getu32lsb(data+0x1DE) : 0; }

        inline int32_t OffsetDggInfo() const                { return IsWord97() ? Blex::gets32lsb(data+0x22A) : 0; }
        inline uint32_t LengthDggInfo() const                { return IsWord97() ? Blex::getu32lsb(data+0x22E) : 0; }

        inline int32_t OffsetFldPlcMainDoc() const          { return IsWord97() ? Blex::gets32lsb(data+0x11A) : Blex::gets32lsb(data+0xD8); }
        inline uint32_t LengthFldPlcMainDoc() const          { return IsWord97() ? Blex::getu32lsb(data+0x11E) : Blex::getu32lsb(data+0xDC); }

        inline int32_t OffsetFldPlcHeaderDoc() const        { return IsWord97() ? Blex::gets32lsb(data+0x122) : 0; }
        inline uint32_t LengthFldPlcHeaderDoc() const        { return IsWord97() ? Blex::getu32lsb(data+0x126) : 0; }
        inline int32_t OffsetFldPlcFootnoteDoc() const      { return IsWord97() ? Blex::gets32lsb(data+0x12A) : 0; }
        inline uint32_t LengthFldPlcFootnoteDoc() const      { return IsWord97() ? Blex::getu32lsb(data+0x12E) : 0; }
        inline int32_t OffsetFldPlcEndnoteDoc() const       { return IsWord97() ? Blex::gets32lsb(data+0x21A) : 0; }
        inline uint32_t LengthFldPlcEndnoteDoc() const       { return IsWord97() ? Blex::getu32lsb(data+0x21E) : 0; }
        inline int32_t OffsetFldPlcAnnotationDoc() const    { return IsWord97() ? Blex::gets32lsb(data+0x132) : 0; }
        inline uint32_t LengthFldPlcAnnotationDoc() const    { return IsWord97() ? Blex::getu32lsb(data+0x126) : 0; }
        inline int32_t OffsetFldPlcTextboxDoc() const       { return IsWord97() ? Blex::gets32lsb(data+0x262) : 0; }
        inline uint32_t LengthFldPlcTextboxDoc() const       { return IsWord97() ? Blex::getu32lsb(data+0x266) : 0; }

        inline int32_t OffsetBookmarkInfo() const           { return IsWord97() ? Blex::gets32lsb(data+0x142) : Blex::gets32lsb(data+0x100); }
        inline uint32_t LengthBookmarkInfo() const           { return IsWord97() ? Blex::getu32lsb(data+0x146) : Blex::getu32lsb(data+0x104); }

        inline int32_t OffsetPlcfBookmarkStart() const      { return IsWord97() ? Blex::gets32lsb(data+0x14A) : Blex::gets32lsb(data+0x108); }
        inline uint32_t LengthPlcfBookmarkStart() const      { return IsWord97() ? Blex::getu32lsb(data+0x14E) : Blex::getu32lsb(data+0x10C); }

        inline int32_t OffsetPlcfBookmarkEnd() const        { return IsWord97() ? Blex::gets32lsb(data+0x152) : Blex::gets32lsb(data+0x110); }
        inline uint32_t LengthPlcfBookmarkEnd() const        { return IsWord97() ? Blex::getu32lsb(data+0x156) : Blex::getu32lsb(data+0x114); }

        inline int32_t OffsetPlcfTextboxes() const          { return IsWord97() ? Blex::gets32lsb(data+0x25A) : Blex::gets32lsb(data+0x222); }
        inline uint32_t LengthPlcfTextboxes() const          { return IsWord97() ? Blex::getu32lsb(data+0x25E) : Blex::getu32lsb(data+0x226); }

        inline int32_t OffsetPlcfTextboxFields() const      { return IsWord97() ? Blex::gets32lsb(data+0x262) : Blex::gets32lsb(data+0x22A); }
        inline uint32_t LengthPlcfTextboxFields() const      { return IsWord97() ? Blex::getu32lsb(data+0x266) : Blex::getu32lsb(data+0x22E); }

        inline int32_t OffsetListFormatInfo() const         { return IsWord97() ? Blex::gets32lsb(data+0x2E2) : 0; }
        inline uint32_t LengthListFormatInfo() const         { return IsWord97() ? Blex::getu32lsb(data+0x2E6) : 0; }

        inline int32_t OffsetListFormatOverrides() const    { return IsWord97() ? Blex::gets32lsb(data+0x2EA) : 0; }
        inline uint32_t LengthListFormatOverrides() const    { return IsWord97() ? Blex::getu32lsb(data+0x2EE) : 0; }

};

/** Information about a textbox */
struct TextBoxInfo
{
        ///Start offset of the text inside the associated textbox stream
        Cp startcp;
        ///Limit offset of the text inside the associated textbox stream
        Cp limitcp;
        ///The 'odd' bytes - don't yet know what their purpose is
        uint8_t oddbytes[22];
};

/** The cache of cached grpprls */
class GrpprlCache
{
        public:
        /** Prepare space for a grpprl of 'size' bytes
            @param size number of bytes in grpprl
            @return pointer to this grpprl */
        GrpprlPointer Reserve(unsigned size);
        /** Store a grpprl at the specified location */
        GrpprlPointer Store(unsigned size, uint8_t const *data);

        private:
        typedef uint8_t Cache[65536];

        struct CacheBlock
        {
                CacheBlock() : used(0)
                {
                }

                Cache data;
                unsigned used;
        };
        std::list<CacheBlock> blocks;
};

struct Font
{
        Font();

        enum MSFontType
        {
                Plain,
                Symbol,
                Wingdings
        };

        std::string name;
        Parsers::Font formatted;

        uint8_t      prq;
        bool    truetype;
        uint8_t      fontfamily;
        int16_t     baseweight;
        uint8_t      charset;
        uint8_t      alternative;            // index into ffn.szFfn
        MSFontType msfonttype;

        ///if not null, character remapping table for this font
        const uint32_t *charactermap;
};

/** Section properties */
struct Sep
{
        Sep();

        //BiffDoc *parent;          //where's my parent?

        struct Pod
        {
                uint8_t      bkc;                    // 0000 break code: 0=no break, 1=new column, 2=new page, 3=even page, 4=odd page
                uint8_t      fTitlePage;             // 0001 1 if titlepage is to be displayed
                int8_t      fAutoPgn;               // 0002 mac-stuff
                uint8_t      nfcPgn;                 // 0003 page number format code: 0=Arabic, 1=Roman(upper case), 2=Roman(lower case), 3=Letter (upper case), 4=Letter (lower case)
                uint8_t      fUnlocked;              // 0004 1 if this section is unlocked inside a locked document
                uint8_t      cnsPgn;                 // 0005 chapter number seperator for page numbers
                uint8_t      fPgnRestart;            // 0006 set to 1 when page numbering should be restarted at the beginning of this section
                uint8_t      fEndNote;               // 0007 when 1, footnotes placed at end of section. When 0, footnotes are placed at bottom of page.
                int8_t      lnc;                    // 0008 line numbering code: 0 Per page  1 Restart  2 Continue
                int8_t      grpfIhdt;               // 0009 specification of which headers and footers are included in this section. See explanation in Headers and Footers topic. No longer used.
                uint16_t     nLnnMod;                // 000A if 0, no line numbering, otherwise this is the line number modulus (e.g. if nLnnMod is 5, line numbers appear on line 5, 10, etc.)
                int32_t     dxaLnn;                 // 000C distance of
                int16_t     dxaPgn;                 // 0010 when fAutoPgn ==1, gives the x position of auto page number on page in twips (for Mac compatibility only)
                int16_t     dyaPgn;                 // 0012 when fAutoPgn ==1, gives the y position of auto page number on page in twips (for Mac compatibility only)
                uint8_t      fLBetween;              // 0014 when ==1, draw vertical lines between columns
                uint8_t      vjc;                    // 0015 vertical justification code  0 top justified  1 centered  2 fully justified vertically  3 bottom justified
                uint16_t     dmBinFirst;             // 0016 bin number supplied from windows printer driver indicating which bin the first page of section will be printed.
                uint16_t     dmBinOther;             // 0018 bin number supplied from windows printer driver indicating which bin the pages other than the first page of section will be printed.
                //uint16_t   dmPaperReq;             // 001A dmPaper code for form selected by user
                //Brc   brcTop;                 // 001C top page border
                //Brc   brcLeft;                // 0020 left page border
                //Brc   brcBottom;              // 0024 bottom page border
                //Brc   brcRight;               // 0028 right page border
                int16_t     fPropRMark;             // 002C when 1, properties have been changed with revision marking on
                int16_t     ibstPropRMark;          // 002E index to author IDs stored in hsttbfRMark. used when properties have been changed when revision marking was enabled
                //struct dttm dttmPropRMark;    // 0030 Date/time at which properties of this were changed for this run of text by the author. (Only recorded when revision marking is on.)
                int32_t     dxtCharSpace;
                int32_t     dyaLinePitch;
                uint16_t     clm;
                uint8_t      dmOrientPage;           // 0040 orientation of pages in that section. set to 0 when portrait, 1 when landscape
                uint8_t      iHeadingPgn;            // 0041 heading number level for page number
                uint16_t     pgnStart;               // 0042 user specified starting page number.
                int16_t     lnnMin;                 // 0044 beginning line number for section
                uint16_t     wTextFlow;
                uint32_t     xaPage;                 // 004C default value is 12240 twipswidth of page
                uint32_t     yaPage;                 // 0050 default value is 15840 twipsheight of page
                uint32_t     xaPageNUp;
                uint32_t     yaPageNUp;
                uint32_t     dxaLeft;                // 005C default value is 1800 twipsleft margin
                uint32_t     dxaRight;               // 0060 default value is 1800 twipsright margin
                uint32_t     dyaTop;                 // 0064 default value is 1440 twipstop margin
                uint32_t     dyaBottom;              // 0068 default value is 1440 twipsbottom margin
                uint32_t     dzaGutter;              // 006C default value is 0 twips gutter width
                uint32_t     dyaHdrTop;              // 0070 y position of top header measured from top edge of page.
                uint32_t     dyaHdrBottom;           // 0074 y position of bottom header measured from top edge of page.
                int16_t     ccolM1;                 // 0078 number of columns in section - 1.
                uint8_t      fEvenlySpaced;          // 007A when == 1, columns are evenly spaced. Default value is 1.
                int32_t     dxaColumns;             // 007C distance that will be maintained between columns
                int32_t     rgdxaColumnWidthSpacing[89]; // 0080 array of 89 longs that determine bounds of irregular width columns
                int32_t     dxaColumnWidth;
                uint8_t      dmOrientFirst;
                uint8_t      fLayout;
        } pod;
        Olst    olstAnm;

        int Sprm(BiffDoc const &parent, const SprmData &sprm);
        void Apply(Parsers::FormattedOutput *dest) const;
};

struct SectionData
{
        SectionData(BiffDoc &worddoc, Cp startcp, Cp limitcp, std::vector<uint8_t> &grpprl_ptr);

        Cp biff_startcp;
        Cp biff_limitcp;
        Sep sep;
};
typedef std::vector<SectionData> Sections;

/** Storage and reader for Word's String Tables. String tables are a generic
    format, used by Word to store some of its internal tables, such as boomarks.
    It has nothing to do with the actual tables in the word text. */
class Stringtable
{
        public:
        /** Read a Word stringtable
            @param worddata Word document data (needed to figure out if the table is 97 or 95 format)
            @param source Stream to read the string table from
            @param startpos Position of the stringtable inside the above stream
            @param length Length of the stringtable in bytes
            @return false on corruption error */
        bool Read(/*const BiffDoc &worddata, */Blex::RandomStream &source,Blex::FileOffset startpos,uint32_t length);

        //The number of strings stored in this STTBF
        unsigned int Length() const {return strings.size();}

        //The length of the ExtraData fields
        unsigned int LengthData() const {return extradata;}

        //Grab string # from the STTBF
        std::string const &Grab(unsigned int num) const
        {
                return strings[num];
        }

        //Grab extra data # from the STTBF
        const void *Data(unsigned int num) const
        {
                return &extra[num*extradata];
        }

        //Write debugging data
        void Dump(std::ostream &output) const;

        private:
        bool extended;  //true if we're storing extended strings
        unsigned int extradata; //length of the 'extra data' that is attached everywhere

        std::vector<std::string> strings;       //The strings
        std::vector<uint8_t> extra;
};

/** Description of a character exception run (CHPX) */
struct CharData
{
        /** Function object to verify whether a certain FC lies before us */
        struct IsBefore
        {
                bool operator()(const CharData &check, Fc check_fc)
                {
                        return check.limitfc<=check_fc;
                }
        };

        ///FC at which this run starts
        Fc startfc;
        ///FC at which this run ends
        Fc limitfc;
        ///SPRMs to apply to this run's CHP
        GrpprlPointer grpprlptr;
};

class ParaEvent
{
        public:
        virtual ~ParaEvent();
        /** @short Execute the event
            @return True if the character causing this event can be skipped */
        virtual bool Execute(FormattedOutput &output) = 0;
        ///Describe event
        virtual std::string Describe() const;
};
typedef std::shared_ptr<ParaEvent> ParaEventPtr;
typedef std::vector<ParaEventPtr> ParaEventPtrs;
typedef std::map<Cp,ParaEventPtrs> ParaEvents;

struct TableCell
{
        void PackedRead(uint8_t const *packed_tc);

        TableCell();

        DrawLib::Pixel32 bgcolor;
        Parsers::VerticalAlignment vertalign;

        unsigned fFirstMerged : 1;      // 1: cell is first of a range of cells that have been merged
        unsigned fMerged : 1;           // 1: cell has been merged with preceding cell
        unsigned fVertical : 1;         // 1: cell has vertical text flow
        unsigned fBackward : 1;         // 1: ???
        unsigned fRotateFont : 1;       // 1: cell has rotated characters
        unsigned fVertMerge : 1;        // 1: cell is vertically merged with the cells above or below
        unsigned fVertRestart : 1;      // 1: cell is the first of a set of vertically merged cells
        unsigned verifiedVertMerge : 1; // We have verified this vertical merge as legal (Word sometimes screws up)

        Brc bordertop;
        Brc borderleft;
        Brc borderbottom;
        Brc borderright;
        Parsers::Distance cellpadding;
};

struct Tap
{
        typedef std::vector<TableCell> Cells;

        Tap();

        /** Find the cell closest to the specified margin
            @param margin Margin to find
            @return 0 if margin equals the leftmost margin,
                    otherwise cell#+1 whose rightmost margin equal margin */
        unsigned FindClosestCell(int32_t margin) const;

        void Dump(std::ostream &ostr) const;

        int Sprm (BiffDoc const &parent,const SprmData &sprm);

        int32_t     wWidth;                 // Preferred table width (0=unspecified, >0=pixels, <0=percentage)
        int32_t     wWidthIndent;           // Left indent (0=unspecified, >0=pixels, <0=percentage)
        int32_t     wWidthBefore;           // Width of invisible cell (used for layout purposes) before the first visible cell in the row. (0=unspecified, >0=pixels, <0=percentage)
        int32_t     wWidthAfter;            // Width of invisible cell (used for layout purposes) after the last visible cell in the row. (0=unspecified, >0=pixels, <0=percentage)
        Parsers::HorizontalAlignment table_jc; // how to justify the table row in its column. 0=left, 1=center, 2=right
        int32_t     dxaGapHalf;             // halfs of white space that will be maintained between text in adjacent columns of a table row
        int32_t     dxaGapHalf_delta;       //
        int32_t     dyaRowHeight;           // when greater than 0, guarantees that the height of the table will be at least dyaRowHeight
                                // when lses than 0, guarantees that the height of the table will be exactly absolute value of dyaRowHeight high
                                // when 0, table will be given a height large enough to represent all of the text in all cells of the table
        uint16_t     cellspacing;            //< Cell spacing, in twips

        Brc     default_topborder;
        Brc     default_leftborder;
        Brc     default_rightborder;
        Brc     default_bottomborder;
        Brc     default_innerhorizontalborder;
        Brc     default_innerverticalborder;

        Parsers::Distance tablepadding;
        Parsers::Distance default_cellpadding;

        ///Table row may not be split accross page bounds
        unsigned cantsplit : 1;
        ///table row is to be used as the header of the table
        unsigned tableheader : 1;

        //struct tlp tlp;                       // table look specifier
        uint32_t     lwHTMLProps;            // reserved for future use

        std::vector<int32_t> margins;

        Cells cells;

        int ParseTableBorders2000(BiffDoc const &parent,const SprmData &sprm);
        int ParseTableBorders(const SprmData &sprm);

        void ApplyDocXProps(Blex::XML::Node ppr);
        void ApplySingleDocXProp(Blex::XML::Node newnode);
        void DoCellMar(Blex::XML::Node newnode);
        void DoBorders(Blex::XML::Node itr);
        void DoTableWidth(Blex::XML::Node itr);
        void DoJC(Blex::XML::Node newnode);

        struct ParserTable
        {
                const char *entry;
                void (Tap::*parser)(Blex::XML::Node newnode);
        };
        static const ParserTable parsertable[];
};

struct TableDocPart
{
        struct Cell
        {
                Cell()
                : firstpart(NULL)
                , tableheader(false)
                , offset(0)
                {
                }

                DocPart *firstpart;
                bool tableheader;
                ///Offset of this cell from the LHS of the supertable
                unsigned offset;
        };

        struct Row
        {
                std::vector<Cell> cells;
        };

        TableDocPart()
        {
        }

        void ApplyGlobalPropsFromTap(Tap const &tap);
        void PostProcess();

        typedef std::vector<int32_t> Widths;
        Widths margins;

        Tap defaulttap;
        Parsers::Table tableformat;
        std::vector<Row> rows;

        DocPart const* GetFirstDocpart() const;

        inline DocPart* GetFirstDocpart()
        { return const_cast<DocPart*>(const_cast<TableDocPart const*>(this)->GetFirstDocpart()); }
};

class DocPart : public Parsers::OutputObjectInterface
{
        public:
        DocPart(DocBase const &doc, DocPart *parent, ParaCharStyle const *basestyle);
        ~DocPart();

        bool HasAnchor(std::string const &anchorname) const;
        bool HasAnyAnchors() const;

        /*update*/ int32_t GetFinalOutputObjectId() const;

        ///Find the first paragraph which has its 'master' set to us (first paragraph in a collapse set)
        DocPart const *GetFirstSlave() const;
        inline DocPart *GetFirstSlave()
        { return const_cast<DocPart*>(const_cast<DocPart const*>(this)->GetFirstSlave()); }

        virtual std::pair<bool, unsigned> GetParagraphCollapseInfo() const ;

        std::string SuggestAnchorName() const;

        std::string GetAnchor() const ;
        void StartPara(Pap const &pap, Parsers::FormattedOutput &output, Parsers::ObjectType listtype, ParaCharStyle *style) const;

        DocBase const &doc;

        ///The 'master' part. If master!=this, we have been eliminated
        DocPart *master;

        ///BiffDoc/DocX style attached
        ParaCharStyle const * basestyle;
        TableDocPart *table;
        ///Parent docpart
        DocPart *parent;
        ///Previous paragraph
        DocPart *prev;
        ///Next sibling (paragraph/table at _same_ level)
        DocPart *next;

        unsigned add_top_padding;
        unsigned add_bottom_padding;

        std::vector<std::string> initialanchors;
        std::vector<std::string> otheranchors;
        ListCounters listcounters;

        ///List we're a part of
        ListOverride const *listovr;
        ///Our listlevel
        unsigned listlevel;

        ///Enable contextual spacing?
        bool contextualspacing;
        unsigned myspacingtop;
        unsigned myspacingbottom;
};

/** Plcf is a temporary class for reading Plcf tables in a word document */
class Plcf
{
        public:
        Plcf(Blex::RandomStream &tablefile, Fc data_fc, unsigned data_lcb, unsigned structsize, bool readfirst /* defaulted to false */);

        inline unsigned GetNumEntries() const
        {
                return entries;
        }
        uint32_t GetEntryOffset(unsigned entry) const;
        const uint8_t *GetEntryData(unsigned entry) const;

        private:
        Blex::RandomStream &tablefile;
        std::vector<uint8_t> buffer;
        uint32_t entries;
        unsigned structsize;
};

/** Create a RGB color code
    @param pattern      shading pattern
    @param forecolor    foreground color (or FormattedNoColor for none)
    @param backcolor    background color (or -1 for none) */
DrawLib::Pixel32 MixColors(uint8_t pattern, DrawLib::Pixel32 forecolor, DrawLib::Pixel32 backcolor);

DrawLib::Pixel32 MixColors2(unsigned promille, DrawLib::Pixel32 forecolor, DrawLib::Pixel32 backcolor);

struct FieldData
{
        FieldData() : linkopen(false)
        {
        }

        std::string instruction;

        Parsers::Hyperlink link;
        bool linkopen;
};

struct Chp
{
        explicit Chp(DocBase const &parent);
        void Fixup();

        template <int bit> void SetFormattingBit(const Chp &parent_chp, uint8_t setting);
        template <int bit> void SetInternalBit(const Chp &parent_chp, uint8_t setting);
        template <int bit> void CopyParentFormattingBit(const Chp &parent_chp, Chp &temp_chp);
        template <int bit> void CopyParentInternalBit(const Chp &parent_chp, Chp &temp_chp);

        enum
        {
                Caps        = 0x00000001,
                Vanish      = 0x00000002,       //Text is hidden
                RMarkDel    = 0x00000004,       //Text is deleted (track changes)
                RMarkIns    = 0x00000008,       //Text is inserted (track changes)

                Special     = 0x00000010,       //Special character
                EmbeddedObj = 0x00000020,
                Lowercase   = 0x00000040,       /*Character is displayed in lower case when 1. No case
                                                  transformation is performed when 0. This field may be
                                                  set to 1 only when chp.fSmallCaps is 1. */
                Data        = 0x00000080,       /*When 1, chp.fcPic points to an FFDATA, the data structure binary
                                                  data used by Word to describe a form field. The bit chp.fData may
                                                  only be 1 when chp.fSpec is also 1 and the special character in
                                                  the document stream that has this property is a chPicture (0x01). */
                Ole2        = 0x00000100,       /*when 1, chp.lTagObj specifies a particular object in the
                                                  object stream that specifies the particular OLE object in
                                                  the stream that should be displayed when the chPicture
                                                  fSpec character that is tagged with the fOle2 is encountered.
                                                  The bit chp.fOle2 may only be 1 when chp.fSpec is also 1 and
                                                  the special character in the document stream that has this
                                                  property is a chPicture (0x01). */
                Highlight   = 0x00000200,       /*when 1, characters are highlighted with color specified by chp.icoHighlight.*/
                ///Foreground colors are automatic
                FGAutomatic = 0x00000400,
                ///Bold for bidirectional text ??
                BoldBi      = 0x00000800,
                ///Italics for bidirectional text ??
                ItalicBi    = 0x00001000
        };

        Parsers::Character formatted;

        //FIXME: Shouldn't maintain both a font pointer here and inside 'formatted'
        Font const *font;

        struct Pod
        {
                Pod()
                : internal_bits(0)
                , icohighlight(0, 0, 0, 0)
                , backgroundcolor(0, 0, 0, 0)
                , fcPicObjTag(0)
                , lidDefault(0)
                , lidFE(0)
                , wCharScale(0)
                , istd_style(0)
                , ftcSym(0)
                , xchSym(0)
                , ftcFE(0)
                , ftcOther(0)
                , sfxtText(0)
                {
                }

                uint32_t internal_bits;

                //Our stuff
                DrawLib::Pixel32 icohighlight;           // Highlighted colors
                DrawLib::Pixel32 backgroundcolor;       // Current background color
                uint32_t     fcPicObjTag;                    // Offset in data stream of picture or OLE1 data, or long word tag that identifies an OLE2 object in the object stream when the character is an OLE2 object character. (character is 0x01 and chp.fSpec is 1, chp.fOle2 is 1)
                uint16_t     lidDefault;                     // Language for non-Far East text
                uint16_t     lidFE;                          // Language for Far East text
                uint16_t     wCharScale;                     // ???
                ParaCharStyle const *istd_style;              // Index to character style descriptor in the stylesheet that tags this run of text When istd is istdNormalChar (10 decimal), characters in run are not affected by a character style. If chp.istd contains any other value, chpx of the specified character style are applied to CHP for this run before any other exceptional properties are applied.
                uint16_t     ftcSym;                         // When chp.fSpec is 1 and the character recorded for the run in the document stream is chSymbol (0x28), chp.ftcSym identifies the font code of the symbol font that will be used to display the symbol character recorded in chp.xchSym. chp.ftcSym is an index into the rgffn structure.
                uint16_t     xchSym;                         // When chp.fSpec is 1 and the character recorded for the run in the document stream is chSymbol (0x28), the character stored chp.xchSym will be displayed using the font specified in chp.ftcSym.
                int16_t     ftcFE;                          // Font for Far East text
                int16_t     ftcOther;                       // Font for non-Far East text
                uint8_t      sfxtText;                       // Text animation:  0 no animation  1 Las Vegas lights  2 background blink  3 sparkle text  4 marching ants  5 marchine red ants  6 shimmer
        } pod;

        /*
        //Legacy items
        int32_t     dxaSpace;                       // 0012 space following each character expressed in twip units.
        int16_t     supersub;                       // 0018 super/subscript position in half points - positive means raise, negative means lower
        uint8_t      idct;                           // 0020
        uint8_t      idctHint;                       // 0021 identifier of character type  0->shared chars get non-FE props, 1->shared chars get FE props
        int16_t     ibstRMark;                      // 0028 index to author IDs stored in hsttbfRMark. used when text in run was newly typed when revision marking was enabled
        int16_t     ibstRMarkDel;                   // 002A index to author IDs stored in hsttbfRMark. used when text in run was deleted when revision marking was enabled
        //struct dttm dttmRMark;                        // 002C Date/time at which this run of text was entered/modified by the author. (Only recorded when revision marking is on.)
        //struct dttm ddtmRMarkDel;             // 0030 Date/time at which this run of text was deleted by the author. (Only recorded when revision marking is on.)
        int16_t     idslRMReason;                   // 003C an index to strings displayed as reasons for actions taken by Word's AutoFormat code
        int16_t     idslReasonDel;                  // 003E an index to strings displayed as reasons for actions taken by Word's AutoFormat code
        uint8_t      ysr;                            // 0040 hyphenation rule 0 No hyphenation 1 Normal hyphenation 2 Add letter before hyphen 3 Change letter before hyphen 4 Delete letter before hyphen 5 Change letter after hyphen 6 Delete letter before the hyphen and change the letter preceding the deleted character
        uint8_t      chYsr;                          // 0041 the character that will be used to add or change a letter when chp.ysr is 2,3, 5 or 6
        //uint16_t   cp;
        uint16_t     hpsKern;                        // 0044 kerning distance for characters in run recorded in half points
        uint16_t     fPropMark;                      // 0048 when 1, properties have been changed with revision marking on
        int16_t     ibstPropRMark;                  // 004A index to author IDs stored in hsttbfRMark. used when properties have been changed when revision marking was enabled
        //struct dttm dttmPropRMark;            // 004C Date/time at which properties of this were changed for this run of text by the author. (Only recorded when revision marking is on.)
        int8_t      fDispFldRMark;                  // 005B (Only valid for ListNum fields). When 1, the number for a ListNum field is being tracked in xstDispFldRMark—if that number is different from the current value, the number has changed.
        int16_t     ibstDispFldRMark;               // 005C Index to author IDs stored in hsttbfRMark. used when ListNum field numbering has been changed when revision marking was enabled
        //struct dttm dttmDispFldRMark;         // 005E The date for the ListNum field number change
        uint16_t     xstDispFldRMark[16];            // 0062 The string value of the ListNum field when revision mark tracking began
        Shd     shd;                            // 0082 shading
        Brc     brc;                            // 0084 border
        */

        int Sprm(BiffDoc const &parent, Chp const &base_style_chp, Chp *cur_style_chp, const SprmData &sprm);

        void SetFont(Font const *newfont);
};

inline std::ostream& operator<<(std::ostream &str,Tap const &tap)
{ tap.Dump(str); return str; }

struct Pap
{
        struct Tab
        {
                inline Tab(int16_t stop, uint8_t descriptor) : stop(stop), descriptor(descriptor)
                {
                }
                int16_t stop;
                uint8_t descriptor;
        };
        typedef std::vector<Tab> Tabs;

        Pap(DocBase const &doc);

        void ApplyIlfo(BiffDoc const &parent, int16_t ilfo);
        int Sprm(BiffDoc const &parent, const SprmData &sprm, Tap *tap);

        //Fix internal inconsistencies, eg paddingbeforeauto which should clear padding.top. use after applying all properties
        void Fixup();

        Parsers::Paragraph formatted;

        /// Table level of this paragraph
        unsigned tablelevel;
        /// This paragraph is the last paragraph of a cell with tablelevel > 1
        unsigned cellend : 1;
        /// Paragraph consists only of the row mark special character and marks the end of a table row.
        unsigned ttp : 1;
        /// Multi line space?
        unsigned multilinespace : 1; //fMultiLineSpace
        /// Contextual spacing (Ignore Spacing Above and Below When Using Identical Styles)
        unsigned contextualspacing : 1;
        /// Vertical spacing before is automatic
        unsigned paddingbeforeauto : 1;
        /// Vertical spacing after is automatic
        unsigned paddingafterauto : 1;
        /// Style identifier
        ParaCharStyle const *istd_style;
        int8_t      lvl;
        /// Parapgraph Ilfo
        int16_t ilfo;
        /// dyaLine (line height??) in twips
        int16_t dyaline;

        /// Word 97 Paragraph's list override
        ListOverride const *listovr;
        /// Word 97 Paragraph's 1-based list level
        unsigned listlevel;

        /// Autonumber list descriptor
        Anld    anld;

        Tabs tabs;

        /*
        uint8_t      fKeep;                  // 0003 keep entire paragraph on one page if possible
        uint8_t      fKeepFollow;            // 0004 keep paragraph on same page with next paragraph if possible
        uint8_t      fPageBreakBefore;       // 0005 start this paragraph on new page
        uint8_t      brcp;                   // 0007 rectangle border codes  0 none  1 border above  2 border below  15 box around  16 bar to left of paragraph
        uint8_t      brcl;                   // 0008 border line style  0 single  1 thick  2 double  3 shadow
        uint8_t      fNoLnn;                 // 000B no line numbering for this paragraph. (makes this an exception to the section property of line numbering)
        uint8_t      fSideBySide;            // 0010 when 1, paragraph is a side by side paragraph
        uint8_t      fNoAutoHyph;            // 0012 when 0, text in paragraph may be auto hyphenated.
        int32_t     lspd;                   // 0020 line spacing descriptor
        //Phe   phe;                    // 002C height of current paragraph.
        uint8_t      fCrLf;
        uint8_t      fUsePgsuSettings;
        uint8_t      fAdjustRight;
        uint8_t      fKinsoku;               // 003C when 1, apply kinsoku rules when performing line wrapping
        uint8_t      fWordWrap;              // 003D when 1, perform word wrap
        uint8_t      fOverflowPunct;         // 003E when 1, apply overflow punctuation rules when performing line wrapping
        uint8_t      fTopLinePunct;          // 003F when 1, perform top line punctuation processing
        uint8_t      fAutoSpaceDE;           // 0040 when 1, auto space FE and alphabetic characters
        uint8_t      fAtuoSpaceDN;           // 0041 when 1, auto space FE and numeric characters
        uint16_t     wAlignFont;             // 0042 font alignment  0 Hanging  1 Centered  2 Roman  3 Variable  4 Auto
        uint8_t      wr;                     // 004A Wrap Code for absolute objects
        uint8_t      fLocked;                // 004B when 1, paragraph may not be edited
        uint8_t      ptap[4];                // 004C used internally by Word
        int32_t     dxaAbs;                 // 0050 when positive, is the horizontal distance from the reference frame specified by pap.pcHorz. 0 means paragraph is positioned at the left with respect to the reference frame specified by pcHorz. Certain negative values have special meaning:
                                        //      -4 paragraph centered horizontally within reference frame
                                        //      -8 paragraph adjusted right within reference frame
                                        //      -12 paragraph placed immediately inside of reference frame
                                        //      -16 paragraph placed immediately outside of reference frame
        int32_t     dyaAbs;                 // 0054 when positive, is the vertical distance from the reference frame specified by pap.pcVert. 0 means paragraph's y-position is unconstrained. Certain negative values have special meaning:
                                        //      -4 paragraph is placed at top of reference frame
                                        //      -8 paragraph is centered vertically within reference frame
                                        //      -12 paragraph is placed at bottom of reference frame.
        int32_t     dxaWidth;               // 0058 when not == 0, paragraph is constrained to be dxaWidth wide, independent of current margin or column settings.
        Brc     brcTop;                 // 005C specification for border above paragraph
        Brc     brcLeft;                // 0060 specification for border to the left of paragraph
        Brc     brcBottom;              // 0064 specification for border below paragraph
        Brc     brcRight;               // 0068 specification for border to the right of paragraph
        Brc     brcBetween;             // 006C specification of border to place between conforming paragraphs. Two paragraphs conform when both have borders, their brcLeft and brcRight matches, their widths are the same, they both belong to tables or both do not, and have the same absolute positioning props.
        Brc     brcBar;                 // 0070 specification of border to place on outside of text when facing pages are to be displayed.
        int32_t     dxaFromText;            // 0074 horizontal distance to be maintained between an absolutely positioned paragraph and any non-absolute positioned text
        int32_t     dyaFromText;            // 0078 vertical distance to be maintained between an absolutely positioned paragraph and any non-absolute positioned text
        int16_t     dyaHeight;              // 007C first 15 bits: height of abs obj; 0 == Auto * bit15==0 ? exact : at least
        Shd     shd;                    // 007E shading
        //Dcs   dcs;                    // 0080 drop cap specifier (see DCS definition)
        int8_t      fNumRMIns;
        int16_t     fPropRMark;             // 00D8 when 1, properties have been changed with revision marking on
        int16_t     ibstPropRMark;          // 00DA index to author IDs stored in hsttbfRMark. used when properties have been changed when revision marking was enabled
        //struct dttm dttmPropRMark;    // 00DC Date/time at which properties of this were changed for this run of text by the author. (Only recorded when revision marking is on.)
        //struct numrm numrm;           // 00E0 paragraph numbering revision mark data (see NUMRM)
        */

        /** Apply paragraph props */
        void ApplyDocXProps(DocX::DocXDoc const &docx, Blex::XML::Node ppr);
        void ApplySingleDocXProp(DocX::DocXDoc const &docx, Blex::XML::Node newnode);
        Parsers::ObjectType GetListType() const;

        private:
        void AddTab(int16_t tabstop,uint8_t descriptor);
        void DelTab(int16_t tabstop,int16_t tolerance=0);

        struct ParserTable
        {
                const char *entry;
                void (Pap::*parser)(DocX::DocXDoc const &docx, Blex::XML::Node newnode);
        };
        static const ParserTable parsertable[];

        void DoSpacing(DocX::DocXDoc const &docx, Blex::XML::Node newnode);
        void DoShading(DocX::DocXDoc const &docx, Blex::XML::Node newnode);
        void DoOutlineLevel(DocX::DocXDoc const &docx, Blex::XML::Node newnode);
        void DoJC(DocX::DocXDoc const &docx, Blex::XML::Node newnode);
        void DoIndentation(DocX::DocXDoc const &docx, Blex::XML::Node newnode);
        void DoNumPr(DocX::DocXDoc const &docx, Blex::XML::Node newnode);
        void DoContextualSpacing(DocX::DocXDoc const &docx, Blex::XML::Node newnode);
};

struct StyleBase //stuff shared between paragraph, char and table styles
{
        StyleBase();
        virtual ~StyleBase();

        enum StyleType
        {
                CharacterStyle,
                ParagraphStyle,
                TableStyle
        };

        StyleType type;

        ///Styleid (used to look up styles)
        std::string styleid;
        ///Base styleid
        std::string basestyleid;
        ///User display name
        std::string stylename;

        ///The styles on which we are based, if any (element 0 = true base, 1 = first derived, etc)
        std::vector<StyleBase const* > stylehistory;

        ///MS Word style id
        unsigned mswordid;

        private:
        StyleBase(const StyleBase&);
        StyleBase& operator=(const StyleBase&);
};

struct ParaCharStyle : public StyleBase
{
        static const uint16_t UnusedStyleId = 4095;
        static const uint16_t DocXStyle = 65535;

        virtual void ApplyStyle(Pap *pap, Chp * chp) const = 0;


        int32_t predefined_output_style;

        /** Pap, chp caching. Only valid for Paragraph styles */
        Pap     cached_stylepap;
        Chp     cached_stylechp;

        ///Default filter (Used only by docx now.. - still correct?)
        Parsers::StyleSettings const *filter;

        ParaCharStyle(DocBase &parent);

        void PredefineStyle(Parsers::FormattedOutput &output);
};

struct ComplexRecord
{
        Cp      startcp;        // Where does this piece start
        Cp      limitcp;        // Where does this piece end

        Fc      startfc;        // Where does this piece start..
        Fc      limitfc;        // ..and end?

        uint16_t     val;            // A value. No clue yet what it is
                                // It seems to be some sort of bitmap.
                                // Bit 0 set: no paragraph ends here
        unsigned bytespc;       // 1 or 2, bytes per character
        uint16_t     sprm;           // Whose idea was it to store a sprm here?

        //Convert CPs to the file FCs, and vice versa
        Fc      Cp2Fc (Cp cp) const { return (cp-startcp)*(bytespc)+startfc; }
        Cp      Fc2Cp (Fc fc) const { return (fc-startfc)/(bytespc)+startcp; }
};

class FileShape
{
        public:
        //Word's information
        Cp      cp;             // CP of office draw object

        int32_t     spid;           // Shape Identifier. Used in conjuction with the office art data (found via fcDggInfo) to find the actual data for the shape
        int32_t     xa_left,ya_top,xa_right,ya_bottom;      //rectangle enclosing shape relative to the origin of the hape
        int     relative_x;     // relation to anchor CP - 0=to page margin, 1=top of page, 2=text
        int     relative_y;     // relation to anchor CP - 0=to page margin, 1=top of page, 2=text
        int     wrapping;       // 0=wrap around, 1=no text next to shape, 2=wrap around absolute object, 3=wrap as if no object present, 4=wrap tightly around object, 5=wrap tightly but allow holes
        int     wrappingtype;   // (for wrapping modes 2 and 4 only) 0=both sides, 1=left only, 2=right only, 3=largest side only
        int     rcasimple;      // forcing xaLeft,xaRight,yaTop,yaBottom to be all page relative
        int     belowtext;      // if 1, shape is below text
        int     anchorlock;     // if 1, anchor is locked
};

struct ParagraphWalkerCache
{
        ///start of current buffer data
        Fc buffer_start;
        ///the actual character buffer
        std::vector<uint8_t> char_buffer;
};

/** The word document fields and bookmarks manager */
class FieldsManager
{
public:
        /* Remember information about fields that were already opened but
           not yet closed */
        struct FieldStack
        {
                FieldStack(Cp _start_cp, uint8_t _type)
                {
                        start_cp=_start_cp;
                        type=_type;
                        seperator_cp=0;
                }
                Cp start_cp;
                Cp seperator_cp;
                uint8_t type;
        };

        ///Bookmark to paragraph coupling type
        typedef std::map<std::string, Cp, Blex::StrCaseLess<std::string> > BookmarkLinks;
        ///Reverse mapper to find 'next' bookmarks
        typedef std::map<Cp, BookmarkLinks::const_iterator> BookmarkPlacements;

        FieldsManager(BiffDoc &parentdoc);

        /** Read bookmark and fields information. */
        void Initialize(Blex::RandomStream &tablefile);

//        BookmarkPlacements const &GetPlacedBookmarks() const { return placements; }

//        std::string GenerateAnchor(int32_t cp);

        ///Get the word field type of the field starting at the specified position
        unsigned GetFieldType(Cp cp) const;
        ///Set the default anchor loaction
        void SetDefaultAnchorTarget(std::string const &target);

        void DumpToClog() const;

private:
        void ReadFields(Blex::RandomStream &tablefile);
        void ReadFieldsPlcf(Plcf const &plcf, Cp start_offset);

        void ReadBookmarks(Blex::RandomStream &tablefile);

        void Process(FieldStack const &start, Cp end_cp,BiffDoc &document);

        ///Create a HTML control
        void CreateHTMLControl(Cp location, uint32_t oleid);

        /** Create the Hyperlink events in their destination paragraphs */
        void SetLinks(Cp start_cp, Cp end_cp, Parsers::Hyperlink const &link);

        Parsers::Hyperlink CreateHyperlink(std::string const &fieldcode);

        Parsers::Hyperlink ResolveInternalLink(std::string const &linklocation);

        ///Link to parent document
        BiffDoc &doc;
        ///Bookmark to paragraph coupling
//        BookmarkLinks bookmark_links;
        ///Reverse mapping - where to place bookmarks?
//        BookmarkPlacements placements;
        ///Field types (stored at thier starting position)
        typedef std::map<Cp, unsigned> FieldTypes;
        FieldTypes fieldtypes;
        ///Default anchor target
        std::string defaultanchortarget;
};

/** A sprm range iterator */
class SprmIterator
{
        public:
        SprmIterator(BiffDoc const &doc, uint8_t const *grpprl_start, unsigned len);
        SprmIterator(BiffDoc const &doc, GrpprlPointer ptr);
        SprmIterator(BiffDoc const &doc, uint16_t sprm);

        SprmData const &GetSprm() const { return cur; }
        bool AtEnd() { return len==0; }
        void Next();

        private:
        void ReadCurrent97();

        BiffDoc const  &doc;
        uint8_t localbuf[1024];
        uint8_t const *grpprl;
        bool overrun;
        unsigned len;
        unsigned opsize;
        unsigned start;
        SprmData cur;
};

class Callbacks
{
        public:
        virtual ~Callbacks();

        virtual int32_t RegisterOutputObject(OutputObjectInterface *output_object, bool is_top_level, unsigned toclevel, bool filtersplit, bool allhidden) = 0;
        virtual void FoundFootEndNote(bool is_foot_note, DocPart const *begin, DocPart const *limit, FormattedOutput &output) = 0;
        virtual void PrivateFieldCallback(std::string const &data, FormattedOutput &output) = 0;
};


class DocBase
{
        public:
        enum TrackChangesMode
        {
                TCFinal,
                TCFinalWithMarkup,
                TCOriginal,
                TCOriginalWithMarkup
        };
        TrackChangesMode tcmode;

        bool symbol_conversion_images;

        bool ignore_allcaps;

        ParaCharStyle * nullstyle;
        ParaCharStyle const* default_paragraph_style;

        DocBase(ParaCharStyle *nullstyle, int32_t unique_id, Callbacks &callbacks);
        virtual ~DocBase();

        /** Get our unique VM-specific ID */
        int32_t GetUniqueVMId() const { return unique_id; }

        inline const Font & GetFont(unsigned num) const
        {
                return fonts.empty() ? fallbackfont : num<fonts.size() ? fonts[num] : fonts[0];
        }
        Font const* GetFontByName(std::string const &fontname) const;
        Font const* GetFontByTheme(std::string const &fontname) const;

        ParaCharStyle const* GetStyle(unsigned num) const;
        StyleBase const* GetStyleByDocXId(std::string const &styleid) const;
        StyleBase * GetStyleByDocXId(std::string const &styleid)
        {
                return const_cast<StyleBase *>(const_cast<DocBase const*>(this)->GetStyleByDocXId(styleid));
        }


        Blex::ObjectOwner<TableDocPart> tableparts; //FIXME PROTECTED OR PRIVATE

        Callbacks &callbacks;

        void DumpParts();

        /** Scan a worddocument and split it into objects */
        std::pair<unsigned, std::string> Scan(bool emptydocobjects, Parsers::PublicationProfile const &pubprof);

        ListOverride const *GetListOverride(int32_t id) const;

        DocPart const *FindByBookmark(std::string const &part) const;

        inline DocPart *FindByBookmark(std::string const &part)
        { return const_cast<DocPart*>(const_cast<DocBase const*>(this)->FindByBookmark(part)); }

        Parsers::Hyperlink GetHyperlink(DocPart const *para, std::string const &anchorname) const;

        protected:
        typedef std::map<std::string, std::string> ThemeFontsMap;
        ThemeFontsMap themefonts;

        int32_t const unique_id;
        DocPart *firstpart;

        typedef std::shared_ptr<StyleBase> StylePtr;

        std::vector<Font> fonts;
        std::vector<StylePtr> styles;

        ///All document paragraphs
        Blex::ObjectOwner<DocPart> pars;

        ///All list overrides
        typedef std::map<int32_t, ListOverridePtr> ListOverrideMap;
        ListOverrideMap numberings;

        ///Bookmark name->para mappings
        typedef std::map<std::string, DocPart*> BookmarkMap;
        BookmarkMap bookmarks;

        DocPart *AdoptAndRegisterPart(DocPart *part);

        void LinkStyleHistories();
        void MapStyles(Parsers::PublicationProfile const &pubprof);
        void CacheParagaphStyles();
        void SetupFontInfo(Font *newfont);

        Pap document_default_pap;
        Chp document_default_chp;

        typedef std::set<std::string> ReferredAnchors;
        ReferredAnchors referred_anchors;

        private:
        virtual std::pair<unsigned, std::string> ScanMetadata()=0;
        virtual std::pair<unsigned, std::string> ScanStructure()=0;

        void DumpPartsFrom(DocPart *part, unsigned level);

        void EliminateEmptyDocParts(DocPart *part);
        void EliminateEmptyDocPartsTable(TableDocPart *part);
        void RegisterDocParts();

        void RegisterDocPartsFrom(DocPart *part, bool top_level);
        void RegisterTable(TableDocPart *part);
        ///Create any missing anchors
        void CreateAnchors();

        void GenerateAnchorFor(DocPart *part);

        typedef std::map<std::string, DocPart*> AnchorMap;
        AnchorMap anchors;


        void ProcessLists();
        void DumpMetadata();

        const Font fallbackfont; //Default chp relies on this
        friend class FieldsManager;
};

/** Raw word character stream parser */
class RawCharacterParser
{
        public:
        RawCharacterParser(BiffDoc const &doc);

        ~RawCharacterParser();

        /** Get the character to which char_cp now points. This function
            reads the raw character: it is not correct for character sets
            or allcaps settings */
        uint16_t GetRawChar(Cp cp);

        /** Go to a specific character
            @return Fc position of specified Cp */
        Fc GoTo(Cp cp);

        /** Get the current piece */
        ComplexRecord const& GetCurrentPiece() const { return *char_piece; }

        private:
        BiffDoc const &doc;
        ParagraphWalkerCache &cache;

        ///Update character FC and recalculate direct pointers
        Fc SetupCharacters(Cp cp);

        /// Current character's piece
        ComplexRecord const *char_piece;        // Pointer to currentpiece
};

class FootEndNoteEvent : public ParaEvent
{
        public:
        FootEndNoteEvent(BiffDoc &doc, bool is_foot_note, Cp startcp, Cp endcp);
        bool Execute(FormattedOutput &output);

        private:
        BiffDoc &doc;
        bool is_footnote;
        ///The start offset for the text
        Cp startcp;
        ///The limit offset for the text
        Cp limitcp;
};

unsigned GetPapChpEmptyHeight(Pap const &pap, Chp const &chp);


/** Get the RFC 1766 language code for a Windows language id */
const char *GetLanguageCode(int16_t windows_id);

std::ostream& operator << (std::ostream &str, FileShape const &fs);

void BrcToBorder(Parsers::Table::BorderType *border, Brc const &brc);

} // End of namespace Word
} // End of namespace Office
} // End of namespace Parsers

#endif
