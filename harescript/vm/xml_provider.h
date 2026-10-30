#ifndef harescript_modules_xml_xml_provider
#define harescript_modules_xml_xml_provider

#include <blex/context.h>
#include <blex/path.h>
#include <blex/xml.h>
#include <harescript/vm/hsvm_dllinterface.h>
#include <libxml/parser.h>
#include <libxml/parserInternals.h>
#include <libxml/HTMLparser.h>
#include <libxml/xmlschemas.h>
#include <libxml/xpath.h>
#include <libxml/xpathInternals.h>
#include <unordered_set>

/**
 * XML_XMLNS_NAMESPACE:
 *
 * This is the namespace for the special xmlns: prefix predefined in the
 * XML Namespace specification. XML_XML_NAMESPACE is defined in <libxml/tree.h>.
 */
#define XML_XMLNS_NAMESPACE "http://www.w3.org/2000/xmlns/"

namespace HareScript
{
namespace Xml
{


enum ObjectType
{
        // Numbered DOM node types
        ElementObject = 1,

        TextObject = 3,
        CDATASectionObject = 4,
        EntityReferenceObject = 5,
        EntityObject = 6,
        ProcessingInstructionObject = 7,
        CommentObject = 8,
        DocumentObject = 9,
        DocumentTypeObject = 10,
        DocumentFragmentObject = 11,
        NotationObject = 12,
        HTMLDocumentNodeObject = 13,
        DTDNodeObject = 14,
        ElementDeclObject = 15,
        AttributeDeclObject = 16,
        EntityDeclObject = 17,
        NamespaceDeclObject = 18,
        XIncludeStartObject = 19,
        XIncludeEndObject = 20,
        // Other object types (node types 1-200 are reserved and not returned as node type)
        DOMExceptionObject = 201,
        NodeObject,
        CharacterDataObject,
        XMLSchemaObject
};


typedef std::map<std::string,std::string> XpathNamespaces;

const unsigned XMLNodeContextId = 28601;
const unsigned XMLDOMImplementationContextId = 28602;

const unsigned XMLSchemaContextId = 28607;
const unsigned XMLXPathQueryContextId = 28608;
const unsigned XMLNodeCreateContextId = 28609;

xmlCharEncoding GetEncoding(std::string encoding);
std::string GetNodeName(xmlNodePtr node);
std::string GetNodeContent(xmlNodePtr node);

struct XMLBlobData
{
        XMLBlobData(HSVM *_hsvm, int _blobid)
        : hsvm(_hsvm)
        , blobid(_blobid)
        {}

        HSVM *hsvm;
        int blobid;
};

/** Shared reference to an XML document. The xml document is deleted when
    the last reference has been deleted

    The shared data is kept in the Data structure. The Data structure
    has a 'secure' section in which the refcount is kept, and optionally
    the parsed schema (for readonly documents only!)
*/
class XMLDocRef
{
    public:
        class Data
        {
            public:
                Data(xmlDocPtr _doc, bool _readonly);
                ~Data();

                class SecureData
                {
                    public:
                        inline SecureData() : refcount(1), schema(0) {}
                        ~SecureData();

                        unsigned refcount;
                        xmlSchemaPtr schema;
                };

                typedef Blex::InterlockedData< SecureData, Blex::Mutex > LockedSecureData;
                LockedSecureData sdata;

                bool readonly;
                xmlDocPtr doc;

                std::unordered_set< xmlNodePtr > unlinkedheads;
        };

    private:
        Data *data;

    public:
        XMLDocRef() : data(0) {}
        explicit XMLDocRef(xmlDocPtr _doc, bool _readonly);
        explicit XMLDocRef(XMLDocRef const &rhs);
        ~XMLDocRef();
        XMLDocRef & operator =(XMLDocRef const &rhs) { XMLDocRef(rhs).swap(*this); return *this; }
        void swap(XMLDocRef &rhs) { std::swap(data, rhs.data); }
        void reset(xmlDocPtr doc, bool readonly) { XMLDocRef(doc, readonly).swap(*this); }
        void reset() { XMLDocRef().swap(*this); }

