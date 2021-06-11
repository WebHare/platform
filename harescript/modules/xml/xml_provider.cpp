//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>

//---------------------------------------------------------------------------
#include "xml_provider.h"
#include <stdarg.h>
#include <libxml/catalog.h>
#include <harescript/vm/hsvm_dllinterface_blex.h>

//ADDME: Merge our common code with blex/xml
#define XML_PARSER_BUFFER_SIZE 8192

//#define TRACECREATION

#if defined(DEBUG) && defined(TRACECREATION)
 #define TC_PRINT(x) DEBUGPRINT(x)
#else
 #define TC_PRINT(x) (void)0
#endif


namespace Blex { namespace XML {
xmlCharEncodingHandlerPtr GetxmlCopyCharEncodingHandler();
XMLError ParsexmlErrorPtr(xmlErrorPtr error);

extern "C"
{
        void HandleXMLError(void * user_data, xmlErrorPtr error);
}

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
        if (schematronschema)
            xmlSchematronFree(schematronschema);
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

xmlSchematronPtr XMLContextReadData::GetSchematronSchemaPtr()
{
        XMLDocRef::Data *data = doc.get();
        if (!data)
           return 0;

        XMLDocRef::Data::LockedSecureData::WriteRef lock(data->sdata);
        return lock->schematronschema;
}

// -----------------------------------------------------------------------------
//
// XMLContextData
//

XMLContextData::XMLContextData()
{
        read_context_id = 0;
        aborted = false;
}

XMLContextData::~XMLContextData()
{
}

/**
 * I/O Callbacks
 */
static int ReadBlob (void *context, char *buffer, int len)
{
        XMLBlobData *blobdata = static_cast<XMLBlobData*>(context);
        XMLContextData &vmcontext = *static_cast<XMLContextData*>(HSVM_GetContext(blobdata->hsvm,ContextId, true));
        if (vmcontext.aborted)
        {
                DEBUGPRINT("Aborted - Not reading blob");
                return 0;
        }
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

void ParseExternalSubset(void */*ctx*/, const xmlChar *DEBUGONLYARG(name), const xmlChar *DEBUGONLYARG(ExternalID), const xmlChar *DEBUGONLYARG(SystemID))
{
        DEBUGONLY(
            DEBUGPRINT("Got external subset '" << (char *)name << "'");
            if (ExternalID)
                DEBUGPRINT("PUBLIC '" << (char *)ExternalID << "'");
            if (SystemID)
                DEBUGPRINT("SYSTEM '" << (char *)SystemID << "'"));
}

namespace
{
inline xmlChar const * AsXmlChar(std::string const &in)
{
        return reinterpret_cast<xmlChar const *>(in.c_str());
}
inline std::string AsSTDstring(xmlChar const *in)
{
        return std::string(reinterpret_cast<char const*>(in));
}
}

xmlDocPtr ParseXMLDocument(XMLBlobData *blobdata, xmlCharEncoding enc)
{
        xmlDocPtr doc = NULL;
//        htmlSAXHandler handler = { NULL };
//        handler.externalSubset = &ParseExternalSubset;

        xmlParserCtxtPtr ctx = xmlCreateIOParserCtxt(NULL/*&handler*/, NULL,
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

        if (!ParseAndValidateXML(xmlblobdata, NULL, enc, readonly))
            return false;

        return true;
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

xmlSchematronPtr XMLContextReadData::ParseAsSchematronValidator(HSVM *vm, HSVM_VariableId domimpl)
{
        XMLDocRef::Data *data = doc.get();
        if (!data)
           return 0;

        {
                XMLDocRef::Data::LockedSecureData::WriteRef lock(data->sdata);
                if (lock->schematronschema)
                    return lock->schematronschema;
        }

        xmlSchematronPtr schematronschema = NULL;
        xmlSchematronParserCtxtPtr stron_ctx = xmlSchematronNewDocParserCtxt(GetDocPtr());
        //xmlSchematronSetValidStructuredErrors(stron_ctx, HareScript::Xml::HandleXMLError, &errorcatcher);
        Blex::XML::PushEntityLoader(std::bind(&XMLContextReadData::GetExternalSchema, this, vm, domimpl, std::placeholders::_1, std::placeholders::_2, std::placeholders::_3));
        schematronschema = xmlSchematronParse(stron_ctx);
        bool error = !Blex::XML::PopEntityLoader();
        xmlSchematronFreeParserCtxt(stron_ctx);

        if (error || !schematronschema)
        {
                xmlSchematronFree(schematronschema);
                return 0;
        }

        {
                XMLDocRef::Data::LockedSecureData::WriteRef lock(data->sdata);
                if (!lock->schematronschema)
                    lock->schematronschema = schematronschema;
                else
                   xmlSchematronFree(schematronschema);
        }
        return schematronschema;
}

bool XMLContextReadData::ParseAndValidateXML(XMLBlobData &xmlblob, XMLBlobData *xsdblob, xmlCharEncoding enc, bool readonly)
{
        // Set error handler
        xmlSetStructuredErrorFunc(&errorcatcher, HareScript::Xml::HandleXMLError);

        // Open and parse XML blob
        doc.reset(ParseXMLDocument(&xmlblob, enc), readonly);

        // Open and parse XSD blob, if any
        xmlSchemaPtr xsdschema = NULL;
        xmlDocPtr xsdfile = NULL;
        xmlSchemaParserCtxtPtr xsd_ctx = NULL;
        if (xsdblob)
        {
                xsdfile = ParseXMLDocument(xsdblob, enc);
                if (xsdfile)
                {
                        xsd_ctx = xmlSchemaNewDocParserCtxt(xsdfile);
                        xmlSchemaSetParserStructuredErrors(xsd_ctx, HareScript::Xml::HandleXMLError, &errorcatcher);
                        xsdschema = xmlSchemaParse(xsd_ctx);
                        xmlSchemaSetParserStructuredErrors(xsd_ctx, NULL, NULL);
                }
        }

        // Reset error handler
        xmlSetStructuredErrorFunc(NULL, NULL);

        if (xsdblob && GetDocPtr())
        {
                if (xsdschema)
                {
                        // Validate the XML file
                        xmlSchemaValidCtxtPtr val_ctx = xmlSchemaNewValidCtxt(xsdschema);
                        xmlSchemaSetValidStructuredErrors(val_ctx, HareScript::Xml::HandleXMLError, &errorcatcher);
                        xmlSchemaValidateDoc(val_ctx, GetDocPtr());
                        xmlSchemaSetValidStructuredErrors(val_ctx, NULL, NULL);
                        xmlSchemaFreeValidCtxt(val_ctx);
                        xmlSchemaFree(xsdschema);
                }
        }

        if(xsdfile)
        {
                xmlSchemaFreeParserCtxt(xsd_ctx);
                xmlFreeDoc(xsdfile);
        }
        return GetDocPtr();
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

int ParseAndValidateXML(XMLContextData &context, XMLBlobData *xmlblob, XMLBlobData *xsdblob, xmlCharEncoding enc, bool readonly)
{
        int result = 0;

        if (!xmlblob)
            return result;

        XMLContextReadDataPtr new_context (new XMLContextReadData);
        if (new_context->ParseAndValidateXML(*xmlblob, xsdblob, enc, readonly))
        {
                context.read_context[++context.read_context_id] = new_context;
                result = context.read_context_id;
        }
        return result;
}


/**
 * SAX Callbacks
 * There is no way of aborting the SAX callback interface within LibXML, so we're
 * using the aborted flag in our XML context to signal errors from HSVM_CallFunctionPtr.
 */
void SaxStartElement(void *user_data, const xmlChar *name, const xmlChar *attrs[])
{
        XMLSaxCallbacks &callbacks = *(XMLSaxCallbacks *)user_data;
        HSVM * vm = callbacks.vm;
        XMLContextData &context = *static_cast<XMLContextData*>(HSVM_GetContext(vm,ContextId, true));
        if (context.aborted)
            return;

        HSVM_OpenFunctionCall(vm, 2);

        // Set element name parameter
        HSVM_VariableId element_name = HSVM_CallParam(vm, 0);
        HSVM_StringSet(vm, element_name, (const char*)name, (const char*)name+strlen((const char*)name));

        // Set attributes parameter
        HSVM_ColumnId field_col = HSVM_GetColumnId(vm, "FIELD");
        HSVM_ColumnId value_col = HSVM_GetColumnId(vm, "VALUE");
        HSVM_VariableId element_attrs = HSVM_CallParam(vm, 1);
        HSVM_SetDefault(vm, element_attrs, HSVM_VAR_RecordArray);
        if (attrs != NULL)
        {
                int i = 0;
                while (attrs[i] != NULL)
                {
                        HSVM_VariableId attr = HSVM_ArrayAppend(vm, element_attrs);
                        HSVM_VariableId cell;

                        // Set field
                        cell = HSVM_RecordCreate(vm, attr, field_col);
                        HSVM_StringSet(vm, cell, (const char*)attrs[i], (const char*)attrs[i]+strlen((const char*)attrs[i]));
                        // Set value
                        ++i;
                        cell = HSVM_RecordCreate(vm, attr, value_col);
                        if (attrs[i] != NULL)
                            HSVM_StringSet(vm, cell, (const char*)attrs[i], (const char*)attrs[i]+strlen((const char*)attrs[i]));
                        else
                            HSVM_StringSet(vm, cell, NULL, NULL);

                        ++i;
                }
        }
        if (HSVM_CallFunctionPtr(vm, callbacks.start_element, true) == 0)
        {
                context.aborted = true;
                return;
        }
        HSVM_CloseFunctionCall(vm);
}

void SaxEndElement(void *user_data, const xmlChar *name)
{
        XMLSaxCallbacks &callbacks = *(XMLSaxCallbacks *)user_data;
        HSVM * vm = callbacks.vm;
        XMLContextData &context = *static_cast<XMLContextData*>(HSVM_GetContext(vm,ContextId, true));
        if (context.aborted)
            return;

        HSVM_OpenFunctionCall(vm, 1);

        // Set element name parameter
        HSVM_VariableId element_name = HSVM_CallParam(vm, 0);
        HSVM_StringSet(vm, element_name, (const char*)name, (const char*)name+strlen((const char*)name));

        if (HSVM_CallFunctionPtr(vm, callbacks.end_element, true) == 0)
        {
                context.aborted = true;
                return;
        }
        HSVM_CloseFunctionCall(vm);
}

void SaxText(void *user_data, const xmlChar *ch, int len)
{
        XMLSaxCallbacks &callbacks = *(XMLSaxCallbacks *)user_data;
        HSVM * vm = callbacks.vm;
        XMLContextData &context = *static_cast<XMLContextData*>(HSVM_GetContext(vm,ContextId, true));
        if (context.aborted)
            return;

        HSVM_OpenFunctionCall(vm, 1);

        // Set text parameter
        HSVM_VariableId text = HSVM_CallParam(vm, 0);
        HSVM_StringSet(vm, text, (const char*)ch, (const char*)ch+len);

        if (HSVM_CallFunctionPtr(vm, callbacks.text_node, true) == 0)
        {
                context.aborted = true;
                return;
        }
        HSVM_CloseFunctionCall(vm);
}

void SaxComment(void *user_data, const xmlChar *value)
{
        XMLSaxCallbacks &callbacks = *(XMLSaxCallbacks *)user_data;
        HSVM * vm = callbacks.vm;
        XMLContextData &context = *static_cast<XMLContextData*>(HSVM_GetContext(vm,ContextId, true));
        if (context.aborted)
            return;

        HSVM_OpenFunctionCall(vm, 1);

        // Set comment text parameter
        HSVM_VariableId comment_text = HSVM_CallParam(vm, 0);
        HSVM_StringSet(vm, comment_text, (const char*)value, (const char*)value+strlen((const char*)value));

        if (HSVM_CallFunctionPtr(vm, callbacks.comment_node, true) == 0)
        {
                context.aborted = true;
                return;
        }
        HSVM_CloseFunctionCall(vm);
}

void SaxError(void * user_data, xmlErrorPtr error)
{
        XMLSaxCallbacks &callbacks = *(XMLSaxCallbacks *)user_data;
        if (!callbacks.error)
            return;

        HSVM * vm = callbacks.vm;
        XMLContextData &context = *static_cast<XMLContextData*>(HSVM_GetContext(vm,ContextId, true));
        if (context.aborted)
            return;

        HSVM_OpenFunctionCall(vm, 1);

        // Set error parameter
        Blex::XML::XMLError err = Blex::XML::ParsexmlErrorPtr(error);
        HSVM_VariableId error_id = HSVM_CallParam(vm, 0);
        HSVM_SetDefault(vm, error_id, HSVM_VAR_Record);
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, error_id, HSVM_GetColumnId(vm, "CODE")), err.code);
        HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, error_id, HSVM_GetColumnId(vm, "LINENUM")), err.line);
        HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, error_id, HSVM_GetColumnId(vm, "MESSAGE")), err.message);

