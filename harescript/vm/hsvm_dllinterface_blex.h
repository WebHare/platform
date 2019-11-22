#ifndef blex_harescript_vm_hsvm_dllinterface_blex
#define blex_harescript_vm_hsvm_dllinterface_blex

#include "hsvm_constants.h"

namespace Blex
{
        class ComplexFileStream;
}

namespace HareScript
{

class GlobalBlobManager;

namespace Interface
{

/** A wrapper that offers a Blex::Stream around a HSVM blob. This is not your
    everyday stream, so keep the following in mind:

    - Close() may never be called during HSVM shutdown. When in doubt, don't
      call it. Generally, you should only Close a HSVM stream on explicit request,
      and never in your class or context destructors
    - A blob's source may be coming from a database transaction or other remote
      object. This transaction may be closed due to errors or by an explicit
      user close. When this happens, all functions return EOF - no exception is
      thrown because this is not considered an uncommon situation
    - Don't call any functions on a HareScript stream you explicitly Close()d
      (although destructing it is okay). Any function call after a Close() will
      force a throw() (and remember, you're not allowed to leak exceptions
      through the HSVM interfaces)
    - The HSVM garbage collects all open streams when the VM is shut down.
      So unclosed streams don't leak memory (although they do consume resources
      as long as the VM is still running), and using a HareScriptStream after
      its respective VM has shut down will probably crash the application.
*/
class BLEXLIB_PUBLIC InputStream : public Blex::RandomStream_InternalFilePointer
{
        public:
        /** Associate an input stream with an open blob
            @param vm Virtual machine owning the blob
            @param blob_variable_id Variable id for the blob
        */
        InputStream(HSVM *vm, HSVM_VariableId id);
        ~InputStream();

        std::size_t DirectRead(Blex::FileOffset startpos,void *buf,std::size_t maxbufsize) ;
        std::size_t DirectWrite(Blex::FileOffset startpos,const void *buf,std::size_t bufsize) ;
        bool SetFileLength(Blex::FileOffset newlength);
        Blex::FileOffset GetFileLength();

        private:
        HSVM *vm;
        int blobhandle;
};

class BLEXLIB_PUBLIC OutputStream : public Blex::Stream
{
        public:
        OutputStream(HSVM *vm, int32_t streamid);
        ~OutputStream();

        std::size_t Read(void *buf,std::size_t maxbufsize);
        bool EndOfStream();
        std::size_t Write(void const *buf, std::size_t bufsize);

        private:
        HSVM *vm;
        int32_t const streamid;
};

Blex::RandomStream * GetRandomStreamOfTempFile(HSVM *vm, int id);

} //end namspace Interface
} //end namespace HareScript

#endif
