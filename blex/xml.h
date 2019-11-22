#ifndef blex_xml
#define blex_xml

#ifndef blex_stream
#include "stream.h"
#endif

namespace Blex {
namespace XML {

struct XMLError
{
        int code;
        int line;
        std::string message;
        std::string file;
        std::string node_ns;
        std::string node_localname;
};

class ErrorCatcher
{
        public:
        std::vector<XMLError> errors;
};

class NodeIterator;
class PathExpr;

/** @short Represents an XML namespace */
class BLEXLIB_PUBLIC Namespace
{
public:
        Namespace(std::string const &prefix, std::string const &uri);

        std::string const &GetPrefix() const { return prefix; }
        std::string const &GetURI() const { return uri; }
private:
        std::string prefix;
        std::string uri;
};

/** @short Represents an Node. Does not hold a live reference to it */
class BLEXLIB_PUBLIC Node
{
public:
        Node() { nodeptr = NULL; }

        operator bool() const { return nodeptr != NULL; }

        bool IsElement() const;

        bool LocalNameIs(const char *name) const;
        bool LocalNameIs(std::string const &name) const
        {
                return LocalNameIs(name.c_str());
        }

        std::string GetLocalName() const;
        std::string GetNodeName() const;
        std::string GetAttrNames() const;
        //ADDME: Gedrag GetAttr bij !limit_ns verschilt nu van GetchildNodeIterator!

        /** @short Check for attribute existence
            @param limit_ns Namespace to get attributes from. If NULL, get only unqualified attributes
            @param attrname Attribute name*/
        bool HasAttr(Namespace const *limit_ns, std::string const &attrname) const;
        /** @short Get an attribute
            @param limit_ns Namespace to get attributes from. If NULL, get only unqualified attributes
            @param attrname Attribute name*/
        std::string GetAttr(Namespace const *limit_ns, std::string const &attrname) const;
        ///Get text content from this node (content nodes only)
        std::string GetContent() const;
        ///Get content from all child nodes
        std::string GetAllChildrenContent() const;
        ////Replace all nodes with a single child content node, with specified data
        void ReplaceWithContent(std::string const &newcontent);

        /** Iterate child nodes inside this code
            @param limit_ns If not NULL, find only nodes in this namespace */
        NodeIterator GetChildNodeIterator(Namespace const *limit_ns) const;

        std::vector<Blex::XML::Node> GetElementsByTagNameNS(Blex::XML::Namespace const *xml_ns, std::string const &localname) const;

        bool IsInNamespace(Namespace const &ns) const;

        Node GetFirstChild() const;
        Node GetNextSibling() const;
        Node GetParentNode() const;

        class Detail;

private:
        void GetElementsByTagNameNS_(Namespace const *xml_ns, std::string const &localname, std::vector<Blex::XML::Node> *out) const;

        void *nodeptr;
        friend class NodeIterator;
        friend class Detail;
        friend class PathExpr;
};

//ADDE: Support other iterators than forward child walking
class BLEXLIB_PUBLIC NodeIterator
{
public:
        Node * operator->() { return &cur; }
        Node & operator*() { return cur; }
        Node const * operator->() const { return &cur; }
        Node const & operator*() const { return cur; }

        operator bool () { return cur.nodeptr!=NULL; }
        inline NodeIterator& operator ++();
        inline NodeIterator operator ++(int);
private:
        inline NodeIterator(Namespace const *limit_ns, Node start);
        ///Go to the next element
        void Next();
        ///If the current element is a mismatch, loop to the next matching element
        void UntilMatch();
        ///Limit to this namespace
        Namespace const *limit_ns;
        Node cur;

        friend class Node;
};

class BLEXLIB_PUBLIC PathResult
{
public:
        ~PathResult();

        unsigned Size() const;
        Node operator [](unsigned) const;
        Node Item(unsigned) const;

private:
        PathResult();
        void *xpath_object_ptr; //xmlXPathObjectPtr obj;
        friend class PathExpr;
};

class BLEXLIB_PUBLIC Document
{
public:
        Document();
        ~Document();

        bool ReadFromStream(Blex::Stream &instream);
        bool ReadHTMLFromStream(Blex::Stream &instream);

        bool ReadFromFile(std::string const &path);
        bool WriteToFile(std::string const &path);
        Node GetRoot();
        void CreateEmptyDocument();

        void *SneakyGetDocPtr() const { return docptr; }

private:
        //no copying allowed
        Document(Document const &);
        Document& operator=(Document const &);

        void Reset();
        void *docptr; //xmlDocPtr
        friend class PathExpr;

};
class BLEXLIB_PUBLIC PathExpr
{
public:
        PathExpr(Document const &doc);
        ~PathExpr();
        void RegisterNamespace(Namespace const &ns);
        /** @short Evaluate a XML path expression
            @return A path result (caller should deallocate) or NULL if no matches */
        PathResult *Evaluate(std::string const &xpath);

        Node context;
private:
        void *docptr; //xmlDocPtr doc;
        void *xpathptr; //xmlXPathContextPtr xpath;
};

inline NodeIterator::NodeIterator(Namespace const *_limit_ns, Node start)
: limit_ns(_limit_ns)
, cur(start)
{
        UntilMatch();
}
inline NodeIterator& NodeIterator::operator ++()
{
        Next();
        UntilMatch();
        return *this;
}
inline NodeIterator NodeIterator::operator ++(int)
{
        NodeIterator saved(*this);
        Next();
        UntilMatch();
        return saved;
}
void BLEXLIB_PUBLIC SetCatalogBase(std::string const &path);


/** Entity loader object
*/
class BLEXLIB_PUBLIC EntityLoader
{
    private:
        /// XML Parser context
        void *ctxt;
        std::unique_ptr< Stream > stream;
        std::string path;
        std::string publicfilename;
        bool fatal_error;

        int GetData(char *buffer, int len);

        static int GetDataExt(void *ptr, char *buffer, int len);
        static int Destroy(void *ptr);

    public:
        EntityLoader(void *_context) : ctxt(_context), fatal_error(false) { }

        /// Sets a file as source for this entity
        void SetFile(std::string const &path);

        /// Set the public filename for error reporting
        void SetPublicFilename(std::string const &name);

        /// Sets a stream as source for this entity
        void SetStream(std::unique_ptr< Stream > *stream);

        /// Sets the fatal error status for this load
        void SetFatalError() { fatal_error = true; }
        bool GetFatalError() { return fatal_error; }

        bool IsSet() { return stream.get() || !path.empty(); }

        class Detail;
        friend class Detail;
};

typedef std::function< void(const char *, const char *, EntityLoader *) > EntityLoaderCallback;

// FIXME: document
/** @short Push a new entity loader callback
    @long Pushes a new enity loader callback on the loader stack for this thread. When an entity
          request is done other than the standard xml/xml schema documents, this callback is called.
    @param loader Loader callback to call
*/
void BLEXLIB_PUBLIC PushEntityLoader(EntityLoaderCallback const &loader);

/** Pops the entity loader callback on top of the stack for this thread
    @return Returns TRUE when SetFatalError(true) was called on any of the entityloader objects
            passed to the callback funtion.
*/
bool BLEXLIB_PUBLIC PopEntityLoader(); // returns whether not fatal error

/// Set the error catcher to use for the current thread (0 to use none)
void BLEXLIB_PUBLIC SetXMLGenericThreadErrorCatcher(ErrorCatcher *catcher);

} //end namespace XML
} //end namespace Blex

#endif
