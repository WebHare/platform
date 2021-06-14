//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>

//---------------------------------------------------------------------------
#include <harescript/vm/hsvm_dllinterface.h>
#include "xml_provider.h"
#include <stdarg.h>
#include <libxml/catalog.h>
#include <libxml/schemasInternals.h>
#include <libxml/schematron.h>
#include <libxml/c14n.h>

#include <iostream>

//ADDME: Merge our common code with blex/xml (lets webhare lite benefit too) and then we can get rid of this 'comment' below:

namespace HareScript
{
namespace Xml
{

Blex::Mutex validationmutex;

inline xmlChar const * AsXmlChar(std::string const &in)
{
        return reinterpret_cast<xmlChar const *>(in.c_str());
}
inline xmlChar const * AsXmlCharOrNull(std::string const &in)
{
        return in.empty() ? NULL : reinterpret_cast<xmlChar const *>(in.c_str());
}
inline xmlChar const * AsXmlChar(char const *in)
{
        return reinterpret_cast<xmlChar const *>(in);
}
inline std::string AsSTDstring(xmlChar const *in)
{
        return in ? std::string(reinterpret_cast<char const*>(in)) : std::string();
}


enum ExecptionCode
{
        IndexSizeErr = 1,
        DomstringSizeErr = 2,
        HierarchyRequestErr = 3,
        WrongDocumentErr = 4,
        InvalidCharacterErr = 5,
        NoDataAllowedErr = 6,
        NoModificationAllowedErr = 7,
        NotFoundErr = 8,
        NotSupportedErr = 9,
        InuseAttributeErr = 10,
        InvalidStateErr = 11,
        SyntaxErr = 12,
        InvalidModificationErr = 13,
        NamespaceErr = 14,
        InvalidAccessErr = 15
};


typedef std::pair<std::string, std::string> QualifiedNamePair;

typedef HSVM_RegisteredContext< XMLNode, XMLNodeContextId > XMLNodeContext;

//---------------------------------------------------------------------------
// RAII ptr keeper for safety

template< class Class >
 class OwnedPtr
{
    private:
        Class *ptr;
        void destroy();

    public:
        typedef Class value_type;
        typedef Class * pointer;
        typedef Class const * const_pointer;
        typedef Class & reference;
        typedef Class const & const_reference;

        explicit OwnedPtr(Class *newptr) : ptr(newptr) { }
        OwnedPtr(OwnedPtr const &) = delete;

        OwnedPtr(OwnedPtr &&rhs)
        {
                ptr = rhs.ptr;
                rhs.ptr = 0;
        }

        ~OwnedPtr()
        {
                if (ptr)
                    destroy();
        }

        OwnedPtr &operator =(OwnedPtr const &) = delete;

        pointer operator->() { return ptr;}
        const_pointer operator->() const { return ptr;}
        reference operator*()  { return *ptr; }
        const_reference operator*() const { return *ptr; }

        operator pointer() { return ptr;}
        operator const_pointer() const { return ptr;}
};

template <> void OwnedPtr< xmlXPathContext >::destroy()
{
        xmlXPathFreeContext(ptr);
}

template <> void OwnedPtr< xmlXPathObject >::destroy()
{
        xmlXPathFreeObject(ptr);
}
template <> void OwnedPtr< xmlNodeSet >::destroy()
{
        xmlXPathFreeNodeSet(ptr);
}

template < class Class >
 OwnedPtr< Class > MakeOwnedPtr(Class *ptr)
{
        return OwnedPtr< Class >(ptr);
}

namespace
{

// works for elements/text nodes like xmlAddNextSibling, but no merging/freeing of nodes
xmlNodePtr addNextSibling(xmlNodePtr cur, xmlNodePtr elem)
{
        if (elem->parent)
            xmlUnlinkNode(elem);
        elem->parent = cur->parent;
        elem->prev = cur;
        elem->next = cur->next;
        cur->next = elem;
        if (elem->next)
            elem->next->prev = elem;
        if (elem->parent && (elem->parent->last == cur))
            elem->parent->last = elem;
        return elem;
}

// works for elements/text nodes like xmlAddPrevSibling, but no merging/freeing of nodes
xmlNodePtr addPrevSibling(xmlNodePtr cur, xmlNodePtr elem)
{
        if (elem->parent)
            xmlUnlinkNode(elem);
        elem->parent = cur->parent;
        elem->next = cur;
        elem->prev = cur->prev;
        cur->prev = elem;
        if (elem->prev)
            elem->prev->next = elem;
        if (elem->parent && (elem->parent->children == cur))
            elem->parent->children = elem;
        return elem;
}


// works for elements/text nodes like xmlAddChild, but no merging/freeing of nodes
xmlNodePtr appendChild(xmlNodePtr parent, xmlNodePtr elem)
{
        // remove the child before determinging whether the parent is empty,
        // it might be the parent's only child that is being appended.
        if (elem->parent)
            xmlUnlinkNode(elem);

        if (parent->last)
            return addNextSibling(parent->last, elem);

        // Add the first child
        elem->parent = parent;
        elem->next = nullptr;
        elem->prev = nullptr;
        parent->children = elem;
        parent->last = elem;
        return elem;
}


} // end of anonymous namespace

//---------------------------------------------------------------------------
// Marshaller

bool XML_CreateObject(HSVM *hsvm, ObjectType type, HSVM_VariableId var, XMLContextReadDataPtr doc);

class DocumentObjectMarshalData
{
    public:
        DocumentObjectMarshalData(XMLContextReadDataPtr docdata)
        {
                newdocdata.reset(new XMLContextReadData(*docdata));
        }
        bool RestoreTo(struct HSVM *vm, HSVM_VariableId var);
        DocumentObjectMarshalData *Clone();

    private:
        XMLContextReadDataPtr newdocdata;
};

class XMLSchemaObjectMarshalData
{
    public:
        XMLSchemaObjectMarshalData(XMLContextReadDataPtr docdata)
        {
                newdocdata.reset(new XMLContextReadData(*docdata));
        }
        bool RestoreTo(struct HSVM *vm, HSVM_VariableId var);
        XMLSchemaObjectMarshalData *Clone();

