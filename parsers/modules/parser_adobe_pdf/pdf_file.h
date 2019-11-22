#ifndef blex_harescript_modules_pdf_file
#define blex_harescript_modules_pdf_file

#include "pdf_lexer.h"
#include "pdf_contents.h"
#include "pdf_font.h"


namespace Parsers
{

namespace Adobe
{

namespace PDF
{

class Page
{
        PDFfile *file;

        DictObject dict;
        size_t pagenr;
        FontRefs fontrefs;

public:
        Page(PDFfile *file, Object const &object, size_t pagenr);

        PDFfile const &GetFile() const { return *file; }
        FontPtr GetFont(std::string const &name) const;

        // Render this page to the output renderer
        void Render(Renderer *render) const;

        size_t GetPageNr() const { return pagenr; }
};
typedef std::shared_ptr<Page> PagePtr;

class PageTree;
typedef std::shared_ptr<PageTree> PageTreePtr;

class PageTree
{
private:
        size_t first_pagenr;
        size_t last_pagenr;

        std::vector<PageTreePtr> subtrees;
        std::vector<PagePtr> pages;

public:
        PageTree(PDFfile *file, Object const &object, size_t first_pagenr);

        // Get the total number of pages in this and recursive page trees
        size_t GetNumPages() const { return last_pagenr - first_pagenr; }

        // Try the find the page in this or recursive page trees
        bool HasPage(size_t find_pagenr) const { return find_pagenr >= first_pagenr && find_pagenr < last_pagenr; }
        Page const &FindPage(size_t pagenr) const;
};

class Destinations
{
private:
        std::vector<std::string> dests;

public:
        Destinations(Object const &object);
        void ReadDestinations(Object const &nametree);
};

class OutlineItem;
typedef std::shared_ptr<OutlineItem> OutlineItemPtr;

class OutlineItem
{
        std::string title;
        std::string dest;
        std::vector<OutlineItemPtr> outline_items;

public:
        OutlineItem(Object const &object);
        std::string const &GetTitle() const { return title; }
        std::string const &GetDest() const { return dest; }
        std::vector<OutlineItemPtr> const &GetOutlineItems() const { return outline_items; }
};

class Outline
{
        std::vector<OutlineItemPtr> outline_items;
public:
        Outline(Object const &object);
        ~Outline();

        std::vector<OutlineItemPtr> const &GetOutlineItems() const { return outline_items; }
};

typedef std::shared_ptr<XObject> XObjectPtr;

class PDFfile
{
        Version version;

        std::unique_ptr<Lexer> lexer;

        // The root page tree
        std::unique_ptr<PageTree> root_pagetree;

        // Destinations within the document
        std::unique_ptr<Destinations> destinations;

        // The outline of the document
        std::unique_ptr<Outline> outline;

        ///XObjects in this file
        std::map<std::string, XObjectPtr> xobjects;

        ///Font descriptors in this file
        FontDescriptors fontdescriptors;

        ///The documents meta information
        std::map<std::string, std::string> meta_info;

        /// File permissions
        uint32_t permissions;
        /// File encryption key
        std::string file_encryption_key;

        // The file stream
        Blex::RandomStream &stream;

        ObjectPtr trailer;
public:
        PDFfile(Blex::RandomStream &stream);
        ~PDFfile();

        void OpenFile();
        void WriteFile(Blex::Stream &outputstream);

        PageTree const &GetRootPageTree() const
        {
                if(root_pagetree.get() == NULL)
                        throw std::runtime_error("PDF File has not been parsed yet");
                return *root_pagetree;
        }

        Outline const *GetOutline() const { return outline.get(); }

        Version const &GetVersion() const { return version; }

        /** Get meta information about document
            Included are:
            - Title
            - Author
            - Subject
            - Keywords
            - Creator
            - Producer
            - CreationDate
            - ModDate */
        std::map<std::string, std::string> GetMetaInfo();

        void ParseXObjects(Page const &page,Object const &resource_dict);
        void ParseFonts(Object const &resource_dict, FontRefs *refs);

        XObjectPtr FindXObject(std::string const &name)
        {
                std::map<std::string, XObjectPtr>::iterator result = xobjects.find(name);
                if(result == xobjects.end())
                        return XObjectPtr();
                return result->second;
        }

/*        FontPtr FindFont(std::string const &name)
        {
                std::map<std::string, FontPtr>::iterator result = fonts.find(name);
                if(result == fonts.end())
                        return FontPtr();
                return result->second;
        }*/

private:
        // Store parsed information about the document
        std::map<std::string, std::vector<uint16_t> > unicode_encodings;

        void ReadMetaInfo(Object const&info);
        void ParsePageTree(Object const&pages_object);

        bool GenerateFileKey(DictObject const &trailer, unsigned revision, unsigned keylength,
                             std::string const &ownerkey, std::string const &userkey,
                             std::string const &userpassword);

};

} //end namespace PDF
} //end namespace Adobe
} //end namespace Parsers


#endif
