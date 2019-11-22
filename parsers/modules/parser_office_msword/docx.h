#ifndef blex_parsers_office_msword_docx
#define blex_parsers_office_msword_docx

#include <blex/xml.h>
#include "word_base.h"

namespace Parsers {
namespace Office {
namespace OOXML {

extern Blex::XML::Namespace xmlns_package_relationships;
extern Blex::XML::Namespace xmlns_officedoc_relationships;

/** @short
    FIXME: Needs to be optimized, currently just extracts all files
*/
class ZipFile
{
        private:
        ZipFile();

        typedef std::shared_ptr< std::vector<uint8_t> > OOFilePtr;
        typedef std::map<std::string, OOFilePtr> OOFiles;
        OOFiles files;

        public:
        static ZipFile* OpenZipFile(Blex::RandomStream &data);

        Blex::Stream * OpenFile(std::string const &path);

        ~ZipFile();
};

class OOXMLPackage
{
        private:
        OOXMLPackage(std::unique_ptr<ZipFile> &zip);
        std::unique_ptr<ZipFile> zip;

        Blex::XML::Document* GetRelsFor(std::string const &curpath) const;
        mutable std::map<std::string, std::shared_ptr<Blex::XML::Document> > relscache;

        public:
        static OOXMLPackage* Open(Blex::RandomStream &data);
        Blex::Stream* OpenFile(std::string const &path) const ;
        Blex::Stream* OpenRelationship(std::string const &curpath, Blex::XML::Node relationship) const;
        Blex::Stream* OpenFileByRelation(std::string const &curpath, std::string const &id) const;
        Blex::Stream* OpenFileByType(std::string const &curpath, std::string const &type) const;
        Blex::XML::Node GetRelNodeById(std::string const &curpath, std::string const &id) const ;
        Blex::XML::Node GetRelNodeByType(std::string const &curpath, std::string const &type) const ;
        ~OOXMLPackage();
};

class OOXMLPackageRef
{
        public:
        OOXMLPackageRef(OOXMLPackage const &package, std::string const &docpath);

        Blex::XML::Node GetRelNodeById(std::string const &id) const;
        Blex::XML::Node GetRelNodeByType(std::string const &type) const;
        Blex::Stream* OpenFileByRelation(std::string const &id) const;
        Blex::Stream* OpenFileByType(std::string const &type) const;

        private:
        OOXMLPackage  const *package;
        std::string docpath;
};


} //end namespace OOXML
} // End of namespace Office
} // End of namespace Parsers


namespace Parsers {
namespace Office {
namespace Word {

class OutputState;

namespace DocX {

class DocXDoc;
class DocXParagraph;
struct DocXTableStyle;

namespace FieldStates
{
        enum State { Begin, Separate, End, Unknown };
}

typedef std::pair<FieldStates::State, FieldData> FieldInfo;

class DocXParagraphWalker
{
        public:
        /** Construct a DocState object
            @param doc Word Document we will be walking */
        DocXParagraphWalker(DocXDoc const &doc);

        void SetParagraph(DocXParagraph const &docobj);

         /** Obtain the paragraph properties for this entire paragraph */
        Pap const & GetParaPap() const { return para_pap; }

        /** Obtain the character properties for the current character */
        Chp const & GetCurChp() const { return char_chp; }

        Chp GetListBulletChp() const;

        FieldInfo ProcessFieldChar(Blex::XML::Node node);
        void ProcessFieldInstr(Blex::XML::Node node);

        bool eating_pagebreaks;

        ///The current field stack
        std::vector<FieldData> fieldstack;

        private:
        DocXDoc const &doc;
        ///Current paragraph
        DocXParagraph const *curpara;
        ///Current paragraph properties
        Pap para_pap;
        /** Current character properties */
        Chp char_chp;
};

struct DocXTable : public TableDocPart
{
        DocXTable(DocXDoc &doc, Blex::XML::Node tableprops);
        ~DocXTable();

        Blex::XML::Node tabprops;
        DocXDoc &doc;

        void DumpTable();
};

class DocXTableHolder : public DocPart
{
        public:
        DocXTableHolder(DocPart *parent, DocXDoc const &doc, DocXTable *table);
        void Send(Parsers::FormattedOutputPtr const &siteoutput) const;
};

class BLEXLIB_PUBLIC DocXParagraph : public DocPart
{
        public:
        DocXParagraph(DocPart *parent, DocXDoc const &doc, Blex::XML::Node paranode);