        if (HSVM_CallFunctionPtr(vm, callbacks.error, true) == 0)
        {
                context.aborted = true;
                return;
        }
        HSVM_CloseFunctionCall(vm);
}

void SaxPI(void *user_data, const xmlChar *target, const xmlChar *data)
{
        XMLSaxCallbacks &callbacks = *(XMLSaxCallbacks *)user_data;
        HSVM * vm = callbacks.vm;
        XMLContextData &context = *static_cast<XMLContextData*>(HSVM_GetContext(vm,ContextId, true));
        if (context.aborted)
            return;

        HSVM_OpenFunctionCall(vm, 2);

        // Set text parameter
        HSVM_StringSet(vm, HSVM_CallParam(vm, 0), (const char*)target, (const char*)target + strlen((const char*)target));
        HSVM_StringSet(vm, HSVM_CallParam(vm, 1), (const char*)data, (const char*)data + strlen((const char*)data));

        if (HSVM_CallFunctionPtr(vm, callbacks.pi_node, true) == 0)
        {
                context.aborted = true;
                return;
        }
        HSVM_CloseFunctionCall(vm);
}


/**
 * Read a record with callback cells and add callbacks to the SAX handler
 */
void ReadCallbacksRecord(HSVM *hsvm, HSVM_VariableId callback_rec, xmlSAXHandler *handler, XMLSaxCallbacks *callbacks)
{
        if (HSVM_RecordExists(hsvm, callback_rec))
        {
                HSVM_VariableId callback;

                // start_element
                callback = HSVM_RecordGetRef(hsvm, callback_rec, HSVM_GetColumnId(hsvm, "START_ELEMENT"));
                if (callback && HSVM_GetType(hsvm, callback) == HSVM_VAR_FunctionPtr)
                {
                        handler->startElement = &SaxStartElement;
                        callbacks->start_element = callback;
                }

                // end_element
                callback = HSVM_RecordGetRef(hsvm, callback_rec, HSVM_GetColumnId(hsvm, "END_ELEMENT"));
                if (callback && HSVM_GetType(hsvm, callback) == HSVM_VAR_FunctionPtr)
                {
                        handler->endElement = &SaxEndElement;
                        callbacks->end_element = callback;
                }

                // text_node
                callback = HSVM_RecordGetRef(hsvm, callback_rec, HSVM_GetColumnId(hsvm, "TEXT_NODE"));
                if (callback && HSVM_GetType(hsvm, callback) == HSVM_VAR_FunctionPtr)
                {
                        handler->characters = &SaxText;
                        callbacks->text_node = callback;
                }

                // comment_node
                callback = HSVM_RecordGetRef(hsvm, callback_rec, HSVM_GetColumnId(hsvm, "COMMENT_NODE"));
                if (callback && HSVM_GetType(hsvm, callback) == HSVM_VAR_FunctionPtr)
                {
                        handler->comment = &SaxComment;
                        callbacks->comment_node = callback;
                }

                // error
                callback = HSVM_RecordGetRef(hsvm, callback_rec, HSVM_GetColumnId(hsvm, "ERROR"));
                if (callback && HSVM_GetType(hsvm, callback) == HSVM_VAR_FunctionPtr)
                {
                        // Because the direct error callback (handler->serror) does
                        // not seem to work, we'll handle error using the global
                        // error handler, which receives the handler struct and
                        // calls the callback function
                        callbacks->error = callback;
                }

                // pi_node
                callback = HSVM_RecordGetRef(hsvm, callback_rec, HSVM_GetColumnId(hsvm, "PI_NODE"));
                if (callback && HSVM_GetType(hsvm, callback) == HSVM_VAR_FunctionPtr)
                {
                        handler->processingInstruction = &SaxPI;
                        callbacks->pi_node = callback;
                }

        }
}

