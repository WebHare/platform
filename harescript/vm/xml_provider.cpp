//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>

//---------------------------------------------------------------------------
#include "xml_provider.h"
#include <harescript/vm/hsvm_dllinterface_blex.h>

//ADDME: Merge our common code with blex/xml
#define XML_PARSER_BUFFER_SIZE 8192

//#define TRACECREATION

#if defined(WHBUILD_DEBUG) && defined(TRACECREATION)
 #define TC_PRINT(x) DEBUGPRINT(x)
#else
 #define TC_PRINT(x) (void)0
#endif


namespace Blex { namespace XML {
xmlCharEncodingHandlerPtr GetxmlCopyCharEncodingHandler();
} } //end blex::xml

namespace HareScript
{
namespace Xml
{

xmlCharEncoding GetEncoding(std::string encoding)
{
        xmlCharEncoding enc = XML_CHAR_ENCODING_NONE;
        Blex::ToUppercase(encoding.begin(), encoding.end());

             if (encoding == "UTF-8")       enc = XML_CHAR_ENCODING_UTF8;
        else if (encoding == "UTF-16-LE")   enc = XML_CHAR_ENCODING_UTF16LE;
        else if (encoding == "UTF-16-BE")   enc = XML_CHAR_ENCODING_UTF16BE;
        else if (encoding == "UCS-4-LE")    enc = XML_CHAR_ENCODING_UCS4LE;
        else if (encoding == "UCS-4-BE")    enc = XML_CHAR_ENCODING_UCS4BE;
//        else if (encoding == "EBCDIC")      enc = XML_CHAR_ENCODING_EBCDIC;
        else if (encoding == "UCS-4-2143")  enc = XML_CHAR_ENCODING_UCS4_2143;
        else if (encoding == "UCS-4-3412")  enc = XML_CHAR_ENCODING_UCS4_3412;
        else if (encoding == "UCS-2")       enc = XML_CHAR_ENCODING_UCS2;
        else if (encoding == "ISO-8859-1"
              || encoding == "LATIN-1")     enc = XML_CHAR_ENCODING_8859_1;
        else if (encoding == "ISO-8859-2"
              || encoding == "LATIN-2")     enc = XML_CHAR_ENCODING_8859_2;
        else if (encoding == "ISO-8859-3")  enc = XML_CHAR_ENCODING_8859_3;
        else if (encoding == "ISO-8859-4")  enc = XML_CHAR_ENCODING_8859_4;
        else if (encoding == "ISO-8859-5")  enc = XML_CHAR_ENCODING_8859_5;
        else if (encoding == "ISO-8859-6")  enc = XML_CHAR_ENCODING_8859_6;
        else if (encoding == "ISO-8859-7")  enc = XML_CHAR_ENCODING_8859_7;
        else if (encoding == "ISO-8859-8")  enc = XML_CHAR_ENCODING_8859_8;
        else if (encoding == "ISO-8859-9")  enc = XML_CHAR_ENCODING_8859_9;
        else if (encoding == "ISO-2022-JP") enc = XML_CHAR_ENCODING_2022_JP;
        else if (encoding == "SHIFT-JIS")   enc = XML_CHAR_ENCODING_SHIFT_JIS;
        else if (encoding == "EUC-JP")      enc = XML_CHAR_ENCODING_EUC_JP;
        else if (encoding == "ASCII")       enc = XML_CHAR_ENCODING_ASCII;

        return enc;
}

// ADDME duplicate with Node::GetNodeName in libblex
std::string GetNodeName(xmlNodePtr node)
{
        std::string nodename;
        switch (node->type)
        {
                // node names as defined in
                // http://www.w3.org/TR/DOM-Level-2-Core/core.html#ID-1841493061
                case XML_TEXT_NODE:
                    nodename = "#text";
                    break;
                case XML_CDATA_SECTION_NODE:
                    nodename = "#cdata-section";
                    break;
                case XML_COMMENT_NODE:
                    nodename = "#comment";
                    break;
                case XML_DOCUMENT_NODE:
                    nodename = "#document";
                    break;
                case XML_DOCUMENT_FRAG_NODE:
                    nodename = "#document-fragment";
                    break;
                case XML_ATTRIBUTE_NODE:
                case XML_ELEMENT_NODE:
                    if (node->ns && node->ns->prefix && xmlStrlen(node->ns->prefix) > 0)
                    {
                            nodename.assign((char *)node->ns->prefix);
                            nodename += ":";
                    }
                    if (node->name)
                        nodename += (char *)node->name;
                    break;
                default:
                    if (node->name)
                        nodename.assign((char *)node->name);
                    break;
        }
        return nodename;
}

std::string GetNodeContent(xmlNodePtr node)
{
        xmlChar *content = NULL;
        bool should_free = false;
        switch (node->type)
        {
                case XML_ATTRIBUTE_NODE:
                    content = xmlNodeListGetString(node->doc, node->children, 1);
                    should_free = true;
                    break;
                case XML_TEXT_NODE:
                case XML_CDATA_SECTION_NODE:
                case XML_PI_NODE:
                case XML_COMMENT_NODE:
                    content = node->content;
                    break;
                default: ;
        }
        std::string nodevalue;
        if (content)
        {
                nodevalue.assign((char *)content);
                if (should_free)
                    xmlFree(content);
        }
        return nodevalue;
}

// -----------------------------------------------------------------------------
//
// XMLDocRef
//

XMLDocRef::XMLDocRef(XMLDocRef const &rhs)
: data(rhs.data)
{
        if (data)
            ++Data::LockedSecureData::WriteRef(data->sdata)->refcount;
}

XMLDocRef::XMLDocRef(xmlDocPtr _doc, bool _readonly)
{
        if (_doc)
            data = new Data(_doc, _readonly);
        else
            data = 0;
}

XMLDocRef::~XMLDocRef()
{
        if (data && --Data::LockedSecureData::WriteRef(data->sdata)->refcount == 0)
            delete data;
}

XMLDocRef::Data::Data(xmlDocPtr _doc, bool _readonly)
: readonly(_readonly)
, doc(_doc)
{
        TC_PRINT("xml new document " << doc);
}

XMLDocRef::Data::~Data()
{
        if (doc)
        {
                for (auto itr: unlinkedheads)
                    xmlFreeNode(itr);

                xmlFreeDoc(doc);
                TC_PRINT("xmlFreeDoc " << doc);
        }
}

XMLDocRef::Data::SecureData::~SecureData()
{
        if (schema)
            xmlSchemaFree(schema);
}

// -----------------------------------------------------------------------------
//
// XMLContextReadData
//

//Create a new XML parsing context
XMLContextReadData::XMLContextReadData()
{
        TC_PRINT("Create XMLContextReadData " << this);
//        readonly = false;

        from_html = false;

        // Add the default xml: namespace to the context (we're adding it here, so
        // it can be overridden by using AddXPathNamespace)
        xpath_namespaces["http://www.w3.org/XML/1998/namespace"] = "xml";
}

//Destruct a XML parsing context. Free all memory
XMLContextReadData::~XMLContextReadData()
{
        TC_PRINT("Destroying XMLContextReadData " << this);
}

xmlSchemaPtr XMLContextReadData::GetSchemaPtr()
{
        XMLDocRef::Data *data = doc.get();
        if (!data)
           return 0;

        XMLDocRef::Data::LockedSecureData::WriteRef lock(data->sdata);
        return lock->schema;
}

/**
 * I/O Callbacks
 */
static int ReadBlob (void *context, char *buffer, int len)
{
        XMLBlobData *blobdata = static_cast<XMLBlobData*>(context);
//        DEBUGPRINT("Reading blob");
        return HSVM_BlobRead(blobdata->hsvm, blobdata->blobid, len, buffer);
}

static int CloseBlob (void *context)
{
//        DEBUGPRINT("Closing blob");
        XMLBlobData *blobdata = static_cast<XMLBlobData*>(context);
        HSVM_BlobClose(blobdata->hsvm, blobdata->blobid);
        return 0;
}

void LibXMLBugWorkAround(char *buffer, std::size_t *len)
{
        if(*len == 1)
        {
                // encoding as entity didn't work either
                std::string newbuffer = "&#";
                Blex::EncodeNumber(unsigned(buffer[0]), 10, std::back_inserter(newbuffer));
                newbuffer += ";";

                std::copy(newbuffer.begin(), newbuffer.end(), buffer);
                *len = newbuffer.size();
        }
}

xmlDocPtr ParseXMLDocument(XMLBlobData *blobdata, xmlCharEncoding enc)
{
        xmlDocPtr doc = NULL;
        xmlParserCtxtPtr ctx = xmlCreateIOParserCtxt(NULL, NULL,
                                                     &ReadBlob, &CloseBlob, blobdata,
                                                     XML_CHAR_ENCODING_NONE); // We'll switch to the correct encoding later
        if (ctx)
        {
                TC_PRINT("Got context, READING");

                if (enc != XML_CHAR_ENCODING_NONE)
                {
                        xmlCharEncodingHandlerPtr handler;
                        if (enc == XML_CHAR_ENCODING_UTF8)
                            handler = Blex::XML::GetxmlCopyCharEncodingHandler();
                        else
                            handler = xmlGetCharEncodingHandler(enc);
                        xmlSwitchToEncoding(ctx, handler);
                }

                xmlCtxtUseOptions(ctx, XML_PARSE_NOERROR | XML_PARSE_NOWARNING | XML_PARSE_NONET | XML_PARSE_NODICT);

                xmlParseDocument(ctx);
                doc = ctx->myDoc;
                if(!doc)
                    DEBUGPRINT("who toke my doc?");

                xmlFreeParserCtxt(ctx);
        }
        return doc;
}

bool XMLContextReadData::ParseHTMLBlob(HSVM *hsvm, HSVM_VariableId blob, HSVM_VariableId encoding, bool readonly, bool noimplied)
{
        // Get encoding
        xmlCharEncoding enc = GetEncoding(HSVM_StringGetSTD(hsvm, encoding));

        // First chunk of HTML data, used to strip off BOM (ADDME: In this case, you can force the encoding to UTF-8?)
        int blobid = HSVM_BlobOpen(hsvm, blob);
        char buffer[XML_PARSER_BUFFER_SIZE];
        std::size_t len = HSVM_BlobRead(hsvm, blobid, sizeof buffer, buffer);

        // Force UTF-8 if we encounter a BOM
        if (len > 2 && buffer[0] == (char)0xEF && buffer[1] == (char)0xBB && buffer[2] == (char)0xBF)
            enc = XML_CHAR_ENCODING_UTF8;

        LibXMLBugWorkAround(buffer, &len);

        // Open and parse blob
        xmlSetStructuredErrorFunc(&errorcatcher, HareScript::Xml::HandleXMLError);
        htmlParserCtxtPtr ctx = htmlCreatePushParserCtxt(NULL, NULL,
                                                         buffer, len, NULL,
                                                         XML_CHAR_ENCODING_NONE); // We'll switch to the correct encoding later

        if (ctx)
        {
                if (enc != XML_CHAR_ENCODING_NONE)
                {
                        xmlSwitchEncoding(ctx, enc);
                        if (enc == XML_CHAR_ENCODING_UTF8)
                        {
                                //Hack to prevent libxml from interpreting META tags when we already explicitly indicated the character set
                                if (ctx->input->encoding)
                                    xmlFree((xmlChar *) ctx->input->encoding);
                                ctx->input->encoding = xmlStrdup((xmlChar*)"UTF-8");
                        }
                }

                htmlCtxtUseOptions(ctx, HTML_PARSE_RECOVER | HTML_PARSE_NODEFDTD | XML_PARSE_NOERROR | XML_PARSE_NOWARNING | XML_PARSE_NONET | XML_PARSE_NODICT | (noimplied ? HTML_PARSE_NOIMPLIED : 0));

                while(len > 0)
                {
                        len = HSVM_BlobRead(hsvm, blobid, sizeof buffer, buffer);
                        htmlParseChunk(ctx, buffer, len, (len == 0));
                }

                HSVM_BlobClose(hsvm, blobid);

                doc.reset(ctx->myDoc, readonly);
                htmlFreeParserCtxt(ctx);
        }
        xmlSetStructuredErrorFunc(NULL, NULL);

        if(GetDocPtr())
        {
                from_html = true;
                return true;
        }
        return false;
}

bool XMLContextReadData::ParseXMLBlob(HSVM *hsvm, HSVM_VariableId blob, HSVM_VariableId encoding, bool readonly)
{
        doc.reset(xmlNewDoc(reinterpret_cast<xmlChar const *>("1.0")), readonly);
        int xmlblob = HSVM_BlobOpen(hsvm, blob);
        XMLBlobData xmlblobdata(hsvm, xmlblob);
        xmlCharEncoding enc = GetEncoding(HSVM_StringGetSTD(hsvm, encoding));

        xmlSetStructuredErrorFunc(&errorcatcher, HareScript::Xml::HandleXMLError);
        doc.reset(ParseXMLDocument(&xmlblobdata, enc), readonly);
        xmlSetStructuredErrorFunc(NULL, NULL);
        return GetDocPtr();
}

void XMLContextReadData::GetExternalSchema(HSVM *hsvm, HSVM_VariableId domimpl, const char *URL, const char *ID, Blex::XML::EntityLoader *loader)
{
        HSVM_OpenFunctionCall(hsvm, 3);
        HSVM_CopyFrom(hsvm, HSVM_CallParam(hsvm, 0), domimpl);
        HSVM_StringSetSTD(hsvm, HSVM_CallParam(hsvm, 1), URL ? URL : "");
        HSVM_StringSetSTD(hsvm, HSVM_CallParam(hsvm, 2), ID ? ID : "");
        static const HSVM_VariableType funcargs[3] = { HSVM_VAR_Object, HSVM_VAR_String, HSVM_VAR_String };
        HSVM_VariableId res = HSVM_CallFunction(hsvm, "wh::xml/dom.whlib", "XMLDOMIMPLEMENTATION#__INTERNAL_DOENTITYLOADINTERNAL", HSVM_VAR_Record, 3, funcargs);
        if (!res)
        {
                loader->SetFatalError();
                HSVM_CloseFunctionCall(hsvm);
                return;
        }

        if (HSVM_RecordExists(hsvm, res))
        {
                HSVM_VariableId blobdata = HSVM_RecordGetRef(hsvm, res, HSVM_GetColumnId(hsvm, "DATA"));
                HSVM_VariableId filename = HSVM_RecordGetRef(hsvm, res, HSVM_GetColumnId(hsvm, "FILENAME"));
                if (!blobdata || !filename)
                {
                        HSVM_ReportCustomError(hsvm, "Incorrect return value from XmlDomImplementation::DoEntityLoadInternal");
                        HSVM_CloseFunctionCall(hsvm);
                        return;
                }
                std::unique_ptr< Blex::Stream > stream;
                stream.reset(new HareScript::Interface::InputStream(hsvm, blobdata));

                loader->SetStream(&stream);
                loader->SetPublicFilename(HSVM_StringGetSTD(hsvm, filename));
        }
        HSVM_CloseFunctionCall(hsvm);
}

xmlSchemaPtr XMLContextReadData::ParseAsValidator(HSVM *vm, HSVM_VariableId domimpl)
{
        XMLDocRef::Data *data = doc.get();
        if (!data)
           return 0;

        {
                XMLDocRef::Data::LockedSecureData::WriteRef lock(data->sdata);
                if (lock->schema)
                    return lock->schema;
        }

        xmlSchemaPtr xsdschema = NULL;
        xmlSchemaParserCtxtPtr xsd_ctx = xmlSchemaNewDocParserCtxt(GetDocPtr());
        xmlSchemaSetParserStructuredErrors(xsd_ctx, HareScript::Xml::HandleXMLError, &errorcatcher);
        Blex::XML::PushEntityLoader(std::bind(&XMLContextReadData::GetExternalSchema, this, vm, domimpl, std::placeholders::_1, std::placeholders::_2, std::placeholders::_3));
        xsdschema = xmlSchemaParse(xsd_ctx);
        bool error = !Blex::XML::PopEntityLoader();
        xmlSchemaFreeParserCtxt(xsd_ctx);

        if (error)
        {
                xmlSchemaFree(xsdschema);
                return 0;
        }

        {
                XMLDocRef::Data::LockedSecureData::WriteRef lock(data->sdata);
                if (!lock->schema)
                    lock->schema = xsdschema;
                else
                   xmlSchemaFree(xsdschema);
        }
        return xsdschema;
}

void XMLContextReadData::SetIsUnlinkedHead(xmlNodePtr node, bool unlinked)
{
        if (!doc.get())
            return;

        if (unlinked)
            doc.get()->unlinkedheads.insert(node);
        else
            doc.get()->unlinkedheads.erase(node);
}


} // End of namespace Xml
} // End of namespace HareScript

//---------------------------------------------------------------------------

extern "C" {

// Function which register DOM-object-specific functions and contexts (implemented
// in xml_domobjects.cpp)
int RegisterDomObjectFunctions(HSVM_RegData *regdata);

BLEXLIB_PUBLIC int XMLEntryPoint(HSVM_RegData *regdata,void*)
{
        Blex::XML::SetCatalogBase( Blex::MergePath(HSVM_GetResourcesPath(regdata),"xml") );

        // Register DOM object functions and contexts
        if (!RegisterDomObjectFunctions(regdata))
            return 0;

        return 1;
}

} //end extern "C"
