#include <blex/blexlib.h>

#include "path.h"
#include "xml.h"
#include "stream.h"
#include "logfile.h"
#include "context.h"
#include <libxml/parser.h>
#include <libxml/parserInternals.h>
#include <libxml/xpath.h>
#include <libxml/xpathInternals.h>
#include <libxml/HTMLparser.h>

namespace Blex {
namespace XML {

static xmlCharEncodingHandlerPtr xmlCopyCharEncodingHandler = NULL;
xmlCharEncodingHandlerPtr BLEXLIB_PUBLIC GetxmlCopyCharEncodingHandler() //hack until we have the xml parsers moved to this file
{
        return xmlCopyCharEncodingHandler;
}

class XMLThreadContextData
{
    public:
        XMLThreadContextData() : catcher(0) { }

        ErrorCatcher *catcher;
        std::vector< std::pair< EntityLoaderCallback, bool > > callbacks;
};

typedef Context< XMLThreadContextData, 2, void > XMLThreadContext;

#define XML_PARSER_BUFFER_SIZE 8192

XMLError BLEXLIB_PUBLIC ParsexmlErrorPtr(xmlErrorPtr error)
{
        XMLError err;
        err.code = error->code;
        err.line = error->line;
        if(error->file)
            err.file = error->file;

        if(error->node)
        {
                xmlNodePtr node=static_cast<xmlNodePtr>(error->node);
                if(node->type == XML_ELEMENT_NODE)
                {
                        err.node_localname = reinterpret_cast<const char*>(node->name);
                        if(node->ns && node->ns->href)
                            err.node_ns = reinterpret_cast<const char*>(node->ns->href);
                }
        }

        if (error->message)
        {
                err.message.assign(error->message);
                if (err.message[err.message.size()-1] == '\n')
                    err.message.resize(err.message.size()-1);
        }
        else
        {
                err.message = "libxml #" + Blex::AnyToString(error->code);
        }
        return err;
}


extern "C" {

void BLEXLIB_PUBLIC HandleXMLError(void * user_data, xmlErrorPtr error)
{
        XMLError err = ParsexmlErrorPtr(error);
        DEBUGPRINT("Caught libxml error: " << err.code << " on line " << err.line << ": " << err.message);

        if (user_data)
        {
                ((ErrorCatcher*)user_data)->errors.push_back(err);
        }
}

} //end extern "C"

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

class Node::Detail
{
        public:
        static Node Make(xmlNodePtr node)
        {
                Node retval;
                retval.nodeptr=node;
                return retval;
        }
};

bool Node::IsElement() const
{
        xmlNodePtr node=static_cast<xmlNodePtr>(nodeptr);
        return node->type == XML_ELEMENT_NODE;
}
Node Node::GetFirstChild() const
{
        xmlNodePtr node=static_cast<xmlNodePtr>(nodeptr);
        return Node::Detail::Make(node->children);
}
Node Node::GetNextSibling() const
{
        xmlNodePtr node=static_cast<xmlNodePtr>(nodeptr);
        return Node::Detail::Make(node->next);
}
Node Node::GetParentNode() const
{
        xmlNodePtr node=static_cast<xmlNodePtr>(nodeptr);
        return Node::Detail::Make(node->parent);
}
bool Node::IsInNamespace(Namespace const &ns) const
{
        xmlNodePtr node=static_cast<xmlNodePtr>(nodeptr);
        return node->ns && reinterpret_cast<const char*>(node->ns->href) == ns.GetURI();
}
std::string Node::GetContent() const
{
        xmlNodePtr node=static_cast<xmlNodePtr>(nodeptr);
        xmlChar *content = xmlNodeGetContent(node);
        std::string result(reinterpret_cast<const char*>(content));
        xmlFree(content);
        return result;
}
std::string Node::GetAllChildrenContent() const
{
        xmlNodePtr node=static_cast<xmlNodePtr>(nodeptr);
        //ADDME: Don't call into children of other types
        std::string totalcontent;
        for (xmlNodePtr child = node->children;child!=NULL;child=child->next)
          totalcontent += Node::Detail::Make(child).GetContent();
        return totalcontent;
}

std::string Node::GetLocalName() const
{
        xmlNodePtr node=static_cast<xmlNodePtr>(nodeptr);
        if(node->type != XML_ELEMENT_NODE || !node->ns)
            return std::string();
        else
            return std::string(reinterpret_cast<const char*>(node->name));
}

//FIXME: Should be a live node set (deleted nodes disappear automatically)
std::vector<Blex::XML::Node> Node::GetElementsByTagNameNS(Blex::XML::Namespace const *xml_ns, std::string const &localname) const
{
        std::vector<Blex::XML::Node> nodes;
        GetElementsByTagNameNS_(xml_ns, localname, &nodes);
        return nodes;
}
void Node::GetElementsByTagNameNS_(Blex::XML::Namespace const *xml_ns, std::string const &localname, std::vector<Blex::XML::Node> *out) const
{
        for (Blex::XML::Node itr = GetFirstChild(); itr; itr=itr.GetNextSibling())
        {
                if(itr.IsElement()
                     && (!xml_ns || itr.IsInNamespace(*xml_ns))
                     && (localname.empty() || itr.LocalNameIs(localname)))
                {
                        out->push_back(itr);
                }
                itr.GetElementsByTagNameNS_(xml_ns, localname, out);
        }
}

bool Node::LocalNameIs(const char *checkname) const
{
        xmlNodePtr node=static_cast<xmlNodePtr>(nodeptr);
        if(node->type != XML_ELEMENT_NODE || !node->ns)
            return *checkname==0;
        else
        {
                const char *nodename = reinterpret_cast< const char * >(node->name);
                const char *nodename_end = nodename + strlen(nodename);
                const char *checkname_end = checkname + strlen(checkname);

                return Blex::StrCompare(nodename, nodename_end, checkname, checkname_end) == 0;
        }
}

// ADDME duplicate with GetNodeName in HS xml_provider
std::string Node::GetNodeName() const
{
        xmlNodePtr node=static_cast<xmlNodePtr>(nodeptr);
        switch (node->type)
        {
                case XML_TEXT_NODE:
                    return std::string("#text");
                case XML_CDATA_SECTION_NODE:
                    return std::string("#cdata-section");
                case XML_COMMENT_NODE:
                    return std::string("#comment");
                case XML_DOCUMENT_NODE:
                case XML_HTML_DOCUMENT_NODE:
                case XML_DOCB_DOCUMENT_NODE:
                    return std::string("#document");
                case XML_DOCUMENT_FRAG_NODE:
                    return std::string("#document-fragment");
                case XML_PI_NODE:
                    return std::string("#document-fragment");
                default: ;
                /*ADDME: Any other special node names?
                XML_ELEMENT_NODE = 1
                XML_ATTRIBUTE_NODE = 2
                XML_ENTITY_REF_NODE = 5
                XML_ENTITY_NODE = 6
                XML_DOCUMENT_TYPE_NODE = 10
                XML_NOTATION_NODE = 12
                XML_DTD_NODE = 14
                XML_ELEMENT_DECL = 15
                XML_ATTRIBUTE_DECL = 16
                XML_ENTITY_DECL = 17
                XML_NAMESPACE_DECL = 18
                XML_XINCLUDE_START = 19
                XML_XINCLUDE_END = 20
                */
        }
        if (node->name)
        {
          if(node->ns && node->ns->prefix)
            return std::string( reinterpret_cast<const char*>(node->ns->prefix))
                   + ':'
                   + std::string( reinterpret_cast<const char*>(node->name));
          else
            return reinterpret_cast<const char*>(node->name);
        }
        else
        {
          return std::string();
        }
}

std::string Node::GetAttrNames() const
{
        xmlNodePtr node=static_cast<xmlNodePtr>(nodeptr);

        std::string retval;
        for(xmlAttrPtr attr = node->properties; attr != NULL; attr = attr->next)
          if(attr->name && attr->name)
            retval += std::string(retval.empty() ? "" : ",") + reinterpret_cast<const char*>(attr->name);
        return std::string();
}

bool Node::HasAttr(Namespace const *limit_ns, std::string const &attrname) const
{
        xmlNodePtr node=static_cast<xmlNodePtr>(nodeptr);

        for(xmlAttrPtr attr = node->properties; attr != NULL; attr = attr->next)
          if(attr->name
             && reinterpret_cast<const char*>(attr->name) == attrname
             // Either we're not looking for a specific namespace, or the namespace matches
             && (limit_ns == NULL
                 || (attr->ns!=NULL && reinterpret_cast<const char*>(attr->ns->href) == limit_ns->GetURI()))
             // Either we're looking for a specific namespace, or there is no attribute namespace
             && (limit_ns != NULL || attr->ns==NULL)
             && attr->children
             && attr->children->content)
        {
              return true;
        }

        return false;
}

std::string Node::GetAttr(Namespace const *limit_ns, std::string const &attrname) const
{
        xmlNodePtr node=static_cast<xmlNodePtr>(nodeptr);

        for(xmlAttrPtr attr = node->properties; attr != NULL; attr = attr->next)
          if(attr->name
             && reinterpret_cast<const char*>(attr->name) == attrname
             // Either we're not looking for a specific namespace, or the namespace matches
             && (limit_ns == NULL
                 || (attr->ns!=NULL && reinterpret_cast<const char*>(attr->ns->href) == limit_ns->GetURI()))
             // Either we're looking for a specific namespace, or there is no attribute namespace
             && (limit_ns != NULL || attr->ns==NULL)
             && attr->children
             && attr->children->content)
        {
              return reinterpret_cast<const char*>(attr->children->content);
        }

        return std::string();
}

void Node::ReplaceWithContent(std::string const &newcontent)
{
        xmlNodePtr node=static_cast<xmlNodePtr>(nodeptr);
        xmlNodeSetContent(node, reinterpret_cast<xmlChar const *>(newcontent.c_str()));
}

NodeIterator Node::GetChildNodeIterator(Namespace const *limit_ns) const
{
        xmlNodePtr node=static_cast<xmlNodePtr>(nodeptr);
        return NodeIterator(limit_ns, Node::Detail::Make(node ? node->children : NULL));
}

void NodeIterator::Next()
{
        xmlNodePtr node=static_cast<xmlNodePtr>(cur.nodeptr);
        cur.nodeptr=node->next;
}
void NodeIterator::UntilMatch()
{
        for(;cur.nodeptr;Next())
        {
                if (!cur.IsElement())
                    continue;
                if (limit_ns && !cur.IsInNamespace(*limit_ns))
                    continue;

                return; //match!
        }
}

PathResult::PathResult()
: xpath_object_ptr(NULL)
{
}
PathResult::~PathResult()
{
        xmlXPathObjectPtr obj = static_cast<xmlXPathObjectPtr>(xpath_object_ptr);
        if(obj)
            xmlXPathFreeObject(obj);
}

unsigned PathResult::Size() const
{
        xmlXPathObjectPtr obj = static_cast<xmlXPathObjectPtr>(xpath_object_ptr);
        if (!obj->nodesetval)
            return 0;
        return obj->nodesetval->nodeNr;
}
Node PathResult::operator [](unsigned i) const
{
        xmlXPathObjectPtr obj = static_cast<xmlXPathObjectPtr>(xpath_object_ptr);
        return Node::Detail::Make(obj->nodesetval->nodeTab[i]);
}
Node PathResult::Item(unsigned i) const
{
        if (i >= Size())
            return Node();

        return (*this)[i];
}

PathExpr::PathExpr(Document const &doc)
: docptr(doc.docptr)
, xpathptr(xmlXPathNewContext(static_cast<xmlDocPtr>(docptr)))
{
}
PathExpr::~PathExpr()
{
        xmlXPathContextPtr xpath = static_cast<xmlXPathContextPtr>(xpathptr);
        xmlXPathFreeContext(xpath);
}
void PathExpr::RegisterNamespace(Namespace const &ns)
{
        xmlXPathContextPtr xpath = static_cast<xmlXPathContextPtr>(xpathptr);
        xmlXPathRegisterNs(xpath,
                           reinterpret_cast<const xmlChar*>(ns.GetPrefix().c_str()),
                           reinterpret_cast<const xmlChar*>(ns.GetURI().c_str()));
}
PathResult *PathExpr::Evaluate(std::string const &xpath_expr)
{
        std::unique_ptr<PathResult> res(new PathResult);
        xmlXPathContextPtr xpath = static_cast<xmlXPathContextPtr>(xpathptr);
        if(context)
            xpath->node = static_cast<xmlNodePtr>(context.nodeptr);

        res->xpath_object_ptr = xmlXPathEvalExpression((const xmlChar *)xpath_expr.c_str(), xpath);
        if (!res->xpath_object_ptr)
            return NULL;

        return res.release();
}

Namespace::Namespace(std::string const &prefix, std::string const &uri)
: prefix(prefix)
, uri(uri)
{
}

Document::Document()
: docptr(NULL)
{
}

Document::~Document()
{
        Reset();
}

void Document::Reset()
{
        xmlDocPtr doc = static_cast<xmlDocPtr>(docptr);
        if(doc != NULL)
        {
                xmlFreeDoc(doc);
                docptr=NULL;
        }
}

void Document::CreateEmptyDocument()
{
        Reset();
        docptr = xmlNewDoc(reinterpret_cast<const xmlChar*>("1.0"));
}

bool Document::ReadHTMLFromStream(Blex::Stream &instream)
{
        Reset();

        xmlSetStructuredErrorFunc(NULL, Blex::XML::HandleXMLError);
        htmlParserCtxtPtr ctxt = htmlCreatePushParserCtxt(NULL, NULL, NULL, 0, NULL, XML_CHAR_ENCODING_NONE);
        htmlCtxtUseOptions(ctxt, HTML_PARSE_NOERROR | HTML_PARSE_NOWARNING);

        bool finished = false;
        do
        {
                char buffer[16384]; //ADDME: Use allocated buffer (or better, LimitedSendTo and be a Blex::Stream :-) )
                std::size_t len = instream.Read(buffer, sizeof buffer);

                finished = len < sizeof buffer;
                htmlParseChunk(ctxt, buffer, len, finished);
        } while(!finished);

        docptr = ctxt->myDoc;
        htmlFreeParserCtxt(ctxt);
        xmlSetStructuredErrorFunc(NULL, NULL);
        return docptr!=NULL;
}

bool Document::ReadFromStream(Blex::Stream &instream)
{
        Reset();
        xmlSetStructuredErrorFunc(NULL, Blex::XML::HandleXMLError);
        xmlParserCtxtPtr ctxt = xmlCreatePushParserCtxt(NULL, NULL, NULL, 0, NULL);

        bool finished = false;
        do
        {
                char buffer[16384]; //ADDME: Use allocated buffer
                std::size_t len = instream.Read(buffer, sizeof buffer);

                finished = len < sizeof buffer;
                xmlParseChunk(ctxt, buffer, len, finished);
        } while(!finished);

        docptr = ctxt->myDoc;
        xmlFreeParserCtxt(ctxt);
        xmlSetStructuredErrorFunc(NULL, NULL);
        return docptr!=NULL;
}

bool Document::ReadFromFile(std::string const &path)
{
        Reset();
        std::unique_ptr<Blex::FileStream> instream;
        instream.reset(Blex::FileStream::OpenRead(path));
        if(!instream.get())
            return false;

        return ReadFromStream(*instream);
}

bool Document::WriteToFile(std::string const &path)
{
        xmlDocPtr doc = static_cast<xmlDocPtr>(docptr);
        if(!doc)
            return false;

            /*
        std::unique_ptr<Blex::FileStream> file;
        file.reset(Blex::FileStream::OpenWrite(path,true,false,Blex::FilePermissions::PublicRead));
        if (!file.get())
            return false;

        file->SetFilelength(0);
        //ADDME: XML serializing code...
        */
        //FIXME: NOT WIN95 PATHNAME SAFE DUE TO USE OF LIBXML HERE, USE BLEX::STREAM!
        return (xmlSaveFile(path.c_str(), doc) != -1);
}
Node Document::GetRoot()
{
        xmlDocPtr doc = static_cast<xmlDocPtr>(docptr);
        if(!doc)
            return Node::Detail::Make(NULL);
        else
            return Node::Detail::Make(xmlDocGetRootElement(doc));
}

void EntityLoader::SetFile(std::string const &_path)
{
        if (stream.get())
           throw std::runtime_error("Can't set both a path and a stream in an entity loader");
        path = _path;
}

void EntityLoader::SetPublicFilename(std::string const &name)
{
        publicfilename = name;
}

void EntityLoader::SetStream(std::unique_ptr< Stream > *_stream)
{
        if (!path.empty())
           throw std::runtime_error("Can't set both a path and a stream in an entity loader");

        stream.reset(_stream->release());
}

class EntityLoader::Detail
{
    public:
        static xmlParserInputPtr GetInputPtr(std::unique_ptr< EntityLoader > *loader);
};

int EntityLoader::GetData(char *buffer, int len)
{
        return stream->Read(buffer, len);
}

int EntityLoader::GetDataExt(void *ptr, char *buffer, int len)
{
        return static_cast< EntityLoader * >(ptr)->GetData(buffer, len);
}

int EntityLoader::Destroy(void *ptr)
{
        delete static_cast< EntityLoader * >(ptr);
        return 0;
}


xmlParserInputPtr EntityLoader::Detail::GetInputPtr(std::unique_ptr< EntityLoader > *loader)
{
        xmlParserCtxtPtr xmlCtxt = static_cast< xmlParserCtxtPtr >((*loader)->ctxt);
        xmlParserInputPtr newstream;

        const char *filename = (const char*)xmlCharStrdup((*loader)->publicfilename.c_str());

        if (!(*loader)->stream.get())
        {
                newstream = xmlNewInputFromFile(xmlCtxt, (*loader)->path.c_str());
        }
        else
        {
                xmlParserInputBufferPtr inputbuffer = xmlParserInputBufferCreateIO
                        ( &EntityLoader::GetDataExt
                        , &EntityLoader::Destroy
                        , loader->release()
                        , XML_CHAR_ENCODING_NONE);

                newstream = xmlNewIOInputStream(xmlCtxt, inputbuffer, XML_CHAR_ENCODING_NONE);
        }
        if(newstream->filename)
                xmlFree((char*)newstream->filename);
        newstream->filename = filename;
        return newstream;
}



namespace Detail
{

class InitXMLParse
{
        public:
        InitXMLParse();
};

struct XMLData
{
        std::string catalogbase;
};
typedef Blex::InterlockedData<XMLData, Blex::Mutex> LockedXMLData;
LockedXMLData xmldata;

xmlParserInputPtr MyExternalEntityLoader(const char *URL, const char *ID, xmlParserCtxtPtr ctxt)
{
        //ADDME: Volgens spec is hier een simpeler catalog mee te bouwen? een callbackende zou iig wel mooi zijn.....
        //http://xmlsoft.org/xmlio.html#entities

        EntityLoaderCallback loadercb;
/*
        {
                LockedXMLData::ReadRef lock(xmldata);

                if(URL && 0==strcmp(URL,"http://www.w3.org/2001/xml.xsd"))
                    return xmlNewInputFromFile(ctxt, Blex::MergePath(lock->catalogbase,"xml.xsd").c_str());
                if(ID && 0==strcmp(ID,"-//W3C//DTD XMLSCHEMA 200102//EN"))
                    return xmlNewInputFromFile(ctxt, Blex::MergePath(lock->catalogbase,"xmlschema.xsd").c_str());
        }
*/
        XMLThreadContext context(CurrentThreadContext());
        if (!context->callbacks.empty())
            loadercb = context->callbacks.back().first;

        if (loadercb)
        {
                std::unique_ptr< EntityLoader > loader;
                loader.reset(new EntityLoader(ctxt));
                loadercb(URL, ID, loader.get());

                if (loader->GetFatalError())
                   context->callbacks.back().second = true;
                else if (loader->IsSet())
                {
                        LockedXMLData::ReadRef lock(xmldata);
                        return EntityLoader::Detail::GetInputPtr(&loader);
                }
        }

        return NULL;
}

extern "C"
{
void XMLCDECL MyGenericErrorFunc        (void *,const char *msg, ...)
{
        va_list args;

        char buf[4096];
        va_start(args, msg);
        vsnprintf(buf, 4095, msg, args);
        va_end(args);
        buf[4095]=0;

        DEBUGPRINT("Caught generic libxml error: " << buf);

        XMLThreadContext context(CurrentThreadContext());
        DEBUGPRINT("Error catcher: " << context->catcher);
        if (context->catcher)
        {
                XMLError error;
                error.code = 0;
                error.line = 0;
                error.message = buf;

                context->catcher->errors.push_back(error);
        }
}
} //end extern "C"

InitXMLParse::InitXMLParse()
{
        if(!xmlHasFeature(XML_WITH_THREAD))
        {
                Blex::SafeErrorPrint("LibXML is not thread-safe\n");
                Blex::FatalAbort();
        }

        XMLThreadContext::Register(GetThreadContextRegistrator());

        xmlInitParser();
        xmlSetExternalEntityLoader(MyExternalEntityLoader);

        // unbelievable...
        xmlSetGenericErrorFunc(NULL, MyGenericErrorFunc);
        xmlThrDefSetGenericErrorFunc(NULL, MyGenericErrorFunc); //for new threads

        xmlSetStructuredErrorFunc(NULL, Blex::XML::HandleXMLError);
        xmlThrDefSetStructuredErrorFunc(NULL, Blex::XML::HandleXMLError);

        xmlThrDefIndentTreeOutput(1);

        xmlCopyCharEncodingHandler = xmlNewCharEncodingHandler("COPY",&xmlCharCopyFunc,&xmlCharCopyFunc);
}

InitXMLParse initxmlparse;

} //end namespace Detail

void SetXMLGenericThreadErrorCatcher(ErrorCatcher *catcher)
{
        XMLThreadContext context(CurrentThreadContext());
        context->catcher = catcher;
}

void SetCatalogBase(std::string const &path)
{
        Detail::LockedXMLData::WriteRef lock(Detail::xmldata);
        lock->catalogbase=path;
}

void PushEntityLoader(EntityLoaderCallback const &loader)
{
        XMLThreadContext context(CurrentThreadContext());

        context->callbacks.push_back(std::make_pair(loader, false));
}

bool PopEntityLoader()
{
        XMLThreadContext context(CurrentThreadContext());

        if (context->callbacks.empty())
            throw std::runtime_error("Cannot pop an entity loader, there are none left");

        bool fatal_error = context->callbacks.back().second;
        context->callbacks.pop_back();
        return !fatal_error;
}


} //end namespace XML
} //end namespace Blex
