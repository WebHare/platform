#ifndef blex_parsers_formatter
#define blex_parsers_formatter

#include <drawlib/drawlibv2/drawlib_v2_types.h>
#include <harescript/vm/hsvm_dllinterface.h>

namespace Parsers
{

typedef std::function<void(int32_t, DrawLib::BitmapInterface *, int32_t, int32_t, int32_t, int32_t) > PaintFunction;

class ForwardingOutput;
class OutputObjectInterface;

inline uint32_t DrawlibtoHSPixel(DrawLib::Pixel32 drawlibpixel)
{
        //Pixel32(packedcolor) 65536*red + 256* green + blue + 16.7m * alpha
        return uint32_t( (drawlibpixel.GetA() << 24)
                  | (drawlibpixel.GetR() << 16)
                  | (drawlibpixel.GetG() <<  8)
                  | (drawlibpixel.GetB()      ) );
}
inline int TwipsToPixels(int twips)
{
        return (twips+8)/15;
}


enum HorizontalAlignment
{
        Left=0,
        Center,
        Right,
        Justified
};

enum VerticalAlignment
{
        Top=0,
        Middle,
        Bottom
};

/** Object types for a paragraph */
enum ObjectType
{
        ///This paragraph is not part of a list
        NoList,
        ///The bullet (or numbering) is inline with the text (text wraps around)
        InlineBullet,
        ///The bullet (or numbering) is side-by-side with the text
        SidebysideBullet
};

/** Four direction dinstances object (padding/margin) */
struct Distance
{
        Distance()
        : left(0)
        , right(0)
        , top(0)
        , bottom(0)
        {
        }

        Distance(unsigned _top, unsigned _right, unsigned _bottom, unsigned _left)
        : left(_left)
        , right(_right)
        , top(_top)
        , bottom(_bottom)
        {
        }

        inline bool operator ==(Distance const &rhs) const
        {
                return left==rhs.left && right==rhs.right && top==rhs.top && bottom==rhs.bottom;
        }
        inline bool operator !=(Distance const &rhs) const
        {
                return !(*this==rhs);
        }

        /// Padding at left of paragraph, in 20ths of a point
        unsigned left;
        /// padding at right of paragraph
        unsigned right;
        /// Padding at top of paragraph
        unsigned top;
        /// Padding at bottom of paragraph
        unsigned bottom;
};

/** Formatting properties for a paragraph */
struct BLEXLIB_PUBLIC Paragraph
{
        Paragraph();

        /// Paragraph justification
        HorizontalAlignment jc;
        /// Relative indentation of first line, in twips (20ths of a point)
        signed first_indent;
        /// Paragraph padding
        Distance padding;
        /// HTML heading level
        unsigned headinglevel;

        bool exactheight;
        signed lineheight; //a negative value codes for a percentage, positive is lineheight in twips
        ///Word style id of the paragraph, if available
        int32_t mswordid;
};

/** Configuration of a link (ADDME: Can we move this to the Output module?) */
struct Hyperlink
{
        Hyperlink()
        : objectptr(0)
        {
        }

        Hyperlink(std::string const &_data, std::string const &_target, std::string const &_title)
        : data(_data), objectptr(0), target(_target), title(_title)
        {
        }

        Hyperlink(OutputObjectInterface const* _objectptr, std::string const &_target, std::string const &_title)
        : objectptr(_objectptr), target(_target), title(_title)
        {
        }

        bool operator!=(const Hyperlink &rhs) const
        {
                return data!=rhs.data || objectptr != rhs.objectptr || target!=rhs.target || title!=rhs.title;
        }

        ///Location the link points to
        std::string data;
        ///Doc object the link points to
        OutputObjectInterface const* objectptr;
        ///Optional target into which the link should be loaded
        std::string target;
        ///Optional title for the link
        std::string title;
};

/** Data associated with a font (separated from FormattedCharacter so that the
    strings don't have to be re-set all the time) */
struct Font
{
        Font()
        {
                neveroverride=false;
        }
        explicit Font(std::string const &facename)
        : font_face(facename)
        {
        }