        ///Used by scanner
        void AddPpr(Blex::XML::Node ppr);
        ///Extend a pagraph
        void ExtendParagraph(Blex::XML::Node nextparanode);

        std::vector<Blex::XML::Node> paranodes;
        ///Paragraph properties
        Blex::XML::Node ppr;
        ///Char properties for the paragraph mark (in BIFF, this applied to lists too. suspecting the same in DocX)
        Blex::XML::Node paragraphmark_rpr;

        void Send(Parsers::FormattedOutputPtr const &siteoutput) const;

        void ProcessField(FieldData const &fld, OutputState &os, bool isstart) const;

        ///The initial field state (used to maintain 'open' links caused by fields between paragraphs) - this is the equivalent of Biff ParaEvents
        std::vector<FieldData> initialfieldstack;

//        int32_t outputobjectid;

        private:
        std::pair<bool, unsigned> GetParagraphCollapseInfo() const;
        void SendRuns(DocXParagraphWalker &walker, OutputState &os, Blex::XML::Node para) const;
        void SendRun(DocXParagraphWalker &walker, OutputState &os, Blex::XML::Node run) const;
        void SendPict(DocXParagraphWalker &walker, OutputState &os, Blex::XML::Node para) const;
        void SendDrawing(DocXParagraphWalker &walker, OutputState &os, Blex::XML::Node para) const;

        inline DocXDoc const & GetDocXDoc() const;
};

struct DocXParaCharStyle : public ParaCharStyle
{
        DocXParaCharStyle(DocXDoc &parent);
        void ApplyStyle(Pap *pap, Chp * chp) const;

        DocXDoc &docx;

        ///DocX paragraph props
        Blex::XML::Node docx_ppr;
        ///DocX char props
        Blex::XML::Node docx_rpr;
};

class DocXDoc : public DocBase
{
        public:
        DocXDoc(int32_t unique_id,
                std::shared_ptr<Blex::RandomStream> const &docfile,
                Callbacks &callbacks);

        virtual ~DocXDoc();

        std::pair<unsigned, std::string> Scan(bool emptydocobjects, Parsers::PublicationProfile const &pubprof);

        ParaCharStyle const* default_character_style;
        DocXTableStyle const* default_table_style;
        DocXParaCharStyle mynullstyle;

        /** Properties system */
        void ApplyChpProps(Chp *chp, Blex::XML::Node ppr, bool direct) const;
        void ApplySingleChpProp(Chp *chp, Blex::XML::Node newnode, bool direct) const;

        Parsers::Office::OOXML::OOXMLPackageRef GetPackageRef() const;
        Blex::XML::Document const& GetMainDoc() const { return maindoc; }
        std::string const& GetDefaultAnchorTarget() const { return defaultanchortarget; }

        private:
        struct ChpParserTable
        {
                const char *entry;
                void (DocXDoc::*parser)(Chp *chp, Blex::XML::Node newnode, bool direct) const;
        };
        static const ChpParserTable chpparsertable[];

        DocPart* ScanParagraph(DocXParagraphWalker &walker, DocPart *parent, Blex::XML::Node paranode);
        DocPart* ScanTable(DocXParagraphWalker &walker, DocPart *parent, Blex::XML::Node tablenode);
        DocPart* ScanParts(DocXParagraphWalker &walker, DocPart *parent, Blex::XML::Node firstpara);
        DocPart* ScanSDT(DocXParagraphWalker &walker, DocPart *parent, Blex::XML::Node node);
        void ScanRuns(DocXParagraphWalker &walker, Blex::XML::Node paranode, DocXParagraph *part, bool *seencontent);
        void ScanRun(DocXParagraphWalker &walker, Blex::XML::Node runnode, DocXParagraph *part, bool *seencontent);
        unsigned ScanCell(DocXParagraphWalker &walker, DocPart *parent, Blex::XML::Node cell, DocXTable *table, unsigned rownum, unsigned celloffset, Tap const &tap, unsigned gridbefore, unsigned gridafter);
        void ScanRow(DocXParagraphWalker &walker, DocPart *parent, Blex::XML::Node tr, DocXTable *table, unsigned rownum);

