#ifndef blex_harescript_modules_powerpoint
#define blex_harescript_modules_powerpoint
//---------------------------------------------------------------------------

#include <harescript/vm/hsvm_dllinterface.h>
#include <harescript/vm/hsvm_idmapstorage.h>
#include <blex/docfile.h>
#include <blex/stream.h>
#include <blex/datetime.h>
#include <parsers/office_escher/escher.h>
#include <parsers/office_escher/internal.h> // For Blips
#include <drawlib/drawlibv2/drawobject.h>
#include "types.h"

namespace Parsers
{

namespace Office
{

namespace Powerpoint
{

using Parsers::Office::Escher::RecordData;

// The relative scale between line widths (in pixels) and font sizes (in points)
static const float font_scale = 4.0/3.0;
static const float point_to_pixel = 1.0/6.0;

// Type for the callback function used to handle items in a container in the powerpoint file
typedef std::function< void(RecordHeader const &, uint32_t, Blex::RandomStream &) > RecordCallback;

struct TextMarker
{
        uint32_t start;
        uint32_t end;
};

struct SpecialInfo
{
        uint16_t language;
};

// Sometimes we have to calculate the date our self, in order to be able to do this,
// we need to know the language to render the date in. At read in time this is not known
struct TextExtension
{
        TextExtension() : calculate_date(false), formatid(0) {} ;
        bool calculate_date; // When set to true, we have to calculate the date ourself

        uint8_t formatid;
        Blex::UTF16String text;
};

class Text
{
        public:
        Text(int32_t _type) : type(_type) {}
        int32_t type;

        // This vector contains interactive items like hyperlinks, sounds, programs, animations
        std::vector<std::pair<TextMarker, InteractiveInfoAtom> > interactive_items;

        // This vector contains special information (like the language), ordered by character position
        std::vector<std::pair<uint32_t, SpecialInfo> > special_infos;

        // Text extensions, ordered by character position (could be a date, page number, etc.)
        std::map<uint32_t, TextExtension> text_extensions;

        // Contains the UTF16 encoded data string
        Blex::UTF16String data;

        // Contains unencoded character/paragraph styles
        std::vector<uint8_t> style;
        std::vector<uint8_t> ruler;
        std::vector<uint8_t> extpar;
};

// Coordinates
struct Coords {
        int16_t x1;
        int16_t y1;
        int16_t x2;
        int16_t y2;
};

// Store information about the shape
struct ShapeInfo
{
        Coords position;
        std::unique_ptr<OEPlaceholderAtom> oeplaceholderatom;
        std::unique_ptr<InteractiveInfoAtom> interactiveinfoatom;

/*        std::unique_ptr<ExObjRefAtom> exobjrefatom;
        std::unique_ptr<AnimationInfoAtom> animationinfoatom;
        std::unique_ptr<MouseClick> mouseclick;
        std::unique_ptr<MouseMove> mousemove;
        std::unique_ptr<RecolorInfoAtom> recolorinfoatom;*/
};

typedef std::shared_ptr<ShapeInfo> ShapeInfoPtr;

// Information per slide
class Slide
{
public:
        Slide() : drawing_container_id(0) { }

        // Properties
        unsigned type;                          // 0=master, 1=normal, 2=notes
        uint32_t slideid;                            // Id of this slide
        uint32_t slidenr;                            // Slide number
        SlideAtom slideatom;                    // SlideAtom
        NotesAtom notesatom;                    // NotesAtom
        std::vector<Text> texts;                // Vector with all the texts (except headers, footers, etc.)
        Blex::UTF16String headertext;           // Header text
        Blex::UTF16String footertext;           // Footer text
        Blex::UTF16String userdatetext;         // User date text
        std::unique_ptr<HeadersFootersAtom> headersfooters;      // HeadersFootersAtom
        Escher::SchemeColors schemecolors;      // SchemeColors

        // Id of the dgContainer and Stream to dgContainer
        uint32_t drawing_container_id;
        std::unique_ptr<Blex::LimitedStream> dgContainerStream;

        // Store information about shapes (actions, etc.)
        int32_t background_shape_id;            // The background shape id
        std::vector<std::pair<int32_t, ShapeInfoPtr> > shapes; // All other shapes at the root of the slide
};

// Information about paragraph formatting
struct ParSetting
{
        ParSetting() :
          bullet_flags(0), bullet_char(0), bullet_font(0), bullet_height(0),
          bullet_color(0,0,0), bullet_instance(0xFFFF),
          numbering_type(0xFFFFFFFF), numbering_start(0xFFFF),
          alignment(0), line_feed(0), space_before(0), space_after(0), indent(0),
          bullet_indent(0), default_tab(0), asian_line_break(0), bidi(0),
          font(0), asian_complex_font(0), symbol(0), size(0), scheme_color(0xFF), color(0,0,0), escapement(0),
          offset(0), bold(false), italic(false), underline(false), shadow(false), relief(false)
        { }

