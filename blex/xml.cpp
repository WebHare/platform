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
        // not sure about the context for the above 'unbelievable' but I presume a lot of the mess here (and XML calls still
        // updating error callbacks) is coming from the  fact that libxml2 stores its configuration in a per-thread object.
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