    private:
        XMLContextReadDataPtr newdocdata;
};


bool DocumentObjectMarshalData::RestoreTo(struct HSVM *vm, HSVM_VariableId var)
{
        if (!XML_CreateObject(vm, DocumentObject, var, newdocdata))
            return false;

        XMLNodeContext::AutoCreateRef xmlnode(vm, var);
        xmlnode->node = (xmlNodePtr)newdocdata->GetDocPtr();

        return true;
}

DocumentObjectMarshalData * DocumentObjectMarshalData::Clone()
{
        return new DocumentObjectMarshalData(*this);
}

bool XMLSchemaObjectMarshalData::RestoreTo(struct HSVM *vm, HSVM_VariableId var)
{
        if (!XML_CreateObject(vm, XMLSchemaObject, var, newdocdata))
            return false;

        XMLNodeContext::AutoCreateRef xmlnode(vm, var);
        xmlnode->node = (xmlNodePtr)newdocdata->GetDocPtr();

        return true;
}

XMLSchemaObjectMarshalData * XMLSchemaObjectMarshalData::Clone()
{
        return new XMLSchemaObjectMarshalData(*this);
}

static void xmlSecXPathHereFunction(xmlXPathParserContextPtr ctxt, int /*nargs*/)
{
        valuePush(ctxt, xmlXPathNewNodeSet(ctxt->context->here));
}

XMLNodeOrNs XMLNamedNodeMap_GetNamedItemNSInternal(xmlNodePtr node, std::string const& xmlname, std::string const& namespaceuri)
{
        XMLNodeOrNs retval;
        if (!node)
            return retval;

        bool lookingfor_xmlns = xmlname == "xmlns"; //ADDME is it okay to always see 'xmlns'? or should we explicilty check for lvl1 vs lvl2 call?
        if (lookingfor_xmlns || namespaceuri == XML_XMLNS_NAMESPACE)
        {
                for (xmlNs* nsattr = node->nsDef; nsattr; nsattr = nsattr->next)
                {
                        if( (lookingfor_xmlns && !nsattr->prefix)
                            || (!lookingfor_xmlns && xmlStrcmp(nsattr->prefix, AsXmlChar(xmlname)) == 0))
                        {
                                retval.node = node;
                                retval.nsdef = nsattr;
                                return retval;
                        }
                }
                return retval; //no luck
        }

        retval.node = (xmlNodePtr)xmlHasNsProp(node, AsXmlChar(xmlname), AsXmlCharOrNull(namespaceuri));
        return retval;
}

void XMLUnlinkNS(xmlNodePtr parent, xmlNsPtr ns)
{
        if(parent->nsDef == ns)
        {
                parent->nsDef = ns->next;
        }
        else
        {
                for(xmlNsPtr cur = parent->nsDef; cur; cur = cur->next)
                  if(cur->next == ns)
                  {
                          cur->next = ns->next;
                          break;
                  }
        }

        if(!parent->doc->oldNs)
        {
                //trigger filling of oldNs by libxml
                xmlSearchNs(parent->doc, parent, (const xmlChar *)"xml");
                if(!parent->doc->oldNs)
                        throw std::runtime_error("xml namespace not appearing in doc->oldNs");
        }

        //link the ns into the 'old namespace' list of the parentdoc. this appears to be the way gnome dom does it. but always add it at the SECOND position because libxml assumes XML_XML_NAMESPACE is the first element
        ns->next = parent->doc->oldNs->next;
        parent->doc->oldNs->next = ns;
}

/* Returns an namespace declaration with the specified prefix and namespaceuri. Searches
   for a match in the document oldNs list, adds a new one if necessary
   @param doc Document
*/
xmlNsPtr createUnlinkedNSPtr(xmlNodePtr parent, xmlChar const *namespaceuri, xmlChar const *prefix)
{
        if (!parent->doc->oldNs)
        {
                //trigger filling of oldNs by libxml
                xmlSearchNs(parent->doc, parent, (const xmlChar *)"xml");
                if(!parent->doc->oldNs)
                    throw std::runtime_error("xml namespace not appearing in doc->oldNs");
        }

        xmlNsPtr curr = parent->doc->oldNs; // is always set to the 'xml' namespace
        while (curr)
        {
                // Two nullptr strings are equal too
                if (xmlStrEqual(curr->prefix, prefix) && xmlStrEqual(curr->href, namespaceuri))
                    return curr;
                if (!curr->next)
                {
                        // End of list reached, add a new namespace declaration
                        curr->next = xmlNewNs(nullptr, namespaceuri, prefix);
                        return curr->next;
                }
                curr = curr->next;
        }
        return nullptr;
}

//---------------------------------------------------------------------------
// Helper functions

// Throw a HareScript XmlDOMException using the wh::filetypes/xml.whlib helper
// function.
// You should return directly after calling this function!
void Xml_ThrowDomException(struct HSVM *hsvm, uint16_t code, std::string const &what)
{
        // Call the ThrowDomException helper function in HareScript
        HSVM_OpenFunctionCall(hsvm, 2);
        HSVM_IntegerSet(hsvm, HSVM_CallParam(hsvm, 0), code);
        HSVM_StringSetSTD(hsvm, HSVM_CallParam(hsvm, 1), what);
        static const HSVM_VariableType funcargs[2] = { HSVM_VAR_Integer, HSVM_VAR_String };
        HSVM_CallFunction(hsvm, "wh::xml/dom.whlib", "__INTERNAL_THROWDOMEXCEPTION", 0, 2, funcargs);
        HSVM_CloseFunctionCall(hsvm);
}

//bool XMLDocumentObjectMarshaller(struct HSVM *receiver, HSVM_VariableId received_var, struct HSVM *caller, HSVM_VariableId sent_var)
int XMLDocumentObjectMarshaller(struct HSVM *caller, HSVM_VariableId sent_var, void **resultdata, HSVM_ObjectRestorePtr *restoreptr, HSVM_ObjectClonePtr *cloneptr)
{
        XMLNodeContext::Ref xmlnode(caller, sent_var);
        if (!xmlnode->realdoc)
            HSVM_ReportCustomError(caller, "Object is not a XML Document");
        if (!xmlnode->realdoc->IsReadonly())
            HSVM_ReportCustomError(caller, "Object is not a regular readonly XML Document");

        try
        {
                *restoreptr = &HSVM_ObjectMarshalRestoreWrapper< DocumentObjectMarshalData >;
                if (cloneptr)
                    *cloneptr = &HSVM_ObjectMarshalCloneWrapper< DocumentObjectMarshalData >;
                *resultdata = new DocumentObjectMarshalData(xmlnode->realdoc);
                return true;
        }
        catch (std::exception &)
        {
                return false;
        }
//
//        XMLContextReadDataPtr newdocdata(new XMLContextReadData(*xmlnode->realdoc));
//        return XML_CreateObject(receiver, DocumentObject, received_var, newdocdata);
}

//bool XMLSchemaObjectMarshaller(struct HSVM *receiver, HSVM_VariableId received_var, struct HSVM *caller, HSVM_VariableId sent_var)
int XMLSchemaObjectMarshaller(struct HSVM *caller, HSVM_VariableId sent_var, void **resultdata, HSVM_ObjectRestorePtr *restoreptr, HSVM_ObjectClonePtr *cloneptr)
{
        XMLNodeContext::Ref xmlnode(caller, sent_var);
        if (!xmlnode->realdoc || !xmlnode->realdoc->GetSchemaPtr())
            HSVM_ReportCustomError(caller, "Object is not a XML Schema");
        if (!xmlnode->realdoc->IsReadonly())
            HSVM_ReportCustomError(caller, "Object is not a regular readonly XML Schema");

        try
        {
                *restoreptr = &HSVM_ObjectMarshalRestoreWrapper< XMLSchemaObjectMarshalData >;
                if (cloneptr)
                    *cloneptr = &HSVM_ObjectMarshalCloneWrapper< XMLSchemaObjectMarshalData >;
                *resultdata = new XMLSchemaObjectMarshalData(xmlnode->realdoc);
                return true;
        }
        catch (std::exception &)
        {
                return false;
        }
}


// Create an XML object using the given wh::filetypes/xml.whlib creation function
// in a given variable.
// Return false on error, directly return on false!
bool XML_CreateObject(HSVM *hsvm, ObjectType type, HSVM_VariableId var, XMLContextReadDataPtr doc)
{
        XMLNodeCreate &nccontext = *static_cast<XMLNodeCreate *>(HSVM_GetContext(hsvm, XMLNodeCreateContextId, true));

        // Determine which creationfunction to use
        const char *createfunction = 0;
        HSVM_VariableId *fptr = 0;
        switch (type)
        {
                //case DOMImplementationObject: createfunction = "CREATEXMLDOMIMPLEMENTATIONOBJECT"; break;
                case ElementObject:          createfunction = "__CREATEXMLELEMENTOBJECT"; fptr = &nccontext.fptr_elementobject; break;
                case TextObject:             createfunction = "__CREATEXMLTEXTOBJECT"; fptr = &nccontext.fptr_textobject; break;
                case CDATASectionObject:     createfunction = "__CREATEXMLCDATASECTIONOBJECT"; fptr = &nccontext.fptr_cdatasectionobject; break;
                case EntityReferenceObject:  createfunction = "__CREATEXMLNODEOBJECT"; fptr = &nccontext.fptr_entityreferenceobject; break;
                case ProcessingInstructionObject: createfunction = "__CREATEXMLPROCESSINGINSTRUCTIONOBJECT"; fptr = &nccontext.fptr_processinginstructionobject; break;
                case CommentObject:          createfunction = "__CREATEXMLCOMMENTOBJECT"; fptr = &nccontext.fptr_commentobject; break;
                case DocumentObject:
                    {
                        if (doc->from_html)
                        {
                                createfunction = "__CREATEHTMLDOCUMENTOBJECT";
                                fptr = &nccontext.fptr_htmldocumentobject;
                        }
                        else
                        {
                                createfunction = "__CREATEXMLDOCUMENTOBJECT";
                                fptr = &nccontext.fptr_documentobject;
                        }
                    } break;
                case DocumentFragmentObject: createfunction = "__CREATEXMLDOCUMENTFRAGMENTOBJECT"; fptr = &nccontext.fptr_documentfragmentobject; break;
                case DTDNodeObject:          createfunction = "__CREATEXMLDOCUMENTTYPEOBJECT"; fptr = &nccontext.fptr_dtdnodeobject; break;
                case ElementDeclObject:      createfunction = "__CREATEXMLNODEOBJECT"; fptr = &nccontext.fptr_elementdeclobject; break;
                case AttributeDeclObject:    createfunction = "__CREATEXMLNODEOBJECT"; fptr = &nccontext.fptr_attributedeclobject; break;
                case EntityDeclObject:       createfunction = "__CREATEXMLNODEOBJECT"; fptr = &nccontext.fptr_entitydeclobject; break;
                case NamespaceDeclObject:    createfunction = "__CREATEXMLNODEOBJECT"; fptr = &nccontext.fptr_namespacedeclobject; break;
                case NodeObject:             createfunction = "__CREATEXMLNODEOBJECT"; fptr = &nccontext.fptr_nodeobject; break;
                case CharacterDataObject:    createfunction = "__CREATEXMLCHARACTERDATAOBJECT"; fptr = &nccontext.fptr_characterdataobject; break;
                case XMLSchemaObject:        createfunction = "__CREATEXMLSCHEMAOBJECT"; fptr = &nccontext.fptr_xmlschemaobject; break;
                case SchematronSchemaObject: createfunction = "__CREATESCHEMATRONSCHEMAOBJECT"; fptr = &nccontext.fptr_schematronschemaobject; break;
                case HTMLDocumentNodeObject: createfunction = "__CREATEHTMLDOCUMENTOBJECT"; fptr = &nccontext.fptr_htmldocumentobject; break;
                default:
                        HSVM_ReportCustomError(hsvm, ("Unsupported object type " + Blex::AnyToString((int)type)).c_str());
                        return false;
        }

        if (!*fptr)
        {
                *fptr = HSVM_AllocateVariable(hsvm);
                int result = HSVM_MakeFunctionPtr(hsvm, *fptr, "wh::xml/dom.whlib", createfunction, HSVM_VAR_Object, 0, NULL, 0);
                if(result <= 0)
                    return 0; //fatal error..
        }

        // Create the object in var
        HSVM_OpenFunctionCall(hsvm, 0);
        HSVM_VariableId obj = HSVM_CallFunctionPtr(hsvm, *fptr, false);
        if (!obj)
            return false;
        HSVM_CopyFrom(hsvm, var, obj);
        HSVM_CloseFunctionCall(hsvm);

        // Initialize object context(s)
        switch (type)
        {
                case DocumentObject:
                {
                        XMLNodeContext::AutoCreateRef newnode(hsvm, var);
                        newnode->realdoc = doc;
                        HSVM_ObjectSetMarshaller(hsvm, var, &XMLDocumentObjectMarshaller);
                } break;
                case XMLSchemaObject:
                {
                        XMLNodeContext::AutoCreateRef newnode(hsvm, var);
                        newnode->realdoc = doc;
                        HSVM_ObjectSetMarshaller(hsvm, var, &XMLSchemaObjectMarshaller);
                } break;

                default:
                {
                        XMLNodeContext::AutoCreateRef newnode(hsvm, var);
                        newnode->realdoc = doc;
                } break;
        }

        return true;
}

void GetErrorsFromCatcher(HSVM *hsvm, HSVM_VariableId id_set, Blex::XML::ErrorCatcher const &catcher)
{
        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_RecordArray);
        for(std::vector<Blex::XML::XMLError>::const_iterator it = catcher.errors.begin(); it != catcher.errors.end(); ++it)
        {
                HSVM_VariableId id_row = HSVM_ArrayAppend(hsvm, id_set);
                HSVM_IntegerSet(hsvm, HSVM_RecordCreate(hsvm, id_row, HSVM_GetColumnId(hsvm, "CODE")), it->code);
                HSVM_IntegerSet(hsvm, HSVM_RecordCreate(hsvm, id_row, HSVM_GetColumnId(hsvm, "LINENUM")), it->line);

                HSVM_StringSetSTD(hsvm, HSVM_RecordCreate(hsvm, id_row, HSVM_GetColumnId(hsvm, "MESSAGE")), it->message);
                HSVM_StringSetSTD(hsvm, HSVM_RecordCreate(hsvm, id_row, HSVM_GetColumnId(hsvm, "FILENAME")), it->file);
                HSVM_StringSetSTD(hsvm, HSVM_RecordCreate(hsvm, id_row, HSVM_GetColumnId(hsvm, "LOCALNAME")), it->node_localname);
                HSVM_StringSetSTD(hsvm, HSVM_RecordCreate(hsvm, id_row, HSVM_GetColumnId(hsvm, "NAMESPACEURI")), it->node_ns);
        }
}

// This function tests for a valid XML Name (adapted from Blex::IsValidUTF8)
// @param part_only Don't accept ':', only checking valid prefix or local-name
bool TestQualifiedName(std::string const &name, bool part_only)
{
        /*
        From "Extensible Markup Language (XML) 1.0 (Fifth Edition)", http://www.w3.org/TR/REC-xml/#d0e804
        [4]  NameStartChar ::= ":" | [A-Z] | "_" | [a-z] | [#xC0-#xD6] | [#xD8-#xF6] | [#xF8-#x2FF] | [#x370-#x37D] | [#x37F-#x1FFF] | [#x200C-#x200D] | [#x2070-#x218F] | [#x2C00-#x2FEF] | [#x3001-#xD7FF] | [#xF900-#xFDCF] | [#xFDF0-#xFFFD] | [#x10000-#xEFFFF]
        [4a] NameChar      ::= NameStartChar | "-" | "." | [0-9] | #xB7 | [#x0300-#x036F] | [#x203F-#x2040]
        [5]  Name          ::= NameStartChar (NameChar)*
        */

        if (name.empty())
            return false;

        Blex::UTF8DecodeMachine checker;
        std::string::const_iterator pos = name.begin();
        for (;pos!=name.end();++pos)
        {
                // Add the octet as pos to the checker
                uint32_t c = checker(*pos);

                // If the checker encountered an invalid UTF-8 sequence, the name is invalid
                if (c == Blex::UTF8DecodeMachine::InvalidChar)
                    return false;

                // If the checker returned an actual Unicode value, check it for validity
                if (c != Blex::UTF8DecodeMachine::NoChar &&
                    !(
                      // NameStartChar
                      (c == ':' && !part_only) ||
                      (c >= 'A' && c <= 'Z') ||
                      c == '_' ||
                      (c >= 'a' && c <= 'z') ||
                      (c >= 0xC0 && c <= 0xD6) ||
                      (c >= 0xD8 && c <= 0xF6) ||
                      (c >= 0xF8 && c <= 0x2FF) ||
                      (c >= 0x370 && c <= 0x37D) ||
                      (c >= 0x37F && c <= 0x1FFF) ||
                      (c >= 0x200C && c <= 0x200D) ||
                      (c >= 0x2070 && c <= 0x218F) ||
                      (c >= 0x2C00 && c <= 0x2FEF) ||
                      (c >= 0x3001 && c <= 0xD7FF) ||
                      (c >= 0xF900 && c <= 0xFDCF) ||
                      (c >= 0xFDF0 && c <= 0xFFFD) ||
                      (pos != name.begin() && (
                                               // NameChar
                                               c == '-' ||
                                               c == '.' ||
                                               (c >= '0' && c <= '9') ||
                                               c == 0xB7 ||
                                               (c >= 0x300 && c <= 0x36F) ||
                                               (c >= 0x203F && c <= 0x2040)
                                              )
                      )
                     )
                   )
                    return false;
        }
        return checker.InsideCharacter() == false; //not halfway inside a character ?
}

// Split a qualified or local name into a prefix and local name part
// If qname was a local name, prefix is empty
// If illegal characters were found, both prefix and local name are empty
QualifiedNamePair SplitQualifiedName(std::string const &qname, xmlNsPtr ns)
{
        QualifiedNamePair split;
        if (!TestQualifiedName(qname, false))
            return split;

        std::string::const_iterator colon = std::find(qname.begin(), qname.end(), ':');
        if(ns && colon == qname.begin()+3 && std::equal(qname.begin(), colon, "xml") && xmlStrcmp(ns->href, XML_XML_NAMESPACE) != 0)
        {
                DEBUGPRINT("Using prefix xml: with wrong namespace URI");
                return split;
        }

        if(colon == qname.end()) //not found
        {
                split.second = qname;
                return split;
        }

        split.first.assign(qname.begin(), colon);
        split.second.assign(colon + 1, qname.end());
        return split;
}

void NormalizeNode(XMLContextReadData *realdoc, xmlNodePtr node)
{
        // First merge text node children
        xmlNodePtr child = node->children;
        while (child)
        {
                bool merged = false;
                if (child->type == XML_TEXT_NODE)
                {
                        if (xmlStrlen(child->content) == 0)
                        {
                                // Delete empty node
                                xmlNodePtr to_remove = child;
                                child = child->next;
                                xmlUnlinkNode(to_remove);
                                realdoc->SetIsUnlinkedHead(to_remove, true);
                                merged = true;
                        }
                        else if (child->next && child->next->type == XML_TEXT_NODE)
                        {
                                // Merge with next child
                                xmlNodePtr to_remove = child->next;
                                xmlNodeAddContent(child, to_remove->content);
                                xmlNodeSetContent(to_remove, 0);
                                xmlUnlinkNode(to_remove);
                                realdoc->SetIsUnlinkedHead(to_remove, true);
                                merged = true;
                        }
                }
                else
                    NormalizeNode(realdoc, child);

                if (!merged)
                    child = child->next;
        }
        // Then merge attribute text nodes
        if (node->type == XML_ELEMENT_NODE)
        {
                child = (xmlNodePtr)node->properties;
                while (child)
                {
                        NormalizeNode(realdoc, child);
                        child = (xmlNodePtr)child->next;
                }
        }
}

// Test if child is a valid child node of node (used by functions such as appendChild
// and insertBefore)
// http://www.w3.org/TR/DOM-Level-2-Core/core.html#ID-1590626202
bool TestValidChildNodeType(xmlElementType nodetype, xmlElementType childtype)
{
        switch (nodetype)
        {
                case XML_DOCUMENT_NODE:
                {
                        DEBUGPRINT("Should use TestValidChildNode to test document node child");
                        return false;
                }
                case XML_DOCUMENT_FRAG_NODE:
                case XML_ENTITY_REF_NODE:
                case XML_ELEMENT_NODE:
                case XML_ENTITY_NODE:
                {
                        return childtype == XML_ELEMENT_NODE
                            || childtype == XML_PI_NODE
                            || childtype == XML_COMMENT_NODE
                            || childtype == XML_TEXT_NODE
                            || childtype == XML_CDATA_SECTION_NODE
                            || childtype == XML_ENTITY_REF_NODE;
                }
                case XML_ATTRIBUTE_NODE:
                {
                        return childtype == XML_TEXT_NODE
                            || childtype == XML_ENTITY_REF_NODE;
                }
                default:
                        return false;
        }
}
bool TestValidChildNode(xmlNodePtr node, xmlNodePtr child, xmlNodePtr replaced)
{
        if (!node || !child)
            return false;

        // Document fragment nodes act like a collection of nodes on insert; need special handling
        if (child->type == XML_DOCUMENT_FRAG_NODE)
        {
                if (node->type == XML_DOCUMENT_NODE)
                {
                        unsigned elt_nodes = 0;
                        unsigned doctype_nodes = 0;

                        //Document -- Element (maximum of one), ProcessingInstruction, Comment, DocumentType (maximum of one)

                        // Only one child of types element, and one child of type doctype allowed
                        // Count the ones that remain after replace
                        xmlNodePtr curchild = node->children;
                        while (curchild)
                        {
                                if (curchild->type == XML_ELEMENT_NODE && curchild != replaced)
                                    ++elt_nodes;
                                if (curchild->type == XML_DOCUMENT_TYPE_NODE && curchild != replaced)
                                    ++doctype_nodes;
                                curchild = curchild->next;
                        }

                        // Count the ones that are inserted (and check the types)
                        curchild = child->children;
                        while (curchild)
                        {
                                if (curchild->type == XML_ELEMENT_NODE)
                                    ++elt_nodes;
                                else if (curchild->type == XML_DOCUMENT_TYPE_NODE)
                                    ++doctype_nodes;
                                else if (curchild->type != XML_PI_NODE && curchild->type != XML_COMMENT_NODE)
                                    return false;

                                curchild = curchild->next;
                        }

                        return elt_nodes <= 1 && doctype_nodes <= 1;
                }
                else
                {
                        xmlNodePtr curchild = child->children;
                        while (curchild)
                        {
                                if (!TestValidChildNodeType(node->type, curchild->type))
                                    return false;
                                curchild = curchild->next;
                        }
                        return true;
                }
        }

        if (node->type == XML_DOCUMENT_NODE)
        {
                if (child->type == XML_ELEMENT_NODE || child->type == XML_DOCUMENT_TYPE_NODE)
                {
                        // Only one child of these types allowed
                        xmlNodePtr curchild = node->children;
                        while (curchild)
                        {
                                if (curchild->type == child->type && curchild != replaced)
                                    return false;
                                curchild = curchild->next;
                        }
                        // No children with child node type found, it's ok to add
                        return true;
                }
                return child->type == XML_PI_NODE
                    || child->type == XML_COMMENT_NODE;
        }

        return TestValidChildNodeType(node->type, child->type);
}

// Test if a node is readonly (i.e. a child node within a read-only document)
bool IsReadOnlyNode(XMLContextReadDataPtr doc, xmlNodePtr node)
{
        if (!doc)
            return true; // Got no doc, return read-only
        if (!node)
            return doc->IsReadonly(); // Got no node, return document read-only status

        xmlNodePtr docrootnode = xmlDocGetRootElement(doc->GetDocPtr());
        while (node)
        {
                // If we got to the document root node, the node is inserted in
                // the DOM tree, return the read-only status of the document
                if (node == docrootnode)
                    return doc->IsReadonly();
                node = node->parent;
        }

        // The node is not part of the document tree, so it can be modified
        return false;
}

//---------------------------------------------------------------------------
// DOMImplementation

void XMLDOMImplementation_CreateDocument(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLContextReadDataPtr realdoc(new XMLContextReadData);
        realdoc->doc.reset(xmlNewDoc(AsXmlChar("1.0")), false);
        DEBUGPRINT("Called xmlNewDoc: " << realdoc->GetDocPtr());

        // Create root element
        QualifiedNamePair qname = SplitQualifiedName(HSVM_StringGetSTD(hsvm, HSVM_Arg(2)), NULL);
        if (qname.second.empty())
        {
                Xml_ThrowDomException(hsvm, InvalidCharacterErr, "Invalid characters used in element name");
                return;
        }

        std::string nsuri = HSVM_StringGetSTD(hsvm, HSVM_Arg(1));
        if (!nsuri.empty())
        {
                if (qname.first == "xml" && nsuri != (const char*)XML_XML_NAMESPACE)
                {
                        Xml_ThrowDomException(hsvm, NamespaceErr, "Using xml prefix without xml namespace");
                        return;
                }
        }
        else if (!qname.first.empty())
        {
                Xml_ThrowDomException(hsvm, NamespaceErr, "Prefix specified without a namespace URI");
                return;
        }

        xmlNodePtr newelement = xmlNewDocNode(realdoc->GetDocPtr(), NULL, AsXmlChar(qname.second), NULL);
        if (!nsuri.empty())
        {
                xmlNsPtr newns = xmlNewNs(newelement, AsXmlChar(nsuri), AsXmlCharOrNull(qname.first));
                newelement->ns = newns;
        }
        xmlAddChild((xmlNodePtr)realdoc->GetDocPtr(), newelement);

        // Looks like it does nothing, but removing it breaks the tests. FIXME: WHY????
        xmlSearchNsByHref(realdoc->GetDocPtr(), newelement, XML_XML_NAMESPACE);

        if (!XML_CreateObject(hsvm, DocumentObject, id_set, realdoc))
            return;

        XMLNodeContext::AutoCreateRef xmlnode(hsvm, id_set);
        xmlnode->node = (xmlNodePtr)realdoc->GetDocPtr();
}

void XMLDOMImplementation_MakeDocument(HSVM *hsvm, HSVM_VariableId id_set)
{
        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_Object);