        // Bullet properties
        uint16_t bullet_flags;
        uint16_t bullet_char;
        uint16_t bullet_font;
        uint16_t bullet_height;
        DrawLib::Pixel32 bullet_color;
        // Extended bullet properties (Powerpoint 2000)
        uint16_t bullet_instance;
        uint32_t numbering_type;
        uint16_t numbering_start;

        // Paragraph properties
        uint16_t alignment;
        int16_t line_feed;
        int16_t space_before;
        int16_t space_after;
        uint16_t indent;
        uint16_t bullet_indent;
        uint16_t default_tab;
        uint16_t asian_line_break;
        uint16_t bidi;
        uint16_t tab_count;
        std::vector< std::pair<uint16_t,uint16_t> > tab_entries; // style and offset

        // Font properties
        uint16_t font;
        uint16_t asian_complex_font;
        uint16_t symbol;
        uint16_t size;
        uint8_t scheme_color; // When this value is 0xFE we use no scheme colors
        DrawLib::Pixel32 color;
        uint16_t escapement; // FIXME: Are these the same (escapement and offset?)
        int16_t offset;
        bool bold;
        bool italic;
        bool underline;
        bool shadow;
        bool relief;
};

typedef std::vector<ParSetting> ParSettings; // Save paragraph/character settings per indentation level

typedef std::shared_ptr<Slide> SlidePtr;
typedef std::shared_ptr<Escher::Interface> EscherInterfacePtr;

class BLEXLIB_PUBLIC Powerpointfile
{
public:
        Powerpointfile(std::unique_ptr<Blex::RandomStream> &_file)
        : file(std::move(_file))
        , docfile(*file)
        { }

        ~Powerpointfile() {};

        void DecodeFile();
        std::vector<uint32_t> GetSlideList();
        std::vector<Text> GetSlideTexts(uint32_t slideid);
        const std::vector<std::pair<std::string, std::vector<uint32_t> > > & GetCustomShows() { return custom_shows; }
        void RenderSlide(int32_t slideid, DrawLib::BitmapInterface *canvas, std::vector<Text> *extracted_texts);
        void RenderNotes(int32_t slideid, DrawLib::BitmapInterface *canvas, std::vector<Text> *extracted_texts);

private:
/*        void ReadContainer(uint32_t offset, uint32_t length, RecordCallback const &recordcallback, Blex::RandomStream &container);*/
        void ReadData(std::vector<uint8_t> * buffer, uint32_t offset, uint32_t length, Blex::RandomStream &container);

        void RestoreCurrentEdit(uint32_t offset);

        void HandleDocument(RecordData &record_data);
        void HandleCurrentUser(RecordData &record_data);
        void HandleSlideList(RecordData &record_data, SlidePtr &curslide, unsigned type);
        void HandleSlide(RecordData &record_data, SlidePtr curslide);
        void HandleHeadersFooters(RecordData &record_data, SlidePtr curslide);
        void HandleEnvironment(RecordData &record_data);
        void HandleFontCollection(RecordData &record_data);
        void HandleClientTextbox(RecordData &record_data, SlidePtr curslide, SlidePtr dataslide, Text *text);
        void HandleClientData(RecordData &record_data, ShapeInfoPtr shape);
        void HandleExObjList(RecordData &record_data);
        void HandleExHyperlink(RecordData &record_data, uint32_t *objId);
        void HandleInteractiveInfo(RecordData &record_data, InteractiveInfoAtom &interactiveatom);
        void HandleClientDataExtPar(RecordData &record_data, Text *text);
        void HandleList(RecordData &record_data);
        void HandleNamedShows(RecordData &record_data);
        void HandleNamedShow(RecordData &record_data);
        void HandleProgTags(RecordData &record_data);
        void HandleProgBinaryTag(RecordData &record_data, std::string &version);
        void HandlePPT9TagData(RecordData &record_data);
        void HandleExtendedPresRuleContainer(RecordData &record_data, uint32_t &slideid, uint32_t &tx_type);
        void HandleExtendedBuGraContainer(RecordData &record_data, uint32_t slideid, uint32_t tx_type);

        void LoadEscherInterface(SlidePtr slide, Blex::RandomStream &dgContainerStream);

        void GetText(DrawLib::TextFormatter *textformatter, int32_t shapeid, SlidePtr curslide, SlidePtr dataslide, std::vector<Text> *extracted_texts);

        void DecodeMasterStyle(uint32_t txtype, Blex::RandomStream &master_style_stream);
        void DecodeParagraphProps(ParSetting *parsetting, Blex::RandomStream &style_stream, bool first);
        void DecodeExtendedParagraphProps(ParSetting *parsetting, Blex::RandomStream &style_stream);
        void DecodeMasterExtendedParagraphProps(ParSetting *parsetting, Blex::RandomStream &style_stream);
        void DecodeCharacterProps(ParSetting *parsetting, Blex::RandomStream &style_stream);
        void DecodeRuler(ParSettings *parsettings, Blex::RandomStream &ruler_stream);
        void DecodeSpecialInfoRun(std::vector<std::pair<uint32_t, SpecialInfo> > *special_info, Blex::RandomStream &special_info_stream);
        void DecodeSpecialInfo(SpecialInfo* special_info, Blex::RandomStream &special_info_stream);