void ParseHTMLAsXMLWithCallbacks(HSVM *hsvm)
{
        // Construct a default handler (no callbacks)
        htmlSAXHandler handler;
        handler.externalSubset = &ParseExternalSubset;
        memset(&handler, 0, sizeof(handler));

        // Read callbacks record and set the corresponding callbacks
        XMLSaxCallbacks callbacks;
        callbacks.vm = hsvm;
        HSVM_VariableId callback_rec = HSVM_Arg(1);
        ReadCallbacksRecord(hsvm, callback_rec, &handler, &callbacks);

        // Get encoding
        xmlCharEncoding enc = GetEncoding(HSVM_StringGetSTD(hsvm, HSVM_Arg(2)));

        // First chunk of HTML data, used to strip off BOM (ADDME: In this case, you can force the encoding to UTF-8?)
        int blobid = HSVM_BlobOpen(hsvm, HSVM_Arg(0));
        char buffer[XML_PARSER_BUFFER_SIZE];
        std::size_t len = HSVM_BlobRead(hsvm, blobid, sizeof buffer, buffer);

        // Force UTF-8 if we encounter a BOM
        if (len > 2 && buffer[0] == (char)0xEF && buffer[1] == (char)0xBB && buffer[2] == (char)0xBF)
            enc = XML_CHAR_ENCODING_UTF8;

        LibXMLBugWorkAround(buffer, &len);

        // Open and parse blob
        xmlSetStructuredErrorFunc((void *)&callbacks, HareScript::Xml::SaxError);
        htmlParserCtxtPtr ctx = htmlCreatePushParserCtxt(&handler, (void *)&callbacks,
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

                htmlCtxtUseOptions(ctx, HTML_PARSE_RECOVER | HTML_PARSE_NODEFDTD | XML_PARSE_NOERROR | XML_PARSE_NOWARNING | XML_PARSE_NONET | XML_PARSE_NODICT);

                while(len > 0)
                {
                        len = HSVM_BlobRead(hsvm, blobid, sizeof buffer, buffer);
                        htmlParseChunk(ctx, buffer, len, (len == 0));
                }
                htmlFreeParserCtxt(ctx);
                HSVM_BlobClose(hsvm, blobid);

                XMLContextData &context = *static_cast<XMLContextData*>(HSVM_GetContext(hsvm,ContextId, true));
                if (context.aborted)
                    context.aborted = !HSVM_IsUnwinding(hsvm);
        }
        xmlSetStructuredErrorFunc(NULL, NULL);
}