        XMLContextReadDataPtr realdoc(new XMLContextReadData);

        if(!realdoc->ParseXMLBlob(hsvm, HSVM_Arg(0), HSVM_Arg(1), HSVM_BooleanGet(hsvm, HSVM_Arg(2))))
            return;

        if (!XML_CreateObject(hsvm, DocumentObject, id_set, realdoc))
            return;

        XMLNodeContext::AutoCreateRef xmlnode(hsvm, id_set);
        xmlnode->node = (xmlNodePtr)realdoc->GetDocPtr();
}

void XMLDOMImplementation_MakeHTMLDocument(HSVM *hsvm, HSVM_VariableId id_set)
{
        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_Object);

        XMLContextReadDataPtr realdoc(new XMLContextReadData);

        if(!realdoc->ParseHTMLBlob(hsvm, HSVM_Arg(0), HSVM_Arg(1), HSVM_BooleanGet(hsvm, HSVM_Arg(2)), HSVM_BooleanGet(hsvm, HSVM_Arg(3))))
            return;

        if (!XML_CreateObject(hsvm, DocumentObject, id_set, realdoc))
            return;

        XMLNodeContext::AutoCreateRef xmlnode(hsvm, id_set);
        xmlnode->node = (xmlNodePtr)realdoc->GetDocPtr();
}

void XMLDOMImplementation_MakeXMLSchema(HSVM *hsvm, HSVM_VariableId id_set)
{
        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_Object);

        XMLContextReadDataPtr realdoc(new XMLContextReadData);
        if(!realdoc->ParseXMLBlob(hsvm, HSVM_Arg(1), HSVM_Arg(2), HSVM_BooleanGet(hsvm, HSVM_Arg(3))))
            return;

        if (!XML_CreateObject(hsvm, XMLSchemaObject, id_set, realdoc))
            return;

        /* libxml catalog handling is not threadsafe, we're seeing errors comparable to
            https://stackoverflow.com/questions/34007044/libxml2-multithreading-errors-in-helgrind */
        Blex::Mutex::AutoLock lock(validationmutex);
        xmlSchemaPtr sptr = realdoc->ParseAsValidator(hsvm, HSVM_Arg(0));
        if (!sptr)
            return;

        XMLNodeContext::AutoCreateRef xmlnode(hsvm, id_set);
        xmlnode->node = (xmlNodePtr)realdoc->GetDocPtr();
}

void XMLDOMImplementation_MakeSchematronSchema(HSVM *hsvm, HSVM_VariableId id_set)
{
        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_Object);

        XMLContextReadDataPtr realdoc(new XMLContextReadData);
        if(!realdoc->ParseXMLBlob(hsvm, HSVM_Arg(1), HSVM_Arg(2), HSVM_BooleanGet(hsvm, HSVM_Arg(3))))
            return;

        if (!XML_CreateObject(hsvm, SchematronSchemaObject, id_set, realdoc))
            return;

        XMLNodeContext::AutoCreateRef xmlnode(hsvm, id_set);
        xmlnode->node = (xmlNodePtr)realdoc->GetDocPtr();

        Blex::XML::SetXMLGenericThreadErrorCatcher(&realdoc->errorcatcher);
        xmlSchematronPtr sptr = realdoc->ParseAsSchematronValidator(hsvm, HSVM_Arg(0));
        Blex::XML::SetXMLGenericThreadErrorCatcher(0);
        if (!sptr)
            return;
}


//---------------------------------------------------------------------------
// Document

void TranslateXMLNsNodesForValidation(xmlNodePtr node, xmlNsPtr xmlns)
{
        // First merge text node children
        xmlNodePtr child = node->children;
        while (child)
        {
                if (child->type != XML_TEXT_NODE)
                    TranslateXMLNsNodesForValidation(child, xmlns);
                child = child->next;
        }
        if (node->type == XML_ELEMENT_NODE)
        {
                xmlAttrPtr attr = node->properties;
                while (attr)
                {
                        if (!attr->ns && attr->name && xmlStrcmp(attr->name, AsXmlChar("xmlns")) == 0)
                            attr->ns = xmlns;
                        attr = attr->next;
                }
        }
}

void TranslateXMLNsNodesAfterValidation(xmlNodePtr node, xmlNsPtr xmlns)
{
        // First merge text node children
        xmlNodePtr child = node->children;
        while (child)
        {
                if (child->type != XML_TEXT_NODE)
                    TranslateXMLNsNodesAfterValidation(child, xmlns);
                child = child->next;
        }
        if (node->type == XML_ELEMENT_NODE)
        {
                xmlAttrPtr attr = node->properties;
                while (attr)
                {
                        if (attr->ns == xmlns && attr->name && xmlStrcmp(attr->name, AsXmlChar("xmlns")) == 0)
                            attr->ns = NULL;
                        attr = attr->next;
                }
        }
}

// Schema

void XMLSchema_FindElementByName(HSVM *hsvm, HSVM_VariableId id_set)
{
        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_Object);

        XMLNodeContext::Ref xsdnode(hsvm, HSVM_Arg(0));
        xmlSchemaPtr xsdschema = xsdnode->realdoc->GetSchemaPtr();

        if(!xsdschema)
        {
                HSVM_ReportCustomError(hsvm, "Object is not a XML Schema");
                return;
        }

        xmlSchemaElementPtr elem = (xmlSchemaElementPtr)xmlHashLookup(xsdschema->elemDecl, AsXmlChar(HSVM_StringGetSTD(hsvm, HSVM_Arg(1))));

        if (elem)
        {
                if (!XML_CreateObject(hsvm, (ObjectType)elem->node->type, id_set, xsdnode->realdoc))
                    return;
                XMLNodeContext::AutoCreateRef xmlnode(hsvm, id_set);
                xmlnode->node = elem->node;
        }
}

void XMLSchema_FindTypeByName(HSVM *hsvm, HSVM_VariableId id_set)
{
        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_Object);

        XMLNodeContext::Ref xsdnode(hsvm, HSVM_Arg(0));
        xmlSchemaPtr xsdschema = xsdnode->realdoc->GetSchemaPtr();

        if(!xsdschema)
        {
                HSVM_ReportCustomError(hsvm, "Object is not a XML Schema");
                return;
        }

        xmlSchemaTypePtr type = (xmlSchemaTypePtr)xmlHashLookup(xsdschema->typeDecl, AsXmlChar(HSVM_StringGetSTD(hsvm, HSVM_Arg(1))));

        if (type)
        {
                if (!XML_CreateObject(hsvm, (ObjectType)type->node->type, id_set, xsdnode->realdoc))
                    return;
                XMLNodeContext::Ref xmlnode(hsvm, id_set);
                xmlnode->node = type->node;
        }
}

