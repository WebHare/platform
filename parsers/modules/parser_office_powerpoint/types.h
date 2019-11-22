#ifndef blex_harescript_modules_powerpoint_types
#define blex_harescript_modules_powerpoint_types
//---------------------------------------------------------------------------

namespace Parsers
{

namespace Office
{

namespace Powerpoint
{

struct RecordHeader
{
        unsigned version;
        unsigned instance;
        uint16_t type;
        uint32_t length;
};

struct DocumentAtom
{
        int32_t slideWidth;
        int32_t slideHeight;
        int32_t notesWidth;
        int32_t notesHeight;
        int32_t zoomNumerator; // Scale used 1:2 is default
        int32_t zoomDenumerator;
        uint32_t notesMaster; // Reference to notes master
        uint32_t handoutMaster; // Reference to handout master
        uint16_t firstSlideNum; // Number of the first slide
        int16_t slideSizeType; // See enum SlideSizes
        uint8_t saveWithFonts;  // Indicates if the document was saved with embedded true type fonts
        uint8_t omitTitlePlace; // Set if the placeholders on the title slide are omitted
        uint8_t rightToLeft;    // Flag for Bidi version
        uint8_t showComments;   // Visibility of comment shapes
};

enum SlideSizes
{
        ss_OnScreen     = 0,
        ss_Letter       = 1,
        ss_A4           = 2,
        ss_35mm         = 3,
        ss_Overhead     = 4,
        ss_Banner       = 5,
        ss_Custom       = 6
};

struct CurrentUserAtom
{
        uint32_t size;
        uint32_t magic; // Magic number to ensure that this is a powerpoint file
        uint32_t offsetToCurrentEdit; // Offset in main stream to current edit field
        uint16_t lenUserName;
        uint32_t docFileVersion;
        uint8_t majorVersion;
        uint8_t minorVersion;
};

struct UserEditAtom
{
        int32_t lastSlideID;    // slideID
        uint32_t version;        // This is major/minor/build which did the edit
        uint32_t offsetLastEdit; // File offset of last edit
        uint32_t offsetPersistDirectory; // Offset to PersistPtrs for
                                      // this file version.
        uint32_t documentRef;
        uint32_t maxPersistWritten;      // Addr of last persist ref written to the file (max seen so far).
        int16_t lastViewType;   // enum view type
};

struct SlidePersistAtom
{
        uint32_t psrReference;
        uint32_t flags;
        int32_t numberTexts;
        int32_t slideid;
        uint32_t reserved;
};

const int S_FOLLOW_MASTER_OBJECTS    = 0x01;
const int S_FOLLOW_MASTER_SCHEME     = 0x02;
const int S_FOLLOW_MASTER_BACKGROUND = 0x04;

#define MAX_OBJECTS_IN_LAYOUT 8     // no layout has more than 5 objects
struct SlideAtom
{
   int32_t geom;
   uint8_t placeholderid[MAX_OBJECTS_IN_LAYOUT];
   int32_t masterid;
   int32_t notesid;
   uint32_t flags;
};

struct NotesAtom
{
   int32_t slideid; // Link to the slide this notes slide belongs to
   uint16_t flags;
};

const int S_HEADERFOOTER_DATE =        0x01;
const int S_HEADERFOOTER_TODAYDATE =   0x02;
const int S_HEADERFOOTER_USERDATE =    0x04;
const int S_HEADERFOOTER_SLIDENUMBER = 0x08;
const int S_HEADERFOOTER_HEADER =      0x10;
const int S_HEADERFOOTER_FOOTER =      0x20;

struct HeadersFootersAtom
{
   HeadersFootersAtom() { formatid = 0; flags = 0; }
   int16_t formatid;
   uint16_t flags;    // date, todayDate, userDate, slideNumber, header, footer
};

struct TextHeaderAtom
{
        uint32_t txType;
};


const int S_PLACEHOLDER_MASTER_TITLE     = 1;
const int S_PLACEHOLDER_MASTER_DATE      = 7;
const int S_PLACEHOLDER_MASTER_SLIDENR   = 8;
const int S_PLACEHOLDER_MASTER_FOOTER    = 9;
const int S_PLACEHOLDER_MASTER_HEADER    = 10;

struct OEPlaceholderAtom
{
        uint32_t placementid;
        uint8_t placeholderid;
        uint8_t size;
        uint16_t undefined; // Have to find out whast this is
};

struct InteractiveInfoAtom
{
        uint32_t soundref;
        uint32_t ex_hyperlink_id;
        uint8_t action; /* Actions enum */
        uint8_t oleverb;
        uint8_t jump;
        uint8_t flags; /* Bit 1: Animated, Bit 2: Stop sound, Bit 3: CustomShowReturn */
        uint8_t hyperlink_type;

