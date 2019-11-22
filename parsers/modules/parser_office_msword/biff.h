#ifndef blex_parsers_office_msword_biff
#define blex_parsers_office_msword_biff

#include "word_base.h"

namespace Parsers {
namespace Office {
namespace Word {

class CharacterProcessor;
class BiffDoc;


/** Description of a paragraph exception run (PAPX)*/
class BiffParagraph : public DocPart
{
        public:
        BiffParagraph(DocPart *parent, BiffDoc &doc, Cp startcp, Cp limitcp, ComplexRecord const *endpiece, ParaCharStyle const* style);

        void ExtendParagraph(Cp limitcp, ComplexRecord const *endpiece);

        inline BiffParagraph const *GetNext() const
        {
                return static_cast<BiffParagraph const*>(this->next);
        }

        std::pair<bool, unsigned> GetParagraphCollapseInfo() const;
        void Send(Parsers::FormattedOutputPtr const &siteoutput) const;
        void SendCurrentParagraph(CharacterProcessor &charproc, Parsers::FormattedOutputPtr const &output) const;
        void SendTable(CharacterProcessor &charproc, Parsers::FormattedOutputPtr const &siteoutput) const;
        void SendParagraphData(CharacterProcessor &charproc,Parsers::FormattedOutput &output) const;

        inline BiffDoc const & GetBiffDoc() const;

        ///CP at which this run starts
        Cp startcp;
        ///Cp at which the next run will start
        Cp limitcp;
        ///Pointer to the complex piece that contains this paragraph's end (the CR byte)
        ComplexRecord const *endpiece;
        ///Deal with unpredictable GetPara calls :-( (FIXME) - avoid doubleinit of a ParaData
        bool configured;

        GrpprlPointer grpprlptr;
};

struct PieceTable
{
        public:
        /** Find the piece describing the specified CP
            @return The piece containg cp, or NULL if the piece could not be found */
        const ComplexRecord* FindPiece(Cp cp) const;
        GrpprlPointer GetSprmGrpprl(uint16_t sprm) const;

        /** Parse the piece table
            @param starttable Start FC of the piece table
            @param limittable Limit FC of the piece table
            @param infile File to read the pieces from
            @param worddoc Word document to store the GRPRPLS in */
        void Parse(Fc starttable, Fc limittable, Blex::RandomStream &infile, BiffDoc &worddoc);

        friend class BiffDoc;
        friend class BiffParaAnalyzer;

        private:
        std::vector<ComplexRecord> piecetable;
        std::vector<GrpprlPointer> complexgrpprl;
};


struct BiffParaCharStyle : public ParaCharStyle
{
        BiffParaCharStyle(BiffDoc &parent, unsigned styleid);

        BiffDoc &doc;

        void ApplyStyle(Pap *pap, Chp * chp) const;

        /** Grpprls for this style.
            For paragraph styles: grpprls[0] = PAP grpprl, grpprls[1] = CHP grpprl
            For character styles: grpprls[0] = CHP grpprl (and also apply those from 'base_style') */
        GrpprlPointer grpprls[2];
};

/** The worddocument holds *ALL* data and defines *ALL* structures associated to
    the formatting and contents of a BiffDoc. */
class BLEXLIB_PUBLIC BiffDoc : public DocBase
{
public: //Structures
        typedef std::multimap<uint32_t, std::string> BookmarkMap;

        typedef std::map<uint32_t,GrpprlPointer> HugePapx;

private: //Private data
        std::shared_ptr<Blex::Docfile> docfile;
        Blex::Docfile::Directory const *docfileroot;
        /** The Wordfile inside the OLE file. This object contains the Wordfile
            header, and the document text */
        std::shared_ptr<Blex::RandomStream> wordfile;
        /** The Tablefile inside the OLE file. This object contains mostly
            formatting and other metadata about the 'wordfile'*/
        std::shared_ptr<Blex::RandomStream> tablefile;
        /** The datafile inside the OLE file. This file is not always present,
            but may contain 'big' data - it is probably used to escape the 32MB
            limit on other OLE files? */
        std::shared_ptr<Blex::RandomStream> datafile;
        ///Associated Escher data
        EscherDataStorePtr escherdatastore;

        ///Current wrod version
        WordVersions version;
        /// Text box information
        std::vector<TextBoxInfo> textboxes;
        Header header;

        std::vector<FileShape> fileshapes;
        //std::vector<ListData> lists;

        //Huge PAPX support

        ///The huge papx cache. Mutable because filling the cache does not 'visible' change the document
        mutable HugePapx hugepapx;

        ///All character data structures
        std::vector<CharData> chars;

        BiffParaCharStyle mynullstyle;

#ifdef DEBUG
        mutable int sprms_total;
        mutable int sprms_errors;
        mutable int sprms_unknown;
        mutable uint16_t sprm_problems[512][8];
#endif

public: //Public DATA (ADDME: Start making stuff private)

        /** A big buffer to store grpprls we would be keeping in memory permanently anyway */
        mutable GrpprlCache grpprlcache;

        /** The fields manager */
        FieldsManager fieldsmgr;

        /** Cache for paragraph walker */
        mutable ParagraphWalkerCache paragraphwalkercache;

        Sections sections;

        BookmarkMap suggested_bookmarks;

        ///Events contained inside this paragraph
        ParaEvents paraevents;

        PieceTable piecetable;

public: //Public functions