void XMLSchema_ValidateDocument(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLNodeContext::Ref xmlschemanode(hsvm, HSVM_Arg(0));
        XMLNodeContext::Ref xmldoc(hsvm, HSVM_Arg(1));
        if(!xmldoc->realdoc.get())
        {
                HSVM_ReportCustomError(hsvm, "Object is not a XML Document");
                return;
        }

        xmlSchemaPtr xsdschema = xmlschemanode->realdoc->GetSchemaPtr();
        if(!xsdschema)
        {
                HSVM_ReportCustomError(hsvm, "Object is not a XML Schema");
                return;
        }

        xmlNodePtr docrootnode = xmlDocGetRootElement(xmldoc->realdoc->GetDocPtr());

        xmlNsPtr xmlns = xmlSearchNs(xmldoc->realdoc->GetDocPtr(), docrootnode, AsXmlChar("xmlns"));
        if (docrootnode)
            TranslateXMLNsNodesForValidation(docrootnode, xmlns);

        // Validate the XML file
        Blex::XML::ErrorCatcher catcher;
        xmlSchemaValidCtxtPtr val_ctx = xmlSchemaNewValidCtxt(xsdschema);
        xmlSchemaSetValidStructuredErrors(val_ctx, HareScript::Xml::HandleXMLError, &catcher);
        xmlSchemaValidateDoc(val_ctx, xmldoc->realdoc->GetDocPtr());
        xmlSchemaSetValidStructuredErrors(val_ctx, NULL, NULL);
        xmlSchemaFreeValidCtxt(val_ctx);

        if (docrootnode)
            TranslateXMLNsNodesAfterValidation(docrootnode, xmlns);

        GetErrorsFromCatcher(hsvm, id_set, catcher);
}

//---------------------------------------------------------------------------
// SchematronSchema

void SchematronSchema_ValidateDocument(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLNodeContext::Ref xmlschemanode(hsvm, HSVM_Arg(0));
        XMLNodeContext::Ref xmldoc(hsvm, HSVM_Arg(1));
        if(!xmldoc->realdoc.get())
        {
                HSVM_ReportCustomError(hsvm, "Object is not a valid schematron schema");
                return;
        }

        xmlSchematronPtr schematronschema = xmlschemanode->realdoc->GetSchematronSchemaPtr();
        if(!schematronschema)
        {
                HSVM_ReportCustomError(hsvm, "Object is not a valid schematron schema, check the parse errors");
                return;
        }

        xmlNodePtr docrootnode = xmlDocGetRootElement(xmldoc->realdoc->GetDocPtr());

        xmlNsPtr xmlns = xmlSearchNs(xmldoc->realdoc->GetDocPtr(), docrootnode, AsXmlChar("xmlns"));
        if(docrootnode)
                TranslateXMLNsNodesForValidation(docrootnode, xmlns);

        // Validate the XML file
        Blex::XML::ErrorCatcher catcher;
        xmlSchematronValidCtxtPtr val_ctx = xmlSchematronNewValidCtxt(schematronschema, XML_SCHEMATRON_OUT_ERROR);
        Blex::XML::SetXMLGenericThreadErrorCatcher(&catcher);
        xmlSchematronSetValidStructuredErrors(val_ctx, HareScript::Xml::HandleXMLError, &catcher);
        xmlSchematronValidateDoc(val_ctx, xmldoc->realdoc->GetDocPtr());
        xmlSchematronSetValidStructuredErrors(val_ctx, NULL, NULL);
        Blex::XML::SetXMLGenericThreadErrorCatcher(0);
        xmlSchematronFreeValidCtxt(val_ctx);

        if(docrootnode)
                TranslateXMLNsNodesAfterValidation(docrootnode, xmlns);

        GetErrorsFromCatcher(hsvm, id_set, catcher);
}

//---------------------------------------------------------------------------
// Document

void XMLDoc_GetDocumentElement(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        xmlNodePtr docrootnode = xmlDocGetRootElement(xmlnode->realdoc->GetDocPtr());
        if (!docrootnode)
        {
                // No root node, return default object
                HSVM_SetDefault(hsvm, id_set, HSVM_VAR_Object);
                return;
        }
        if (!XML_CreateObject(hsvm, (ObjectType)docrootnode->type, id_set, xmlnode->realdoc))
            return;
        XMLNodeContext::AutoCreateRef rootnode(hsvm, id_set);
        rootnode->node = docrootnode;
}


void XMLDoc_GetReadOnly(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        HSVM_BooleanSet(hsvm, id_set, xmlnode->realdoc->IsReadonly());
}


void XMLDoc_GetDocumentBlob(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        std::string encoding = HSVM_StringGetSTD(hsvm, HSVM_Arg(2));
        Blex::ToUppercase(encoding.begin(), encoding.end());

        if (!xmlnode->realdoc.get())
            return;

        // doesn't work....  xmlReconciliateNs(xmlnode->realdoc->doc, xmlDocGetRootElement(xmlnode->realdoc->doc));
        /*xmlNodePtr docrootnode = xmlDocGetRootElement(xmlnode->realdoc->doc);
        xmlDOMWrapCtxtPtr domwrapper = xmlDOMWrapNewCtxt();
        xmlDOMWrapReconcileNamespaces(domwrapper, docrootnode, 0);
        xmlDOMWrapFreeCtxt(domwrapper);
*/
        xmlChar *output;
        int len;
        xmlDocPtr doc = xmlnode->realdoc->GetDocPtr();
        if (encoding.empty())
        {
                if (xmlStrlen(doc->encoding) > 0)
                    encoding.assign((char *)doc->encoding);
                else
                    encoding = "UTF-8";
        }
        xmlDocDumpFormatMemoryEnc(doc, &output, &len, encoding.c_str(), HSVM_BooleanGet(hsvm, HSVM_Arg(1)) ? 1 : 0);
        HSVM_MakeBlobFromMemory(hsvm, id_set, len, (void *)output);
        xmlFree(output);
}

void XMLDoc_GetParseErrors(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        if (!xmlnode->realdoc.get())
            return;

        GetErrorsFromCatcher(hsvm, id_set, xmlnode->realdoc->errorcatcher);
}

void XMLDoc_CreateCDATASection(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        std::string data = HSVM_StringGetSTD(hsvm, HSVM_Arg(1));
        Blex::EnsureValidUTF8(&data, true);

        xmlNodePtr newcdata = xmlNewCDataBlock(xmlnode->realdoc->GetDocPtr(), AsXmlChar(data), data.size());
        xmlnode->realdoc->SetIsUnlinkedHead(newcdata, true);
        if (!XML_CreateObject(hsvm, CDATASectionObject, id_set, xmlnode->realdoc))
            return;
        XMLNodeContext::AutoCreateRef newnode(hsvm, id_set);
        newnode->node = newcdata;
}

void XMLDoc_CreateComment(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        std::string data = HSVM_StringGetSTD(hsvm, HSVM_Arg(1));
        Blex::EnsureValidUTF8(&data, true);
        xmlNodePtr newcomment = xmlNewDocComment(xmlnode->realdoc->GetDocPtr(), AsXmlChar(data));
        xmlnode->realdoc->SetIsUnlinkedHead(newcomment, true);
        if (!XML_CreateObject(hsvm, CommentObject, id_set, xmlnode->realdoc))
            return;
        XMLNodeContext::AutoCreateRef newnode(hsvm, id_set);
        newnode->node = newcomment;
}

void XMLDoc_CreateDocumentFragment(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        xmlNodePtr newdocfragment = xmlNewDocFragment(xmlnode->realdoc->GetDocPtr());
        xmlnode->realdoc->SetIsUnlinkedHead(newdocfragment, true);
        if (!XML_CreateObject(hsvm, DocumentFragmentObject, id_set, xmlnode->realdoc))
            return;
        XMLNodeContext::AutoCreateRef newnode(hsvm, id_set);
        newnode->node = newdocfragment;
}

void XMLDoc_CreateElement(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        std::string elname = HSVM_StringGetSTD(hsvm, HSVM_Arg(1));
        if (!TestQualifiedName(elname, false))
        {
                Xml_ThrowDomException(hsvm, InvalidCharacterErr, "Invalid characters used in element name");
                return;
        }
        xmlNodePtr newelement = xmlNewDocNode(xmlnode->realdoc->GetDocPtr(), NULL, AsXmlChar(elname), NULL);
        xmlnode->realdoc->SetIsUnlinkedHead(newelement, true);
        if (!XML_CreateObject(hsvm, ElementObject, id_set, xmlnode->realdoc))
            return;
        XMLNodeContext::AutoCreateRef newnode(hsvm, id_set);
        newnode->node = newelement;
}

void XMLDoc_CreateElementNS(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));

        QualifiedNamePair qname = SplitQualifiedName(HSVM_StringGetSTD(hsvm, HSVM_Arg(2)), NULL);
        if (qname.second.empty())
        {
                Xml_ThrowDomException(hsvm, InvalidCharacterErr, "Invalid characters used in attribute name");
                return;
        }
        if (qname.second.find(':') != std::string::npos)
        {
                Xml_ThrowDomException(hsvm, NamespaceErr, "Malformed qualified name specified");
                return;
        }
        xmlNodePtr newelement = xmlNewDocNode(xmlnode->realdoc->GetDocPtr(), NULL, AsXmlChar(qname.second), NULL);
        xmlnode->realdoc->SetIsUnlinkedHead(newelement, true);
        if (!XML_CreateObject(hsvm, ElementObject, id_set, xmlnode->realdoc))
            return;

        std::string hrefstr = HSVM_StringGetSTD(hsvm, HSVM_Arg(1));

        if (!qname.first.empty())
        {
                if (hrefstr.empty())
                {
                        Xml_ThrowDomException(hsvm, NamespaceErr, "Prefix specified without a namespace URI");
                        return;
                }
                if (qname.first == "xml" && hrefstr != (const char*)XML_XML_NAMESPACE)
                {
                        Xml_ThrowDomException(hsvm, NamespaceErr, "Using xml prefix without xml namespace");
                        return;
                }
        }
        xmlNsPtr newns = xmlSearchNsByHref(xmlnode->realdoc->GetDocPtr(), newelement, AsXmlCharOrNull(hrefstr));
        if (!newns)
        {
                //Create the namespace, as it may not be set visible in the DOM yet
                newns = createUnlinkedNSPtr(newelement, AsXmlChar(hrefstr), AsXmlCharOrNull(qname.first));
                if(!newns)
                {
                        Xml_ThrowDomException(hsvm, NamespaceErr, "Namespace creation failed");
                        return;
                }
        }

        newelement->ns = newns;
        XMLNodeContext::AutoCreateRef newnode(hsvm, id_set);
        newnode->node = newelement;
}

void XMLDoc_CreateProcessingInstruction(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        std::string pi1 = HSVM_StringGetSTD(hsvm, HSVM_Arg(1));
        std::string pi2 = HSVM_StringGetSTD(hsvm, HSVM_Arg(2));

        Blex::EnsureValidUTF8(&pi1, true);
        Blex::EnsureValidUTF8(&pi2, true);

        xmlNodePtr newelement = xmlNewDocPI(xmlnode->realdoc->GetDocPtr(), AsXmlChar(pi1), AsXmlChar(pi2));
        xmlnode->realdoc->SetIsUnlinkedHead(newelement, true);
        if (!XML_CreateObject(hsvm, ProcessingInstructionObject, id_set, xmlnode->realdoc))
            return;

        XMLNodeContext::AutoCreateRef newnode(hsvm, id_set);
        newnode->node = newelement;
}

void XMLDoc_CreateTextNode(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        std::string txt = HSVM_StringGetSTD(hsvm, HSVM_Arg(1));
        Blex::EnsureValidUTF8(&txt, true);

        xmlNodePtr newtext = xmlNewDocText(xmlnode->realdoc->GetDocPtr(), AsXmlChar(txt));
        xmlnode->realdoc->SetIsUnlinkedHead(newtext, true);
        if (!XML_CreateObject(hsvm, TextObject, id_set, xmlnode->realdoc))
            return;
        XMLNode *newnode = static_cast<XMLNode*>(HSVM_ObjectContext(hsvm, id_set, XMLNodeContextId, true));
        newnode->node = newtext;
}