        std::string name;
};

enum Actions
{
        ACT_NoAction         = 0,
        ACT_MacroAction      = 1,
        ACT_RunProgramAction = 2,
        ACT_JumpAction       = 3,
        ACT_HyperlinkAction  = 4,
        ACT_OLEAction        = 5,
        ACT_MediaAction      = 6,
        ACT_CustomShowAction = 7
};

enum TextTypes
{
        TYP_Title               = 0,
        TYP_Body                = 1,
        TYP_Notes               = 2,
        TYP_NotUsed             = 3,
        TYP_Other               = 4,
        TYP_CenterBody          = 5,
        TYP_CenterTitle         = 6,
        TYP_HalfBody            = 7,
        TYP_QuarterBody         = 8
};

enum psrTypeCode
{
        PST_Document            = 1000,
        PST_DocumentAtom        = 1001,
        PST_Slide               = 1006,
        PST_SlideAtom           = 1007,
        PST_Notes               = 1008,
        PST_NotesAtom           = 1009,
        PST_Environment         = 1010,
        PST_SlidePersistAtom    = 1011,
        PST_MainMaster          = 1016,
        PST_ExObjList           = 1033,
        PST_ExObjListAtom       = 1034,
        PST_PPDrawingGroup      = 1035,
        PST_PPDrawing           = 1036,
        PST_NamedShows          = 1040,
        PST_NamedShow           = 1041,
        PST_NamedShowSlides     = 1042,

        PST_List                = 2000,
        PST_FontCollection      = 2005,
        PST_ColorSchemeAtom     = 2032,
        PST_ExtendedBuGraContainer = 2040,
        PST_ExtendedBuGraAtom   = 2041,

        PST_OEPlaceholderAtom   = 3011,

        PST_OutlineTextRefAtom  = 3998,
        PST_TextHeaderAtom      = 3999,
        PST_TextCharsAtom       = 4000,
        PST_StyleTextPropAtom   = 4001,
        PST_BaseTextPropAtom    = 4002,
        PST_TxMasterStyleAtom   = 4003,
        PST_TextRulerAtom       = 4006,
        PST_TextBytesAtom       = 4008,
        PST_TxSIStyleAtom       = 4009,
        PST_TextSpecInfoAtom    = 4010,
        PST_ExtendedParagraphAtom = 4012,
        PST_ExtendedParagraphMasterAtom = 4013,
        PST_ExtendedPresRuleContainer = 4014,
        PST_ExtendedParagraphHeaderAtom = 4015,
        PST_FontEntityAtom      = 4023,
        PST_CString             = 4026,
        PST_ExHyperlinkAtom     = 4051,
        PST_ExHyperlink         = 4055,
        PST_SlideNumberMCAtom   = 4056,
        PST_HeadersFooters      = 4057,
        PST_HeadersFootersAtom  = 4058,
        PST_TxInteractiveInfoAtom = 4063,
        PST_SlideListWithText   = 4080,
        PST_InteractiveInfo     = 4082,
        PST_InteractiveInfoAtom = 4083,
        PST_UserEditAtom        = 4085,
        PST_CurrentUserAtom     = 4086,
        PST_DateTimeMCAtom      = 4087,
        PST_GenericDateMCAtom   = 4088,
        PST_FooterMCAtom        = 4090,
        PST_ProgTags            = 5000,
        PST_ProgStringTag       = 5001,
        PST_ProgBinaryTag       = 5002,
        PST_BinaryTagData       = 5003,


        PST_PersistPtrIncrementalBlock = 6002
};

enum pssInstanceCode
{
        // Doc
        INS_DocSlideList      = 0,
        INS_DocMasterList     = 1,
        INS_DocNotesList      = 2,

        INS_SlideScheme       = 1,

        INS_UserDate          = 0,
        INS_Header            = 1,
        INS_Footer            = 2,