        ///The face of the font, UTF8 coded
        std::string font_face;
        ///True if this font may never be overridden (symbol fonts)
        bool neveroverride;
};

struct BLEXLIB_PUBLIC Character
{
        enum Bits
        {
                Bold=           0x00000001,
                Italic=         0x00000002,
                Strikethrough=  0x00000004,
                Blink=          0x00000008,
                Smallcaps=      0x00000010,
                DoubleStrike=   0x00000020,
                Shadow=         0x00000040,
                Emboss=         0x00000080,
                Imprint=        0x00000100,
                Outline=        0x00000200,
                Overline=       0x00000400,
                Insertion=      0x00000800,
                Deletion=       0x00001000
        };

        enum Underlines
        {
                NoUnderline = 0,
                SingleUnderline
        };

        enum SubSuperScript
        {
                NormalScript =  0,
                SubScript,
                SuperScript
        };

        Character();

        bool operator ==(Character const &rhs) const;

        inline bool operator !=(Character const &rhs) const
        {
                return !(*this==rhs);
        }

        uint32_t format_bits;
        Underlines underlining;
        SubSuperScript subsuper;
        DrawLib::Pixel32 foreground_color;
        DrawLib::Pixel32 background_color;
        unsigned font_halfpoint_size;
        Font const *fonttype;
        std::string languagecode;
};

struct PredefinedStyle
{
        std::string name;
        Paragraph formatpara;
        Character formatchar;
};

/** Format for an output table. Can't yet decide whether all the data should be
    public or private... */
class BLEXLIB_PUBLIC Table
{
        public:
        /** How to format a border */
        struct BorderType
        {
                BorderType()
                : color(0,0,0,0), thickness_twips(0), overlapped(false)
                {
                }

                DrawLib::Pixel32 color;
                unsigned thickness_twips;             //< Thickness in twips
                bool overlapped;                //< This border is overlapped by a cell

                inline bool operator==(BorderType const &rhs) const
                {
                        return color == rhs.color && thickness_twips == rhs.thickness_twips && overlapped == rhs.overlapped;
                }
                inline bool operator!=(BorderType const &rhs) const
                {
                        return !(*this==rhs);
                }
        };

        /** Existance types of a cell */
        enum CellTypes
        {
                Open,                           //< The cell has not been defined yet
                Data,                           //< The cell has data
                OverlappedStartLower,           //< The cell is the left side of an overlap, but not on the same row as the start of the overlap
                OverlappedRemainder,            //< The cell is part of the second or later gridcolumn of an overlap
                OutsideTable                    //< The cell is outside the table (only exists for border setting)
        };

        /** Grid cell formatting. */
        struct CellFormatting
        {
                CellFormatting()
                : background(0,0,0,0)
                , valign(Top)
                , tableheader(false)
                , type(Open)
                , rowspan(1)
                , colspan(1)
                {
                }

                DrawLib::Pixel32 background;    //< Cell background color
                VerticalAlignment valign;       //< Vertical alignment of all data (only valid for Data cells)
                Distance padding;               //< Padding of data inside the cell
                bool tableheader;               //< Cell is a table header


                CellTypes type;                 //< Cell type (overlapped, exists, etc)
                BorderType top;                 //< Type of the top border
                BorderType right;               //< Type of the right border
                BorderType bottom;              //< Type of the bottom border
                BorderType left;                //< Type of the left border
                unsigned rowspan;               //< Rows this cell spans over (only valid for Data cells)
                unsigned colspan;               //< Columns this cell spans over (only valid for Data cells)

                friend class Table;
        };

        private:
        /** Get the position of a cell in the grid */
        unsigned GridPosition(unsigned column, unsigned row) const
        {
                return row*(cellwidths.size()+1) + column;
        }