OwnedPtr< xmlXPathObject > EvaluateXpath(HSVM *hsvm, xmlDocPtr doc, HSVM_VariableId instructions)
{
        if(!HSVM_RecordExists(hsvm, instructions))
                return OwnedPtr< xmlXPathObject > (0);

        HSVM_VariableId cell_query = HSVM_RecordGetRef(hsvm, instructions, HSVM_GetColumnId(hsvm, "QUERY"));
        if(!cell_query || HSVM_GetType(hsvm, cell_query) != HSVM_VAR_String)
        {
                HSVM_ReportCustomError(hsvm, "Cell QUERY is not a STRING");
                return OwnedPtr< xmlXPathObject > (0);
        }

        HSVM_VariableId cell_namespaces = HSVM_RecordGetRef(hsvm, instructions, HSVM_GetColumnId(hsvm, "NAMESPACES"));
        if(!cell_namespaces || HSVM_GetType(hsvm, cell_namespaces) != HSVM_VAR_RecordArray)
        {
                HSVM_ReportCustomError(hsvm, "Cell NAMESPACES is not a RECORD ARRAY");
                return OwnedPtr< xmlXPathObject > (0);
        }

        HSVM_VariableId cell_node = HSVM_RecordGetRef(hsvm, instructions, HSVM_GetColumnId(hsvm, "NODE"));
        if(!cell_node || HSVM_GetType(hsvm, cell_node) != HSVM_VAR_Object)
        {
                HSVM_ReportCustomError(hsvm, "Cell NODE is not an OBJECT");
                return OwnedPtr< xmlXPathObject > (0);
        }

        HSVM_VariableId cell_herenode = HSVM_RecordGetRef(hsvm, instructions, HSVM_GetColumnId(hsvm, "HERENODE"));
        if(!cell_herenode || HSVM_GetType(hsvm, cell_herenode) != HSVM_VAR_Object)
        {
                HSVM_ReportCustomError(hsvm, "Cell HERENODE is not an OBJECT");
                return OwnedPtr< xmlXPathObject > (0);
        }

        auto context = MakeOwnedPtr(xmlXPathNewContext(doc));

        if (HSVM_ObjectExists(hsvm, cell_node))
        {
                XMLNodeContext::Ref xmlnode(hsvm, cell_node);
                if(!xmlnode)
                    return OwnedPtr< xmlXPathObject > (0);

                context->node = xmlnode->node;
        }

        if (HSVM_ObjectExists(hsvm, cell_herenode))
        {
                XMLNodeContext::Ref here(hsvm, cell_herenode);
                if(!here)
                    return OwnedPtr< xmlXPathObject > (0);

                context->here = here->node;
                context->xptr = 1;
                xmlXPathRegisterFunc(context, (xmlChar *)"here", xmlSecXPathHereFunction);
        }

        unsigned num_namespaces = HSVM_ArrayLength(hsvm, cell_namespaces);
        for(unsigned i=0; i<num_namespaces;++i)
        {
                HSVM_VariableId el = HSVM_ArrayGetRef(hsvm, cell_namespaces, i);
                HSVM_VariableId cell_prefix = HSVM_RecordGetRef(hsvm, el, HSVM_GetColumnId(hsvm, "PREFIX"));
                HSVM_VariableId cell_namespaceuri = HSVM_RecordGetRef(hsvm, el, HSVM_GetColumnId(hsvm, "NAMESPACEURI"));

                if(!cell_prefix || HSVM_GetType(hsvm, cell_prefix) != HSVM_VAR_String)
                {
                        HSVM_ReportCustomError(hsvm, "Cell NAMESPACES.PREFIX is not a STRING");
                        return OwnedPtr< xmlXPathObject > (0);
                }
                if(!cell_namespaceuri || HSVM_GetType(hsvm, cell_namespaceuri) != HSVM_VAR_String)
                {
                        HSVM_ReportCustomError(hsvm, "Cell NAMESPACES.NAMESPACEURI is not a STRING");
                        return OwnedPtr< xmlXPathObject > (0);
                }

                xmlXPathRegisterNs(context
                                  ,AsXmlChar(HSVM_StringGetSTD(hsvm, cell_prefix))
                                  ,AsXmlChar(HSVM_StringGetSTD(hsvm, cell_namespaceuri))
                                  );
        }

        return MakeOwnedPtr(xmlXPathEval(AsXmlChar(HSVM_StringGetSTD(hsvm, cell_query)), context));
}

void XMLDoc___C14N2(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_String);

        int mode = HSVM_IntegerGet(hsvm, HSVM_Arg(1));
        bool withcomments = HSVM_BooleanGet(hsvm, HSVM_Arg(3));

        if(!xmlnode->realdoc)
        {
                HSVM_ReportCustomError(hsvm, "Object is not a XML Document");
                return;
        }
        if(mode < 0 || mode > 2)
            mode = 0;

        OwnedPtr< xmlXPathObject > xpathresult = EvaluateXpath(hsvm, xmlnode->realdoc->GetDocPtr(), HSVM_Arg(4));

        std::vector<std::string> inclusive_ns_prefixes_list;
        for(unsigned i=0; i < HSVM_ArrayLength(hsvm, HSVM_Arg(2));++i)
            inclusive_ns_prefixes_list.push_back(HSVM_StringGetSTD(hsvm, HSVM_ArrayGetRef(hsvm, HSVM_Arg(2), i)));

        std::vector<xmlChar*> inclusive_ns_prefixes;
        for(unsigned i=0; i<inclusive_ns_prefixes_list.size(); i++)
            inclusive_ns_prefixes.push_back(const_cast<xmlChar*>(AsXmlChar(inclusive_ns_prefixes_list[i])));
        inclusive_ns_prefixes.push_back(NULL);

        xmlChar *doc_txt_ptr = NULL;
        int byteswritten = xmlC14NDocDumpMemory(xmlnode->realdoc->GetDocPtr(), xpathresult ? xpathresult->nodesetval : 0, mode, &inclusive_ns_prefixes[0], withcomments, &doc_txt_ptr);
        if(byteswritten>0)
            HSVM_StringSet(hsvm, id_set, reinterpret_cast<char*>(doc_txt_ptr), reinterpret_cast<char*>(doc_txt_ptr)+byteswritten);
        xmlFree(doc_txt_ptr);
}


//---------------------------------------------------------------------------
// Node

void XMLNode_GetLinenum(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        if(!xmlnode->node) //broken node
            HSVM_IntegerSet(hsvm, id_set, 0);
        else
            HSVM_IntegerSet(hsvm, id_set, xmlnode->node->type == XML_ATTRIBUTE_NODE ? xmlnode->node->parent->line : xmlnode->node->line);
}

void AppendAttr(HSVM *hsvm, HSVM_VariableId appendto, std::string const &namespaceuri, std::string const &nodename, std::string const &prefix, std::string const &localname, std::string const &nodevalue)
{
        HSVM_VariableId id_row = HSVM_ArrayAppend(hsvm, appendto);
        HSVM_VariableId namespacecell = HSVM_RecordCreate(hsvm, id_row, HSVM_GetColumnId(hsvm, "NAMESPACEURI"));
        HSVM_VariableId nodenamecell = HSVM_RecordCreate(hsvm, id_row, HSVM_GetColumnId(hsvm, "NODENAME"));
        HSVM_VariableId prefixcell = HSVM_RecordCreate(hsvm, id_row, HSVM_GetColumnId(hsvm, "PREFIX"));
        HSVM_VariableId localnamecell = HSVM_RecordCreate(hsvm, id_row, HSVM_GetColumnId(hsvm, "LOCALNAME"));
        HSVM_VariableId nodevaluecell = HSVM_RecordCreate(hsvm, id_row, HSVM_GetColumnId(hsvm, "NODEVALUE"));

        HSVM_StringSetSTD(hsvm, namespacecell, namespaceuri);
        HSVM_StringSetSTD(hsvm, nodenamecell, nodename);
        HSVM_StringSetSTD(hsvm, prefixcell, prefix);
        HSVM_StringSetSTD(hsvm, localnamecell, localname);
        HSVM_StringSetSTD(hsvm, nodevaluecell, nodevalue);
}

void XMLNode_ListAttributes(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_RecordArray);
        if (!xmlnode->node || xmlnode->node->type != XML_ELEMENT_NODE)
            return;

        for (xmlNs* nsattr = xmlnode->node->nsDef; nsattr; nsattr = nsattr->next)
        {
                if(nsattr->prefix)
                    AppendAttr(hsvm, id_set, XML_XMLNS_NAMESPACE, std::string("xmlns:") + AsSTDstring(nsattr->prefix), "xmlns", AsSTDstring(nsattr->prefix), AsSTDstring(nsattr->href));
                else
                    AppendAttr(hsvm, id_set, XML_XMLNS_NAMESPACE, "xmlns", "", "xmlns", AsSTDstring(nsattr->href));
        }
        for (xmlAttrPtr attr = xmlnode->node->properties; attr; attr = attr->next)
        {
                AppendAttr(hsvm, id_set, attr->ns ? AsSTDstring(attr->ns->href) : std::string(), GetNodeName((xmlNode*)attr), attr->ns ? AsSTDstring(attr->ns->prefix) : "", attr->ns ? AsSTDstring(attr->name) : "", GetNodeContent((xmlNode*)attr));
        }
}

void XMLNode___GetNumChildren(HSVM *hsvm, HSVM_VariableId id_set)
{
        unsigned count=0;

        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        if(xmlnode->node)
        {
                for(xmlNode *node = xmlnode->node->children; node; node=node->next)
                    ++count;
        }

        HSVM_IntegerSet(hsvm, id_set, count);
}
void XMLNode___GetChild(HSVM *hsvm, HSVM_VariableId id_set)
{
        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_Object);
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        if(!xmlnode->node)
            return;

        int32_t idx = HSVM_IntegerGet(hsvm, HSVM_Arg(1));
        xmlNode *node = xmlnode->node->children;
        for(; node && idx > 0; --idx)
            node = node->next;

        if(!node)
            return;

        if (!XML_CreateObject(hsvm, (ObjectType)node->type, id_set, xmlnode->realdoc))
            return;

        XMLNodeContext::AutoCreateRef newnode(hsvm, id_set);
        newnode->node = node;
}
void XMLNode___GetChildren(HSVM *hsvm, HSVM_VariableId id_set)
{
        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_ObjectArray);
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        if(!xmlnode->node)
            return;

        bool elementsonly = HSVM_BooleanGet(hsvm, HSVM_Arg(1));
        for(xmlNode *node = xmlnode->node->children; node; node = node->next)
        {
                if(elementsonly && node->type != XML_ELEMENT_NODE)
                    continue;

                HSVM_VariableId newel = HSVM_ArrayAppend(hsvm, id_set);
                if (!XML_CreateObject(hsvm, (ObjectType)node->type, newel, xmlnode->realdoc))
                    return;

                XMLNodeContext::AutoCreateRef newnode(hsvm, newel);
                newnode->node = node;
        }
}

void XMLNode_GetFirstChild(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_Object);
        if(!xmlnode->node || !xmlnode->node->children)
            return;

        if (!XML_CreateObject(hsvm, (ObjectType)xmlnode->node->children->type, id_set, xmlnode->realdoc))
            return;
        XMLNodeContext::AutoCreateRef newnode(hsvm, id_set);
        newnode->node = xmlnode->node->children;
}

void XMLNode_GetLastChild(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_Object);
        if(!xmlnode->node || !xmlnode->node->last)
            return;

        if (!XML_CreateObject(hsvm, (ObjectType)xmlnode->node->last->type, id_set, xmlnode->realdoc))
            return;
        XMLNodeContext::AutoCreateRef newnode(hsvm, id_set);
        newnode->node = xmlnode->node->last;
}

void XMLNode_GetLocalName(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        if(xmlnode->node && xmlnode->node->type == XML_ELEMENT_NODE && xmlnode->node->ns)
            HSVM_StringSetSTD(hsvm, id_set, AsSTDstring(xmlnode->node->name));
       else
            HSVM_SetDefault(hsvm, id_set, HSVM_VAR_String);
}

void XMLNode_GetNamespaceURI(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_String);
        if(xmlnode->node && xmlnode->node->type == XML_ELEMENT_NODE && xmlnode->node->ns)
            HSVM_StringSetSTD(hsvm, id_set, AsSTDstring(xmlnode->node->ns->href));
       else
            HSVM_SetDefault(hsvm, id_set, HSVM_VAR_String);
}

void XMLNode_GetNextSibling(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_Object);
        if (!xmlnode->node || !xmlnode->node->next)
            return;

        if (!XML_CreateObject(hsvm, (ObjectType)xmlnode->node->next->type, id_set, xmlnode->realdoc))
            return;
        XMLNodeContext::AutoCreateRef newnode(hsvm, id_set);
        newnode->node = xmlnode->node->next;
}

void XMLNode_GetNodeName(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        if (!xmlnode->node)
            return;

        HSVM_StringSetSTD(hsvm, id_set, GetNodeName(xmlnode->node));
}

void XMLNode_GetNodeType(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        HSVM_IntegerSet(hsvm, id_set, xmlnode->GetType());
}

void XMLNode_GetNodeValue(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        if (xmlnode->node)
            HSVM_StringSetSTD(hsvm, id_set, GetNodeContent(xmlnode->node));
        else
            HSVM_SetDefault(hsvm, id_set, HSVM_VAR_String);
}
void XMLNode_SetNodeValue(HSVM *hsvm)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        if (IsReadOnlyNode(xmlnode->realdoc, xmlnode->node))
        {
                Xml_ThrowDomException(hsvm, NoModificationAllowedErr, "Trying to update a read-only XML document");
                return;
        }

        std::string txt = HSVM_StringGetSTD(hsvm, HSVM_Arg(1));
        Blex::EnsureValidUTF8(&txt, true);
        xmlNodeSetContent(xmlnode->node, AsXmlChar(txt));
}

void XMLNode_GetOwnerDocument(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_Object);
        if (!xmlnode->realdoc.get() || xmlnode->node->type == XML_DOCUMENT_NODE)
            return;

        //ADDME: Might be wiser to cache this object?
        if (!XML_CreateObject(hsvm, DocumentObject, id_set, xmlnode->realdoc))
            return;

        XMLNodeContext::AutoCreateRef docnode(hsvm, id_set);
        docnode->node = (xmlNode *)xmlnode->realdoc->GetDocPtr();
}

void XMLNode_GetParentNode(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_Object);
        if (!xmlnode->node || !xmlnode->node->parent)
            return;

        if (!XML_CreateObject(hsvm, (ObjectType)xmlnode->node->parent->type, id_set, xmlnode->realdoc))
            return;
        XMLNodeContext::AutoCreateRef newnode(hsvm, id_set);
        newnode->node = xmlnode->node->parent;
}

void XMLNode_GetPrefix(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        if(xmlnode->node && xmlnode->node->type == XML_ELEMENT_NODE && xmlnode->node->ns)
            HSVM_StringSetSTD(hsvm, id_set, AsSTDstring(xmlnode->node->ns->prefix));
       else
            HSVM_SetDefault(hsvm, id_set, HSVM_VAR_String);
}