        uint32_t GetSlideRefById(uint32_t slideid);
        uint32_t GetNotesRefById(uint32_t slideid);
        uint32_t GetMasterRefById(uint32_t slideid);

        void AddShape(SlidePtr slide, int32_t shapeid);

        void RenderShape(SlidePtr slide, int32_t shapeid, DrawLib::BitmapInterface *canvas, SlidePtr dataslide, std::vector<Text> *extracted_texts);
        void RenderText(ParSettings master_text_style, Escher::SchemeColors const *scheme_colors, Blex::RandomStream &text_style_stream, Blex::RandomStream &ruler_stream, Blex::RandomStream &ext_par_props, Blex::RandomStream &master_ext_par_props, Blex::UTF16String text, DrawLib::TextFormatter *textformatter, std::map<uint32_t, TextExtension> const &text_extensions, std::vector<std::pair<uint32_t, SpecialInfo> > const &special_infos);
        void ApplyTextFormattingText(ParSetting &parsetting, Blex::UTF16String text, DrawLib::TextFormatter *textformatter, bool &par_initialized, bool &is_first_line, Escher::SchemeColors const *scheme_colors);
        void ActivateFontSettings(ParSetting parsetting, DrawLib::TextFormatter *textformatter, Escher::SchemeColors const *scheme_colors);
        void InitTextParagraph(ParSetting &parsetting, DrawLib::TextFormatter *textformatter, bool &is_first_line, Escher::SchemeColors const *scheme_colors);

        std::unique_ptr<Blex::RandomStream> file;
        Blex::Docfile docfile;
        CurrentUserAtom currentUserAtom;

        // A map with ref nrs to each slide, notesslide and masterslide
        std::map<uint32_t, SlidePtr> slides;
        std::map<uint32_t, SlidePtr> notesslides;
        std::map<uint32_t, SlidePtr> masterslides;
        // Contains initialized versions of the masterslides escher data
        Escher::Interface escherinterface;

        // A map with ref nrs to offsets in the documentstream
        std::map<uint32_t, uint32_t> ref_offsets;

        // A map with Text Type to default paragraph/character settings
        std::map<uint32_t, ParSettings> master_text_styles;

        // The default special info (default language, etc.)
        SpecialInfo special_info;

        // The document stream in the OLE file
        std::unique_ptr<Blex::RandomStream> documentstream;
        // The current user stream in the OLE file
        std::unique_ptr<Blex::RandomStream> currentuserstream;
        // The delay stream in the OLE file
        std::shared_ptr<Blex::RandomStream> delaystream;

        int32_t documentRef;

        // Contains information about the document
        DocumentAtom documentAtom;

        // Fonts used in the document
        std::vector<std::string> fontnames;

        // Hyperlinks used in the document
        std::map<uint32_t, std::string> hyperlinks;

        // Custom shows (name -> vector with slideid's)
        std::vector<std::pair<std::string, std::vector<uint32_t> > > custom_shows;

        // Extended paragraph settings (introduced in PowerPoint 2000) will be processed later
        // when the slides are loaded (the master ext_par settings are stored under id=0 and
        // are stored in a different way)
        typedef std::map<uint32_t, std::vector<uint8_t> > txtype_extpar;
        std::map<uint32_t, txtype_extpar> ext_par_settings;
        // Here we store graphical bullet blips
        typedef std::shared_ptr<Parsers::Office::Escher::BlipStoreEntry> BlipStoreEntryPtr;
        std::map<uint16_t, BlipStoreEntryPtr> graphical_bullet_blips;

        // Name of the user who opened the document
        std::string username;
};

class PowerpointConversion
{
public:
        PowerpointConversion(HSVM *hsvm, HSVM_VariableId filedata);

        void DecodeFile();
        void GetSlideList(HSVM_VariableId id_set);
        void GetSlideTexts(uint32_t slideid, HSVM_VariableId id_set);
        void GetCustomShows(HSVM_VariableId id_set);
        void RenderSlide(int32_t slideid, DrawLib::BitmapInterface &canvas);
        void RenderNotes(int32_t slideid, DrawLib::BitmapInterface &canvas);

        std::unique_ptr<Powerpointfile> powerpointfile;

private:
        std::unique_ptr<Blex::MemoryRWStream> blobstream;
        HSVM *hsvm;
};

/** Global PowerPoint data, per VM */
class PPointContext
{
        public:
        PPointContext();
        ~PPointContext();

        typedef std::shared_ptr<PowerpointConversion> PowerpointConversionPtr;
        HareScript::IdMapStorage<PowerpointConversionPtr> conversionlist;

};

/////////////////////////////////////////////////////
// Some (globally) used debug functions:

std::ostream &operator<<(std::ostream &output, RecordHeader const &data);

const unsigned PPointContextId = 517;

}
}
}

//---------------------------------------------------------------------------
#endif