/**
 * Parse an XML file using the SAX (callback) interface. The user provides
 * callbacks for certain events, such as start of elements or text.
 */
void ParseXMLWithCallbacks(HSVM *hsvm)
{
        // Construct a default handler (no callbacks)
        xmlSAXHandler handler;
        memset(&handler, 0, sizeof(handler));

        // Read callbacks record and set the corresponding callbacks
        XMLSaxCallbacks callbacks;
        callbacks.vm = hsvm;
        HSVM_VariableId callback_rec = HSVM_Arg(1);
        ReadCallbacksRecord(hsvm, callback_rec, &handler, &callbacks);

        // Get encoding
        xmlCharEncoding enc = GetEncoding(HSVM_StringGetSTD(hsvm, HSVM_Arg(2)));

        // Open and parse blob
        int blobid = HSVM_BlobOpen(hsvm, HSVM_Arg(0));
        XMLBlobData blobdata(hsvm, blobid);
        xmlSetStructuredErrorFunc((void *)&callbacks, HareScript::Xml::SaxError);
        xmlParserCtxtPtr ctx = xmlCreateIOParserCtxt(&handler, (void *)&callbacks,
                                                     &ReadBlob, &CloseBlob, &blobdata,
                                                     XML_CHAR_ENCODING_NONE); // We'll switch to the correct encoding later

        if (ctx)
        {
                if (enc != XML_CHAR_ENCODING_NONE)
                    xmlSwitchEncoding(ctx, enc);

                xmlCtxtUseOptions(ctx, XML_PARSE_NOERROR | XML_PARSE_NOWARNING | XML_PARSE_NONET | XML_PARSE_NODICT);

                xmlParseDocument(ctx);
                xmlFreeParserCtxt(ctx);

                XMLContextData &context = *static_cast<XMLContextData*>(HSVM_GetContext(hsvm,ContextId, true));
                if (context.aborted)
                    context.aborted = !HSVM_IsUnwinding(hsvm);
        }
        xmlSetStructuredErrorFunc(NULL, NULL);
}

} // End of namespace Xml
} // End of namespace HareScript