void XMLNode_SetPrefix(HSVM *hsvm)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        if(!xmlnode->node)
           return;
        if (IsReadOnlyNode(xmlnode->realdoc, xmlnode->node))
        {
                Xml_ThrowDomException(hsvm, NoModificationAllowedErr, "Trying to update a read-only XML document");
                return;
        }

        if (xmlnode->node->type != XML_ELEMENT_NODE || !(xmlnode->node->ns && xmlnode->node->ns->href))
        {
                Xml_ThrowDomException(hsvm, NamespaceErr, "Trying to set a prefix when no namespace URI is specified on this node");
                return;
        }

        xmlNodePtr ns_node = xmlnode->node;

        xmlDocPtr doc = xmlnode->realdoc->GetDocPtr();
        std::string new_prefix = HSVM_StringGetSTD(hsvm, HSVM_Arg(1));

        if (!TestQualifiedName(new_prefix, true))
        {
                if (new_prefix.find(':') != std::string::npos)
                    Xml_ThrowDomException(hsvm, NamespaceErr, "Malformed prefix specified");
                else
                    Xml_ThrowDomException(hsvm, InvalidCharacterErr, "Invalid characters used in element prefix");
                return;
        }
        if (new_prefix == "xml" && xmlStrcmp(xmlnode->node->ns->href, XML_XML_NAMESPACE) != 0)
        {
                Xml_ThrowDomException(hsvm, NamespaceErr, "Using xml prefix without xml namespace");
                return;
        }
        if (new_prefix == "xmlns" && xmlStrcmp(xmlnode->node->ns->href, AsXmlChar(XML_XMLNS_NAMESPACE)) != 0)
        {
                Xml_ThrowDomException(hsvm, NamespaceErr, "Using xmlns prefix without xmlns namespace");
                return;
        }

        // See if we can use an existing declaration.
        /* ADDME: are we supposed to overwrite it, or should we just remove/readd ?
           given: "However, nodes are permanently bound to namespace URIs as they get created "
           directly updating xmlns seems dangerous
         */
        xmlNsPtr nsptr = xmlSearchNs(doc, xmlnode->node, AsXmlChar(new_prefix));
        if (!nsptr || !xmlStrEqual(nsptr->href, xmlnode->node->ns->href))
        {
                // Create a new namespace decl
                nsptr = xmlNewNs(ns_node, xmlnode->node->ns->href, AsXmlChar(new_prefix));
                if (!nsptr)
                {
                        // libxml refused to make the namespace decl... hand insert a new one.
                        nsptr = xmlNewNs(NULL, xmlnode->node->ns->href, AsXmlChar(new_prefix));
                        if(!nsptr)
                        {
                                Xml_ThrowDomException(hsvm, NamespaceErr, "Namespace creation failed");
                                return;
                        }

                        xmlNsPtr *ref = &ns_node->nsDef;
                        while (*ref)
                            ref = &(*ref)->next;
                        *ref = nsptr;
                }
        }
        xmlSetNs(xmlnode->node, nsptr);
}

void XMLNode_GetPreviousSibling(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_Object);
        if (!xmlnode->node || !xmlnode->node->prev  || xmlnode->node->type == XML_ATTRIBUTE_NODE)
            return;

        if (!XML_CreateObject(hsvm, (ObjectType)xmlnode->node->prev->type, id_set, xmlnode->realdoc))
            return;
        XMLNodeContext::AutoCreateRef newnode(hsvm, id_set);
        newnode->node = xmlnode->node->prev;
}

//ADDME: wat gebeurt er als je dit soort functies op attributes e.d. aanroept ?
void XMLNode_AppendChild(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLNode *xmlparent = static_cast<XMLNode*>(HSVM_ObjectContext(hsvm, HSVM_Arg(0), XMLNodeContextId, true));
        XMLNode *xmlchild = static_cast<XMLNode*>(HSVM_ObjectContext(hsvm, HSVM_Arg(1), XMLNodeContextId, true));

        if(!xmlparent->node)
            return;
        if(!xmlchild || !xmlchild->node)
        {
                Xml_ThrowDomException(hsvm, HierarchyRequestErr, "New child is not a node");
                return;

        }

        if (IsReadOnlyNode(xmlparent->realdoc, xmlparent->node))
        {
                Xml_ThrowDomException(hsvm, NoModificationAllowedErr, "Trying to update a read-only XML document");
                return;
        }

        // Test if the child node is an ancestor of the parent node
        xmlNodePtr testnode = xmlparent->node;
        while (testnode)
        {
                if (testnode == xmlchild->node)
                {
                        Xml_ThrowDomException(hsvm, HierarchyRequestErr, "New child node is an ancestor of this node");
                        return;
                }
                testnode = testnode->parent;
        }
        if(xmlparent->realdoc != xmlchild->realdoc)
        {
                Xml_ThrowDomException(hsvm, WrongDocumentErr, "New child node was created in a different document");
                return;
        }

        if (!TestValidChildNode(xmlparent->node, xmlchild->node, 0))
        {
                Xml_ThrowDomException(hsvm, HierarchyRequestErr, "This node does not allow insertion of the new child node");
                return;
        }

        if (xmlchild->node->type == XML_DOCUMENT_FRAG_NODE)
        {
                // Add the child nodes of the document fragment,
                // instead of the doc frag itself
                while (xmlchild->node->children)
                    appendChild(xmlparent->node, xmlchild->node->children);
        }
        else
        {
                appendChild(xmlparent->node, xmlchild->node);
                xmlchild->realdoc->SetIsUnlinkedHead(xmlchild->node, false);
        }

        HSVM_CopyFrom(hsvm, id_set, HSVM_Arg(1));
}

void DebugNsList(xmlNsPtr ns)
{
        for(; ns; ns=ns->next)
            DEBUGPRINT("prefix: " << (ns->prefix ? (const char*)ns->prefix : "") << " = " << (ns->href ? (const char*)ns->href : ""));
}

void XMLNode_CloneNode(HSVM *hsvm, HSVM_VariableId id_set) //FIXME either we fix xmlCopyNode 's odd namespace handling (gnome dom puts new namespaces into oldNs where xmlCopyNode does nsDef which already gave a better emdresult)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_Object);

        if(!xmlnode->node || xmlnode->node->type == XML_DOCUMENT_NODE) //XMLDocument::CloneNode is implemented in harescript so shouldn't get here
            return;

        // Make a copy of the node
        xmlNodePtr clone = xmlCopyNode(xmlnode->node, HSVM_BooleanGet(hsvm, HSVM_Arg(1)) ? 1 : 2);
        if (clone)
        {
                xmlUnlinkNode(clone);
                xmlnode->realdoc->SetIsUnlinkedHead(clone, true);
                if (!XML_CreateObject(hsvm, (ObjectType)clone->type, id_set, xmlnode->realdoc))
                    return;
                XMLNodeContext::AutoCreateRef newnode(hsvm, id_set);
                newnode->node = clone;
        }
}

void XMLNode_HasAttributes(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        HSVM_BooleanSet(hsvm, id_set, xmlnode->node && (xmlnode->node->properties != NULL || xmlnode->node->nsDef != NULL));
}

void XMLNode_InsertBefore(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_Object);
        if(!xmlnode->node)
            return;

        if (IsReadOnlyNode(xmlnode->realdoc, xmlnode->node))
        {
                Xml_ThrowDomException(hsvm, NoModificationAllowedErr, "Trying to update a read-only XML document");
                return;
        }

        XMLNode *xmlchild = static_cast<XMLNode*>(HSVM_ObjectContext(hsvm, HSVM_Arg(1), XMLNodeContextId, true));
        if(!xmlchild->node)
        {
                Xml_ThrowDomException(hsvm, HierarchyRequestErr, "New child is not a node");
                return;

        }

        // Test if the child node is an ancestor of the parent node
        xmlNodePtr testnode = xmlnode->node;
        while (testnode)
        {
                if (testnode == xmlchild->node)
                {
                        Xml_ThrowDomException(hsvm, HierarchyRequestErr, "New child node is an ancestor of this node");
                        return;
                }
                testnode = testnode->parent;
        }
        if(xmlnode->realdoc != xmlchild->realdoc)
        {
                Xml_ThrowDomException(hsvm, WrongDocumentErr, "New child node was created in a different document");
                return;
        }

        if (!TestValidChildNode(xmlnode->node, xmlchild->node, 0))
        {
                Xml_ThrowDomException(hsvm, HierarchyRequestErr, "This node does not allow insertion of the new child node");
                return;
        }

        // By passing a default object as reference child, the new node is appended
        // as a child
        if (HSVM_ObjectExists(hsvm, HSVM_Arg(2)))
        {
                XMLNodeContext::Ref xmlref(hsvm, HSVM_Arg(2));
                if(!xmlref->node)
                    return;

                if (xmlref->node->parent != xmlnode->node)
                {
                        Xml_ThrowDomException(hsvm, NotFoundErr, "Reference node is not a child of this node");
                        return;
                }

                if (xmlchild->node->type == XML_DOCUMENT_FRAG_NODE)
                {
                        xmlNodePtr insertbefore = xmlref->node;
                        while (xmlchild->node->last)
                            insertbefore = addPrevSibling(insertbefore, xmlchild->node->last);
                }
                else
                {
                        addPrevSibling(xmlref->node, xmlchild->node);
                        xmlchild->realdoc->SetIsUnlinkedHead(xmlchild->node, false);
                }

                HSVM_CopyFrom(hsvm, id_set, HSVM_Arg(1));
        }
        else
        {
                // Just call append child with arguments xmlnode and xmlchild
                XMLNode_AppendChild(hsvm, id_set);
        }
}

void XMLNode_Normalize(HSVM *hsvm)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        if(!xmlnode->node)
            return;
        if (IsReadOnlyNode(xmlnode->realdoc, xmlnode->node))
        {
                Xml_ThrowDomException(hsvm, NoModificationAllowedErr, "Trying to update a read-only XML document");
                return;
        }
        NormalizeNode(xmlnode->realdoc.get(), xmlnode->node);
}

void XMLNode_RemoveChild(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        XMLNodeContext::Ref xmlchild(hsvm, HSVM_Arg(1));
        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_Object);
        if (!xmlnode->node || !xmlchild)
            return;
        if (IsReadOnlyNode(xmlnode->realdoc, xmlnode->node))
        {
                Xml_ThrowDomException(hsvm, NoModificationAllowedErr, "Trying to update a read-only XML document");
                return;
        }

        // Check if we are deleting a child node from the parent node
        if (xmlchild->node && xmlchild->node->parent == xmlnode->node)
        {
                xmlUnlinkNode(xmlchild->node);
                xmlnode->realdoc->SetIsUnlinkedHead(xmlchild->node, true);
                HSVM_CopyFrom(hsvm, id_set, HSVM_Arg(1));
        }
        else
        {
                Xml_ThrowDomException(hsvm, NotFoundErr, "Node to remove is not a child of this node");
                return;
        }
}

void XMLNode_ReplaceChild(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        XMLNode *xmlchild = static_cast<XMLNode*>(HSVM_ObjectContext(hsvm, HSVM_Arg(1), XMLNodeContextId, true));
        XMLNode *xmlold = static_cast<XMLNode*>(HSVM_ObjectContext(hsvm, HSVM_Arg(2), XMLNodeContextId, true));
        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_Object);
        if (!xmlnode->node)
            return;
        if (!xmlchild || !xmlchild->node || !xmlold || !xmlold->node)
        {
                Xml_ThrowDomException(hsvm, HierarchyRequestErr, "New or old is not a node");
                return;

        }
        if (IsReadOnlyNode(xmlnode->realdoc, xmlnode->node))
        {
                Xml_ThrowDomException(hsvm, NoModificationAllowedErr, "Trying to update a read-only XML document");
                return;
        }

        // Test if the child node is an ancestor of the parent node
        xmlNodePtr testnode = xmlnode->node;
        while (testnode)
        {
                if (testnode == xmlchild->node)
                {
                        Xml_ThrowDomException(hsvm, HierarchyRequestErr, "New child node is an ancestor of this node");
                        return;
                }
                testnode = testnode->parent;
        }
        if(xmlnode->realdoc != xmlchild->realdoc)
        {
                Xml_ThrowDomException(hsvm, WrongDocumentErr, "New child node was created in a different document");
                return;
        }

        if (!TestValidChildNode(xmlnode->node, xmlchild->node, xmlold->node))
        {
                Xml_ThrowDomException(hsvm, HierarchyRequestErr, "This node does not allow insertion of the new child node");
                return;
        }

        // Check if we are replacing a child node from the parent node
        if (xmlold->node->parent != xmlnode->node)
        {
                Xml_ThrowDomException(hsvm, NotFoundErr, "Node to replace is not a child of this node");
                return;
        }

        if (xmlchild->node->type == XML_DOCUMENT_FRAG_NODE)
        {
                // Add the child nodes of the document fragment, instead
                // of the doc frag itself
                xmlNodePtr insertafter = xmlold->node;

                while (xmlchild->node->children)
                    insertafter = addNextSibling(insertafter, xmlchild->node->children);

                xmlUnlinkNode(xmlold->node);
                xmlnode->realdoc->SetIsUnlinkedHead(xmlold->node, true);
        }
        else
        {
                xmlold->node = xmlReplaceNode(xmlold->node, xmlchild->node);

                if (xmlchild->node != xmlold->node)
                {
                        xmlnode->realdoc->SetIsUnlinkedHead(xmlold->node, true);
                        xmlchild->realdoc->SetIsUnlinkedHead(xmlchild->node, false);
                }
        }
        //xmlReconciliateNs(xmlnode->realdoc->doc, xmlnode->node);
        HSVM_CopyFrom(hsvm, id_set, HSVM_Arg(2));
}