        Data * get() { return data; }
};

struct XMLContextReadData
{
        XMLContextReadData();
        ~XMLContextReadData();

        bool ParseXMLBlob(HSVM *hsvm, HSVM_VariableId blob, HSVM_VariableId encoding, bool readonly);
        bool ParseHTMLBlob(HSVM *hsvm, HSVM_VariableId blob, HSVM_VariableId encoding, bool readonly, bool noimplied);
        xmlSchemaPtr ParseAsValidator(HSVM *vm, HSVM_VariableId domimpl);

        void GetExternalSchema(
                HSVM *hsvm,
                HSVM_VariableId domimpl,
                const char *URL,
                const char *ID,
                Blex::XML::EntityLoader *loader);

        inline xmlDocPtr GetDocPtr() { return doc.get() ? doc.get()->doc : 0; }
        xmlSchemaPtr GetSchemaPtr();
        inline bool IsReadonly() { return doc.get() && doc.get()->readonly; }
        void SetIsUnlinkedHead(xmlNodePtr node, bool unlinked);

        XMLDocRef doc;

        bool from_html;
        XpathNamespaces xpath_namespaces;
        Blex::XML::ErrorCatcher errorcatcher;
};
typedef std::shared_ptr<XMLContextReadData> XMLContextReadDataPtr;

///Holds a reference to a node or namespace definitions
struct XMLNodeOrNs
{
        XMLNodeOrNs()
        {
                node=NULL;
                nsdef=NULL;
        }
        ///The node selected, or the parent node for the namespace definition
        xmlNodePtr node;
        ///The selected namespace definition. If NULL, node is the selected namespace. If not NULL, node is our parent node
        xmlNs *nsdef;

        int GetType() const
        {
                if(!node)
                        return 0;
                if(node->type==13)
                        return 9; //Document node
                if(node->type==14)
                        return 10; //DocumentType node
                return node->type;
        }
        void Unlink(XMLContextReadData *realdoc);
};

struct XMLNode : public XMLNodeOrNs
{
        XMLContextReadDataPtr realdoc;
};

struct XMLNodeCreate
{
        XMLNodeCreate()
        {
                fptr_elementobject = 0;

                fptr_textobject = 0;
                fptr_cdatasectionobject = 0;
                fptr_entityreferenceobject = 0;
                fptr_processinginstructionobject = 0;
                fptr_commentobject = 0;
                fptr_documentobject = 0;
                fptr_documentfragmentobject = 0;
                fptr_dtdnodeobject = 0;
                fptr_elementdeclobject = 0;
                fptr_attributedeclobject = 0;
                fptr_entitydeclobject = 0;
                fptr_namespacedeclobject = 0;
                fptr_nodeobject = 0;
                fptr_characterdataobject = 0;
                fptr_xmlschemaobject = 0;
                fptr_htmldocumentobject = 0;
        }

        HSVM_VariableId fptr_elementobject;
        HSVM_VariableId fptr_textobject;
        HSVM_VariableId fptr_cdatasectionobject;
        HSVM_VariableId fptr_entityreferenceobject;
        HSVM_VariableId fptr_processinginstructionobject;
        HSVM_VariableId fptr_commentobject;
        HSVM_VariableId fptr_documentobject;
        HSVM_VariableId fptr_documentfragmentobject;
        HSVM_VariableId fptr_dtdnodeobject;
        HSVM_VariableId fptr_elementdeclobject;
        HSVM_VariableId fptr_attributedeclobject;
        HSVM_VariableId fptr_entitydeclobject;
        HSVM_VariableId fptr_namespacedeclobject;
        HSVM_VariableId fptr_nodeobject;
        HSVM_VariableId fptr_characterdataobject;
        HSVM_VariableId fptr_xmlschemaobject;
        HSVM_VariableId fptr_htmldocumentobject;
};


extern "C"
{
        void HandleXMLError(void * user_data, xmlErrorPtr error);
}

} // End of namespace Xml
} // End of namespace HareScript

#endif
