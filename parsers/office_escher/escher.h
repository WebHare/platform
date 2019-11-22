#ifndef blex_parsers_office_escher_escher
#define blex_parsers_office_escher_escher

#include <blex/blexlib.h>
#include <blex/stream.h>
#include <drawlib/drawlibv2/drawlib_v2_types.h>
#include <drawlib/drawlibv2/textrenderer.h>
#include <parsers/base/formatter.h>

// Defined in recordreader.h:
namespace Parsers {
namespace Office {
namespace Escher {

// Defined in escher.h:
class EscherDocument;
class SchemeColors;

struct RecordData
{
        RecordData(Blex::RandomStream &source, Blex::FileOffset start, Blex::FileOffset limit)
        : data(start,limit,source)
        {
        }

        unsigned version;
        unsigned instance;
        uint16_t type;
        Blex::LimitedStream data;
};

// Type for the callback function used to handle items in a container in the powerpoint file
typedef std::function< void(RecordData &) > RecordCallback;

BLEXLIB_PUBLIC std::ostream& operator<<(std::ostream &output, RecordData const &record_header);

typedef std::function<void(DrawLib::TextFormatter*, uint32_t) > TextCallback;

class BLEXLIB_PUBLIC SchemeColors
{
public:
        DrawLib::Pixel32 GetColor(unsigned index) const;

        void AddColor(DrawLib::Pixel32 newcolor)
        {
                colors.push_back(newcolor);
        }
private:
        std::vector<DrawLib::Pixel32> colors;
};

/** The interface used to talk to Escher externally */
class BLEXLIB_PUBLIC Interface
{
        /**
         * The escher document / root node of the escher tree.
         * Owned by the interface.
         * (implementation pointer, BCB BUG workaround)
         */
        EscherDocument* doc;

        /** Retrieve the UTF-8 encoded alt tag for a shape
            @param shapeid is an ID of the shape.
        */
        std::string GetShapeAltTag(int32_t shapeid) const;

        /** This method fills the 'gifdata' vector with binary
            @param shapeid ID of the shape to get the GIF data from.
            @param gifdata pointer to a uint8_t vector that will receive the GIF data, if any
        */
        void GetShapeGifData(int32_t shapeid, std::vector<uint8_t> *gifdata) const;

public:
        Interface();
        ~Interface();

        /** Paint the specified shape
            @param drawinfo Drawing information, as retrieved from the harescript drawlib interface
            @param shapeid ID of the shape to paint
            @param textcallback Callback that will provide texts from the host document, given a host-defined identifier
        */
        void PaintShape(DrawLib::BitmapInterface *bitmap, DrawLib::FPSize const &rendered_pixelsize, DrawLib::XForm2D const &final_transform, int32_t shapeid, Escher::TextCallback const &textcallback, Escher::SchemeColors const *scheme_colors) const;

        /** Get the picture full clipping bounding box, relative to the 0,0,1,1 bounding box.
            Currently you MUST CALL this function, no matter what!
            @param shapeid ID of the shape to call the bounding box for
            @param stored_transform The transformation with which the escher shape was stored.
                   Required to figure out how the virtual escher coordinate space maps to pixels,
                   so that line widths (which are specified in pixels) can be properly calculated */
        DrawLib::FPBoundingBox GetBoundingBox(int32_t shapeid, DrawLib::FPSize const &rendered_pixelsize) const;

        /** Reads and parses the escherdata from a word document.
            @param escherdata is a reference to a random access stream containing Escher binary data.
            @param delaydata is a pointer to a random access stream.
        */
        void ReadDocument(Blex::RandomStream &escherdata, Blex::RandomStream *delaydata);

        void ReadDggContainer(Blex::RandomStream &dggContainer, Blex::RandomStream *delaydata);
        // Returns the id of this container to reference it later
        uint32_t ReadDgContainer(Blex::RandomStream &dgContainer, Blex::RandomStream *delaydata);

        /** Get the list with shape id's in the specified drawing container (used by PowerPoint)
        */
        std::vector<int32_t> GetShapeIds(uint32_t drawing_container_id) const;

        /** Get the id with the background in the specified drawing container (used by PowerPoint)
        */
        int32_t GetBackgroundShapeId(uint32_t drawing_container_id) const;

        /** Get the ClientAnchor given a shapeid (used by PowerPoint)
        */
        std::vector<uint8_t> GetClientAnchor(int32_t shapeid);

        /** Get the ClientData given a shapeid (used by PowerPoint)
        */
        std::vector<uint8_t> GetClientData(int32_t shapeid);

        /** Get the ClientTextbox given a shapeid (used by PowerPoint)
        */
        std::vector<uint8_t> GetClientTextbox(int32_t shapeid);

        /** Get the TextId given a shapeid (used by Word)
        */
        uint32_t GetTextId(int32_t shapeid) const;

        /** Retrieve the Hyperlink for a shape */
        Parsers::Hyperlink GetShapeHyperlink(int32_t shapeid) const;

        /** Get the general shape information (a Parsers::ImageInfo object) */
        void GetShapeImageInfo(int32_t shapeid, Parsers::ImageInfo *imageinfo) const;
};

BLEXLIB_PUBLIC void DebugContainerReader(RecordData &record_data, Blex::RandomStream *delay, std::ostream *output, int indent_level);
BLEXLIB_PUBLIC void ReadContainer(Blex::RandomStream &record, RecordCallback const &recordcallback);

} //end namespace Escher
} //end namespace Office
} //end namespace Parsers

#define ESCHER_DGGCONTAINER     0xF000
#define ESCHER_BSTORECONTAINER  0xF001
#define ESCHER_DGCONTAINER      0xF002
#define ESCHER_SPGRCONTAINER    0xF003
#define ESCHER_SPCONTAINER      0xF004
#define ESCHER_SOLVERCONTAINER  0xF005
#define ESCHER_DGG              0xF006
#define ESCHER_BLIP             0xF007
#define ESCHER_DG               0xF008
#define ESCHER_SPGR             0xF009
#define ESCHER_SP               0xF00A
#define ESCHER_OPT              0xF00B
#define ESCHER_TEXTBOX          0xF00C
#define ESCHER_CLIENTTEXTBOX    0xF00D
#define ESCHER_ANCHOR           0xF00E
#define ESCHER_CHILDANCHOR      0xF00F
#define ESCHER_CLIENTANCHOR     0xF010
#define ESCHER_CLIENTDATA       0xF011
#define ESCHER_CONNECTORRULE    0xF012
#define ESCHER_ALIGNRULE        0xF013
#define ESCHER_ARCRULE          0xF014
#define ESCHER_CLIENTRULE       0xF015
#define ESCHER_CLSID            0xF016
#define ESCHER_CALLOUTRULE      0xF017
//F018 - F117 blip types
#define ESCHER_REGROUPITEMS     0xF118
#define ESCHER_SELECTION        0xF119
#define ESCHER_COLORMRU         0xF11A
#define ESCHER_DELETEDPSPL      0xF11D
#define ESCHER_SPLITMENUCOLORS  0xF11E
#define ESCHER_OLEOBJECT        0xF11F
#define ESCHER_COLORSCHEME      0xF120

#define ESCHER_POSITIONINGDATA  0xF122

#endif