        /** Word Document constructor
            @param unique_id HareScript VM-specific unique Word doc ID - used to generate unique image ids
            @param docfile docfile containing Worddoc
            @param docfileroot Root directory of this word document inside the docfile
            @param callbacks Callback object for conversion events */
        BiffDoc(int32_t unique_id,
                     std::shared_ptr<Blex::Docfile> const &docfile,
                     Blex::Docfile::Directory const *docfileroot,
                     Callbacks &callbacks);

        ~BiffDoc();

        /** Get Word document header */
        inline const Header& GetHeader() const { return header; }

        /** Get escher data */
        EscherDataStorePtr GetEscherData() const { return escherdatastore; }

        /** Get word file */
        Blex::RandomStream* GetWordFileStream() const { return wordfile.get(); }

        WordVersions WordVersion() const { return version; }

        void RenderTextboxText(int32_t shapeid, Escher::Interface const *iface, DrawLib::TextFormatter *textformatter) const;

        /** Process an embedded OLE object. */
        void Pic_OLE2(uint32_t objtag, Parsers::FormattedOutput &output) const;

        /** Process an Escher object reference. */
        void Pic_Escher(FileShape const &fs, Parsers::FormattedOutput &output, bool ignore_float) const;

        /** Process an Word PIC object. */
        void Pic_Pic(uint32_t objtag, Parsers::FormattedOutput &output) const;

        /** Search for a fileshape by its id
            @param cp CP of the shape we're looking for
            @return The requested shape, or NULL if no shape with the specified CP was found */
        FileShape const * GetShapeCp(Cp cp) const;

        //properties.cpp
        void ApplySprms(SprmIterator *sprms, Pap *pap, Sep *sep, Tap *tap) const;

        void ApplyChpSprms(SprmIterator *sprms, Chp const &style_base, Chp *cur_style_chp, Chp *to_update_chp) const;

        void ComplexSprm97(const uint16_t complexsprm, Pap *pap, Tap *tap) const;

        typedef std::map<Cp, BiffParagraph*> ParaMap;
        ParaMap paramap;

        Sections::iterator FindSection(Cp cp);
        Sections::const_iterator FindSection(Cp cp) const
        { return const_cast<BiffDoc&>(*this).FindSection(cp); }
        BiffParagraph * FindParagraph(Cp cp);
        BiffParagraph const* FindParagraph(Cp cp) const
        { return const_cast<BiffDoc&>(*this).FindParagraph(cp); }

        /** Find character data. Throws a PublicationInternalException if
            no data can be found
            @param fc FC for which character data must be found
            @return The CharData structure describing fc */
        CharData const &GetCharData(Fc fc) const;

        /** Get the text from a worddocument's Wordfile stream
            @param start_cp CP of first character to get
            @param limit_cp CP after last character to get
            @param formatted True to return a formatted string (see Escher dox), false for plain raw text*/
        void RenderText(Cp start_cp, Cp limit_cp, DrawLib::TextFormatter *textformatter) const;

        /** Get the text bytes from a worddocument's Wordfile stream. Does not
            interpret field codes or markup
            @param start_cp CP of first character to get
            @param limit_cp CP after last character to get */
        std::string GetText(Cp start_cp, Cp limit_cp) const;

        /** Get the raw text bytes from a worddocument's Wordfile stream. Does not
            interpret field codes or markup. Does strip bullets and numbernig
            @param start_cp CP of first character to get
            @param limit_cp CP after last character to get */
        std::string GetRawText(Cp cp, Cp limit_cp) const;

        /// Load PAP properties for a given paragraph
        void LoadParagraphProperties(BiffParagraph const* newpara, Pap *pap, Tap *tap) const;

        void LoadParagraphMarkProperties(BiffParagraph const* para, Pap const &para_pap, Chp *chp) const;

private: //Private functions

        std::pair<unsigned, std::string> ScanMetadata();
        std::pair<unsigned, std::string> ScanStructure();

        /// parse propery sets for interesting data
        void ParsePropertySets();

        void ReadBiffLists();

        //tablestr.cpp
        void ReadTableStream();
        void ReadLists();
        void ReadFonts();
        void ReadStyles ();
        void ReadStyleSheet();
        void DumpTableStream();

        void CharactersRead();
        void SectionsRead();
        void ReadTextBoxes();
        void ReadFootEndNotes(bool emptydocobjects, Parsers::PublicationProfile const &pubprof);
        void ReadNoteSet(bool emptydocobjects, Parsers::PublicationProfile const &pubprof, Cp startoffset, bool is_footnote, Plcf const &frd, Plcf const &text);

        GrpprlPointer GetHugePapx(uint32_t offset) const;

        //word_properties.cpp
        void ApplySprm(SprmData const &sprmdata, Pap *pap, Sep *sep, Tap *tap) const;
        void ApplyChpSprm(SprmData const &sprmdata, Chp const &style_base, Chp *cur_style_chp, Chp *to_update_chp) const;

        //worddocument.cpp
        void ReadHeader();
        void DumpHeader() const;

        friend struct Task;
        friend struct Pap;
        friend struct Chp;
        friend struct Sep;
        friend struct Tap;
        friend class OutputObject; //wants access to our header
        friend class FootEndNoteEvent;
        friend class FieldsManager;
        friend class BiffParaAnalyzer;
};

inline BiffParaCharStyle::BiffParaCharStyle(BiffDoc &parent, unsigned styleid)
: ParaCharStyle(parent)
, doc(parent)
{
        mswordid = styleid;
}
inline BiffDoc const & BiffParagraph::GetBiffDoc() const
{
        return static_cast<const BiffDoc&>(doc);
}

} // End of namespace Word
} // End of namespace Office
} // End of namespace Parsers


#endif