void XMLNode_IsSameNode(HSVM *hsvm, HSVM_VariableId id_set)
{
        if (!XMLNodeContext::HasContext(hsvm, HSVM_Arg(0)) || !XMLNodeContext::HasContext(hsvm, HSVM_Arg(1)))
            HSVM_BooleanSet(hsvm, id_set, false);
        else
        {
                XMLNodeContext::Ref xmlnode_1(hsvm, HSVM_Arg(0));
                XMLNodeContext::Ref xmlnode_2(hsvm, HSVM_Arg(1));

                HSVM_BooleanSet(hsvm, id_set, xmlnode_1->node && xmlnode_1->node == xmlnode_2->node);
        }
}

void XMLNode_GetNodeId(HSVM *hsvm, HSVM_VariableId id_set)
{
        if (!XMLNodeContext::HasContext(hsvm, HSVM_Arg(0)))
            HSVM_Integer64Set(hsvm, id_set, uint64_t(0));
        else
        {
                XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));

                // nsdef nodes also have 'node' ptr set. We can use the 'nsdef' ptr then, it is specific to this node
                HSVM_Integer64Set(hsvm, id_set, uint64_t(xmlnode->node));
        }
}

void XMLNodeOrNs::Unlink(XMLContextReadData *realdoc)
{
        if(nsdef)
            XMLUnlinkNS(node, nsdef);
        else if(node)
        {
                xmlUnlinkNode(node);
                realdoc->SetIsUnlinkedHead(node, true);
        }
}

//---------------------------------------------------------------------------
// Document type
void XMLDocumentType_GetName(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_String);
        xmlDtdPtr dtd = xmlGetIntSubset(xmlnode->realdoc->GetDocPtr());
        if(!dtd || !dtd->name)
            return;

        HSVM_StringSetSTD(hsvm, id_set, AsSTDstring(dtd->name));
}

void XMLDocumentType_GetPublicId(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_String);
        xmlDtdPtr dtd = xmlGetIntSubset(xmlnode->realdoc->GetDocPtr());
        if(!dtd || !dtd->ExternalID)
            return;

        HSVM_StringSetSTD(hsvm, id_set, AsSTDstring(dtd->ExternalID));
}

void XMLDocumentType_GetSystemId(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_String);
        xmlDtdPtr dtd = xmlGetIntSubset(xmlnode->realdoc->GetDocPtr());
        if(!dtd || !dtd->SystemID)
            return;

        HSVM_StringSetSTD(hsvm, id_set, AsSTDstring(dtd->SystemID));
}

//---------------------------------------------------------------------------
// Element

void XMLElement_GetName(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        HSVM_StringSetSTD(hsvm, id_set, GetNodeName(xmlnode->node));
}

void XMLElement_GetAttributeNS(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));

        std::string href = HSVM_StringGetSTD(hsvm, HSVM_Arg(1));
        std::string nodename = HSVM_StringGetSTD(hsvm, HSVM_Arg(2));

        XMLNodeOrNs nodeorns = XMLNamedNodeMap_GetNamedItemNSInternal(xmlnode->node, nodename, href);
        if (nodeorns.nsdef)
            HSVM_StringSetSTD(hsvm, id_set, AsSTDstring(nodeorns.nsdef->href));
        else if (nodeorns.node)
            HSVM_StringSetSTD(hsvm, id_set, GetNodeContent(nodeorns.node));
        else
            HSVM_SetDefault(hsvm, id_set, HSVM_VAR_String);
}

void XMLElement_HasAttributeNS(HSVM *hsvm, HSVM_VariableId id_set)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        std::string hrefstr = HSVM_StringGetSTD(hsvm, HSVM_Arg(1));
        std::string localnamestr = HSVM_StringGetSTD(hsvm, HSVM_Arg(2));

        XMLNodeOrNs nodeorns = XMLNamedNodeMap_GetNamedItemNSInternal(xmlnode->node, localnamestr, hrefstr);
        HSVM_BooleanSet(hsvm, id_set, nodeorns.node != 0);
}

void XMLElement_RemoveAttributeNS(HSVM *hsvm)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));

        if (IsReadOnlyNode(xmlnode->realdoc, xmlnode->node))
        {
                Xml_ThrowDomException(hsvm, NoModificationAllowedErr, "Trying to update a read-only XML document");
                return;
        }

        std::string href = HSVM_StringGetSTD(hsvm, HSVM_Arg(1));
        std::string nodename = HSVM_StringGetSTD(hsvm, HSVM_Arg(2));

        XMLNodeOrNs nodeorns = XMLNamedNodeMap_GetNamedItemNSInternal(xmlnode->node, nodename, href);
        nodeorns.Unlink(xmlnode->realdoc.get());
}

void XMLElement_SetAttributeNS(HSVM *hsvm)
{
        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));

        if (IsReadOnlyNode(xmlnode->realdoc, xmlnode->node))
        {
                Xml_ThrowDomException(hsvm, NoModificationAllowedErr, "Trying to update a read-only XML document");
                return;
        }

        std::string nsuri = HSVM_StringGetSTD(hsvm, HSVM_Arg(1));
        std::string name = HSVM_StringGetSTD(hsvm, HSVM_Arg(2));
        std::string value = HSVM_StringGetSTD(hsvm, HSVM_Arg(3));
        QualifiedNamePair qname = SplitQualifiedName(name, NULL);
        Blex::EnsureValidUTF8(&nsuri, true);
        Blex::EnsureValidUTF8(&value, true);

        //DEBUGPRINT("SetAttributeNS nsuri [" << nsuri << "] qname " << qname.first << ":" << qname.second << " value [" << value << "]");

        if ((name == "xmlns" || qname.first == "xmlns") && nsuri != XML_XMLNS_NAMESPACE)
        {
                Xml_ThrowDomException(hsvm, NamespaceErr, "Using xmlns attribute name without xmlns namespace");
                return;
        }

        if (qname.second.empty())
        {
                if (!qname.first.empty())
                    Xml_ThrowDomException(hsvm, NamespaceErr, "Malformed attribute name specified");
                else
                    Xml_ThrowDomException(hsvm, InvalidCharacterErr, "Invalid characters used in attribute name");
                return;
        }

        //No prefix was selected. Do we need one?
        if (nsuri.empty())
        {
                if (!qname.first.empty())
                {
                        Xml_ThrowDomException(hsvm, NamespaceErr, "Prefix specified without a namespace URI");
                        return;
                }

                xmlSetProp(xmlnode->node, AsXmlChar(qname.second), AsXmlChar(value));
                return;
        }

        xmlNsPtr ns(0);

        XMLNodeOrNs existing = XMLNamedNodeMap_GetNamedItemNSInternal(xmlnode->node, qname.second, nsuri);

        if(nsuri == XML_XMLNS_NAMESPACE) //This is a request to create a new namespace
        {
                //ADDME how exactly do deal with overwriting namespaces? As far as I can tell we should rewrite the node and move the old node away
                if(existing.nsdef)
                {
                        DEBUGPRINT("removed existing namespace");
                        existing.Unlink(xmlnode->realdoc.get());
                }

                for(xmlNsPtr ns = xmlnode->node->nsDef; ns; ns = ns->next)
                    DEBUGPRINT("curns prefix: " << (ns->prefix ? (const char*)ns->prefix : "") << " href: " << (const char*)ns->href);

                DEBUGPRINT("newns: qname.first=" << qname.first << ", qname.second=" << qname.second << ", value=" << value);
                xmlNewNs(xmlnode->node, AsXmlChar(value), qname.second == "xmlns" ? NULL : AsXmlChar(qname.second));
                return;
        }

        if (xmlStrcmp(AsXmlChar(nsuri), XML_XML_NAMESPACE) == 0 && qname.first != "xml")
            qname.first = "xml"; //by definition

        // Invent a name for the prefix if not selected yet
        if (qname.first.empty())
        {
                // Is there already a nsdecl for this uri?
                ns = xmlSearchNsByHref(xmlnode->realdoc->GetDocPtr(), xmlnode->node, AsXmlChar(nsuri));
                if (!ns)
                {
                        ns = createUnlinkedNSPtr(xmlnode->node, AsXmlChar(nsuri), nullptr);
                        if(!ns)
                        {
                                Xml_ThrowDomException(hsvm, NamespaceErr, "Namespace creation failed");
                                return;
                        }

                        DEBUGPRINT("Creating namespace [" << nsuri << "] ns " << (void*)ns);
                }
        }
        else
        {
                if (qname.first == "xml" && xmlStrcmp(AsXmlChar(nsuri), XML_XML_NAMESPACE) != 0)
                {
                        Xml_ThrowDomException(hsvm, NamespaceErr, "Using xml prefix without xml namespace");
                        return;
                }

                // Search for the prefix; set one if it ain't there yet (or is bound to a different namespace)
                ns = xmlSearchNs(xmlnode->realdoc->GetDocPtr(), xmlnode->node, AsXmlChar(qname.first));
                DEBUGPRINT("xmlSearchNs lookup of " << qname.first << " found " << (ns ? (const char*)ns->href : "null"));
                if (!ns || xmlStrcmp(AsXmlChar(nsuri), ns->href) != 0)
                {
                        ns = createUnlinkedNSPtr(xmlnode->node, AsXmlChar(nsuri), AsXmlChar(qname.first));
                        if(!ns)
                        {
                                Xml_ThrowDomException(hsvm, NamespaceErr, "Namespace creation failed");
                                return;
                        }
                }
        }

        xmlSetNsProp(xmlnode->node, ns, AsXmlChar(qname.second), AsXmlChar(value));
}

//---------------------------------------------------------------------------
// XPathQuery

void ExecuteXpathQuery(HSVM *hsvm, HSVM_VariableId id_set) //OBJECT doc STRING query, OBJECT node, OBJECT here, RECORD ARRAY namespaces
{
        HSVM_SetDefault(hsvm, id_set, HSVM_VAR_Record);

        XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(0));
        if(!xmlnode)
            return;

        auto xpathctxt = MakeOwnedPtr(xmlXPathNewContext(xmlnode->realdoc->GetDocPtr()));
        Blex::XML::ErrorCatcher errorcatcher;
        xpathctxt->userData = &errorcatcher;
        xpathctxt->error = &HandleXMLError;

        if (HSVM_ObjectExists(hsvm, HSVM_Arg(2)))
        {
                XMLNodeContext::Ref xmlnode(hsvm, HSVM_Arg(2));
                if(!xmlnode)
                    return;
                xpathctxt->node = xmlnode->node;
        }

        if (HSVM_ObjectExists(hsvm, HSVM_Arg(3)))
        {
                XMLNodeContext::Ref here(hsvm, HSVM_Arg(3));
                if(!here)
                    return;

                xpathctxt->here = here->node;
                xpathctxt->xptr = 1;
                xmlXPathRegisterFunc(xpathctxt, (xmlChar *)"here", xmlSecXPathHereFunction);
        }

        unsigned num_namespaces = HSVM_ArrayLength(hsvm, HSVM_Arg(4));
        for(unsigned i = 0; i < num_namespaces; ++i)
        {
                HSVM_VariableId row = HSVM_ArrayGetRef(hsvm, HSVM_Arg(4), i);
                HSVM_VariableId prefixvar = HSVM_RecordGetRef(hsvm, row, HSVM_GetColumnId(hsvm, "PREFIX"));
                HSVM_VariableId namespacevar = HSVM_RecordGetRef(hsvm, row, HSVM_GetColumnId(hsvm, "URI"));
                if(prefixvar && namespacevar)
                        xmlXPathRegisterNs(xpathctxt, AsXmlChar(HSVM_StringGetSTD(hsvm, prefixvar)), AsXmlChar(HSVM_StringGetSTD(hsvm, namespacevar)));
        }

        HSVM_VariableId errorstr = HSVM_RecordCreate(hsvm, id_set, HSVM_GetColumnId(hsvm, "ERRORCODE"));
        HSVM_VariableId nodelistobj = HSVM_RecordCreate(hsvm, id_set, HSVM_GetColumnId(hsvm, "RESULTLIST"));
        HSVM_SetDefault(hsvm, nodelistobj, HSVM_VAR_RecordArray);

        xmlResetError(&xpathctxt->lastError);
        auto xpathnodes = MakeOwnedPtr(xmlXPathEval(AsXmlChar(HSVM_StringGetSTD(hsvm, HSVM_Arg(1))), xpathctxt));
        if(xpathnodes && xpathnodes->nodesetval)
        {
                unsigned numitems = xmlXPathNodeSetGetLength(xpathnodes->nodesetval);
                for(unsigned i=0; i < numitems; ++i)
                {
                        HSVM_VariableId newrow = HSVM_ArrayAppend(hsvm, nodelistobj);
                        HSVM_SetDefault(hsvm, newrow, HSVM_VAR_Record);

                        HSVM_VariableId cell_node     = HSVM_RecordCreate(hsvm, newrow, HSVM_GetColumnId(hsvm, "NODE"));
                        HSVM_VariableId cell_attrns   = HSVM_RecordCreate(hsvm, newrow, HSVM_GetColumnId(hsvm, "ATTRNS"));
                        HSVM_VariableId cell_attrname = HSVM_RecordCreate(hsvm, newrow, HSVM_GetColumnId(hsvm, "ATTRNAME"));

                        HSVM_SetDefault(hsvm, cell_node, HSVM_VAR_Object);
                        HSVM_SetDefault(hsvm, cell_attrns, HSVM_VAR_String);
                        HSVM_SetDefault(hsvm, cell_attrname, HSVM_VAR_String);

                        xmlNodePtr node = xmlXPathNodeSetItem(xpathnodes->nodesetval, (int)i);
                        if(node->type == XML_ATTRIBUTE_NODE)
                        {
                                if(node->ns)
                                    HSVM_StringSetSTD(hsvm, cell_attrns, AsSTDstring(node->ns->href));

                                HSVM_StringSetSTD(hsvm, cell_attrname, AsSTDstring(node->name));
                                node = node->parent; //we store its owner as the parent

                                if(!node)
                                {
                                        Xml_ThrowDomException(hsvm, InvalidCharacterErr, "Attribute has no parent");
                                        return;
                                }
                        }

                        if (!XML_CreateObject(hsvm, (ObjectType)node->type, cell_node, xmlnode->realdoc))
                            return;

                        XMLNodeContext::AutoCreateRef newnode(hsvm, cell_node);
                        newnode->node = node;
                }
        }

        HSVM_IntegerSet(hsvm, errorstr, xpathctxt->lastError.code);
        xmlResetError(&xpathctxt->lastError); //make sure any allocations are freed - FIXME shouldn't this be on the two other return paths? or isn't it really needed?
}


} // End of namespace Xml
} // End of namespace HareScript