        /** Number of rows */
        unsigned numrows;
        /** Table look. This is a (numcolumns+1) * (numrows+1) table, and
            is ordered left to right, top to bottom. */
        std::vector<CellFormatting> grid;

        public:
        /** The formatting for a table
            @param colums Number of columns in the table's containing grid
            @param rows Number of rows in the table's containing grid
            @param cellspacing Cell spacing
            @param halign Table alignment*/
        //Table(unsigned columns, unsigned rows, unsigned cellspacing, HorizontalAlignment halign);

        Table();

        /** Setup the table grid. Clears any existing cells and cellwidths */
        void SetupGrid(unsigned columns, unsigned rows);

        /** Get the number of rows in the table grid */
        unsigned GetRows() const { return numrows; }

        /** Get the number of columns in the table grid */
        unsigned GetColumns() const { return cellwidths.size(); }

        /** Get the grid location of next cell with a different type, on the same row
            @param row Row number to look in
            @param cell Cell to start searching from
            @return The first cell with a different type, or GetColumns()
                    if no more different cells exist on this row */
        unsigned GetNextCell(unsigned column, unsigned row) const;

        /** Get the formatting for a specified cell */
        CellFormatting const& GetFormatting(unsigned column, unsigned row) const
        { return grid[GridPosition(column,row)]; }

        CellFormatting & GetFormatting(unsigned column, unsigned row)
        { return grid[GridPosition(column,row)]; }

        /** Get the right border type for a specified cell */
//        BorderType GetCellRightBorder(unsigned column, unsigned row) const;

        /** Get the bottom border type for a specified cell */
//        BorderType GetCellBottomBorder(unsigned column, unsigned row) const;

        /** Get the border type for a specified intersection */
//        BorderType const& GetIntersection(unsigned column, unsigned row) const;

        /** Check if the specified cell fits into the table grid */
        bool DoesNewCellFit(unsigned column, unsigned row, unsigned colspan, unsigned rowspan) const;

        /// Delete a column from the table
        void DeleteColumn(unsigned colindex);

        /// Get the rightmost data/open column of a row (the one who's padding-right matters). Returns GetColumns() if the last data column is vertically overlapped
        unsigned GetRightmostColumn(unsigned row) const;

        /** Merge the cell with the one above. If the cell above had a colspan, merge the correct number of neighbours into this cell too
            @return The colspan of the extended cell */
        unsigned SpanToAboveCell(unsigned x, unsigned y);

        /** Create a cell with the specified size
            @return The newly created cell. This pointer is valid until the
                    next CreateCell call */
        CellFormatting *CreateCell(unsigned x, unsigned y,
                                             unsigned colspan, unsigned rowspan,
                                             BorderType const &topborder,
                                             BorderType const &leftborder,
                                             BorderType const &bottomborder,
                                             BorderType const &rightborder);

        /// Padding of this table object relative to its surrounding objects
        Distance tablepadding;
        /// Default table cell padding
        Distance default_cellpadding;

        ///Cell widths (0 = unspecified, >0 = width in pixels, <0 = width percentage)
        std::vector<signed> cellwidths;
        unsigned cellspacing;

        /// Table alignment
        HorizontalAlignment halign;
        ///Table width (0 = unspecified, >0 = width in pixels, <0 = width percentage)
        signed tablewidth;
};

///description of an image..
struct BLEXLIB_PUBLIC ImageInfo
{
        ImageInfo();
        ~ImageInfo();