        INS_FriendlyName      = 0

};

enum {
        FONT_BOLD              = 0x00000001,
        FONT_ITALIC            = 0x00000002,
        FONT_UNDERLINE         = 0x00000004,
        FONT_SHADOW            = 0x00000010,
        FONT_STRIKEOUT         = 0x00000100,
        FONT_RELIEF            = 0x00000200,
        FONT_RESET_NUMBERING   = 0x00000400,
        FONT_ENABLE_NUMBERING1 = 0x00000800,
        FONT_ENABLE_NUMBERING2 = 0x00001000,
        FONT_FLAGS             = 0x0000ffff,
        FONT_FONT              = 0x00010000,
        FONT_FONT_SIZE         = 0x00020000,
        FONT_COLOR             = 0x00040000,
        FONT_OFFSET            = 0x00080000,
        FONT_UNKNOWN1          = 0x00100000,
        FONT_ASIAN_OR_COMPLEX  = 0x00200000,
        FONT_UNKNOWN2          = 0x00400000,
        FONT_SYMBOL            = 0x00800000,
        FONT_UNKNOWN3          = 0x01000000,
        FONT_UNKNOWN4          = 0x02000000,
        FONT_UNKNOWN5          = 0x04000000,
        FONT_UNKNOWN6          = 0x08000000,
        FONT_UNKNOWN7          = 0x10000000,
        FONT_UNKNOWN8          = 0x20000000,
        FONT_UNKNOWN9          = 0x40000000,
        FONT_UNKNOWN10         = 0x80000000
};

enum {
        PAR_BULLET_FLAGS     = 0x0000000f,
        PAR_BULLET_CHARACTER = 0x00000080,
        PAR_BULLET_FAMILY    = 0x00000010,
        PAR_BULLET_SIZE      = 0x00000040,
        PAR_BULLET_COLOR     = 0x00000020,
        PAR_ALIGNMENT        = 0x00000800,
        PAR2_BULLET_OFFSET   = 0x00000400,
        PAR_UNKNOWN_1        = 0x00000400,
        PAR_UNKNOWN_2        = 0x00000200,
        PAR2_TEXT_OFFSET     = 0x00000100,
        PAR_UNKNOWN_3        = 0x00000100,
        PAR_LINE_FEED        = 0x00001000,
        PAR_SPACING_ABOVE    = 0x00002000,
        PAR_SPACING_BELOW    = 0x00004000,
        PAR_TEXT_OFFSET      = 0x00008000,
        PAR_UNKNOWN_4        = 0x00008000,
        PAR_BULLET_OFFSET    = 0x00010000,
        PAR_UNKNOWN_5        = 0x00010000,
        PAR_DEFAULT_TAB      = 0x00020000,
        PAR_ASIAN_LINE_BREAK = 0x00080000,
        PAR_ASIAN_UNKNOWN    = 0x000e0000,
        PAR_BIDI             = 0x00100000,
        PAR2_TABS            = 0x00100000,
        PAR_TABS             = 0x00200000,
        PAR2_BIDI            = 0x00200000
};

enum
{
        RULER_DEFAULT_TAB    = 0x0001,
        RULER_TAB_COUNT      = 0x0004,
        RULER_TEXT_OFFSET    = 0x0008,
        RULER_BULLET_OFFSET  = 0x0100
};

enum
{
        BULLET_ACTIVATED     = 0x01,
        BULLET_UNKNOWN1      = 0x04
};

enum
{
        EXT_PAR_BU_INSTANCE        = 0x0800000,
        EXT_PAR_BU_NUMBERING_TYPE  = 0x1000000,
        EXT_PAR_BU_START           = 0x2000000
};

enum
{
        BULLET_TYPE_1 = 0x00001, // a.
        BULLET_TYPE_2 = 0x10001, // A.
        BULLET_TYPE_3 = 0x20001, // 1)
        BULLET_TYPE_4 = 0x30001, // 1.
        BULLET_TYPE_5 = 0x60001, // i.
        BULLET_TYPE_6 = 0x70001, // I.
        BULLET_TYPE_7 = 0x90001 // a)
};

/* See http://msdn.microsoft.com/library/default.asp?url=/library/en-us/intl/nls_19ir.asp
   for the whole list of actual languages */
enum
{
        LANGUAGE_DONTKNOW                 = 0x03FF,
        LANGUAGE_NONE                     = 0x00FF,
        LANGUAGE_SYSTEM                   = 0x0000,
        LANGUAGE_AFRIKAANS                = 0x0436,
        LANGUAGE_ALBANIAN                 = 0x041C,
        LANGUAGE_ARABIC                   = 0x0001  /* primary only, not a locale! */,
        LANGUAGE_ARABIC_SAUDI_ARABIA      = 0x0401,
        LANGUAGE_ARABIC_IRAQ              = 0x0801,
        LANGUAGE_ARABIC_EGYPT             = 0x0C01,
        LANGUAGE_ARABIC_LIBYA             = 0x1001,
        LANGUAGE_ARABIC_ALGERIA           = 0x1401,
        LANGUAGE_ARABIC_MOROCCO           = 0x1801,
        LANGUAGE_ARABIC_TUNISIA           = 0x1C01,
        LANGUAGE_ARABIC_OMAN              = 0x2001,
        LANGUAGE_ARABIC_YEMEN             = 0x2401,
        LANGUAGE_ARABIC_SYRIA             = 0x2801,
        LANGUAGE_ARABIC_JORDAN            = 0x2C01,
        LANGUAGE_ARABIC_LEBANON           = 0x3001,
        LANGUAGE_ARABIC_KUWAIT            = 0x3401,
        LANGUAGE_ARABIC_UAE               = 0x3801,
        LANGUAGE_ARABIC_BAHRAIN           = 0x3C01,
        LANGUAGE_ARABIC_QATAR             = 0x4001,
        LANGUAGE_ARMENIAN                 = 0x042B,
        LANGUAGE_ASSAMESE                 = 0x044D,
        LANGUAGE_AZERI                    = 0x002C  /* primary only, not a locale! */,
        LANGUAGE_AZERI_LATIN              = 0x042C,
        LANGUAGE_AZERI_CYRILLIC           = 0x082C,
        LANGUAGE_BASQUE                   = 0x042D,
        LANGUAGE_BELARUSIAN               = 0x0423,
        LANGUAGE_BENGALI                  = 0x0445,
        LANGUAGE_BULGARIAN                = 0x0402,
        LANGUAGE_BURMESE                  = 0x0455,
        LANGUAGE_CATALAN                  = 0x0403,
        LANGUAGE_CHINESE                  = 0x0004  /* primary only, not a locale! */,
        LANGUAGE_CHINESE_TRADITIONAL      = 0x0404,
        LANGUAGE_CHINESE_SIMPLIFIED       = 0x0804,
        LANGUAGE_CHINESE_HONGKONG         = 0x0C04,
        LANGUAGE_CHINESE_SINGAPORE        = 0x1004,
        LANGUAGE_CHINESE_MACAU            = 0x1404,
        LANGUAGE_CZECH                    = 0x0405,
        LANGUAGE_DANISH                   = 0x0406,
        LANGUAGE_DUTCH                    = 0x0413,
        LANGUAGE_DUTCH_BELGIAN            = 0x0813,
        LANGUAGE_ENGLISH                  = 0x0009  /* primary only, not a locale! */,
        LANGUAGE_ENGLISH_US               = 0x0409,
        LANGUAGE_ENGLISH_UK               = 0x0809,
        LANGUAGE_ENGLISH_AUS              = 0x0C09,
        LANGUAGE_ENGLISH_CAN              = 0x1009,
        LANGUAGE_ENGLISH_NZ               = 0x1409,
        LANGUAGE_ENGLISH_EIRE             = 0x1809,
        LANGUAGE_ENGLISH_SAFRICA          = 0x1C09,
        LANGUAGE_ENGLISH_JAMAICA          = 0x2009,
        LANGUAGE_ENGLISH_CARRIBEAN        = 0x2409,
        LANGUAGE_ENGLISH_BELIZE           = 0x2809,
        LANGUAGE_ENGLISH_TRINIDAD         = 0x2C09,
        LANGUAGE_ENGLISH_ZIMBABWE         = 0x3009,
        LANGUAGE_ENGLISH_PHILIPPINES      = 0x3409,
        LANGUAGE_ESTONIAN                 = 0x0425,
        LANGUAGE_FAEROESE                 = 0x0438,
        LANGUAGE_FARSI                    = 0x0429,
        LANGUAGE_FINNISH                  = 0x040B,
        LANGUAGE_FRENCH                   = 0x040C,
        LANGUAGE_FRENCH_BELGIAN           = 0x080C,
        LANGUAGE_FRENCH_CANADIAN          = 0x0C0C,
        LANGUAGE_FRENCH_SWISS             = 0x100C,
        LANGUAGE_FRENCH_LUXEMBOURG        = 0x140C,
        LANGUAGE_FRENCH_MONACO            = 0x180C,
        LANGUAGE_FRENCH_WEST_INDIES       = 0x1C0C,
        LANGUAGE_FRENCH_REUNION           = 0x200C,
        LANGUAGE_FRENCH_ZAIRE             = 0x240C,
        LANGUAGE_FRENCH_SENEGAL           = 0x280C,
        LANGUAGE_FRENCH_CAMEROON          = 0x2C0C,
        LANGUAGE_FRENCH_COTE_D_IVOIRE     = 0x300C,
        LANGUAGE_FRENCH_MALI              = 0x340C,
        LANGUAGE_FRISIAN_NETHERLANDS      = 0x0462,
        LANGUAGE_GAELIC_SCOTLAND          = 0x043C,
        LANGUAGE_GAELIC_IRELAND           = 0x083C,
        LANGUAGE_GALICIAN                 = 0x0456,
        LANGUAGE_GEORGIAN                 = 0x0437,
        LANGUAGE_GERMAN                   = 0x0407,
        LANGUAGE_GERMAN_SWISS             = 0x0807,
        LANGUAGE_GERMAN_AUSTRIAN          = 0x0C07,
        LANGUAGE_GERMAN_LUXEMBOURG        = 0x1007,
        LANGUAGE_GERMAN_LIECHTENSTEIN     = 0x1407,
        LANGUAGE_GREEK                    = 0x0408,
        LANGUAGE_GUJARATI                 = 0x0447,
        LANGUAGE_HEBREW                   = 0x040D,
        LANGUAGE_HINDI                    = 0x0439,
        LANGUAGE_HUNGARIAN                = 0x040E,
        LANGUAGE_ICELANDIC                = 0x040F,
        LANGUAGE_INDONESIAN               = 0x0421,
        LANGUAGE_ITALIAN                  = 0x0410,
        LANGUAGE_ITALIAN_SWISS            = 0x0810,
        LANGUAGE_JAPANESE                 = 0x0411,
        LANGUAGE_KANNADA                  = 0x044B,
        LANGUAGE_KASHMIRI                 = 0x0460,
        LANGUAGE_KASHMIRI_INDIA           = 0x0860,
        LANGUAGE_KAZAK                    = 0x043F,
        LANGUAGE_KHMER                    = 0x0453,
        LANGUAGE_KIRGHIZ                  = 0x0440,
        LANGUAGE_KONKANI                  = 0x0457,
        LANGUAGE_KOREAN                   = 0x0412,
        LANGUAGE_KOREAN_JOHAB             = 0x0812,
        LANGUAGE_LAO                      = 0x0454,
        LANGUAGE_LATVIAN                  = 0x0426,
        LANGUAGE_LITHUANIAN               = 0x0427,
        LANGUAGE_LITHUANIAN_CLASSIC       = 0x0827,
        LANGUAGE_MACEDONIAN               = 0x042F,
        LANGUAGE_MALAY                    = 0x003E  /* primary only, not a locale! */,
        LANGUAGE_MALAY_MALAYSIA           = 0x043E,
        LANGUAGE_MALAY_BRUNEI_DARUSSALAM  = 0x083E,
        LANGUAGE_MALAYALAM                = 0x044C,
        LANGUAGE_MALTESE                  = 0x043A,
        LANGUAGE_MANIPURI                 = 0x0458,
        LANGUAGE_MARATHI                  = 0x044E,
        LANGUAGE_MONGOLIAN                = 0x0450,
        LANGUAGE_NEPALI                   = 0x0461,
        LANGUAGE_NEPALI_INDIA             = 0x0861,
        LANGUAGE_NORWEGIAN                = 0x0014  /* primary only, not a locale! */,
        LANGUAGE_NORWEGIAN_BOKMAL         = 0x0414,
        LANGUAGE_NORWEGIAN_NYNORSK        = 0x0814,
        LANGUAGE_ORIYA                    = 0x0448,
        LANGUAGE_POLISH                   = 0x0415,
        LANGUAGE_PORTUGUESE               = 0x0816,
        LANGUAGE_PORTUGUESE_BRAZILIAN     = 0x0416,
        LANGUAGE_PUNJABI                  = 0x0446,
        LANGUAGE_RHAETO_ROMAN             = 0x0417,
        LANGUAGE_ROMANIAN                 = 0x0418,
        LANGUAGE_ROMANIAN_MOLDOVA         = 0x0818,
        LANGUAGE_RUSSIAN                  = 0x0419,
        LANGUAGE_RUSSIAN_MOLDOVA          = 0x0819,
        LANGUAGE_SAMI_LAPPISH             = 0x043B,
        LANGUAGE_SANSKRIT                 = 0x044F,
        LANGUAGE_SERBIAN                  = 0x001A  /* primary only, not a locale! */,
        LANGUAGE_CROATIAN                 = 0x041A,
        LANGUAGE_SERBIAN_LATIN            = 0x081A,
        LANGUAGE_SERBIAN_CYRILLIC         = 0x0C1A,
        LANGUAGE_SESOTHO                  = 0x0430,
        LANGUAGE_SINDHI                   = 0x0459,
        LANGUAGE_SLOVAK                   = 0x041B,
        LANGUAGE_SLOVENIAN                = 0x0424,
        LANGUAGE_SORBIAN                  = 0x042E,
        LANGUAGE_SPANISH                  = 0x040A,
        LANGUAGE_SPANISH_MEXICAN          = 0x080A,
        LANGUAGE_SPANISH_MODERN           = 0x0C0A,
        LANGUAGE_SPANISH_GUATEMALA        = 0x100A,
        LANGUAGE_SPANISH_COSTARICA        = 0x140A,
        LANGUAGE_SPANISH_PANAMA           = 0x180A,
        LANGUAGE_SPANISH_DOMINICAN_REPUBLIC = 0x1C0A,
        LANGUAGE_SPANISH_VENEZUELA        = 0x200A,
        LANGUAGE_SPANISH_COLOMBIA         = 0x240A,
        LANGUAGE_SPANISH_PERU             = 0x280A,
        LANGUAGE_SPANISH_ARGENTINA        = 0x2C0A,
        LANGUAGE_SPANISH_ECUADOR          = 0x300A,
        LANGUAGE_SPANISH_CHILE            = 0x340A,
        LANGUAGE_SPANISH_URUGUAY          = 0x380A,
        LANGUAGE_SPANISH_PARAGUAY         = 0x3C0A,
        LANGUAGE_SPANISH_BOLIVIA          = 0x400A,
        LANGUAGE_SPANISH_EL_SALVADOR      = 0x440A,
        LANGUAGE_SPANISH_HONDURAS         = 0x480A,
        LANGUAGE_SPANISH_NICARAGUA        = 0x4C0A,
        LANGUAGE_SPANISH_PUERTO_RICO      = 0x500A,
        LANGUAGE_SWAHILI                  = 0x0441,
        LANGUAGE_SWEDISH                  = 0x041D,
        LANGUAGE_SWEDISH_FINLAND          = 0x081D,
        LANGUAGE_TAJIK                    = 0x0428,
        LANGUAGE_TAMIL                    = 0x0449,
        LANGUAGE_TATAR                    = 0x0444,
        LANGUAGE_TELUGU                   = 0x044A,
        LANGUAGE_THAI                     = 0x041E,
        LANGUAGE_TIBETAN                  = 0x0451,
        LANGUAGE_TSONGA                   = 0x0431,
        LANGUAGE_TSWANA                   = 0x0432,
        LANGUAGE_TURKISH                  = 0x041F,
        LANGUAGE_TURKMEN                  = 0x0442,
        LANGUAGE_UKRAINIAN                = 0x0422,
        LANGUAGE_URDU                     = 0x0020  /* primary only, not a locale! */,
        LANGUAGE_URDU_PAKISTAN            = 0x0420,
        LANGUAGE_URDU_INDIA               = 0x0820,
        LANGUAGE_UZBEK                    = 0x0043  /* primary only, not a locale! */,
        LANGUAGE_UZBEK_LATIN              = 0x0443,
        LANGUAGE_UZBEK_CYRILLIC           = 0x0843,
        LANGUAGE_VENDA                    = 0x0433,
        LANGUAGE_VIETNAMESE               = 0x042A,
        LANGUAGE_WELSH                    = 0x0452,
        LANGUAGE_XHOSA                    = 0x0434,
        LANGUAGE_ZULU                     = 0x0435
};

enum
{
        SPECIAL_INFO_UNKNOWN1           = 0x0001,
        SPECIAL_INFO_LANGUAGE           = 0x0002,
        SPECIAL_INFO_UNKNOWN2           = 0x0004
};

}

}

}

//---------------------------------------------------------------------------
#endif