//---------------------------------------------------------------------------

extern "C" {

int contexts = 0;

static void* CreateNodeObject(void *)
{
        return new HareScript::Xml::XMLNode;
}
static void DestroyNodeObject(void*, void *context_ptr)
{
        delete static_cast<HareScript::Xml::XMLNode*>(context_ptr);
}

static void* CreateXMLNodeCreateContext(void *)
{
        return new HareScript::Xml::XMLNodeCreate;
}
static void DestroyXMLNodeCreateContext(void*, void *context_ptr)
{
        delete static_cast<HareScript::Xml::XMLNodeCreate*>(context_ptr);
}

int RegisterDomObjectFunctions(HSVM_RegData *regdata)
{
        HSVM_RegisterFunction(regdata, "XMLDOMIMPLEMENTATION#CREATEDOCUMENT:WH_XML:O:OSSO", HareScript::Xml::XMLDOMImplementation_CreateDocument);
        HSVM_RegisterFunction(regdata, "__MAKEXMLDOCUMENT:WH_XML:O:XSB", HareScript::Xml::XMLDOMImplementation_MakeDocument);
        HSVM_RegisterFunction(regdata, "XMLDOMIMPLEMENTATION#__MAKEXMLSCHEMA:WH_XML:O:OXSB", HareScript::Xml::XMLDOMImplementation_MakeXMLSchema);
        HSVM_RegisterFunction(regdata, "__MAKEXMLDOCUMENTFROMHTML:WH_XML:O:XSBB", HareScript::Xml::XMLDOMImplementation_MakeHTMLDocument);
        HSVM_RegisterFunction(regdata, "XMLDOMIMPLEMENTATION#__MAKESCHEMATRONSCHEMA:WH_XML:O:OXSB", HareScript::Xml::XMLDOMImplementation_MakeSchematronSchema);

        HSVM_RegisterFunction(regdata, "XMLSCHEMA#FINDELEMENTBYNAME:WH_XML:O:OS", HareScript::Xml::XMLSchema_FindElementByName);
        HSVM_RegisterFunction(regdata, "XMLSCHEMA#FINDTYPEBYNAME:WH_XML:O:OS", HareScript::Xml::XMLSchema_FindTypeByName);
        HSVM_RegisterFunction(regdata, "XMLSCHEMA#__VALIDATEDOCUMENT:WH_XML:RA:OO", HareScript::Xml::XMLSchema_ValidateDocument);

        HSVM_RegisterFunction(regdata, "SCHEMATRONSCHEMA#__VALIDATEDOCUMENT:WH_XML:RA:OO", HareScript::Xml::SchematronSchema_ValidateDocument);

        HSVM_RegisterFunction(regdata, "XMLDOCUMENT#GETDOCUMENTELEMENT:WH_XML:O:O", HareScript::Xml::XMLDoc_GetDocumentElement);
        HSVM_RegisterFunction(regdata, "XMLDOCUMENT#GETREADONLY:WH_XML:B:O", HareScript::Xml::XMLDoc_GetReadOnly);
        HSVM_RegisterFunction(regdata, "XMLDOCUMENT#GETDOCUMENTBLOB:WH_XML:X:OBS", HareScript::Xml::XMLDoc_GetDocumentBlob);
        HSVM_RegisterFunction(regdata, "XMLDOCUMENT#__GETPARSEERRORS:WH_XML:RA:O", HareScript::Xml::XMLDoc_GetParseErrors);
        HSVM_RegisterFunction(regdata, "XMLDOCUMENT#CREATECDATASECTION:WH_XML:O:OS", HareScript::Xml::XMLDoc_CreateCDATASection);
        HSVM_RegisterFunction(regdata, "XMLDOCUMENT#CREATECOMMENT:WH_XML:O:OS", HareScript::Xml::XMLDoc_CreateComment);
        HSVM_RegisterFunction(regdata, "XMLDOCUMENT#CREATEDOCUMENTFRAGMENT:WH_XML:O:O", HareScript::Xml::XMLDoc_CreateDocumentFragment);
        HSVM_RegisterFunction(regdata, "XMLDOCUMENT#CREATEELEMENT:WH_XML:O:OS", HareScript::Xml::XMLDoc_CreateElement);
        HSVM_RegisterFunction(regdata, "XMLDOCUMENT#CREATEELEMENTNS:WH_XML:O:OSS", HareScript::Xml::XMLDoc_CreateElementNS);
        HSVM_RegisterFunction(regdata, "XMLDOCUMENT#CREATEPROCESSINGINSTRUCTION:WH_XML:O:OSS", HareScript::Xml::XMLDoc_CreateProcessingInstruction);
        HSVM_RegisterFunction(regdata, "XMLDOCUMENT#CREATETEXTNODE:WH_XML:O:OS", HareScript::Xml::XMLDoc_CreateTextNode);
        HSVM_RegisterFunction(regdata, "XMLDOCUMENT#__C14N2:WH_XML:S:OISABR", HareScript::Xml::XMLDoc___C14N2);

        HSVM_RegisterFunction(regdata, "XMLNODE#GETLINENUM:WH_XML:I:O", HareScript::Xml::XMLNode_GetLinenum);
        HSVM_RegisterFunction(regdata, "XMLNODE#__GETNUMCHILDREN:WH_XML:I:O", HareScript::Xml::XMLNode___GetNumChildren);
        HSVM_RegisterFunction(regdata, "XMLNODE#__GETCHILD:WH_XML:O:OI", HareScript::Xml::XMLNode___GetChild);
        HSVM_RegisterFunction(regdata, "XMLNODE#__GETCHILDREN:WH_XML:OA:OB", HareScript::Xml::XMLNode___GetChildren);
        HSVM_RegisterFunction(regdata, "XMLNODE#LISTATTRIBUTES:WH_XML:RA:O", HareScript::Xml::XMLNode_ListAttributes);
        HSVM_RegisterFunction(regdata, "XMLNODE#GETFIRSTCHILD:WH_XML:O:O", HareScript::Xml::XMLNode_GetFirstChild);
        HSVM_RegisterFunction(regdata, "XMLNODE#GETLASTCHILD:WH_XML:O:O", HareScript::Xml::XMLNode_GetLastChild);
        HSVM_RegisterFunction(regdata, "XMLNODE#GETLOCALNAME:WH_XML:S:O", HareScript::Xml::XMLNode_GetLocalName);
        HSVM_RegisterFunction(regdata, "XMLNODE#GETNAMESPACEURI:WH_XML:S:O", HareScript::Xml::XMLNode_GetNamespaceURI);
        HSVM_RegisterFunction(regdata, "XMLNODE#GETNEXTSIBLING:WH_XML:O:O", HareScript::Xml::XMLNode_GetNextSibling);
        HSVM_RegisterFunction(regdata, "XMLNODE#GETNODENAME:WH_XML:S:O", HareScript::Xml::XMLNode_GetNodeName);
        HSVM_RegisterFunction(regdata, "XMLNODE#GETNODETYPE:WH_XML:I:O", HareScript::Xml::XMLNode_GetNodeType);
        HSVM_RegisterFunction(regdata, "XMLNODE#GETNODEVALUE:WH_XML:S:O", HareScript::Xml::XMLNode_GetNodeValue);
        HSVM_RegisterMacro   (regdata, "XMLNODE#SETNODEVALUE:WH_XML::OS", HareScript::Xml::XMLNode_SetNodeValue);
        HSVM_RegisterFunction(regdata, "XMLNODE#GETOWNERDOCUMENT:WH_XML:O:O", HareScript::Xml::XMLNode_GetOwnerDocument);
        HSVM_RegisterFunction(regdata, "XMLNODE#GETPARENTNODE:WH_XML:O:O", HareScript::Xml::XMLNode_GetParentNode);
        HSVM_RegisterFunction(regdata, "XMLNODE#GETPREFIX:WH_XML:S:O", HareScript::Xml::XMLNode_GetPrefix);
        HSVM_RegisterMacro   (regdata, "XMLNODE#SETPREFIX:WH_XML::OS", HareScript::Xml::XMLNode_SetPrefix);
        HSVM_RegisterFunction(regdata, "XMLNODE#GETPREVIOUSSIBLING:WH_XML:O:O", HareScript::Xml::XMLNode_GetPreviousSibling);
        HSVM_RegisterFunction(regdata, "XMLNODE#APPENDCHILD:WH_XML:O:OO", HareScript::Xml::XMLNode_AppendChild);
        // HSVM_RegisterFunction(regdata, "XMLNODE#CLONENODE:WH_XML:O:OB", HareScript::Xml::XMLNode_CloneNode); //disabling broken function
        HSVM_RegisterFunction(regdata, "XMLNODE#HASATTRIBUTES:WH_XML:B:O", HareScript::Xml::XMLNode_HasAttributes);
        HSVM_RegisterFunction(regdata, "XMLNODE#INSERTBEFORE:WH_XML:O:OOO", HareScript::Xml::XMLNode_InsertBefore);
        HSVM_RegisterMacro   (regdata, "XMLNODE#NORMALIZE:WH_XML::O", HareScript::Xml::XMLNode_Normalize);
        HSVM_RegisterFunction(regdata, "XMLNODE#REMOVECHILD:WH_XML:O:OO", HareScript::Xml::XMLNode_RemoveChild);
        HSVM_RegisterFunction(regdata, "XMLNODE#REPLACECHILD:WH_XML:O:OOO", HareScript::Xml::XMLNode_ReplaceChild);
        HSVM_RegisterFunction(regdata, "XMLNODE#ISSAMENODE:WH_XML:B:OO", HareScript::Xml::XMLNode_IsSameNode);
        HSVM_RegisterFunction(regdata, "XMLNODE#GETNODEID:WH_XML:6:O", HareScript::Xml::XMLNode_GetNodeId);

        HSVM_RegisterFunction(regdata, "XMLDOCUMENTTYPE#GETNAME:WH_XML:S:O", HareScript::Xml::XMLDocumentType_GetName);
        HSVM_RegisterFunction(regdata, "XMLDOCUMENTTYPE#GETPUBLICID:WH_XML:S:O", HareScript::Xml::XMLDocumentType_GetPublicId);
        HSVM_RegisterFunction(regdata, "XMLDOCUMENTTYPE#GETSYSTEMID:WH_XML:S:O", HareScript::Xml::XMLDocumentType_GetSystemId);

        HSVM_RegisterFunction(regdata, "XMLELEMENT#GETNAME:WH_XML:S:O", HareScript::Xml::XMLElement_GetName);
        HSVM_RegisterFunction(regdata, "XMLELEMENT#GETATTRIBUTENS:WH_XML:S:OSS", HareScript::Xml::XMLElement_GetAttributeNS);
        HSVM_RegisterFunction(regdata, "XMLELEMENT#HASATTRIBUTENS:WH_XML:B:OSS", HareScript::Xml::XMLElement_HasAttributeNS);
        HSVM_RegisterMacro   (regdata, "XMLELEMENT#REMOVEATTRIBUTENS:WH_XML::OSS", HareScript::Xml::XMLElement_RemoveAttributeNS);
        HSVM_RegisterMacro   (regdata, "XMLELEMENT#SETATTRIBUTENS:WH_XML::OSSS", HareScript::Xml::XMLElement_SetAttributeNS);

        HSVM_RegisterFunction(regdata, "__EXECUTEXPATHQUERY:WH_XML:R:OSOORA", HareScript::Xml::ExecuteXpathQuery);

        HareScript::Xml::XMLNodeContext::Register(regdata);

        HSVM_RegisterContext (regdata, HareScript::Xml::XMLNodeCreateContextId, NULL, &CreateXMLNodeCreateContext, &DestroyXMLNodeCreateContext);

        return 1;
}

} //end extern "C"