        ///We know the image is a photo
        bool is_known_photo;
        ///Width of the image in pixels
        unsigned lenx;
        ///Height of the image in pixels
        unsigned leny;
        ///UTF-8 encoded alttag
        std::string alttag;
        ///UTF-8 encoded title
        std::string title;
        ///Animated GIF file, if any
        std::vector<uint8_t> animated_gif;
        ///Image alignment (0=unknown, 1=left, 2=right)
        unsigned align;
        ///Unique ID for image (if we see the image again in the current conversion, it should have the same ID)
        std::string uniqueid;
        ///Painting function
        PaintFunction painter;
        ///Shape wrapping distance info
        Distance wrapping;
};

class FormattedOutput;
typedef std::shared_ptr<FormattedOutput> FormattedOutputPtr;

/** Base class for formattable output objects */
class BLEXLIB_PUBLIC FormattedOutput
{
        public:
        /** @short Create a formatted object */
        FormattedOutput();
        virtual ~FormattedOutput();

        /** Get the formatted output ID. If 0, we're not  registered yet */
        int32_t GetRegisteredId() { return registered_id; }

        /** Maximum image width */
        virtual unsigned GetMaximumImageWidth();

        /** Do we accept images?
            Overriding and disabling this allows some code to short-circuit and skip image calculation code.
            The default implementation returns 'true' */
        virtual bool AreImagesAccepted();

        /** Do we accept hyperlinks?
            Overriding and disabling this allows some code to short-circuit and skip hyperlink generation/calculation
            The default implementation returns 'true' */
        virtual bool AreHyperlinksAccepted();

        /** Request the current background color. The writers often don't know
            this, as filters may affect the actual background color. If the
            color is unknown, transparent white will be returned */
        virtual DrawLib::Pixel32 GetBackgroundColor();

        /** Get the base formatting for the current paragraph */
        virtual void GetBaseFormatting(Character *formatting);

        /** Pre-define a style
            @param suggestedname Suggested name for the style
            @param formatpara Paragraph formatting for the style
            @param formatchar Character formatting for the style
            @return A pointer to the predefined style. This pointer will remain
                    valid until the SiteWriter is destroyed */
        virtual int32_t PredefineStyle(std::string const &suggestedname, Paragraph const &formatpara, Character const &formatchar);

        /** Create an anchor */
        virtual void SetAnchor(std::string const &anchor);

        /** Start a list (preeedes a StartParagraph, but no end tag exists)
            @param predefstyle Predefined style settings to try to use
            @param format_para Paragraph formatting
            @param format_char Character formatting for the bullet
            @param listtype List type
            @param anchor Anchor for the paragraph, NULL if no anchor is necessary */
        virtual void StartParagraph(int32_t predefstyle,
                                             Paragraph const &format_para,
                                             ObjectType listtype);

        /** Start a paragraph */
        virtual void EnterParaText();

        /** End the last started paragraph */
        virtual void EndParagraph();

        /** Start a hyperlink. Hyperlinks may not be nested */
        virtual void StartHyperlink(Hyperlink const &hyperlink);

        /** End a hyperlink */
        virtual void EndHyperlink();

        /** Change the character formatting
            @param new_format New character formatting  */
        virtual void ChangeFormatting(Character const &new_format);

        /** Write a whole lot of characters */
        virtual void WriteString (unsigned numchars, char const *firstchar);

        /** Write a single character */
        void WriteChar (char ch)
        {
                WriteString(1,&ch);
        }

        /** Define a table
            @param anchor Anchor for the table, NULL if no anchor is necessary */
        virtual void StartTable(Table const &tableformat);

        /** Finish a table */
        virtual void EndTable();

        /** Goto the next cell in a table */
        virtual void NextCell();

        /** Insert an image at the present location
            @param docobjectid ID of the image to insert */
        virtual void InsertImage(ImageInfo const &img);

        /** Flush any remaining output (used when finished printing from a PrintDocobject etc call) */
        virtual void FlushOutput();

        protected:
        HSVM *vm;

        void HyperlinkHandler(bool is_open, Parsers::Hyperlink const &hyperlink);

        private:
        int32_t registered_id;
        friend class ForwardingOutput;

