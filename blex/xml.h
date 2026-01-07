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
