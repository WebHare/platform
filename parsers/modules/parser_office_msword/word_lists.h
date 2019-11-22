#ifndef blex_webhare_hare_msword_word_lists
#define blex_webhare_hare_msword_word_lists

#include <blex/unicode.h>
#include <drawlib/drawlibv2/drawlib_v2_types.h>
#include <vector>

namespace Parsers {
namespace Office {
namespace Word {

class BiffParagraph;
class BiffDoc;
class DocBase;
struct Chp;
class DocPart;
struct Pap;

enum WordVersions
{
        Word97=1,
        Word2000=2
};

/** A pointer to a cached grpprl */
class GrpprlPointer
{
        public:
        /** Construct a grpprl pointer */
        explicit GrpprlPointer(uint8_t *pointer=0) : pointer(pointer)
        { }
        /** Get the length of this grpprl */
        unsigned Length() const
        { return pointer ? Blex::getu16lsb(pointer) : 0; }
        /** Get the data inside this grpprl */
        uint8_t *Data()
        { return pointer ? pointer+2 : 0;}
        uint8_t const *Data() const
        { return pointer ? pointer+2 : 0; }

        private:
        uint8_t * pointer;
};

///The number of list levels supported by MS Word
const unsigned NumListLevels = 9;

/** Autonumber level descriptor. Stores data associated with a list level,
    and is part of ANLDs and OLSTs */
struct Anlv
{
        /** Initialize dead anlv */
        Anlv();
        /** Initialize anlv from data*/
        Anlv(uint8_t const *disk_anlv);
        /** Fix textbefore and textafter values if necessary
            @param maxlen Maximum length of textbefore and textafter */
        void FixTextPointers(unsigned maxlen);

        static const unsigned DiskSize = 16;

        enum FlagBits
        {
                Justification=0x3,      // 0=left, 1=center, 2=right, 3=left&right
                PreviousLevel=0x4,
                HangingIndent=0x8,
                SetBold=0x10,
                SetItalic=0x20,
                SetSmallCaps=0x40,
                SetCaps=0x80,
                SetStrike=0x100,
                SetKul=0x200,
                PrevSpace=0x400,
                Bold=0x800,
                Italic=0x1000,
                SmallCaps=0x2000,
                Caps=0x4000,
                Strike=0x8000
        };

        void Project(BiffDoc const &parent, Chp *chp) const;// project this Anld on a CHP

        uint32_t flags;

        uint8_t      nfc;                    // 0000 number format code  0 Arabic numbering  1 Upper case Roman  2 Lower case Roman  3 Upper case Letter  4 Lower case letter  5 Ordinal
        uint8_t      textbefore;             // 0001 offset into anld.rgxch that is the limit of the text that will be displayed as the prefix of the autonumber text
        uint8_t      textafter;              // 0002 anld.cxchTextBefore will be the beginning offset of the text in the anld.rgxch that will be displayed as the suffix of an autonumber. The sum of anld.cxchTextBefore + anld.cxchTextAfter will be the limit of the autonumber suffix in anld.rgxch

        ///starting value (0 to 65535)
        uint16_t     startat;
        ///width of prefix text (same as indent)
        uint16_t     dxaindent;
        ///minimum space between number and paragraph
        uint16_t     dxaspace;

        ///underline code (if flags&SetKul)
        unsigned kul;
        ///autonumber colour
        DrawLib::Pixel32 autonumber_colour;
        ///autonumber halfpointsize
        unsigned font_halfpoint_size;
        ///autonumber fontface
        unsigned font_code;
};

struct Anld
{
        Anld();
        explicit Anld(uint8_t const *disk_anlv);

        static const unsigned DiskSize = 84;
        Anlv anlv;

        ///Font code
        int16_t ftc;
        ///Half point size
        uint16_t hps;

        Blex::UTF16String chars;