        void ApplyFontTheme(Blex::XML::Node schemenode);

        std::pair<unsigned, std::string> ScanMetadata();
        std::pair<unsigned, std::string> ScanStructure();

        std::shared_ptr<Blex::RandomStream> packagestream;
        std::unique_ptr<Parsers::Office::OOXML::OOXMLPackage> package;

        std::string documentpath;
        std::string defaultanchortarget;
        Blex::XML::Document maindoc;
        Blex::XML::Document stylesdoc;
        Blex::XML::Document numberingdoc;

        //--Used for analysis--
        ///Paragraph that wants to be merged into the next paragraph
        DocXParagraph *merge_with_next;

        void ReadFonts();
        void ReadStyles();
        void ReadTheme();
        void ReadLists();
        bool ReadStyle(Blex::XML::Node node);
        void ReadDocDefaults(Blex::XML::Node node);
        ListDataPtr ReadAbstractNumbering(Blex::XML::Node node) const;

        //CHP props
        void ChpBold(Chp *chp, Blex::XML::Node newnode, bool direct) const;
        void ChpItalic(Chp *chp, Blex::XML::Node newnode, bool direct) const;
        void ChpUnderline(Chp *chp, Blex::XML::Node newnode, bool direct) const;
        void ChpShadow(Chp *chp, Blex::XML::Node newnode, bool direct) const;
        void ChpFontSize(Chp *chp, Blex::XML::Node newnode, bool direct) const;
        void ChpColor(Chp *chp, Blex::XML::Node newnode, bool direct) const;
        void ChpShading(Chp *chp, Blex::XML::Node newnode, bool direct) const;
        void ChpEmboss(Chp *chp, Blex::XML::Node newnode, bool direct) const;
        void ChpImprint(Chp *chp, Blex::XML::Node newnode, bool direct) const;
        void ChpOutline(Chp *chp, Blex::XML::Node newnode, bool direct) const;
        void ChpComplexFontSize(Chp *chp, Blex::XML::Node newnode, bool direct) const;
        void ChpLanguage(Chp *chp, Blex::XML::Node newnode, bool direct) const;
        void ChpHighlight(Chp *chp, Blex::XML::Node newnode, bool direct) const;
        void ChpCaps(Chp *chp, Blex::XML::Node newnode, bool direct) const;
        void ChpSmallCaps(Chp *chp, Blex::XML::Node newnode, bool direct) const;
        void ChpStrike(Chp *chp, Blex::XML::Node newnode, bool direct) const;
        void ChpDStrike(Chp *chp, Blex::XML::Node newnode, bool direct) const;
        void ChpVanish(Chp *chp, Blex::XML::Node newnode, bool direct) const;
        void ChpVertAlign(Chp *chp, Blex::XML::Node newnode, bool direct) const;
        void ChpRFonts(Chp *chp, Blex::XML::Node newnode, bool direct) const;
        void ChpRStyle(Chp *chp, Blex::XML::Node newnode, bool direct) const;
};

struct DocXTableStyle : public StyleBase
{
        //Only DOCX seems to actually use table styles, BIFF-based Word supports them but seems to store the properties in TAP exceptions bound to the paragraphs anyway
        void ApplyTableStyle(DocXTable *doctable) const;

        Blex::XML::Node tblpr;
};


inline DocXParaCharStyle::DocXParaCharStyle(DocXDoc &parent)
: ParaCharStyle(parent)
, docx(parent)
{
}

struct DocXListLevel : public Parsers::Office::Word::ListLevel
{
        explicit DocXListLevel(DocXDoc const &parent, unsigned level);

        Blex::XML::Node ppr, rpr;

        /** Apply the settings for this list to the specified paragraph */
        void ApplyPap(Pap *pap) const;
        void ApplyChp(Pap const *pap, Chp *chp) const;

        private:
        DocXDoc const &parent;
};

inline DocXDoc const & DocXParagraph::GetDocXDoc() const
{
        return static_cast<DocXDoc const&>(doc);
}

} // End of namespace DocX
} // End of namespace Word
} // End of namespace Office
} // End of namespace Parsers

#endif