//---------------------------------------------------------------------------

extern "C" {

static void* CreateContext(void *)
{
        return new HareScript::Xml::XMLContextData;
}
static void DestroyContext(void*, void *context_ptr)
{
        delete static_cast<HareScript::Xml::XMLContextData*>(context_ptr);
}

// Just copy input characters to output (no character conversion)
int xmlCharCopyFunc(unsigned char *out, int *outlen,
                    const unsigned char *in, int *inlen)
{
        int n = std::min(*outlen, *inlen);
        for (int i = 0; i < n; ++i)
            out[i] = in[i];
        *inlen = *outlen = n;
        return n;
}

// Function which register DOM-object-specific functions and contexts (implemented
// in xml_domobjects.cpp)
int RegisterDomObjectFunctions(HSVM_RegData *regdata);

BLEXLIB_PUBLIC int HSVM_ModuleEntryPoint(HSVM_RegData *regdata,void*)
{
        Blex::XML::SetCatalogBase( Blex::MergePath(HSVM_GetResourcesPath(regdata),"xml") );

        HSVM_RegisterMacro   (regdata, "__PARSEXMLWITHCALLBACKS:WH_XML::XRS", HareScript::Xml::ParseXMLWithCallbacks);
        HSVM_RegisterMacro   (regdata, "__PARSEHTMLASXMLWITHCALLBACKS:WH_XML::XRS", HareScript::Xml::ParseHTMLAsXMLWithCallbacks);

        // Register contexts
        HSVM_RegisterContext (regdata, HareScript::Xml::ContextId, NULL, &CreateContext, &DestroyContext);

        // Register DOM object functions and contexts
        if (!RegisterDomObjectFunctions(regdata))
            return 0;

        return 1;
}

} //end extern "C"