        /// number only 1 item per table cell
        unsigned number_1 : 1;
        ///number across cells in tabel row (instead of down)
        unsigned numberaccross : 1;
        /// restart heading number on section boundary
        unsigned restartheading : 1;
};

/** Outline list data */
class Olst
{
        public:
        Olst();

        explicit Olst(uint8_t const *data);

        static const unsigned DiskSize = 212;

        ///Aarray of 9 ANLV structures describing how heading numbers should be displayed for each of Word's 9 outline heading levels
        Anlv    anlv[NumListLevels];
        ///Restart heading on section break
        unsigned restart_after_sectionbreak : 1;
        ///text before/after number
        Blex::UTF16String chars;
};

struct ListLevel
{
        /** @param level Level we're overriding (0-based) */
        explicit ListLevel(unsigned level);
        virtual ~ListLevel();

        uint32_t     startat;
        uint8_t      nfc; //number format code 0=arabic, 1=upperroman, 2=lowerroman, 3=upperletter, 4=lowerletter, 5=ordinal
        uint8_t      jc; //0=left,1=right,2=centered

        bool    legal; //turn all inherited numbers into arabic
        unsigned restartafter; //restart after which level (1-based, 0=no restart)

//        uint8_t      offsets[NumListLevels]; //offsets inside numbering
        uint8_t      follower; //0=tab, 1=space, 2=nothing

        ///The level text. Storing as UTF16 to make character remapping a lot easier
        Blex::UTF16String lvltext;

        virtual void ApplyPap(Pap *pap) const;
        virtual void ApplyChp(Pap const *pap, Chp *chp) const;
};
typedef std::shared_ptr<ListLevel> ListLevelPtr;

struct BiffListLevel : public ListLevel
{
        explicit BiffListLevel(BiffDoc &parent, unsigned level);

        GrpprlPointer list_chpx,list_papx;
        unsigned int Read(Blex::Stream &table); //returns # of bytes read
        /** Apply the settings for this list to the specified paragraph */
        void ApplyPap(Pap *pap) const;
        void ApplyChp(Pap const *pap, Chp *chp) const;

        private:
        BiffDoc &parent;
};

typedef signed ListCounters[NumListLevels];

struct ListData //ADDME Rename to AbstractNumbering
{
        ListData()
        {
        }

        uint32_t     unique_list_id;
        uint32_t     unique_template_code;
        uint16_t     styles[NumListLevels];
        bool    simplelist; //if true, ListLevel has one element. if false,ListLevel has nine
        bool    restart_heading;

        typedef std::map<int32_t, ListLevelPtr> Levels;
        Levels levels;
};

typedef std::shared_ptr<ListData> ListDataPtr;

struct LevelOverride
{
        LevelOverride();
        ~LevelOverride();

        uint8_t      level;          //the level that is being override (0-8)

        bool    formatting;     //whether we're overriding the formatting
        bool    startat;        //or just the start-at value?

        int32_t     new_startat;    //the new start-at value, if start-at is true
        ListLevelPtr new_level; //pointer to the actual level data, if formatting is true
};

typedef std::vector<LevelOverride> LevelOverrides;

/** The list overrides, interestingly enough, contain the *actual* list data. */
struct ListOverride
{
        ListOverride();
        ~ListOverride();

        ///the original list
        ListDataPtr abstract;

        ///the actual overrieds
        LevelOverrides overrides;

        std::vector<DocPart*> listparas;

        ///Get a specific list override
        LevelOverride *GetOverride(unsigned lvl);
        LevelOverride const *GetOverride(unsigned lvl) const;

        //Get level and startat values, considering overrides
        ListLevel const *GetLevel(unsigned lvl) const;
        unsigned GetStartAt(unsigned lvl);
        unsigned GetRestartAfter(unsigned lvl);
};
typedef std::shared_ptr<ListOverride> ListOverridePtr;

} // End of namespace Word
} // End of namespace Office
} // End of namespace Parsers


#endif