        friend int32_t RegisterFormattedOutput(HSVM *vm, FormattedOutputPtr const &myoutput);
        friend void UnregisterFormattedOutput(HSVM *vm, int32_t id);

//        friend void UpdateId(FormattedOutput*, HSVM *vm, int32_t);
};


///Base class for filters
class BLEXLIB_PUBLIC ForwardingOutput : public FormattedOutput
{
        public:
        ForwardingOutput(FormattedOutputPtr const &dest);
        ~ForwardingOutput();

//        FormattedOutput *GetDestinationOutput();

        unsigned GetMaximumImageWidth();
        bool AreImagesAccepted();
        bool AreHyperlinksAccepted();
        DrawLib::Pixel32 GetBackgroundColor();
        void GetBaseFormatting(Character *formatting);
        int32_t PredefineStyle(std::string const &suggestedname, Paragraph const &formatpara, Character const &formatchar);
        void SetAnchor(std::string const &anchor);
        void StartParagraph(int32_t predefstyle,Paragraph const &format_para,ObjectType listtype);
        void EnterParaText();
        void EndParagraph();
        void StartHyperlink(Hyperlink const &hyperlink);
        void EndHyperlink();
        void ChangeFormatting(Character const &new_format);
        void WriteString (unsigned numchars, char const *firstchar);
        void StartTable(Table const &tableformat);
        void EndTable();
        void NextCell();
        void InsertImage(ImageInfo const &img);
        void FlushOutput();

        protected:
        FormattedOutputPtr dest;

        private:
        void NoDestination();
        inline void VerifyDestination()
        {
                if(!dest.get())
                    NoDestination();
        }
};

/** A formatted output filter which just extracts raw text, up to a given limit */
class BLEXLIB_PUBLIC RawTextFilter : public Parsers::FormattedOutput
{
        public:
        /** RawText constructor
            @param _maxlen Maximum number of bytes to read. 0 = no limit */
        RawTextFilter(unsigned _maxlen, bool _skip_bulnum);

        ~RawTextFilter();

        std::string const &GetText() { return rawtext; }

        bool AreImagesAccepted();
        bool AreHyperlinksAccepted();
        void WriteString(unsigned numchars, char const *firstchar);
        void StartParagraph(int32_t predefstyle, Paragraph const &format_para, ObjectType listtype);
        void EnterParaText();
        void NextCell();

        private:
        const unsigned maxlen;
        const bool skip_bulnum;
        std::string rawtext;
        bool now_skipping_bulnum;
};

/** Base interface for document objects. */
class BLEXLIB_PUBLIC OutputObjectInterface
{
        public:
        OutputObjectInterface();

        ///Document object destructor
        virtual ~OutputObjectInterface();

        /** Format and send this object
            @param siteoutput Page to send the object to
            @param override_filter_id If != 0, the id of the filter that must be choosen for the publication */
        virtual void Send(FormattedOutputPtr const &siteoutput) const=0;

        /** Ask this object whether it has an anchor */
        virtual std::string GetAnchor() const;

        /** The 'true' output object id of this object. Elimination (eg emptydocobjects) can require this */\
        virtual int32_t GetFinalOutputObjectId() const;

        /** Our assigned output object id. Set after registering */
        int32_t outputobjectid;
};

BLEXLIB_PUBLIC std::string EncodeXML(std::string const &in);
BLEXLIB_PUBLIC std::string EncodeColor(DrawLib::Pixel32 color);
std::ostream& operator << (std::ostream &str, ObjectType data);
BLEXLIB_PUBLIC std::ostream& operator << (std::ostream &str, Distance const &data);
std::ostream& operator << (std::ostream &str, Paragraph const &data);
std::ostream& operator << (std::ostream &str, Character const &data);
std::ostream& operator << (std::ostream &str, Table const &data);
BLEXLIB_PUBLIC std::ostream& operator << (std::ostream &str, Hyperlink const &data);
std::ostream& operator << (std::ostream &str, ImageInfo const &data);

BLEXLIB_PUBLIC void ApplyWordLinkHack(Parsers::Hyperlink *link);

} //end namespace Parsers
#endif
