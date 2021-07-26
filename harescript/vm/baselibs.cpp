#include <harescript/vm/allincludes.h>


#include <limits>
#include <blex/path.h>
#include <blex/utils.h>
#include "baselibs.h"
#include "hsvm_context.h"
#include "hsvm_dllinterface.h"
#include "hsvm_dllinterface_blex.h"
#include "hsvm_processmgr.h"
#include "mangling.h"
#include <blex/mime.h>
#include "hsvm_debug.h"

//#define SHOW_PACKET
//#define SHOW_GENERATORS

#if defined(SHOW_PACKET) && defined(DEBUG)
 #define PACKET_PRINT(x) DEBUGPRINT(x)
#else
 #define PACKET_PRINT(x)
#endif

#if defined(SHOW_GENERATORS) && defined(DEBUG)
 #define GEN_PRINT(x) DEBUGPRINT(x)
 #define GEN_ONLY(a) DEBUGONLY(a)
#else
 #define GEN_PRINT(x)
 #define GEN_ONLY(a)
#endif

//ADDME: We should optimize the unicode functions quite a bit, I think, performance of eg. UCLeft with large strings (think fetcher.whscr) is TERRIBLE

namespace HareScript {

void GetVMStackTrace(VirtualMachine *vm, HSVM_VariableId var_stacktrace, VirtualMachine *testvm, bool full);
void GetVMStackTraceFromElements(VirtualMachine *vm, HSVM_VariableId var_stacktrace, std::vector< StackTraceElement > const &elements, VirtualMachine *testvm, bool full);


namespace Baselibs {

SystemContextData::SystemContextData()
: archives("Archive")
, logs("Log")
, inited_cols(false)
, var_intcallbacks(0)
{
}

SystemContextData::~SystemContextData()
{
}

void SystemContextData::InitColumnMappings(VirtualMachine *vm)
{
        col_pvt_eof = HSVM_GetColumnId(*vm, "PVT_EOF");
        col_pvt_pos = HSVM_GetColumnId(*vm, "PVT_POS");
        col_pvt_data = HSVM_GetColumnId(*vm, "PVT_DATA");
        col_pvt_current = HSVM_GetColumnId(*vm, "PVT_CURRENT");

        inited_cols = true;
}

void SystemContextData::CloseHandles()
{
        decoders.clear();
        archives.Clear();

        os.CloseHandles();
        tcpip.CloseHandles();
}

void HS_FatalError(VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();
        VMRuntimeError err(
                static_cast<Error::Codes>(stackm.GetInteger(HSVM_Arg(0))),
                stackm.GetString(HSVM_Arg(1)).stl_str(),
                stackm.GetString(HSVM_Arg(2)).stl_str());
        throw err;
}

void HS_SilentTerminate(VirtualMachine *vm)
{
        volatile unsigned *flag = vm->GetVMGroup()->GetAbortFlag();
        *flag = HSVM_ABORT_SILENTTERMINATE;
}


void HS_RedirectOutput(VarId id_set, VirtualMachine *vm)
{
        int redirect_id = HSVM_IntegerGet(*vm, HSVM_Arg(0));
        int old_id = HSVM_RedirectOutputTo(*vm, redirect_id);
        HSVM_IntegerSet(*vm, id_set, old_id);
}

void Print(VirtualMachine *vm)
{
        Blex::StringPair toprint=vm->GetStackMachine().GetString(HSVM_Arg(0));
        HSVM_Print(*vm, toprint.size(), toprint.begin);
}

void PrintTo(VarId id_set, VirtualMachine *vm)
{
        int print_id = HSVM_IntegerGet(*vm, HSVM_Arg(0));
        Blex::StringPair toprint=vm->GetStackMachine().GetString(HSVM_Arg(1));
        bool success = HSVM_PrintTo(*vm, print_id, toprint.size(), toprint.begin);
        HSVM_BooleanSet(*vm, id_set,success);
}

void WriteTo(VarId id_set, VirtualMachine *vm)
{
        int print_id = HSVM_IntegerGet(*vm, HSVM_Arg(0));
        Blex::StringPair toprint=vm->GetStackMachine().GetString(HSVM_Arg(1));
        int chars_written = HSVM_WriteTo(*vm, print_id, toprint.size(), toprint.begin);
        HSVM_IntegerSet(*vm, id_set,chars_written);
}

/* Parameters: id, max-bytes-read, lineread,striplf, onlybuffer
   onlybuffer: don't read from socket, just return everything in buffer
*/
void ReceiveFrom(HSVM_VariableId id_set, VirtualMachine *vm)
{
        SystemContext context(vm->GetContextKeeper());
        int input_id = HSVM_IntegerGet(*vm, HSVM_Arg(0));
        int readbytes = HSVM_IntegerGet(*vm, HSVM_Arg(1));
        bool lineread = HSVM_BooleanGet(*vm, HSVM_Arg(2));
        bool striplf = HSVM_BooleanGet(*vm, HSVM_Arg(3));
        bool onlybuffer = HSVM_BooleanGet(*vm, HSVM_Arg(4));

        //DEBUGPRINT("Receive from id " << input_id << ", bytes " << readbytes << ", line:" << lineread << ", striplf:" << striplf);

        unsigned maxread = unsigned(readbytes>0 ? readbytes : -readbytes);
        bool readany = readbytes < 0;

        if (maxread > 32768)
            maxread = 32768;

        //Get the output object
        //ADDME: OutputObject support should move into baselibs or dllinterface, out of the core VM
        if(input_id==0 && !context->os.console_support)
            throw HareScript::VMRuntimeError(Error::NoConsoleAvailable);

        HSVM_SetDefault(*vm, id_set, HSVM_VAR_Record);
        HSVM_VariableId statusvar = HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, "STATUS")); //FIXME precalc
        HSVM_VariableId datavar = HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, "DATA"));

        HSVM_SetDefault(*vm, datavar, HSVM_VAR_String);

        HareScript::OutputObject *obj = input_id ? vm->GetOutputObject(input_id, false) : &context->os.console;
        assert(obj);

        std::vector<char>::iterator end = obj->readbuffer.end();
        std::vector<char>::iterator lineend = end;
        if (lineread)
        {
                // This is a line read, find a line in the part of the existing buffer
                lineend = std::find(obj->readbuffer.begin(), obj->readbuffer.end(), '\n');
        }

        //DEBUGPRINT("** Enter receive loop, size: " << obj->readbuffer.size() << "/" <<  (readany ? 1 : maxread) << ", found lf: " << (lineend == end));

        bool goterror = false;
        while (obj->readbuffer.size() < (readany ? 1 : maxread) && lineend == end && !onlybuffer && !goterror)
        {
                // Extra data is required to satisfy the request
                unsigned curbufsize = obj->readbuffer.size();
                unsigned maxreadnow = std::min(HareScript::OutputObject::MaxReadChunkSize, maxread - curbufsize);

                //Add bytes and read, then correct the buffer size
                obj->readbuffer.resize(curbufsize + maxreadnow);
                std::pair< Blex::SocketError::Errors, unsigned > res = obj->Read(maxreadnow, &obj->readbuffer[curbufsize]);
                //DEBUGPRINT("Read result: " << res.first << ":" << res.second << ", data: '" << std::string(&obj->readbuffer[curbufsize], &obj->readbuffer[curbufsize + res.second]) << "'");

                unsigned bytesread = res.second;
                obj->readbuffer.resize(curbufsize + bytesread);

                if (res.first == Blex::SocketError::WouldBlock)
                {
                        obj->SetWaitIgnoresReadBuffer(true);
                        HSVM_IntegerSet(*vm, statusvar, res.first);
                        return;
                }

                if (res.first != Blex::SocketError::NoError)
                {
                        if (!obj->readbuffer.empty())
                        {
                                goterror = true;
                        }
                        else
                        {
                                HSVM_IntegerSet(*vm, statusvar, res.first);
                                return;
                        }
                }

                // Update end, find linefeed in just read data
                end = obj->readbuffer.end();
                if (lineread)
                    lineend = std::find(obj->readbuffer.begin() + curbufsize, end, '\n');
                else
                    lineend = end;

                // Returned nothing and no error? End of stream.
                if (res.first == Blex::SocketError::NoError && bytesread == 0)
                    break;
        }

        //DEBUGPRINT("Line result: '" << std::string(obj->readbuffer.begin(), lineend) << "'");

        if (onlybuffer)
            obj->SetWaitIgnoresReadBuffer(false);

        //Never look past the requested maxbytes. If linefeed found, set the end to that
        end = obj->readbuffer.begin() + std::min< std::size_t >(obj->readbuffer.size(), maxread);
        if (lineread)
        {
                // Make sure lineend does not lie after end, and that end lies directly after the lineend (but after the '\n')
                if (lineend < end)
                {
                        end = lineend + 1; // Set end after the '\n'
                        if (!striplf)
                            ++lineend;
                }
                else
                {
                        lineend = end; // Don't return more than requested
                }

                if (striplf && lineend != obj->readbuffer.begin() && lineend[-1] == '\r')
                {
                        // Strip the '\r' at the end of the returned line
                        --lineend;
                }
        }
        else if (lineend > end)
        {
              lineend = end; //don't return more than requested
        }

        HSVM_StringSet(*vm, datavar, &obj->readbuffer[0], &*lineend);
        obj->readbuffer.erase(obj->readbuffer.begin(), end);

        // Set status
        HSVM_IntegerSet(*vm, statusvar, Blex::SocketError::NoError);
}

void HS_CancelReceiveLine(VirtualMachine *vm)
{
        SystemContext context(vm->GetContextKeeper());
        int input_id = HSVM_IntegerGet(*vm, HSVM_Arg(0));

        if(input_id==0 && !context->os.console_support)
            throw HareScript::VMRuntimeError(Error::NoConsoleAvailable);

        HareScript::OutputObject *obj = input_id ? vm->GetOutputObject(input_id, false) : &context->os.console;
        assert(obj);

        obj->SetWaitIgnoresReadBuffer(false);
}

void IsAtEndOfStream(VarId id_set, VirtualMachine *vm)
{
        SystemContext context(vm->GetContextKeeper());
        int input_id = HSVM_IntegerGet(*vm, HSVM_Arg(0));

        if(input_id==0 && !context->os.console_support)
            throw HareScript::VMRuntimeError(Error::NoConsoleAvailable);

        HareScript::OutputObject *obj = input_id ? vm->GetOutputObject(input_id, false) : &context->os.console;
        HSVM_BooleanSet(*vm, id_set, obj == NULL || (obj->IsAtEOF() && obj->readbuffer.empty()));
}

void HS_SimpleFatalError(VirtualMachine *vm)
{
        throw VMRuntimeError(static_cast<Error::Codes>(HSVM_IntegerGet(*vm, HSVM_Arg(0))));
}

void Length(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();
        VariableTypes::Type type=stackm.GetType(HSVM_Arg(0));

        if (type&VariableTypes::Array)
        {
                stackm.SetInteger(id_set, stackm.ArraySize(HSVM_Arg(0)));
                return;
        }

        switch (type)
        {
        case VariableTypes::String:
                stackm.SetInteger(id_set,stackm.GetString(HSVM_Arg(0)).size() );
                return;
        case VariableTypes::Blob:
                stackm.SetInteger(id_set, Blex::LimitOffsetToInt(stackm.GetBlob(HSVM_Arg(0)).GetLength()));
                return;
        default:
                throw VMRuntimeError (Error::LengthWrongType, HareScript::GetTypeName(type));
        }
}
void Length64(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();
        VariableTypes::Type type=stackm.GetType(HSVM_Arg(0));

        if (type&VariableTypes::Array)
        {
                stackm.SetInteger64(id_set, stackm.ArraySize(HSVM_Arg(0)));
                return;
        }

        switch (type)
        {
        case VariableTypes::String:
                stackm.SetInteger64(id_set,stackm.GetString(HSVM_Arg(0)).size() );
                return;
        case VariableTypes::Blob:
                stackm.SetInteger64(id_set, stackm.GetBlob(HSVM_Arg(0)).GetLength());
                return;
        default:
                throw VMRuntimeError (Error::LengthWrongType, HareScript::GetTypeName(type));
        }
}

void SearchElement(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();
        int32_t start = stackm.GetInteger(HSVM_Arg(2));
        stackm.SetInteger(id_set, stackm.SearchElement(HSVM_Arg(0), HSVM_Arg(1), start));
}

void SearchElementFromBack(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();
        int32_t start = stackm.GetInteger(HSVM_Arg(2));
        stackm.SetInteger(id_set, stackm.SearchElementFromBack(HSVM_Arg(0), HSVM_Arg(1), start));
}

/* String functions */
void Left(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        Blex::StringPair str(stackm.GetString(HSVM_Arg(0)));
        int howmany = Blex::Bound<int>(0,str.size(),stackm.GetInteger(HSVM_Arg(1)));

        stackm.MoveFrom(id_set, HSVM_Arg(0));
        stackm.ResizeString(id_set, howmany);
}

void Right(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        Blex::StringPair str(stackm.GetString(HSVM_Arg(0)));
        int howmany = Blex::Bound<int>(0,str.size(),stackm.GetInteger(HSVM_Arg(1)));

        //need to use a temp string because we're not allowed to pass pointers INTO the var buffer to SetString
        Blex::PodVector<char> &scratchpad=SystemContext(vm->GetContextKeeper())->scratchpad;

        scratchpad.assign(str.end-howmany,str.end);
        stackm.SetString(id_set, scratchpad.begin(), scratchpad.end());

//        stackm.SetSTLString(id_set,std::string(str.end-howmany,str.end));
}

/* Look for a string in a string, and return its starting location */
void SearchSubstring(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        Blex::StringPair str=stackm.GetString(HSVM_Arg(0));
        Blex::StringPair searchfor=stackm.GetString(HSVM_Arg(1));

        // Determine starting position
        int32_t start = stackm.GetInteger(HSVM_Arg(2));
        if (start < 0)
            start = 0;
        else if (start > (str.end-str.begin))
        {
                stackm.SetInteger(id_set,-1);
                return;
        }

        if (searchfor.begin == searchfor.end) //looking for an empty string
        {
                stackm.SetInteger(id_set,-1);
                return;
        }

        const char *pos=std::search(str.begin+start,str.end,searchfor.begin,searchfor.end);

        stackm.SetInteger(id_set,pos==str.end ? -1 : pos-str.begin);
}

void SearchLastSubstring(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        Blex::StringPair str=stackm.GetString(HSVM_Arg(0));
        Blex::StringPair searchfor=stackm.GetString(HSVM_Arg(1));

        // Determine starting position, counting from the end
        int32_t start = stackm.GetInteger(HSVM_Arg(2));
        if (start < 0)
        {
                stackm.SetInteger(id_set,-1);
                return;
        }
        else if (start >= (str.end-str.begin))
            start = 0;
        else
            start = str.end-str.begin-start-1;

        if (searchfor.begin == searchfor.end) //looking for an empty string
        {
                stackm.SetInteger(id_set,-1);
                return;
        }

        const char *pos=std::find_end(str.begin,str.end-start,searchfor.begin,searchfor.end);
        stackm.SetInteger(id_set,pos==(str.end-start) ? -1 : pos-str.begin);
}

void Substring(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        Blex::StringPair str=stackm.GetString(HSVM_Arg(0));

        int startpos= Blex::Bound<int>(0,str.size(),stackm.GetInteger(HSVM_Arg(1)));
        int length  = Blex::Bound<int>(0,str.size()-startpos,stackm.GetInteger(HSVM_Arg(2)));

        //need to use a temp string because we're not allowed to pass pointers INTO the var buffer to SetString
        Blex::PodVector<char> &scratchpad=SystemContext(vm->GetContextKeeper())->scratchpad;
        scratchpad.assign(str.begin+startpos,str.begin+startpos+length);

        stackm.SetString(id_set, scratchpad.begin(), scratchpad.end());

//        //need to use a temp string because we're not allowed to pass pointers INTO the var buffer to SetString
//        stackm.SetSTLString(id_set,std::string(str.begin+startpos,str.begin+startpos+length));
}

void TrimWhitespace(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        Blex::StringPair str=stackm.GetString(HSVM_Arg(0));
        Blex::StringPair copy=str;
        ;
        while(str.begin!=str.end && (str.begin[0]==' ' || str.begin[0]=='\r' || str.begin[0]=='\n' || str.begin[0]=='\t'))
           ++str.begin;
        while(str.begin!=str.end && (str.end[-1]==' ' || str.end[-1]=='\r' || str.end[-1]=='\n' || str.end[-1]=='\t'))
           --str.end;

        if(str.begin==copy.begin && str.end==copy.end)
            stackm.MoveFrom(id_set, HSVM_Arg(0));
        else
        {
                //FIXME Optimize but prevent crash?!
                Blex::PodVector<char> &scratchpad=SystemContext(vm->GetContextKeeper())->scratchpad;
                scratchpad.assign(str.begin, str.end);

                stackm.SetString(id_set, scratchpad.begin(), scratchpad.end());
                //stackm.SetSTLString(id_set, std::string(str.begin, str.end));
        }
}

void ToUpperCase(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        std::pair<char*,char*> writablestring = stackm.ResizeString(HSVM_Arg(0), stackm.GetStringSize(HSVM_Arg(0)));
        Blex::ToUppercase(writablestring.first,writablestring.second);
        stackm.CopyFrom(id_set,HSVM_Arg(0));
}

void ToLowerCase(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        std::pair<char*,char*> writablestring = stackm.ResizeString(HSVM_Arg(0), stackm.GetStringSize(HSVM_Arg(0)));
        Blex::ToLowercase(writablestring.first,writablestring.second);
        stackm.CopyFrom(id_set,HSVM_Arg(0));
}

void Substitute(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        std::string temp;

        Blex::StringPair source=stackm.GetString(HSVM_Arg(0));
        Blex::StringPair searchfor=stackm.GetString(HSVM_Arg(1));
        Blex::StringPair replacement=stackm.GetString(HSVM_Arg(2));

        //Empty search string?
        if (searchfor.size()==0)
        { //Don't bother replacing
                stackm.CopyFrom(id_set,HSVM_Arg(0));
                return;
        }

        temp.reserve(source.size());
        while (source.begin != source.end)
        {
                //Next position of the searched item
                const char *nextpos=std::search(source.begin,source.end,
                                                searchfor.begin,searchfor.end);

                //Copy everything till the searchfor starting position
                if (source.begin < nextpos)
                    temp.append(source.begin,nextpos-source.begin);
                //Add the replacement, if the searchfor was found
                if (nextpos != source.end)
                    temp.append(replacement.begin,replacement.end-replacement.begin);
                //Move after the searchfor item to continue substituting
                if (static_cast<unsigned>(std::distance(nextpos,source.end)) < searchfor.size())
                    break;

                source.begin=nextpos+searchfor.size();
        }
        stackm.SetSTLString(id_set,temp);
}

void Tokenize(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        //We must make a copy of sourcecopy and separator, because we call
        //SetString inside our loop, which may invalidate the original GetString() result
        std::string const sourcecopy=stackm.GetString(HSVM_Arg(0)).stl_str();
        std::string const separator=stackm.GetString(HSVM_Arg(1)).stl_str();

        stackm.ArrayInitialize(id_set,0,VariableTypes::StringArray);

        if (!sourcecopy.empty() && separator == sourcecopy) //it would throw us into an infinite loop: defined as returning two empty tokens
        {
                stackm.SetString<char const *>(stackm.ArrayElementAppend(id_set),NULL,NULL);
                stackm.SetString<char const *>(stackm.ArrayElementAppend(id_set),NULL,NULL);
                return;
        }

        if (separator.empty())
        {
                // Split into separate UTF-8 characters
                Blex::PodVector< uint32_t > decoded_string;
                decoded_string.reserve(sourcecopy.size());
                Blex::UTF8Decode(sourcecopy.begin(), sourcecopy.end(), std::back_inserter(decoded_string));

                std::string retval;
                for (auto it = decoded_string.begin(); it != decoded_string.end(); ++it)
                {
                        retval.clear();
                        Blex::UTF8Encode(it, it + 1, std::back_inserter(retval));
                        stackm.SetSTLString(stackm.ArrayElementAppend(id_set), retval);
                }

                return;
        }

        std::string::const_iterator curpos=sourcecopy.begin();
        while (true)
        {
                //Find occurence of the separator
                std::string::const_iterator tokenpos=std::search
                                                     (curpos,sourcecopy.end(),
                                                      separator.begin(),separator.end());

                //Add [curpos,tokenpos[ as a token
                stackm.SetString(stackm.ArrayElementAppend(id_set),curpos,tokenpos);

                //Last token? then quit
                if (tokenpos == sourcecopy.end())
                    break;

                //Move the current position behind the token separator
                curpos = tokenpos + separator.size();
        }
}

void ByteToString(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        int bytecode = stackm.GetInteger(HSVM_Arg(0));
        if (bytecode<0 || bytecode>255) //out of range
        {
                stackm.SetString<const char*>(id_set,NULL,NULL);
        }
        else
        {
                char ch = static_cast<char>(static_cast<uint8_t>(bytecode));
                stackm.SetString(id_set,&ch,&ch+1);
        }
}

void GetByteValue(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        Blex::StringPair str = stackm.GetString(HSVM_Arg(0));
        uint8_t charcode = uint8_t(str.begin==str.end ? 0 : *str.begin);
        stackm.SetInteger(id_set,charcode);
}

void GetUCValue(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        Blex::StringPair str = stackm.GetString(HSVM_Arg(0));

        uint32_t unicodechar[7] = {0};
        //decode up to 7 characters
        Blex::UTF8Decode(str.begin,std::min(str.begin+7,str.end),unicodechar);
        //return the first character
        stackm.SetInteger(id_set,unicodechar[0]);
}

void UCLength(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        Blex::StringPair str = stackm.GetString(HSVM_Arg(0));

        //UTF8 to Unicode
        std::vector<uint32_t> decoded_string;
        decoded_string.reserve(str.size());
        Blex::UTF8Decode(str.begin,str.end,std::back_inserter(decoded_string));

        stackm.SetInteger(id_set,decoded_string.size());
}

void UCLeft(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        Blex::StringPair str = stackm.GetString(HSVM_Arg(0));

        //UTF8 to Unicode
        std::vector<uint32_t> decoded_string;
        decoded_string.reserve(str.size());
        Blex::UTF8Decode(str.begin,str.end,std::back_inserter(decoded_string));

        int howmany = Blex::Bound<int>(0,decoded_string.size(),stackm.GetInteger(HSVM_Arg(1)));
        std::string retval;
        retval.reserve(howmany);
        Blex::UTF8Encode(decoded_string.begin(),
                         decoded_string.begin() + howmany,
                         std::back_inserter(retval));

        stackm.SetSTLString(id_set,retval);
}

void UCRight(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        Blex::StringPair str = stackm.GetString(HSVM_Arg(0));

        //UTF8 to Unicode
        std::vector<uint32_t> decoded_string;
        decoded_string.reserve(str.size());
        Blex::UTF8Decode(str.begin,str.end,std::back_inserter(decoded_string));

        int howmany = Blex::Bound<int>(0,decoded_string.size(),stackm.GetInteger(HSVM_Arg(1)));

        std::string retval;
        retval.reserve(howmany);
        Blex::UTF8Encode(decoded_string.end()-howmany,decoded_string.end(), std::back_inserter(retval));
        stackm.SetSTLString(id_set,retval);
}

void UCSubstring(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        Blex::StringPair str = stackm.GetString(HSVM_Arg(0));

        //UTF8 to Unicode
        std::vector<uint32_t> decoded_string;
        decoded_string.reserve(str.size());
        Blex::UTF8Decode(str.begin,str.end,std::back_inserter(decoded_string));

        int startpos= Blex::Bound<int>(0,decoded_string.size(),stackm.GetInteger(HSVM_Arg(1)));
        int length  = Blex::Bound<int>(0,decoded_string.size()-startpos,stackm.GetInteger(HSVM_Arg(2)));

        std::string retval;
        retval.reserve(length);
        Blex::UTF8Encode(decoded_string.begin()+startpos,decoded_string.begin()+startpos+length,std::back_inserter(retval));
        stackm.SetSTLString(id_set,retval);
}

void UCSearchSubstring(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        Blex::StringPair str = stackm.GetString(HSVM_Arg(0));
        Blex::StringPair searchfor = stackm.GetString(HSVM_Arg(1));

        if (searchfor.begin == searchfor.end) //looking for an empty string
        {
                stackm.SetInteger(id_set,-1);
                return;
        }

        //UTF8 to Unicode
        std::vector<uint32_t> decoded_string, decoded_searchfor;
        decoded_string.reserve(str.size());
        decoded_searchfor.reserve(searchfor.size());
        Blex::UTF8Decode(str.begin,str.end,std::back_inserter(decoded_string));
        Blex::UTF8Decode(searchfor.begin,searchfor.end,std::back_inserter(decoded_searchfor));

        // Determine starting position
        int32_t start = HSVM_IntegerGet(*vm, HSVM_Arg(2));
        if (start < 0)
            start = 0;
        else if ((unsigned)start > decoded_string.size())
        {
                stackm.SetInteger(id_set,-1);
                return;
        }

        std::vector<uint32_t>::iterator pos=std::search(decoded_string.begin()+start,decoded_string.end(),decoded_searchfor.begin(),decoded_searchfor.end());

        HSVM_IntegerSet(*vm, id_set,pos==decoded_string.end() ? -1 : pos-decoded_string.begin());
}

void UCSearchLastSubstring(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        Blex::StringPair str = stackm.GetString(HSVM_Arg(0));
        Blex::StringPair searchfor = stackm.GetString(HSVM_Arg(1));

        if (searchfor.begin == searchfor.end) //looking for an empty string
        {
                stackm.SetInteger(id_set,-1);
                return;
        }

        //UTF8 to Unicode
        std::vector<uint32_t> decoded_string, decoded_searchfor;
        decoded_string.reserve(str.size());
        decoded_searchfor.reserve(searchfor.size());
        Blex::UTF8Decode(str.begin,str.end,std::back_inserter(decoded_string));
        Blex::UTF8Decode(searchfor.begin,searchfor.end,std::back_inserter(decoded_searchfor));

        // Determine starting position, counting from the end
        int32_t start = stackm.GetInteger(HSVM_Arg(2));
        if (start < 0)
        {
                stackm.SetInteger(id_set,-1);
                return;
        }
        else if ((unsigned)start >= decoded_string.size())
            start = 0;
        else
            start = decoded_string.size()-start-1;

        std::vector<uint32_t>::iterator pos=std::find_end(decoded_string.begin(),decoded_string.end()-start,decoded_searchfor.begin(),decoded_searchfor.end());

        stackm.SetInteger(id_set,pos==(decoded_string.end()-start) ? -1 : pos-decoded_string.begin());
}

void UCToString(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        uint32_t code = uint32_t(stackm.GetInteger(HSVM_Arg(0)));

        std::string retval;
        Blex::UTF8Encode(&code,&code+1,std::back_inserter(retval));
        stackm.SetSTLString(id_set,retval);
}

void HS_FormatMessage(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        VarId arg1 = HSVM_Arg(0);
        VarId arg2 = HSVM_Arg(1);
        VarId arg3 = HSVM_Arg(2);
        VarId arg4 = HSVM_Arg(3);

        HareScript::Message msg(stackm.GetBoolean(arg1),
                                stackm.GetInteger(arg2),
                                stackm.GetSTLString(arg3),
                                stackm.GetSTLString(arg4));


        stackm.SetSTLString(id_set, GetMessageString(msg));
}

void GetCallingLibrary(VarId id_set, VirtualMachine *vm)
{
        const char *lib = vm->GetCallingLibrary(1, HSVM_BooleanGet(*vm, HSVM_Arg(0)), 0);
        if(lib)
            HSVM_StringSet(*vm, id_set, lib, lib+strlen(lib));
        else
            HSVM_SetDefault(*vm, id_set, HSVM_VAR_String);
}

void EnableFunctionProfile(VirtualMachine *vm)
{
        vm->EnableFunctionProfiling();
}

void DisableFunctionProfile(VirtualMachine *vm)
{
        vm->DisableFunctionProfiling();
}

void ResetFunctionProfile(VirtualMachine *vm)
{
        vm->ResetFunctionProfile();
}

void EnableMemoryProfile(VirtualMachine *vm)
{
        vm->EnableMemoryProfiling();
}

void DisableMemoryProfile(VirtualMachine *vm)
{
        vm->DisableMemoryProfiling();
}

void ResetMemoryProfile(VirtualMachine *vm)
{
        vm->ResetMemoryProfile();
}

/// Encodes function profile data
void EncodeFunctionProfileData(ProfileData const &profiledata, VirtualMachine *vm, VarId id_set)
{
        StackMachine &stackm = vm->GetStackMachine();

        ColumnNameId col_items = stackm.columnnamemapper.GetMapping("ITEMS");
        ColumnNameId col_parentlocation = stackm.columnnamemapper.GetMapping("PARENTLOCATION");
        ColumnNameId col_location = stackm.columnnamemapper.GetMapping("LOCATION");
        ColumnNameId col_locations = stackm.columnnamemapper.GetMapping("LOCATIONS");
        ColumnNameId col_callcount = vm->columnnamemapper.GetMapping("CALLCOUNT");
        ColumnNameId col_totaltime = vm->columnnamemapper.GetMapping("TOTALTIME");
        ColumnNameId col_totaltime_callee_nr = vm->columnnamemapper.GetMapping("TOTALTIME_CALLEE_NR");
        ColumnNameId col_selftime = vm->columnnamemapper.GetMapping("SELFTIME");

        ColumnNameId col_library = stackm.columnnamemapper.GetMapping("LIBRARY");
        ColumnNameId col_func = stackm.columnnamemapper.GetMapping("FUNC");
        ColumnNameId col_id = stackm.columnnamemapper.GetMapping("ID");
        ColumnNameId col_line = stackm.columnnamemapper.GetMapping("LINE");
        ColumnNameId col_col = stackm.columnnamemapper.GetMapping("COL");

        stackm.InitVariable(id_set, VariableTypes::Record);
        VarId var_locations = stackm.RecordCellCreate(id_set, col_locations);
        VarId var_items = stackm.RecordCellCreate(id_set, col_items);

        stackm.ArrayInitialize(var_locations, 0, VariableTypes::RecordArray);
        stackm.ArrayInitialize(var_items, 0, VariableTypes::RecordArray);

        unsigned lid = 0;

        double tickfreq = Blex::GetSystemTickFrequency();

        std::map< LinkedLibrary::ResolvedFunctionDef const *, unsigned > locationmap;

        for (auto &itr: profiledata.function_profiles)
        {
                if (!itr.first.second)
                    continue;

                std::string funcname = itr.first.second->lib->GetLinkinfoNameStr(itr.first.second->def->name_index);
                if (funcname == "ENABLEFUNCTIONPROFILE:::" || funcname == "DISABLEFUNCTIONPROFILE:::" || funcname == "RESETFUNCTIONPROFILE:::")
                    continue; //no point in profiling half-profiled functions

                int32_t parentlocation = 0, location = 0;
                if (itr.first.first)
                {
                        auto lit = locationmap.find(itr.first.first);
                        if (lit == locationmap.end())
                            locationmap.insert(std::make_pair(itr.first.first, parentlocation = ++lid));
                        else
                            parentlocation = lit->second;
                }

                {
                        auto lit = locationmap.find(itr.first.second);
                        if (lit == locationmap.end())
                            locationmap.insert(std::make_pair(itr.first.second, location = ++lid));
                        else
                            location = lit->second;
                }

                VarId cell = stackm.ArrayElementAppend(var_items);
                stackm.RecordInitializeEmpty(cell);
                stackm.SetInteger(stackm.RecordCellCreate(cell, col_parentlocation), parentlocation);
                stackm.SetInteger(stackm.RecordCellCreate(cell, col_location), location);
                stackm.SetInteger(stackm.RecordCellCreate(cell, col_callcount), itr.second.callcount);
                stackm.SetFloat(stackm.RecordCellCreate(cell, col_totaltime), double(itr.second.totaltime) / tickfreq);
                stackm.SetFloat(stackm.RecordCellCreate(cell, col_totaltime_callee_nr), double(itr.second.totaltime_callee_nr) / tickfreq);
                stackm.SetFloat(stackm.RecordCellCreate(cell, col_selftime), double(itr.second.selftime) / tickfreq);
        }

        Blex::PodVector< LinkedLibrary::ResolvedFunctionDef const * > locations;
        locations.resize(locationmap.size());
        for (auto &itr: locationmap)
            locations[itr.second - 1] = itr.first;

        lid = 0;
        for (auto &itr: locations)
        {
                VarId elt = stackm.ArrayElementAppend(var_locations);
                stackm.InitVariable(elt, VariableTypes::Record);

                stackm.SetSTLString(stackm.RecordCellCreate(elt, col_library), itr->lib->GetLibURI());
                Blex::StringPair fullname = itr->lib->GetLinkinfoName(itr->def->name_index);

                stackm.SetInteger(stackm.RecordCellCreate(elt, col_id), ++lid);
                stackm.SetString(stackm.RecordCellCreate(elt, col_func), fullname);
                stackm.SetInteger(stackm.RecordCellCreate(elt, col_line), itr->def->definitionposition.line);
                stackm.SetInteger(stackm.RecordCellCreate(elt, col_col), itr->def->definitionposition.column);
        }
}

void GetFunctionProfileData(VarId id_set, VirtualMachine *vm)
{
        EncodeFunctionProfileData(vm->GetProfileData(), vm, id_set);
}

void EnableCoverageProfile(VirtualMachine *vm)
{
        vm->EnableCoverageProfiling();
}

void DisableCoverageProfile(VirtualMachine *vm)
{
        vm->DisableCoverageProfiling();
}

void ResetCoverageProfile(VirtualMachine *vm)
{
        vm->ResetCoverageProfile();
}

/// Encodes function profile data
void EncodeCoverageProfileData(ProfileData const &profiledata, VirtualMachine *vm, VarId id_set)
{
        StackMachine &stackm = vm->GetStackMachine();

        ColumnNameId col_libraries = stackm.columnnamemapper.GetMapping("LIBRARIES");
        ColumnNameId col_liburi = vm->columnnamemapper.GetMapping("LIBURI");
        ColumnNameId col_compile_id = vm->columnnamemapper.GetMapping("COMPILE_ID");
        ColumnNameId col_visitedcode = vm->columnnamemapper.GetMapping("VISITEDCODE");
        ColumnNameId col_lines = vm->columnnamemapper.GetMapping("LINES");

        stackm.InitVariable(id_set, VariableTypes::Record);

        VarId var_libraries = stackm.RecordCellCreate(id_set, col_libraries);
        stackm.ArrayInitialize(var_libraries, 0, VariableTypes::RecordArray);

        for (auto &lib: profiledata.coverage_data)
        {
                VarId cell = stackm.ArrayElementAppend(var_libraries);
                stackm.RecordInitializeEmpty(cell);
                stackm.SetSTLString(stackm.RecordCellCreate(cell, col_liburi), lib.first->GetLibURI());
                stackm.SetDateTime(stackm.RecordCellCreate(cell, col_compile_id), lib.first->GetWrappedLibrary().resident.compile_id);
                stackm.SetDateTime(stackm.RecordCellCreate(cell, col_compile_id), lib.first->GetWrappedLibrary().resident.sourcetime);
                VarId var_visitedcode = stackm.RecordCellCreate(cell, col_visitedcode);
                VarId var_lines = stackm.RecordCellCreate(cell, col_lines);

                Blex::PodVector< int32_t > lines;

                HareScript::SectionDebug const &debug = lib.first->GetWrappedLibrary().debug;

                stackm.InitVariable(var_visitedcode, VariableTypes::IntegerArray);
                stackm.InitVariable(var_lines, VariableTypes::IntegerArray);
                unsigned pos = 0;
                for (Blex::PodVector< uint8_t >::iterator it = lib.second->begin(), e = lib.second->end(); it != e; ++it, ++pos)
                    if (*it)
                    {
                            VarId var_idx = stackm.ArrayElementAppend(var_visitedcode);
                            stackm.SetInteger(var_idx, pos);

                            Blex::MapVector<uint32_t, Blex::Lexer::LineColumn>::const_iterator entry = debug.debugentries.UpperBound(pos);
                            if (entry != debug.debugentries.Begin())
                            {
                                    --entry;
                                    lines.push_back(entry->second.line);
                            }
                    }

                std::sort(lines.begin(), lines.end());
                lines.erase(std::unique(lines.begin(), lines.end()), lines.end());

                for (auto line: lines)
                    stackm.SetInteger(stackm.ArrayElementAppend(var_lines), line);
        }
}

/// Encodes function profile data
void GetCoverageProfileData(VarId id_set, VirtualMachine *vm)
{
        EncodeCoverageProfileData(vm->GetProfileData(), vm, id_set);
}

void GetVMStatistics(VarId id_set, VirtualMachine *vm)
{
        HSVM_GetVMStatistics(*vm, id_set, *vm);
}

struct PacketType
{
        char type;
        enum
        {
                NoRepeat,
                HaveCounter,
                HaveQuestion,
                HaveAsterisk
        } repeat;
        unsigned repeatcounter;
        HSVM_ColumnId colid;
};

PacketType GetPacketType(HSVM *vm, char const *start_item, char const *end_item)
{
        PacketType retval;
        retval.type=0;
        retval.colid=-1;
        retval.repeat=PacketType::NoRepeat;
        retval.repeatcounter=0;

        //Format is:  [cell]:type
        const char* colon = std::find(start_item,end_item,':');
        if (colon == end_item)
            return retval;//ill-formatted

        //Try to parse the column name
        if (colon != start_item && std::distance(start_item, colon) < (HSVM_MaxColumnName-1))
        {
                char colname[HSVM_MaxColumnName];
                memcpy(colname, start_item, std::distance(start_item, colon));
                colname[std::distance(start_item, colon)] = 0;
                retval.colid = HSVM_GetColumnId(vm, colname);
        }
        start_item=colon;
        if (++start_item == end_item) //still illformatted..
            return retval;

        retval.type=*start_item;
        if (++start_item < end_item) //see what more we can decode
        {
                if (*start_item=='?' || *start_item=='*')
                {
                        retval.repeat=*start_item=='?' ? PacketType::HaveQuestion : PacketType::HaveAsterisk;
                        if (++start_item < end_item) //ill-formatted
                            retval.type=0;
                }
                else
                {
                        std::pair<uint32_t,char const *> typeinfo = Blex::DecodeUnsignedNumber<uint32_t>(start_item, end_item);
                        retval.repeatcounter = typeinfo.first;
                        if (typeinfo.second != end_item) //ill-formatted (data after counter)
                            retval.type=0;
                        else
                            retval.repeat=PacketType::HaveCounter;
                }
        }
        else
        {
                retval.repeat = PacketType::NoRepeat;
        }
        return retval;

}

int64_t DecodePacket_Integer64(const char *dataptr, bool bigendian, bool is_signed)
{
        if (is_signed)
            return (int64_t)(bigendian ? Blex::gets64msb : Blex::gets64lsb)(dataptr);
        else
            return (bigendian ? Blex::getu64msb : Blex::getu64lsb)(dataptr);
}
int32_t DecodePacket_Integer(const char *dataptr, unsigned size, bool bigendian, bool is_signed)
{
        //Add the value
        switch(size)
        {
        case 1: // 8 bits
                return is_signed ? (int32_t)Blex::gets8(dataptr) : Blex::getu8(dataptr);
        case 2: // 16 bits
                if (is_signed)
                    return (int32_t)(bigendian ? Blex::gets16msb : Blex::gets16lsb)(dataptr);
                else
                    return (bigendian ? Blex::getu16msb : Blex::getu16lsb)(dataptr);
        default:// 4 - 32 bits
                if (is_signed)
                    return (int32_t)(bigendian ? Blex::gets32msb : Blex::gets32lsb)(dataptr);
                else
                    return (bigendian ? Blex::getu32msb : Blex::getu32lsb)(dataptr);
        }
}

F64 DecodePacket_Float(const char *dataptr, unsigned bytes, bool bigendian)
{
        //Add the value
        switch(bytes)
        {
        case 4: // 32 bits
                return (bigendian ? Blex::getf32msb : Blex::getf32lsb)(dataptr);
        default://8 - 64bits
                return (bigendian ? Blex::getf64msb : Blex::getf64lsb)(dataptr);
        }
}

struct PacketFieldTypeData
{
        bool is_signed;
        ptrdiff_t bytes;
        bool big_endian;
        HSVM_VariableType type;

        bool FillFromType(char type);
};

bool PacketFieldTypeData::FillFromType(char packettype)
{
        is_signed = packettype >= 'a' && packettype <= 'z';
        big_endian = false;

        switch (packettype)
        {
        case 'b':
        case 'B':
        case 'd':
        case 'D': // int64_t/uint64_t little(signed/unsigned) big(signed/unsigned)
            {
                    bytes = 8;
                    big_endian = (packettype & 0xDF) == 'D';
                    type = HSVM_VAR_Integer64;
            } break;
        case 'h':
        case 'i': // DATETIME (little, big)
            {
                    bytes = 8;
                    big_endian = packettype == 'i';
                    type = HSVM_VAR_DateTime;
            } break;
        case 'F':
        case 'G': // Double  (little, big)
            {
                    bytes = 8;
                    big_endian = packettype == 'G';
                    type = HSVM_VAR_Float;
            } break;
        case 'c':
        case 'C': // uint8_t/int8_t
            {
                    bytes = 1;
                    type = HSVM_VAR_Integer;
            } break;
        case 'j': // boolean
            {
                    bytes = 1;
                    type = HSVM_VAR_Boolean;
            } break;
        case 'f':
        case 'g': // FLOAT,
            {
                    bytes = 4;
                    big_endian = packettype == 'g';
                    type = HSVM_VAR_Float;
            } break;
        case 'l':
        case 'L':
        case 'p':
        case 'P': // int32_t/uint32_t
            {
                    bytes = 4;
                    big_endian = (packettype & 0xDF) == 'P';
                    type = HSVM_VAR_Integer;
            } break;
        case 'n':
        case 'N':
        case 's':
        case 'S': // int16_t/uint16_t
            {
                    bytes = 2;
                    big_endian = (packettype & 0xDF) == 'N';
                    type = HSVM_VAR_Integer;
            } break;
        default:
            {
                    return false;
            }
        }
        return true;
}

const char *DecodePacket_Field(VirtualMachine *vm, HSVM_VariableId store, PacketType const &packet, const char *start_data, const char *end_data, const char *datapos)
{
        if (store == 0 && (packet.repeat == PacketType::HaveQuestion || strchr("cCsSlLnNpPfFgGbBdDhij", packet.type)))
            return NULL; //With a question mark or one of these types, you HAVE to have a store
        if (packet.repeat == PacketType::HaveQuestion && !strchr("x", packet.type))
            return NULL; //that type doesn't support question marks, or we don't have the required integer as the repeat count
        if (packet.repeat == PacketType::HaveAsterisk && !strchr("xcCsSlLnNpPaArfFgGbBdDhij", packet.type))
            return NULL; //that type doesn't support unlimited lengths

        if (packet.type == 'x')
        {
                if (packet.repeat == PacketType::HaveQuestion && store != 0) //asking for the number of NULs
                {
                        unsigned count = 0;
                        while(datapos != end_data && *datapos==0)
                            ++count, ++datapos;
                        HSVM_IntegerSet(*vm,store,count);
                        return datapos;
                }
                if (store!=0 || packet.repeat==PacketType::HaveQuestion)
                     return NULL; //ill-formatted (can't store a thing, or require a place to store..)
                if (packet.repeat == PacketType::HaveAsterisk) //ask to skip an uninteresting number of NULs
                {
                        while(datapos != end_data && *datapos==0)
                            ++datapos;
                        return datapos;
                }
                //skip the specified number of nuls
                unsigned toskip = packet.repeat == PacketType::HaveCounter ? packet.repeatcounter : 1;
                while (datapos != end_data && *datapos==0 && toskip>0)
                    ++datapos,--toskip;
                return toskip>0 ? NULL /*not enough NULs*/ : datapos;/*it worked!*/
        }

        if (strchr("cCsSlLnNpPfFgGbBdDjhi",packet.type)) //One of the special conversions
        {
                PacketFieldTypeData typedata;
                if (!typedata.FillFromType(packet.type))
                    return NULL;

                PACKET_PRINT("DP special " << packet.type << " " << GetTypeName((VariableTypes::Type)typedata.type) << " bytes:" << typedata.bytes << " be:" << typedata.big_endian << " signed:" << typedata.is_signed
                      << " bytesavail: " << end_data - datapos);

                unsigned maxcount = 1;
                bool isarray = packet.repeat == PacketType::HaveAsterisk || packet.repeat == PacketType::HaveCounter; //repeated....
                if (isarray)
                {
                        HSVM_SetDefault(*vm, store, typedata.type | HSVM_VAR_Array);
                        if (packet.repeat == PacketType::HaveAsterisk)
                            maxcount = std::numeric_limits< int >::max();
                        else
                            maxcount = packet.repeatcounter;
                }

                HSVM_VariableId target = store;
                unsigned count = 0;

                while (end_data - datapos >= typedata.bytes)
                {
                        PACKET_PRINT(" loop " << count << "/" << maxcount);
                        if (isarray)
                            target = HSVM_ArrayAppend(*vm, store);

                        switch (typedata.type)
                        {
                        case HSVM_VAR_Integer64:
                            {
                                    HSVM_Integer64Set(*vm, target, DecodePacket_Integer64(datapos, typedata.big_endian, typedata.is_signed));
                            } break;
                        case HSVM_VAR_DateTime:
                            {
                                    int32_t days = DecodePacket_Integer(datapos, 4, typedata.big_endian, false);
                                    int32_t msecs = DecodePacket_Integer(datapos + 4, 4, typedata.big_endian, false);

                                    HSVM_DateTimeSet(*vm, target, days, msecs);
                            } break;
                        case HSVM_VAR_Float:
                            {
                                    HSVM_FloatSet(*vm, target, DecodePacket_Float(datapos, typedata.bytes, typedata.big_endian));
                            } break;
                        case HSVM_VAR_Integer:
                            {
                                    HSVM_IntegerSet(*vm, target, DecodePacket_Integer(datapos, typedata.bytes, typedata.big_endian, typedata.is_signed));
                            } break;
                        case HSVM_VAR_Boolean:
                            {
                                    HSVM_BooleanSet(*vm, target, DecodePacket_Integer(datapos, 1, false, false) != 0);
                            } break;
                        default:
                            {
                                    PACKET_PRINT(" not enough" << count << "/" << maxcount);
                                    return NULL;
                            }
                        }

                        datapos += typedata.bytes;
                        ++count;

                        if (count == maxcount)
                            break;
                }

                if (packet.repeat != PacketType::HaveAsterisk && count != maxcount)
                {
                        PACKET_PRINT(" not enough " << count << "/" << maxcount);
                        return NULL; //not enough!
                }

                return datapos;
        }

        if (packet.type=='a' || packet.type=='A') //NUL or ASCII padded string
        {
                if (packet.repeat == PacketType::HaveAsterisk)
                {
                        //Eat until next space/0 byte
                        const char *fieldend = std::find(datapos, end_data, packet.type=='a'?0:32);
                        if (fieldend == end_data)
                            return NULL; //can't find it!

                        if(store)
                            HSVM_StringSet(*vm, store, datapos, fieldend);
                        return fieldend+1; //eat the terminator
                }
                else if (packet.repeat == PacketType::HaveCounter)
                {
                        if (static_cast<unsigned>(std::distance(datapos, end_data)) < packet.repeatcounter)
                             return NULL; //Not enough data

                        //Strip padding
                        const char *fieldend = datapos + packet.repeatcounter;
                        while (fieldend > datapos && fieldend[-1] == (packet.type=='a'?0:32))
                            --fieldend;

                        if(store)
                            HSVM_StringSet(*vm, store, datapos, fieldend);
                        return datapos+packet.repeatcounter; //eat it all
                }
                else
                {
                        return NULL;
                }
        }

        if (packet.type=='r')
        {
                if (packet.repeat == PacketType::HaveAsterisk)
                {
                        //Eat remainder
                        if(store)
                            HSVM_StringSet(*vm, store, datapos, end_data);
                        return end_data;
                }
                else if (packet.repeat == PacketType::HaveCounter)
                {
                        if (static_cast<unsigned>(std::distance(datapos, end_data)) < packet.repeatcounter)
                             return NULL; //Not enough data
                        if(store)
                            HSVM_StringSet(*vm, store,datapos, datapos+packet.repeatcounter);
                        return datapos+packet.repeatcounter;
                }
                else
                {
                        return NULL;
                }
        }

        if (packet.type=='@' && packet.repeat == PacketType::HaveCounter) //jump to position
        {
                return std::min(start_data + packet.repeatcounter, end_data);
        }

        return NULL;
}

void DecodePacket(VarId id_set, VirtualMachine *vm)
{
        static const char dummy[1]={""};
        Blex::StringPair data, indata;
        //SPEEDUP: Without a reallocating VM, we could restore the original stringpairs here
        //HSVM_StringGet(*vm, HSVM_Arg(0), &indata.begin, &indata.end);
        //HSVM_StringGet(*vm, HSVM_Arg(1), &data.begin, &data.end);
        std::string indatastore = HSVM_StringGetSTD(*vm, HSVM_Arg(0));
        indata.begin = &indatastore[0];
        indata.end = &indatastore[indatastore.size()];

        PACKET_PRINT("Decodepacket '" << indatastore << "'");

        std::string datastore = HSVM_StringGetSTD(*vm, HSVM_Arg(1));
        data.begin = &datastore[0];
        data.end = &datastore[datastore.size()];


        HSVM_RecordSetEmpty(*vm, id_set);

        if (data.begin==data.end)
            data.begin = data.end = dummy; //otherwise we can't see the difference between NULL (error) and NULL (no data)

        const char *datapos=data.begin;
        for (Blex::TokenIterator<Blex::StringPair> tok(indata.begin, indata.end, ',');tok;++tok)
        {
                PacketType packtype = GetPacketType(*vm, tok.begin(), tok.end());
                HSVM_VariableId datavar=0;
                if(!packtype.type)
                {
                        PACKET_PRINT("GetPacketType failed for '" << std::string(tok.begin(), tok.end()) << "'");
                        HSVM_ThrowException(*vm, ("Invalid packet definition part '" +std::string(tok.begin(), tok.end()) + "'").c_str());
                        return; //failed!
                }

                if (packtype.colid != -1)
                    datavar = HSVM_RecordCreate(*vm, id_set, packtype.colid);

                datapos = packtype.type ? DecodePacket_Field(vm, datavar, packtype, data.begin, data.end, datapos) : NULL;
                if (!datapos)
                {
                        PACKET_PRINT("Decodepacket_field failed for '" << std::string(tok.begin(), tok.end()) << "'");
                        HSVM_SetDefault(*vm,id_set,HSVM_VAR_Record);
                        return; //failed!
                }
        }
        PACKET_PRINT("Decodepacket finished ok");
}

void EncodePacket_Float(std::vector<uint8_t> &retval, F64 value, unsigned bytes, bool bigendian)
{
        //Add the value
        switch(bytes)
        {
        case 4: // 32bits
                retval.resize(retval.size() + 4);
                (bigendian ? Blex::putf32msb : Blex::putf32lsb)(&retval[retval.size()-4], value);
                return;
        default://64
                retval.resize(retval.size() + 8);
                (bigendian ? Blex::putf64msb : Blex::putf64lsb)(&retval[retval.size()-8], value);
                return;
        }
}


void EncodePacket_Integer64(std::vector<uint8_t> &retval, uint64_t value, bool bigendian)
{
        retval.resize(retval.size() + 8);
        (bigendian ? Blex::putu64msb : Blex::putu64lsb)(&retval[retval.size()-8], value);
}

void EncodePacket_Integer(std::vector<uint8_t> &retval, uint32_t value, unsigned bytes, bool bigendian)
{
        //Add the value
        switch(bytes)
        {
        case 1: // 8 bits
                retval.resize(retval.size() + 1);
                Blex::putu8(&retval[retval.size()-1], value);
                return;
        case 2: // 16 bits
                retval.resize(retval.size() + 2);
                (bigendian ? Blex::putu16msb : Blex::putu16lsb)(&retval[retval.size()-2], value);
                return;
        default:// 4 - 32 bits
                retval.resize(retval.size() + 4);
                (bigendian ? Blex::putu32msb : Blex::putu32lsb)(&retval[retval.size()-4], value);
                return;
        }
}

bool EncodePacket_Field(VirtualMachine *vm, std::vector<uint8_t> &retval, HSVM_VariableId datavar, PacketType const &packet)
{
        if (packet.repeat == PacketType::HaveAsterisk && !strchr("cCsSlLnNbBdDaArfFgGhijpP", packet.type))
            return false; //that type doesn't support unlimited lengths

        if (packet.type == '@' && packet.repeat == PacketType::HaveCounter)
        {
                retval.resize(packet.repeatcounter,0); //truncate or pad with zeroes
                return true;
        }
        if (packet.type == 'x' && packet.repeat != PacketType::HaveQuestion) // NUL byte
        {
                retval.insert(retval.end(), packet.repeat == PacketType::HaveCounter ? packet.repeatcounter : 1, 0);
                return true;
        }
        if (!datavar)
            return false; //all remaining ones require a variable

        int datatype = HSVM_GetType(*vm, datavar);

        if (packet.repeat == PacketType::HaveQuestion && (!strchr("x", packet.type) || datatype != HSVM_VAR_Integer))
            return false; //that type doesn't support question marks, or we don't have the required integer as the repeat count

        if (packet.type == 'a' || packet.type == 'A') //NUL-padded or SPACE-padded string
        {
                if (datatype != HSVM_VAR_String)
                     return false; //bad type

                Blex::StringPair the_str;
                HSVM_StringGet(*vm, datavar, &the_str.begin, &the_str.end);

                if (packet.repeat == PacketType::HaveCounter)
                {
                        retval.resize(retval.size() + packet.repeatcounter, packet.type=='a' ? 0 : 32);
                        memcpy(&retval[retval.size() - packet.repeatcounter], the_str.begin, std::min<uint32_t>(packet.repeatcounter, the_str.size()));
                }
                else
                {
                        retval.insert(retval.end(), the_str.begin, the_str.end);
                        if (packet.repeat == PacketType::HaveAsterisk)
                            retval.push_back(packet.type=='a' ? 0 : 32);
                }
                return true;
        }

        if (packet.type == 'x') // NUL byte
        {
                if(datatype != HSVM_VAR_Integer)
                    return false;

                retval.insert(retval.end(), HSVM_IntegerGet(*vm, datavar), 0);
                return true;
        }
        if (strchr("cCsSlLnNpPfFgGbBdDhij",packet.type)) //One of the special conversions
        {
                PacketFieldTypeData typedata;
                if (!typedata.FillFromType(packet.type))
                    return false;

                HSVM_VariableType basetype = datatype & ~HSVM_VAR_Array;
                HSVM_VariableId var = datavar;

                PACKET_PRINT("EP special " << packet.type << " " << GetTypeName((VariableTypes::Type)typedata.type)
                    << " datatype:" << GetTypeName((VariableTypes::Type)datatype)
                    << " basetype:" << GetTypeName((VariableTypes::Type)basetype)
                    << " bytes:" << typedata.bytes << " be:" << typedata.big_endian << " signed:" << typedata.is_signed);

                unsigned count = 1;
                bool isarray = packet.repeat == PacketType::HaveAsterisk || packet.repeat == PacketType::HaveCounter;
                if (isarray) //repeated
                {
                          PACKET_PRINT("Is array " << packet.repeat << " count " << packet.repeatcounter);
                          if (!(datatype & HSVM_VAR_Array))
                              return false;

                          count = HSVM_ArrayLength(*vm, datavar);
                          PACKET_PRINT(" Have " << count << " elts");
                          if (packet.repeat == PacketType::HaveCounter && count != packet.repeatcounter)
                              return false;
                }

                switch (typedata.type)
                {
                case HSVM_VAR_Float:
                    {
                            if (basetype != HSVM_VAR_Integer && basetype != HSVM_VAR_Integer64 && basetype != HSVM_VAR_Boolean && basetype != HSVM_VAR_Float)
                                return false;
                    } break;
                case HSVM_VAR_Integer64:
                case HSVM_VAR_Integer:
                case HSVM_VAR_Boolean:
                    {
                            if (basetype != HSVM_VAR_Integer && basetype != HSVM_VAR_Integer64 && basetype != HSVM_VAR_Boolean)
                                return false;
                    } break;
                default:
                    {
                            if (basetype != typedata.type)
                                return false;
                    }
                }

                for (unsigned idx = 0; idx < count; ++idx)
                {
                        if (isarray)
                            var = HSVM_ArrayGetRef(*vm, datavar, idx);

                        switch (typedata.type)
                        {
                        case HSVM_VAR_Float:
                            {
                                    EncodePacket_Float(retval,
                                                          basetype == HSVM_VAR_Float ? HSVM_FloatGet(*vm, var) :
                                                          basetype == HSVM_VAR_Integer64 ? HSVM_Integer64Get(*vm, var) :
                                                          basetype == HSVM_VAR_Integer ? HSVM_IntegerGet(*vm, var)
                                                                                            : (HSVM_BooleanGet(*vm, var) ? 1 : 0),
                                                          typedata.bytes, typedata.big_endian);
                            } break;
                        case HSVM_VAR_Integer64:
                           {
                                    EncodePacket_Integer64(retval,
                                                          basetype == HSVM_VAR_Integer ? HSVM_IntegerGet(*vm, var) :
                                                          basetype == HSVM_VAR_Integer64 ? HSVM_Integer64Get(*vm, var)
                                                                                            : (HSVM_BooleanGet(*vm, var) ? 1 : 0),
                                                          typedata.big_endian);
                            } break;
                        case HSVM_VAR_Integer:
                            {
                                    EncodePacket_Integer(retval,
                                                          basetype == HSVM_VAR_Integer ? HSVM_IntegerGet(*vm, var) :
                                                          basetype == HSVM_VAR_Integer64 ? HSVM_Integer64Get(*vm, var)
                                                                                           : (HSVM_BooleanGet(*vm, var) ? 1 : 0),
                                                          typedata.bytes, typedata.big_endian);
                            } break;
                        case HSVM_VAR_DateTime:
                            {
                                    int32_t days, msecs;
                                    HSVM_DateTimeGet(*vm, var, &days, &msecs);

                                    EncodePacket_Integer(retval, days, 32, typedata.big_endian);
                                    EncodePacket_Integer(retval, msecs, 32, typedata.big_endian);
                            } break;
                        case HSVM_VAR_Boolean:
                            {
                                    EncodePacket_Integer(retval,
                                                          basetype == HSVM_VAR_Integer ? (HSVM_IntegerGet(*vm, var) ? 1 : 0) :
                                                          basetype == HSVM_VAR_Integer64 ? (HSVM_Integer64Get(*vm, var) ? 1 : 0)
                                                                                           : (HSVM_BooleanGet(*vm, var) ? 1 : 0),
                                                          1, false);
                            } break;
                        default:
                            {
                                    return false;
                            }
                        }
                }
                return true;
        }
        if (packet.type=='h' || packet.type=='i')//Datetimes
        {
                bool bigendian = (packet.type&0xDF)=='I';

                if (packet.repeat == PacketType::HaveAsterisk) //repeated
                {
                        if (datatype != HSVM_VAR_DateTimeArray)
                            return false;

                        unsigned arraylen = HSVM_ArrayLength(*vm, datavar);
                        for (unsigned i=0; i<arraylen; ++i)
                        {
                                HSVM_VariableId elementid = HSVM_ArrayGetRef(*vm, datavar, i);

                                int32_t days, msecs;
                                HSVM_DateTimeGet(*vm, elementid, &days, &msecs);

                                EncodePacket_Integer(retval, days, 32, bigendian);
                                EncodePacket_Integer(retval, msecs, 32, bigendian);
                        }
                }
                else
                {
                        if (datatype != HSVM_VAR_DateTime)
                            return false;

                        int32_t days, msecs;
                        HSVM_DateTimeGet(*vm, datavar, &days, &msecs);

                        EncodePacket_Integer(retval, days, 32, bigendian);
                        EncodePacket_Integer(retval, msecs, 32, bigendian);
                }
                return true;
        }
        if (packet.type=='r' && datatype == HSVM_VAR_String)//Raw
        {
                Blex::StringPair data;
                HSVM_StringGet(*vm, datavar, &data.begin, &data.end);

                if (packet.repeat == PacketType::HaveCounter)
                {
                        retval.insert(retval.end(), data.begin, data.begin + std::min<std::size_t>(data.size(), packet.repeatcounter));
                        return true;
                }
                else if (packet.repeat == PacketType::HaveAsterisk)
                {
                        retval.insert(retval.end(), data.begin, data.end);
                        return true;
                }
        }
        return false;
}

void EncodePacket(VarId id_set, VirtualMachine *vm)
{
        std::vector<uint8_t> retval;
        Blex::StringPair indata;
        //SPEEDUP: Without a reallocating VM, we could restore the original stringpairs here
        //HSVM_StringGet(*vm, HSVM_Arg(0), &indata.begin, &indata.end);
        std::string indatastore = HSVM_StringGetSTD(*vm, HSVM_Arg(0));
        indata.begin = &indatastore[0];
        indata.end = &indatastore[indatastore.size()];

        for (Blex::TokenIterator<Blex::StringPair> tok(indata.begin, indata.end, ',');tok;++tok)
        {
                PacketType packtype = GetPacketType(*vm, tok.begin(), tok.end());
                HSVM_VariableId datavar=0;
                if (packtype.colid != -1)
                    datavar = HSVM_RecordGetRef(*vm, HSVM_Arg(1), packtype.colid);

                if (!packtype.type || !EncodePacket_Field(vm, retval, datavar, packtype))
                {
                        HSVM_ThrowException(*vm, ("Invalid packet definition '" + std::string(tok.begin(),tok.end()) + "'").c_str());
                        return; //failed!
                }
        }

        HSVM_StringSet(*vm, id_set, reinterpret_cast<const char*>(&retval[0]), reinterpret_cast<const char*>(&retval[retval.size()]));
}

void GetStoredScriptProperty(VarId id_set, VirtualMachine *vm)
{
        std::string priv = HSVM_StringGetSTD(*vm, HSVM_Arg(0));
        Blex::ToUppercase(priv.begin(), priv.end());

        if (priv == "FILECREATIONDATE")
            HSVM_DateTimeSet(*vm, id_set, vm->GetScriptParameter_FileCreationDate().GetDays(), vm->GetScriptParameter_FileCreationDate().GetMsecs());
        else if (priv == "FILEID")
            HSVM_IntegerSet(*vm, id_set, vm->GetScriptParameter_FileId());
        else
            HSVM_BooleanSet(*vm, id_set, false);
}

void UnmangleFunctionName(VarId id_set, VirtualMachine *vm)
{
        HSVM_ColumnId col_functionname = HSVM_GetColumnId(*vm, "FUNCTIONNAME");
        HSVM_ColumnId col_modulename = HSVM_GetColumnId(*vm, "MODULENAME");
        HSVM_ColumnId col_returntype = HSVM_GetColumnId(*vm, "RETURNTYPE");
        HSVM_ColumnId col_parameters = HSVM_GetColumnId(*vm, "PARAMETERS");

        // Mangling function need 0-terminated string
        std::string mangledname = HSVM_StringGetSTD(*vm, HSVM_Arg(0));
        const char *mangledname_cstr = mangledname.c_str();

        HSVM_SetDefault(*vm, id_set, HSVM_VAR_Record);
        HSVM_VariableId var_functionname = HSVM_RecordCreate(*vm, id_set, col_functionname);
        HSVM_VariableId var_modulename = HSVM_RecordCreate(*vm, id_set, col_modulename);
        HSVM_VariableId var_returntype = HSVM_RecordCreate(*vm, id_set, col_returntype);
        HSVM_VariableId var_parameters = HSVM_RecordCreate(*vm, id_set, col_parameters);

        HSVM_StringSetStringPair(*vm, var_functionname, Mangling::GetFunctionName(mangledname_cstr));
        HSVM_StringSetStringPair(*vm, var_modulename, Mangling::GetModuleName(mangledname_cstr));
        HSVM_IntegerSet(*vm, var_returntype, Mangling::GetReturnType(mangledname_cstr));

        HSVM_SetDefault(*vm, var_parameters, HSVM_VAR_IntegerArray);
        const char *cur_parameter = Mangling::GetParameterSection(mangledname_cstr);

        while (cur_parameter)
        {
              HSVM_VariableId param = Mangling::GetParameter(&cur_parameter);
              if (!param)
                break;

              HSVM_IntegerSet(*vm, HSVM_ArrayAppend(*vm, var_parameters), param);
        }
}

void EnsureLibraryLoaded(VarId id_set, VirtualMachine *vm)
{
        HSVM_SetDefault(*vm, id_set, HSVM_VAR_Record);

        HSVM_ColumnId col_status = HSVM_GetColumnId(*vm, "STATUS");
        HSVM_ColumnId col_errors = HSVM_GetColumnId(*vm, "ERRORS");

        HSVM_VariableId var_status = HSVM_RecordCreate(*vm, id_set, col_status);
        HSVM_VariableId var_errors = HSVM_RecordCreate(*vm, id_set, col_errors);
        HSVM_SetDefault(*vm, var_errors, HSVM_VAR_RecordArray);

        int retval = HSVM_ScheduleLibraryLoad(*vm, HSVM_Arg(0), var_errors);

        static const char *str_ok = "ok";
        static const char *str_notfound = "notfound";
        static const char *str_errors = "errors";
        static const char *str_unknown = "unknown";

        switch (retval)
        {
        case -2:        HSVM_StringSet(*vm, var_status, str_errors, str_errors + 6); break;
        case -1:        HSVM_StringSet(*vm, var_status, str_notfound, str_notfound + 8); break;
        case 0:         HSVM_StringSet(*vm, var_status, 0, 0); break;
        case 1:         HSVM_StringSet(*vm, var_status, str_ok, str_ok + 2); break;
        default:        HSVM_StringSet(*vm, var_status, str_unknown, str_unknown + 7);
        }
}

void MakeFunctionPtr(VarId id_set, VirtualMachine *vm)
{
        int32_t returntype = HSVM_IntegerGet(*vm, HSVM_Arg(2));
        std::vector< HSVM_VariableType > args(HSVM_ArrayLength(*vm, HSVM_Arg(3)));
        for(unsigned i=0;i<args.size();++i)
            args[i]=HSVM_IntegerGet(*vm, HSVM_ArrayGetRef(*vm, HSVM_Arg(3), i));

        HSVM_ColumnId col_status = HSVM_GetColumnId(*vm, "STATUS");
        HSVM_ColumnId col_pointer = HSVM_GetColumnId(*vm, "POINTER");
        HSVM_ColumnId col_errors = HSVM_GetColumnId(*vm, "ERRORS");

        HSVM_SetDefault(*vm, id_set, HSVM_VAR_Record);
        HSVM_VariableId var_status = HSVM_RecordCreate(*vm, id_set, col_status);
        HSVM_VariableId var_pointer = HSVM_RecordCreate(*vm, id_set, col_pointer);
        HSVM_VariableId var_errors = HSVM_RecordCreate(*vm, id_set, col_errors);
        HSVM_SetDefault(*vm, var_pointer, HSVM_VAR_FunctionPtr);
        HSVM_SetDefault(*vm, var_errors, HSVM_VAR_RecordArray);

        static const char *str_ok = "ok";
        static const char *str_notfound = "notfound";
        static const char *str_errors = "errors";
        static const char *str_unknown = "unknown";
        static const char *str_wrongsignature ="wrongsignature";

        int retval;

        if (returntype < 0)
        {
          retval = HSVM_MakeFunctionPtrWithVarsAutodetect(*vm
                            ,var_pointer
                            ,HSVM_Arg(0)
                            ,HSVM_Arg(1)
                            ,var_errors);
        }
        else
        {
          retval = HSVM_MakeFunctionPtrWithVars(*vm
                            ,var_pointer
                            ,HSVM_Arg(0)
                            ,HSVM_Arg(1)
                            ,returntype
                            ,args.size()
                            ,&args[0]
                            ,var_errors);
        }

        switch (retval)
        {
        case -3:        HSVM_StringSet(*vm, var_status, str_wrongsignature, str_wrongsignature + 14); break;
        case -2:        HSVM_StringSet(*vm, var_status, str_errors, str_errors + 6); break;
        case -1:        HSVM_StringSet(*vm, var_status, str_notfound, str_notfound + 8); break;
        case 0:         HSVM_StringSet(*vm, var_status, 0, 0); break;
        case 1:         HSVM_StringSet(*vm, var_status, str_ok, str_ok + 2); break;
        default:        HSVM_StringSet(*vm, var_status, str_unknown, str_unknown + 7);
        }
}

void ResolveAbsoluteLibrary(VarId id_set, VirtualMachine *vm)
{
        std::string base = HSVM_StringGetSTD(*vm, HSVM_Arg(0));
        if(base.empty())
            base = vm->GetExecuteLibrary();

        std::string toload = HSVM_StringGetSTD(*vm, HSVM_Arg(1));
        try
        {
                vm->GetFileSystem().ResolveAbsoluteLibrary(vm->GetContextKeeper(), base, &toload);
        }
        catch (VMRuntimeError &e)
        {
                HSVM_ThrowException(*vm, ("Could not resolve library '" + toload + "': " + std::string(e.what())).c_str());
        }

        HSVM_StringSetSTD(*vm, id_set, toload);
}

void TranslateLibraryPath(VarId id_set, VirtualMachine *vm)
{
        std::string path = HSVM_StringGetSTD(*vm, HSVM_Arg(0));
        try
        {
                HSVM_StringSetSTD(*vm, id_set, vm->GetFileSystem().TranslateLibraryURI(vm->GetContextKeeper(), "direct::" + path));
        }
        catch (VMRuntimeError &e)
        {
                HSVM_ThrowException(*vm, ("Could not resolve library '" + path + "': " + std::string(e.what())).c_str());
        }
}

void OverrideExecuteLibrary(VarId id_set, VirtualMachine *vm)
{
        std::string libraryuri = HSVM_StringGetSTD(*vm, HSVM_Arg(0));
        if (!libraryuri.empty())
        {
                try
                {
                        vm->GetFileSystem().ResolveAbsoluteLibrary(vm->GetContextKeeper(), vm->GetExecuteLibrary(), &libraryuri);
                }
                catch (VMRuntimeError &e)
                {
                        HSVM_ThrowException(*vm, ("Could not resolve library '" + libraryuri + "': " + std::string(e.what())).c_str());
                        return;
                }

                vm->OverrideExecuteLibrary(libraryuri);
        }

        HSVM_StringSetSTD(*vm, id_set, vm->GetExecuteLibrary());
}

void CallMacroPtrVA(VirtualMachine *)
{
        ThrowInternalError("CallMacroPtrVA should have been translated by the compiler - the function itself may not be called!");
}

void CallFunctionPtrVA(VarId, VirtualMachine *)
{
        ThrowInternalError("CallFunctionPtrVA should have been translated by the compiler - the function itself may not be called!");
}

void GetLibraryInfo(VarId id_set, VirtualMachine *vm)
{
        std::string libraryuri = HSVM_StringGetSTD(*vm, HSVM_Arg(0));

        HSVM_SetDefault(*vm, id_set, HSVM_VAR_Record);
        HSVM_VariableId errors = HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, "ERRORS"));
        HSVM_SetDefault(*vm, errors, HSVM_VAR_RecordArray);

        LibraryInfo info;
        bool loadable;
        bool valid = true;
        try
        {
                vm->GetLibraryInfo(libraryuri, &info);
                loadable = info.loaded || !info.outofdate;
        }
        catch (VMRuntimeError &e)
        {
                loadable = info.loaded;
                valid = false;

                vm->GetErrorHandler().AddMessage(e);
                HSVM_GetMessageList(*vm, errors);

                vm->GetErrorHandler().Reset();
        }

        HSVM_BooleanSet(*vm, HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, "OUTOFDATE")), info.outofdate);
        HSVM_BooleanSet(*vm, HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, "LOADED")), info.loaded);
        HSVM_BooleanSet(*vm, HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, "LOADABLE")), loadable);
        HSVM_BooleanSet(*vm, HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, "VALID")), valid);
        HSVM_DateTimeSet(*vm, HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, "COMPILE_ID")), info.compile_id.GetDays(), info.compile_id.GetMsecs());
}

void GetLoadedLibrariesInfo(VarId id_set, VirtualMachine *vm)
{
        bool onlydirectloaded = HSVM_BooleanGet(*vm, HSVM_Arg(0));

        HSVM_SetDefault(*vm, id_set, HSVM_VAR_Record);
        HSVM_VariableId var_errors = HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, "ERRORS"));
        HSVM_SetDefault(*vm, var_errors, HSVM_VAR_RecordArray);

        HSVM_VariableId var_libraries = HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, "LIBRARIES"));
        HSVM_SetDefault(*vm, var_libraries, HSVM_VAR_RecordArray);

        std::vector< LibraryInfo > info;
        try
        {
                if (onlydirectloaded)
                    vm->GetLoadedLibrariesInfo(&info);
                else
                    vm->GetAllLibrariesInfo(&info);
        }
        catch (VMRuntimeError &e)
        {
                vm->GetErrorHandler().AddMessage(e);
                HSVM_GetMessageList(*vm, var_errors);

                vm->GetErrorHandler().Reset();
        }

        for (std::vector< LibraryInfo >::iterator it = info.begin(); it != info.end(); ++it)
        {
                HSVM_VariableId var_elt = HSVM_ArrayAppend(*vm, var_libraries);

                HSVM_StringSetSTD(*vm, HSVM_RecordCreate(*vm, var_elt, HSVM_GetColumnId(*vm, "LIBURI")),  it->uri);
                HSVM_BooleanSet(*vm, HSVM_RecordCreate(*vm, var_elt, HSVM_GetColumnId(*vm, "OUTOFDATE")), it->outofdate);
                HSVM_DateTimeSet(*vm, HSVM_RecordCreate(*vm, var_elt, HSVM_GetColumnId(*vm, "COMPILE_ID")), it->compile_id.GetDays(), it->compile_id.GetMsecs());
        }

}

void RebindFunctionPtr(VarId id_set, VirtualMachine *vm)
{
        std::vector< int > passthroughs(HSVM_ArrayLength(*vm, HSVM_Arg(1)));
        std::vector< HSVM_VariableId > args(HSVM_ArrayLength(*vm, HSVM_Arg(2)));

        if (passthroughs.size() != args.size())
            throw HareScript::VMRuntimeError(Error::InternalError, "Passthrough and defaults arrays were not of equal length when rebinding a function pointer");

        unsigned size = passthroughs.size();
        for(unsigned i=0;i<size;++i)
            passthroughs[i]=HSVM_IntegerGet(*vm, HSVM_ArrayGetRef(*vm, HSVM_Arg(1), i));
        for(unsigned i=0;i<size;++i)
            args[i]=HSVM_ArrayGetRef(*vm, HSVM_Arg(2), i);

        HSVM_RebindFunctionPtr(*vm
                              ,id_set
                              ,HSVM_Arg(0)
                              ,size
                              ,0
                              ,size == 0 ? 0 : &passthroughs[0]
                              ,size == 0 ? 0 : &args[0]
                              ,0
                              ,false);
}

void RebindFunctionPtr2(VarId id_set, VirtualMachine *vm)
{
        ColumnNameId col_source = HSVM_GetColumnId(*vm, "SOURCE");
        ColumnNameId col_value = HSVM_GetColumnId(*vm, "VALUE");
        ColumnNameId col_type = HSVM_GetColumnId(*vm, "TYPE");
//        ColumnNameId col_rettype = columnnamemapper.GetMapping("RETURNTYPE");
//        ColumnNameId col_excessargstype = HSVM_GetColumnId(*vm, "EXCESSARGSTYPE");
//        ColumnNameId col_vm = HSVM_GetColumnId(*vm, "VM");

        unsigned argcount = HSVM_ArrayLength(*vm, HSVM_Arg(1));
        unsigned vectorlen = argcount ? argcount : 1;

        std::vector< int > passthroughs(vectorlen);
        std::vector< HSVM_VariableType > types(vectorlen);
        std::vector< HSVM_VariableId > bound_params(vectorlen);

        StackMachine &stackm = vm->GetStackMachine();

        for(unsigned i = 0; i < argcount; ++i)
        {
                VarId rec = stackm.ArrayElementGet(HSVM_Arg(1), i);

                VarId var_source = stackm.RecordCellGetByName(rec, col_source);
                int32_t source_id = 0;
                if (!var_source || HSVM_GetType(*vm, var_source) != HSVM_VAR_Integer)
                    HSVM_ThrowException(*vm, "Cell 'SOURCE' is required, and MUST be an INTEGER");
                else
                    source_id = stackm.GetInteger(var_source);
                passthroughs[i] = source_id;

                VarId var_type = stackm.RecordCellGetByName(rec, col_type);
                int32_t type_id = 0;
                if (var_type)
                {
                        if (HSVM_GetType(*vm, var_type) != HSVM_VAR_Integer)
                            HSVM_ThrowException(*vm, "The type of cell 'TYPE' must be INTEGER");
                        else
                            type_id = stackm.GetInteger(var_type); // FIXME: type check
                }
                types[i] = type_id;

                VarId var_value = stackm.RecordCellGetByName(rec, col_value);
                bound_params[i] = var_value; // if missing, fill with zero
        }

        int32_t rest_args_start = stackm.GetInteger(HSVM_Arg(2));
        bool keep_vararg = stackm.GetBoolean(HSVM_Arg(3));

        HSVM_RebindFunctionPtr(*vm, id_set, HSVM_Arg(0), argcount, &types[0], &passthroughs[0], &bound_params[0], rest_args_start, keep_vararg);
}

//int HSVM_RebindFunctionPtr(struct HSVM *vm, HSVM_VariableId id_set, HSVM_VariableId functionptr, int numargs, int const *passthroughs, HSVM_VariableId const *bound_params)

void MarshalWriteTo(VirtualMachine *vm)
{
        int print_id = HSVM_IntegerGet(*vm, HSVM_Arg(0));
        std::vector< uint8_t > data;

        Marshaller marshaller(vm, MarshalMode::DataOnly);
        marshaller.WriteToVector(HSVM_Arg(1), &data);

        size_t size = data.size();
        if (size)
        {
                const uint8_t *ptr = &data[0];
                while (size)
                {
                        unsigned towrite = std::min< size_t>(size, 16384);
                        HSVM_PrintTo(*vm, print_id, towrite, ptr);
                        ptr += towrite;
                        size -= towrite;
                }
        }
}

void MarshalPacketWriteTo(VirtualMachine *vm)
{
        int print_id = HSVM_IntegerGet(*vm, HSVM_Arg(0));
        Blex::PodVector< uint8_t > data;

        Marshaller marshaller(vm, MarshalMode::All);
        std::unique_ptr< MarshalPacket > packet(marshaller.WriteToNewPacket(HSVM_Arg(1)));
        packet->WriteToPodVector(&data, &vm->blobmanager);

        size_t size = data.size();
        if (size)
        {
                const uint8_t *ptr = &data[0];
                while (size)
                {
                        unsigned towrite = std::min< size_t>(size, 16384);
                        HSVM_PrintTo(*vm, print_id, towrite, ptr);
                        ptr += towrite;
                        size -= towrite;
                }
        }
}


void MarshalReadFromBlob(VarId id_set, VirtualMachine *vm)
{
        std::vector< uint8_t > data;
        int blobhandle = HSVM_BlobOpen(*vm, HSVM_Arg(0));
        size_t size = HSVM_BlobOpenedLength(*vm, blobhandle);
        data.resize(size);
        if (size == 0)
            throw HareScript::VMRuntimeError(Error::InternalError, "Cannot decode an empty blob");

        uint8_t *ptr = &data[0];
        while (size)
        {
                unsigned toread = std::min< size_t >(size, 65536);
                HSVM_BlobRead(*vm, blobhandle, toread, ptr);

                ptr += toread;
                size -= toread;
        }
        HSVM_BlobClose (*vm, blobhandle);

        Marshaller marshaller(vm, MarshalMode::DataOnly);
        marshaller.ReadFromVector(id_set, data);
}

void MarshalPacketReadFromBlob(VarId id_set, VirtualMachine *vm)
{
        std::vector< uint8_t > data;
        int blobhandle = HSVM_BlobOpen(*vm, HSVM_Arg(0));
        size_t size = HSVM_BlobOpenedLength(*vm, blobhandle);
        data.resize(size);
        if (size == 0)
            throw HareScript::VMRuntimeError(Error::InternalError, "Cannot decode an empty blob");

        uint8_t *ptr = &data[0];
        size_t orgsize = size;
        while (size)
        {
                unsigned toread = std::min< size_t >(size, 65536);
                HSVM_BlobRead(*vm, blobhandle, toread, ptr);

                ptr += toread;
                size -= toread;
        }
        HSVM_BlobClose (*vm, blobhandle);

        std::unique_ptr< MarshalPacket >packet(new MarshalPacket);
        packet->Read(&data[0], &data[0] + orgsize, &vm->blobmanager);

        Marshaller marshaller(vm, MarshalMode::All);
        marshaller.ReadMarshalPacket(id_set, &packet);
}

void GetStackTrace(VarId id_set, VirtualMachine *vm)
{
        GetVMStackTrace(vm, id_set, vm, false);
}

void GetAsyncStackTrace(VarId id_set, VirtualMachine *vm)
{
        std::vector< StackTraceElement > elements;

        AsyncStackTrace trace;
        vm->GetRawAsyncStackTrace(&trace, 0, nullptr);
        vm->BuildAsyncStackTrace(trace, &elements);

        GetVMStackTraceFromElements(vm, id_set, elements, 0, false);
}

void StringParser_Next(VarId id_set, VirtualMachine *vm)
{
        SystemContext context(vm->GetContextKeeper());
        context->CheckColumnMappings(vm);

        HSVM_VariableId obj = HSVM_Arg(0);

        HSVM_VariableId var_eof = HSVM_ObjectMemberRef(*vm, obj, context->col_pvt_eof, true);

        if (HSVM_BooleanGet(*vm, var_eof))
            HSVM_BooleanSet(*vm, id_set, false);
        else
        {
                HSVM_VariableId var_pos = HSVM_ObjectMemberRef(*vm, obj, context->col_pvt_pos, true);
                HSVM_VariableId var_data = HSVM_ObjectMemberRef(*vm, obj, context->col_pvt_data, true);
                HSVM_VariableId var_current = HSVM_ObjectMemberRef(*vm, obj, context->col_pvt_current, true);

                int32_t pos = HSVM_IntegerGet(*vm, var_pos);

                ++pos;

                const char *data_begin;
                const char *data_end;
                HSVM_StringGet(*vm, var_data, &data_begin, &data_end);

                if (pos >= data_end - data_begin || pos < 0)
                {
                        pos = data_end - data_begin;
                        HSVM_BooleanSet(*vm, var_eof, true);
                        HSVM_BooleanSet(*vm, id_set, true);
                        HSVM_StringSet(*vm, var_current, 0, 0);
                }
                else
                {
                        HSVM_BooleanSet(*vm, id_set, false);

                        // Copy through intermediate, to avoid realloc problems
                        char buf = data_begin[pos];
                        HSVM_StringSet(*vm, var_current, &buf, &buf + 1);
                }
                HSVM_IntegerSet(*vm, var_pos, pos);
        }

/*
      IF (NOT this->pvt_eof)
      {
        this->pvt_pos := this->pvt_pos + 1;
        this->pvt_current := SubString(this->pvt_data, this->pvt_pos, 1);

        BOOLEAN eof := this->pvt_pos = this->pvt_limit;
        this->pvt_eof := eof;
        RETURN NOT eof;
      }
      ELSE
        RETURN FALSE;
*/
}



void StringParser_ParseWhileSet(VarId id_set, VirtualMachine *vm, bool must_be_in_set)
{
        SystemContext context(vm->GetContextKeeper());
        context->CheckColumnMappings(vm);

        HSVM_VariableId obj = HSVM_Arg(0);

        HSVM_VariableId var_eof = HSVM_ObjectMemberRef(*vm, obj, context->col_pvt_eof, true);
        HSVM_VariableId var_pos = HSVM_ObjectMemberRef(*vm, obj, context->col_pvt_pos, true);
        HSVM_VariableId var_data = HSVM_ObjectMemberRef(*vm, obj, context->col_pvt_data, true);
        HSVM_VariableId var_current = HSVM_ObjectMemberRef(*vm, obj, context->col_pvt_current, true);

        const char *search_begin;
        const char *search_end;
        HSVM_StringGet(*vm, HSVM_Arg(1), &search_begin, &search_end);

        const char *data_begin;
        const char *data_end;
        HSVM_StringGet(*vm, var_data, &data_begin, &data_end);

        int32_t pos = HSVM_IntegerGet(*vm, var_pos);

        if (pos >= data_end - data_begin || pos < 0)
        {
                HSVM_BooleanSet(*vm, var_eof, true);
                HSVM_IntegerSet(*vm, var_pos, data_end - data_begin);
                HSVM_StringSet(*vm, id_set, 0, 0);
        }
        else
        {
                const char *itr;
                for (itr = data_begin + pos; itr != data_end; ++itr)
                {
                        bool found = std::find(search_begin, search_end, *itr) != search_end;
                        if (found != must_be_in_set)
                            break;
                }

                int32_t end_pos = itr - data_begin;

                // Copy through intermediate, to avoid realloc problems. ADDME: do this through sharedpool reserve+copy.
                std::string retval(data_begin + pos, itr);

                HSVM_IntegerSet(*vm, var_pos, end_pos);
                if (itr == data_end)
                {
                        HSVM_BooleanSet(*vm, var_eof, true);
                        HSVM_StringSet(*vm, var_current, 0, 0);  // Realloc!
                }
                else
                {
                        // Copy through intermediate, to avoid realloc problems
                        char buf = *itr;
                        HSVM_StringSet(*vm, var_current, &buf, &buf + 1); // Realloc!
                }

                HSVM_StringSetSTD(*vm, id_set, retval);
                HSVM_IntegerSet(*vm, var_pos, end_pos);
        }
}

void StringParser_ParseWhileInSet(VarId id_set, VirtualMachine *vm)
{
        StringParser_ParseWhileSet(id_set, vm, true);
/*
      STRING retval;
      WHILE (NOT this->pvt_eof)
      {
        IF (SearchSubString(myset, this->pvt_current) = -1)
          BREAK;
        retval := retval || this->pvt_current;
        this->Next();
      }
      RETURN retval;
*/
}

void StringParser_ParseWhileNotInSet(VarId id_set, VirtualMachine *vm)
{
        StringParser_ParseWhileSet(id_set, vm, false);
/*
      STRING retval;
      WHILE (NOT this->pvt_eof)
      {
        IF (SearchSubString(myset, this->pvt_current) != -1)
          BREAK;
        retval := retval || this->pvt_current;
        this->Next();
      }
      RETURN retval;
*/
}

void StringParser_TryParseAll(VarId id_set, VirtualMachine *vm, bool case_sensitive)
{
        SystemContext context(vm->GetContextKeeper());
        context->CheckColumnMappings(vm);

//        HSVM_ColumnId col_pvt_eof = HSVM_GetColumnId(*vm, "PVT_EOF");
//        HSVM_ColumnId col_pvt_pos = HSVM_GetColumnId(*vm, "PVT_POS");
//        HSVM_ColumnId col_pvt_data = HSVM_GetColumnId(*vm, "PVT_DATA");
//        HSVM_ColumnId col_pvt_current = HSVM_GetColumnId(*vm, "PVT_CURRENT");

        HSVM_VariableId obj = HSVM_Arg(0);

        HSVM_VariableId var_eof = HSVM_ObjectMemberRef(*vm, obj, context->col_pvt_eof, true);
        HSVM_VariableId var_pos = HSVM_ObjectMemberRef(*vm, obj, context->col_pvt_pos, true);
        HSVM_VariableId var_data = HSVM_ObjectMemberRef(*vm, obj, context->col_pvt_data, true);
        HSVM_VariableId var_current = HSVM_ObjectMemberRef(*vm, obj, context->col_pvt_current, true);

        const char *try_begin;
        const char *try_end;
        HSVM_StringGet(*vm, HSVM_Arg(1), &try_begin, &try_end);

        const char *data_begin;
        const char *data_end;
        HSVM_StringGet(*vm, var_data, &data_begin, &data_end);

        int32_t pos = HSVM_IntegerGet(*vm, var_pos);

        int32_t data_len = data_end - data_begin;
        int32_t search_len = try_end - try_begin;

        if (pos + search_len > data_len || pos < 0 || search_len == 0)
            HSVM_BooleanSet(*vm, id_set, false);
        else
        {
                // Inv: data_end + pos - data_begin <= search_len  --> data_begin + pos + search_len <= data_end
                bool success = case_sensitive ?
                        Blex::StrCompare< const char * >(data_begin + pos, data_begin + pos + search_len, try_begin, try_end) == 0 :
                        Blex::StrCaseCompare< const char * >(data_begin + pos, data_begin + pos + search_len, try_begin, try_end) == 0;

                std::string retval;
                if (success)
                {
                        pos += search_len;

                        if (data_begin + pos == data_end)
                        {
                                HSVM_BooleanSet(*vm, var_eof, true);
                                HSVM_StringSet(*vm, var_current, 0, 0);  // Realloc!
                        }
                        else
                        {
                                // Copy through intermediate, to avoid realloc problems
                                char buf = *(data_begin + pos);
                                HSVM_StringSet(*vm, var_current, &buf, &buf + 1); // Realloc!
                        }
                        HSVM_IntegerSet(*vm, var_pos, pos);
                        HSVM_BooleanSet(*vm, id_set, true);
                }
                HSVM_BooleanSet(*vm, id_set, success);
        }
}

void StringParser_TryParse(VarId id_set, VirtualMachine *vm)
{
        StringParser_TryParseAll(id_set, vm, true);
}

void StringParser_TryParseCase(VarId id_set, VirtualMachine *vm)
{
        StringParser_TryParseAll(id_set, vm, false);
}

void StringParser_ParseSkipN(VarId id_set, VirtualMachine *vm, bool isskip)
{
        SystemContext context(vm->GetContextKeeper());
        context->CheckColumnMappings(vm);

        HSVM_VariableId obj = HSVM_Arg(0);
        int32_t n = HSVM_IntegerGet(*vm, HSVM_Arg(1));

        HSVM_VariableId var_eof = HSVM_ObjectMemberRef(*vm, obj, context->col_pvt_eof, true);
        HSVM_VariableId var_pos = HSVM_ObjectMemberRef(*vm, obj, context->col_pvt_pos, true);
        HSVM_VariableId var_data = HSVM_ObjectMemberRef(*vm, obj, context->col_pvt_data, true);
        HSVM_VariableId var_current = HSVM_ObjectMemberRef(*vm, obj, context->col_pvt_current, true);

        const char *data_begin;
        const char *data_end;
        HSVM_StringGet(*vm, var_data, &data_begin, &data_end);

        int32_t data_len = data_end - data_begin;
        int32_t pos = HSVM_IntegerGet(*vm, var_pos);

        if (n > data_len - pos)
            n = data_len - pos;
        else if (n < 0)
            n = 0;

        int32_t newpos = pos + n;
        char buf = newpos != data_len ? *(data_begin + newpos) : 0;

        if (isskip)
            HSVM_BooleanSet(*vm, id_set, newpos != data_len);
        else
            HSVM_StringSet(*vm, id_set, data_begin + pos, data_begin + newpos); // Realloc!

        if (newpos == data_len)
        {
                HSVM_BooleanSet(*vm, var_eof, true);
                HSVM_StringSet(*vm, var_current, 0, 0);  // Realloc!
        }
        else
        {
                HSVM_BooleanSet(*vm, var_eof, false);
                HSVM_StringSet(*vm, var_current, &buf, &buf + 1); // Realloc!
        }

        HSVM_IntegerSet(*vm, var_pos, newpos);
}

void StringParser_ParseN(VarId id_set, VirtualMachine *vm)
{
        StringParser_ParseSkipN(id_set, vm, false);
}

void StringParser_SkipN(VarId id_set, VirtualMachine *vm)
{
        StringParser_ParseSkipN(id_set, vm, true);
}

void ThrowException(VirtualMachine *vm)
{
        HSVM_CopyFrom(*vm, vm->throwvar, HSVM_Arg(0));
        vm->is_unwinding = true;
        vm->skip_first_traceitem = HSVM_BooleanGet(*vm, HSVM_Arg(1));
}

void GetResetExceptionVariable(VarId id_set, VirtualMachine *vm)
{
        vm->GetStackMachine().MoveFrom(id_set, vm->throwvar);
        vm->GetStackMachine().ObjectInitializeDefault(vm->throwvar);
}

void HS_IsSafeToSuspend(VarId id_set, VirtualMachine *vm)
{
        HSVM_BooleanSet(*vm, id_set, vm->IsSafeToSuspend());
}

void EncodeQP(VarId id_set, VirtualMachine *vm)
{
        Blex::StringPair data;
        HSVM_StringGet(*vm, HSVM_Arg(0), &data.begin, &data.end);

        Blex::PodVector<char> &scratchpad=SystemContext(vm->GetContextKeeper())->scratchpad;
        scratchpad.resize(0);

        Blex::Mime::QuotedPrintableEncoder<std::back_insert_iterator< Blex::PodVector<char> > > qep(std::back_inserter(scratchpad), false);
        for (const char *it = data.begin, *end = data.end; it != end; ++it)
            qep(*it);

        if (scratchpad.empty())
            HSVM_StringSet(*vm, id_set, 0, 0);
        else
        {
                const char *begin = &scratchpad[0];
                HSVM_StringSet(*vm, id_set, begin, begin + scratchpad.size());
        }
}

void DecodeQP(VarId id_set, VirtualMachine *vm)
{
        Blex::StringPair data;
        HSVM_StringGet(*vm, HSVM_Arg(0), &data.begin, &data.end);

        Blex::PodVector<char> &scratchpad=SystemContext(vm->GetContextKeeper())->scratchpad;
        scratchpad.resize(0);

        Blex::Mime::QuotedPrintableDecoder<std::back_insert_iterator< Blex::PodVector< char > > > qep(std::back_inserter(scratchpad), false);
        for (const char *it = data.begin, *end = data.end; it != end; ++it)
            qep(*it);

        if (scratchpad.empty())
            HSVM_StringSet(*vm, id_set, 0, 0);
        else
        {
                const char *begin = &scratchpad[0];
                HSVM_StringSet(*vm, id_set, begin, begin + scratchpad.size());
        }
}

void ExtractTable(HSVM *vm, HSVM_VariableId receiver, MessageData const *tableptr)
{
        HSVM_ColumnId col_id = HSVM_GetColumnId(vm, "ID");
        HSVM_ColumnId col_text = HSVM_GetColumnId(vm, "TEXT");
        HSVM_SetDefault(vm, receiver, HSVM_VAR_RecordArray);

        for(;tableptr->text;++tableptr)
        {
                HSVM_VariableId newrow = HSVM_ArrayAppend(vm, receiver);
                HSVM_IntegerSet(vm, HSVM_RecordCreate(vm, newrow, col_id), tableptr->number);
                HSVM_StringSetSTD(vm, HSVM_RecordCreate(vm, newrow, col_text), tableptr->text);
        }
}

void HS_ConstantsDump(VarId id_set, VirtualMachine *vm)
{
        HSVM_ColumnId col_errors = HSVM_GetColumnId(*vm, "ERRORS");
        HSVM_ColumnId col_warnings = HSVM_GetColumnId(*vm, "WARNINGS");

        HSVM_SetDefault(*vm, id_set, HSVM_VAR_Record);
        HSVM_VariableId errorlist = HSVM_RecordCreate(*vm, id_set, col_errors);
        ExtractTable(*vm, errorlist, errors);

        HSVM_VariableId warninglist = HSVM_RecordCreate(*vm, id_set, col_warnings);
        ExtractTable(*vm, warninglist, warnings);
}

void GetAuthenticationRecord(VarId id_set, VirtualMachine *vm)
{
        HSVM_SetDefault(*vm, id_set, HSVM_VAR_Record);

        std::unique_ptr< MarshalPacket > copy;
        {
                VirtualMachine::LockedProtectedData::WriteRef lock(vm->protected_data);

                if (lock->authenticationrecord.get())
                    lock->authenticationrecord->TryClone(&copy);
        }
        if (copy.get())
            vm->authrec_marshaller.ReadMarshalPacket(id_set, &copy);
}

void SetAuthenticationRecord(VirtualMachine *vm)
{
        std::unique_ptr< MarshalPacket > rec(vm->authrec_marshaller.WriteToNewPacket(HSVM_Arg(0)));

        VirtualMachine::LockedProtectedData::WriteRef lock(vm->protected_data);
        lock->authenticationrecord.reset(rec.release());
}

void RegisterLoadedResource(VirtualMachine *vm)
{
        std::string toinsert = HSVM_StringGetSTD(*vm, HSVM_Arg(0));
        vm->RegisterLoadedResource(toinsert);
}

void HS_SQL_WHDB_CreatePasswordHash(VarId id_set, VirtualMachine *vm)
{
        uint8_t hash[Blex::BlowfishPasswordLen];
        Blex::StringPair toencode;

        HSVM_StringGet(*vm, HSVM_Arg(0), &toencode.begin, &toencode.end);
        if(toencode.size() >= 4096)
        {
                HSVM_ThrowException(*vm, "The supplied password is too long");
                return;
        }

        Blex::GenerateWebHareBlowfishPassword(hash, toencode.begin, toencode.size(), Blex::BlowfishIterations);
        HSVM_StringSet(*vm, id_set, reinterpret_cast<char*>(&hash[0]), reinterpret_cast<char*>(&hash[sizeof(hash)]));
}

void IsWebHarePasswordHashSecure(VarId id_set, VirtualMachine *vm)
{
        Blex::StringPair encoded;
        HSVM_StringGet(*vm, HSVM_Arg(0), &encoded.begin, &encoded.end);
        bool correct = Blex::IsWebHarePasswordStillSecure(encoded.size(), encoded.begin);
        HSVM_BooleanSet(*vm, id_set, correct);

}

void HS_SQL_WHDB_VerifyPasswordHash(VarId id_set, VirtualMachine *vm)
{
        Blex::StringPair encoded, plaintext;

        HSVM_StringGet(*vm, HSVM_Arg(0), &plaintext.begin, &plaintext.end);
        HSVM_StringGet(*vm, HSVM_Arg(1), &encoded.begin, &encoded.end);

        if(plaintext.size() >= 4096)
        {
                HSVM_ThrowException(*vm, "The supplied password is too long");
                return;
        }

        bool correct = Blex::CheckWebHarePassword(encoded.size(), encoded.begin, plaintext.size(), plaintext.begin);
        HSVM_BooleanSet(*vm, id_set, correct);
}

void GetCallTreeStats(VarId id_set, VirtualMachine *vm)
{
        ProfileData const &profiledata = vm->GetProfileData();

        profiledata.calltree.StoreTree(vm, id_set, vm);
}

void ArraySlice(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        VariableTypes::Type type = stackm.GetType(HSVM_Arg(0));
        if (!(type & VariableTypes::Array))
        {
                HSVM_ThrowException(*vm, "The first parameter to ArraySlice must be an array");
                return;
        }

        int32_t start = HSVM_IntegerGet(*vm, HSVM_Arg(1));
        int64_t count = HSVM_Integer64Get(*vm, HSVM_Arg(2));

        if (count < 0)
        {
                HSVM_ThrowException(*vm, "No negative number of elements allowed in ArraySlice");
                return;
        }
        if (start < 0)
        {
                count += start; //start is negative, just subtract that # of elements from count
                start = 0;
        } //note; count can be negative after this again

        int32_t maxpos = HSVM_ArrayLength(*vm, HSVM_Arg(0));
        if (start >= maxpos || count < 0)
        {
                HSVM_SetDefault(*vm, id_set, type);
                return;
        }

        // If start + numelements < maxpos, set maxpos to start + numelements (rearranged to avoid overflow)
        if (count < maxpos - start)
            maxpos = Blex::LimitOffsetToInt(start + count);

        stackm.ArrayInitialize(id_set, maxpos - start, type);
        for (int32_t i = start; i < maxpos; ++i)
            stackm.ArrayElementCopy(HSVM_Arg(0), i, stackm.ArrayElementGet(id_set, i - start));

}

void CalculateVariableHash(VarId id_set, VirtualMachine *vm)
{
        try
        {
                StackMachine &stackm = vm->GetStackMachine();
                stackm.SetSTLString(id_set, stackm.CalculateHash(HSVM_Arg(0), 0));
        }
        catch (VMRuntimeError &e)
        {
                if (e.code == Error::InternalError)
                    HSVM_ThrowException(*vm, e.msg1.c_str());
                else
                  throw;
        }
}

void RepeatText(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        stackm.InitVariable(id_set, VariableTypes::String);
        int32_t cnt = stackm.GetInteger(HSVM_Arg(1));
        if (cnt < 0)
            cnt = 0;

        int32_t strsize = stackm.GetStringSize(HSVM_Arg(0));
        int32_t newsize = strsize * cnt;
        std::pair< char*, char* > newstr = stackm.ResizeString(id_set, newsize);

        Blex::StringPair base = stackm.GetString(HSVM_Arg(0));
        for (int32_t idx = 0; idx < cnt; ++idx)
        {
              std::copy(base.begin, base.end, newstr.first);
              newstr.first += strsize;
        }
}

void GetInstructionNameMap(VarId id_set, VirtualMachine *vm)
{
        StackMachine &stackm = vm->GetStackMachine();

        stackm.InitVariable(id_set, VariableTypes::RecordArray);
        auto map = GetInstructionCodeNameMap();
        for (auto &itr: map)
        {
                VarId elt = stackm.ArrayElementAppend(id_set);
                stackm.InitVariable(elt, VariableTypes::Record);

                stackm.SetInteger(stackm.RecordCellCreate(elt, vm->cn_cache.col_code), itr.first);
                stackm.SetSTLString(stackm.RecordCellCreate(elt, vm->cn_cache.col_name), itr.second);

                unsigned len;
                switch (itr.first)
                {
                case InstructionSet::CALL:
                case InstructionSet::JUMP:
                case InstructionSet::JUMPC:
                case InstructionSet::JUMPC2:
                case InstructionSet::JUMPC2F:
                case InstructionSet::LOADS:
                case InstructionSet::STORES:
                case InstructionSet::LOADSD:
                case InstructionSet::DESTROYS:
                case InstructionSet::COPYS:
                case InstructionSet::LOADG:
                case InstructionSet::STOREG:
                case InstructionSet::LOADGD:
                case InstructionSet::RECORDCELLGET:
                case InstructionSet::RECORDCELLSET:
                case InstructionSet::RECORDCELLCREATE:
                case InstructionSet::RECORDCELLDELETE:
                case InstructionSet::RECORDCELLUPDATE:
                case InstructionSet::LOADTYPEID:
                case InstructionSet::INITVAR:
                case InstructionSet::CAST:
                        len = 5; break;
                case InstructionSet::OBJMETHODCALL:
                case InstructionSet::OBJMETHODCALLTHIS:
                case InstructionSet::OBJMETHODCALLNM:
                case InstructionSet::OBJMETHODCALLTHISNM:
                case InstructionSet::CASTPARAM:
                        len = 9; break;
                default:
                        len = 1;
                }

                stackm.SetInteger(stackm.RecordCellCreate(elt, vm->cn_cache.col_length), len);
        }
}

void GeneratorInitialize(VirtualMachine *vm)
{
        GEN_PRINT("GeneratorHandleResume initialize");

        auto *ctx = vm->GetGeneratorContext(HSVM_Arg(0));
        bool initial_suspended = HSVM_BooleanGet(*vm, HSVM_Arg(1));

        ctx->state = initial_suspended
            ? VirtualMachine::GeneratorContext::SuspendedStart
            : VirtualMachine::GeneratorContext::SuspendedYield;
}

/* @param obj Generator object
   @param type Type of resume (0: next, 1: throw, 2: return)
   @param value to send/throw/return
*/
void GeneratorHandleResume(VarId id_set, VirtualMachine *vm)
{
        GEN_PRINT("GeneratorHandleResume enter");
        GEN_ONLY(vm->ShowStackState(false));

        auto &stackm = vm->GetStackMachine();
        auto *ctx = vm->GetGeneratorContext(HSVM_Arg(0));

        if (!ctx || ctx->state == VirtualMachine::GeneratorContext::NotAGenerator)
        {
                GEN_PRINT(" Not a valid generator!");
                HSVM_ThrowException(*vm, "This object is not a valid generator");
        }
        if (ctx->state == VirtualMachine::GeneratorContext::Executing)
        {
                GEN_PRINT(" Generator is still running!");
                HSVM_ThrowException(*vm, "Cannot re-enter a running generator");
        }

        int32_t type = stackm.GetInteger(HSVM_Arg(1));
        if (type < 0 || type > 2)
        {
                GEN_PRINT(" Invalid resume type parameter");
                HSVM_ThrowException(*vm, "Invalid value for type");
        }

        if (type == 1)
            stackm.CastTo(HSVM_Arg(2), VariableTypes::Object);

        VarId var_stack = stackm.ObjectMemberRef(HSVM_Arg(0), vm->cn_cache.col_stack, true);
        VarId var_resultvalue = stackm.ObjectMemberRef(HSVM_Arg(0), vm->cn_cache.col_value, true);

        if (type != 0 && ctx->state == VirtualMachine::GeneratorContext::SuspendedStart)
        {
                stackm.SetBoolean(stackm.RecordCellCreate(var_resultvalue, vm->cn_cache.col_done), true);
                stackm.InitVariable(stackm.RecordCellCreate(var_resultvalue, vm->cn_cache.col_value), VariableTypes::Record);

                GEN_PRINT(" Marking generator completed, sent throw/return on suspended-start generator");
                ctx->state = VirtualMachine::GeneratorContext::Completed;
        }

        if (ctx->state == VirtualMachine::GeneratorContext::Completed)
        {
                if (type != 1) // return: return [ done := true, value := record(arg2) ]
                {
                        stackm.CopyFrom(id_set, var_resultvalue);
                        if (type == 2) // return: return [ done := true, value := record(arg2) ]
                             stackm.MoveFrom(stackm.RecordCellRefByName(var_resultvalue, vm->cn_cache.col_value), HSVM_Arg(2));
                        return;
                }

                //vm->ShowStackState();
                //Blex::ErrStream() << "Already completed in .throw: throwing " << VarWrapper<VarPrinterPrintType::Default>(stackm, HSVM_Arg(2), true);

                // type = 1: exception: throw object(arg2)
                // Schedule unwind!
                stackm.CopyFrom(vm->throwvar, HSVM_Arg(2));
                vm->is_unwinding = true;
                vm->skip_first_traceitem = false;

                // Push dummy frame to counteract automatic popframe
                vm->PushDummyFrame();
                return;
        }

        GEN_PRINT(" Marking generator as running, preparing execution context");

        // INV: (type = 0 && (suspendedstart/suspendedyield)) || (type != 0 && (suspendedyield))
        ctx->state = VirtualMachine::GeneratorContext::Executing;

        //generatordata->busy = true;
        vm->executionstate.library = ctx->el.library;
        vm->executionstate.function = ctx->el.function;
        vm->executionstate.codeptr = ctx->el.codeptr;
        vm->SetStateShortcuts(false);

/*        DEBUGPRINT("L " << generatordata->el.library);
        DEBUGPRINT("F " << generatordata->el.function);
        DEBUGPRINT("C " << generatordata->el.codeptr);//*/

        // Don't overwrite the object at arg0 just yet - we need the reference to the generatorcontext
        stackm.InitVariable(stackm.StackPointer() - 1, VariableTypes::Record);
        stackm.SetInteger(stackm.RecordCellCreate(stackm.StackPointer() - 1, vm->cn_cache.col_type), type);
        stackm.MoveFrom(stackm.RecordCellCreate(stackm.StackPointer() - 1, vm->cn_cache.col_value), HSVM_Arg(2));

        //Blex::ErrStream() << "pre restore";
        //vm->ShowStackState();

        auto functiondef = &vm->executionstate.library->GetLinkedLibrary().functiondefs[vm->executionstate.function];
        stackm.RestoreStackFrame(1, functiondef->def->parameters.size(), var_stack);

        //Blex::ErrStream() << "post restore";
        //vm->ShowStackState();

        // Push dummy frame to counteract automatic popframe
        vm->PushDummyFrame();
}

void GeneratorProcessResult(VarId id_set, VirtualMachine *vm)
{
        auto &stackm = vm->GetStackMachine();
        auto *ctx = vm->GetGeneratorContext(HSVM_Arg(0));

        GEN_PRINT("Handling generator result");

        if (!ctx || ctx->state == VirtualMachine::GeneratorContext::NotAGenerator)
        {
                GEN_PRINT(" Not a valid generator!");
                HSVM_ThrowException(*vm, "This object is not a valid generator");
        }

        VarId var_resultvalue = stackm.ObjectMemberRef(HSVM_Arg(0), vm->cn_cache.col_value, true);

        VarId var_done = stackm.RecordCellTypedGetByName(HSVM_Arg(1), vm->cn_cache.col_done, VariableTypes::Boolean, false);
        if (!var_done)
        {
                // Empty record signals a thrown exception - complete with DEFAULT RECORD as return
                GEN_PRINT(" Handling a thrown exception");
                ctx->state = VirtualMachine::GeneratorContext::Completed;

                stackm.SetBoolean(stackm.RecordCellCreate(var_resultvalue, vm->cn_cache.col_done), true);
                stackm.InitVariable(stackm.RecordCellCreate(var_resultvalue, vm->cn_cache.col_value), VariableTypes::Record);

                stackm.InitVariable(id_set, VariableTypes::Record);
                return;
        }

        bool done = stackm.GetBoolean(var_done);
        if (done)
        {
                GEN_PRINT(" Generator says it is done, marking as completed");
                ctx->state = VirtualMachine::GeneratorContext::Completed;
                stackm.CopyFrom(var_resultvalue, HSVM_Arg(1));
        }
        else
        {
                GEN_PRINT(" Generator has suspended for yield");
                ctx->state = VirtualMachine::GeneratorContext::SuspendedYield;
        }

        stackm.CopyFrom(id_set, HSVM_Arg(1));
}

void AsyncContextInit(VirtualMachine *vm)
{
        int32_t skipelts = vm->stackmachine.GetInteger(HSVM_Arg(1));
        auto *ctx = vm->GetAsyncCallContext(HSVM_Arg(0), true);
        ctx->trace.reset(new AsyncStackTrace);
        vm->GetRawAsyncStackTrace(ctx->trace.get(), skipelts + 2, &ctx->prev_segment);
}

void PushAsyncContext(VirtualMachine *vm)
{
        auto *ctx = vm->GetAsyncCallContext(HSVM_Arg(0), false);
        if (!ctx)
            throw HareScript::VMRuntimeError(Error::InternalError, "Illegal async call context provided");

        int32_t skipframes = vm->stackmachine.GetInteger(HSVM_Arg(1));

        vm->PushAsyncTraceContext(ctx->trace, ctx->prev_segment, skipframes);
}

void PopAsyncContext(VirtualMachine *vm)
{
        vm->PopAsyncTraceContext();
}

void EncodeHandleList(VirtualMachine *source_vm, VirtualMachine *vm, VarId id_set)
{
        auto &stackm = vm->GetStackMachine();

        stackm.InitVariable(id_set, VariableTypes::Record);
        VarId items = stackm.RecordCellCreate(id_set, vm->columnnamemapper.GetMapping("ITEMS"));
        stackm.InitVariable(items, VariableTypes::RecordArray);

        for (auto &itr: source_vm->outobjects)
        {
                auto type = itr->GetType();

                VarId elt = stackm.ArrayElementAppend(items);
                stackm.InitVariable(elt, VariableTypes::Record);
                stackm.SetSTLString(stackm.RecordCellCreate(elt, vm->cn_cache.col_name), "Outputobject: " + std::string(type ? type : "unknown"));
                stackm.SetInteger(stackm.RecordCellCreate(elt, vm->cn_cache.col_id), itr->GetId());
                stackm.InitVariable(stackm.RecordCellCreate(elt, vm->cn_cache.col_stacktrace), VariableTypes::RecordArray);
        }

        for (auto &itr: vm->idmapstorages)
        {
                itr->RegisterHandles([&stackm, items, vm](std::string const &name, int32_t id)
                {
                        VarId elt = stackm.ArrayElementAppend(items);
                        stackm.InitVariable(elt, VariableTypes::Record);
                        stackm.SetSTLString(stackm.RecordCellCreate(elt, vm->cn_cache.col_name), name);
                        stackm.SetInteger(stackm.RecordCellCreate(elt, vm->cn_cache.col_id), id);
                        stackm.InitVariable(stackm.RecordCellCreate(elt, vm->cn_cache.col_stacktrace), VariableTypes::RecordArray);
                });
        }
}

void ListHandles(VarId id_set, VirtualMachine *vm)
{
        EncodeHandleList(vm, vm, id_set);
}


} // End of namespace Baselibs

int BaselibsEntryPoint(struct HSVM_RegData *regdata, void * /*context_ptr*/)
{
        Baselibs::InitCrypto(regdata);
        Baselibs::InitMime(regdata);
        Baselibs::InitTokenStream(regdata);
        return 0;
}

void RegisterDeprecatedBaseLibs(BuiltinFunctionsRegistrator &bifreg, Blex::ContextRegistrator &creg)
{
        using namespace Baselibs;

        SystemContext::Register(creg);
        InitTypes(bifreg);
        InitBlob(bifreg);
        InitLibdumper(bifreg);
        InitProcess(bifreg);
        InitTCPIP(bifreg);
        InitIPC(creg, bifreg);
        InitJSON(creg, bifreg);
        InitRegex(creg, bifreg);
        InitStrings(bifreg);
        InitEvents(bifreg);


        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("DECODEQP::S:S",DecodeQP));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("ENCODEQP::S:S",EncodeQP));

        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("BYTETOSTRING::S:I",ByteToString));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("DECODEPACKET::R:SS",DecodePacket));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("DISABLEFUNCTIONPROFILE:::",DisableFunctionProfile));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("ENABLEFUNCTIONPROFILE:::",EnableFunctionProfile));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("RESETFUNCTIONPROFILE:::",ResetFunctionProfile));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("DISABLEMEMORYPROFILE:::",DisableMemoryProfile));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("ENABLEMEMORYPROFILE:::",EnableMemoryProfile));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("RESETMEMORYPROFILE:::",ResetMemoryProfile));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("DISABLECOVERAGEPROFILE:::",DisableCoverageProfile));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("ENABLECOVERAGEPROFILE:::",EnableCoverageProfile));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("RESETCOVERAGEPROFILE:::",ResetCoverageProfile));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__INTERNAL_GETCOVERAGEPROFILEDATA::R:",GetCoverageProfileData));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("ENCODEPACKET::S:SR",EncodePacket));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETBYTEVALUE::I:S",GetByteValue));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETCALLINGLIBRARY::S:B",GetCallingLibrary));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__INTERNAL_GETRAWFUNCTIONPROFILE::R:",GetFunctionProfileData));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__INTERNAL_GETVMSTATISTICS::R:", GetVMStatistics));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__INTERNAL_GETCALLTREESTATS::R:", GetCallTreeStats));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETSTOREDSCRIPTPROPERTY::V:S",GetStoredScriptProperty));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETUCVALUE::I:S",GetUCValue));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("ISATENDOFSTREAM::B:I",IsAtEndOfStream));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("LENGTH::I:V",Length));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("LENGTH64::6:V",Length64));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("LEFT::S:SI",Left));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_INTERNAL_ENSURELIBRARYLOADED::R:S",EnsureLibraryLoaded));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_INTERNAL_MAKEFUNCTIONPTR::R:SSIIA",MakeFunctionPtr));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_INTERNAL_RESOLVEABSOLUTELIBRARY::S:SS", ResolveAbsoluteLibrary));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_INTERNAL_TRANSLATELIBRARYPATH::S:S", TranslateLibraryPath));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_INTERNAL_OVERRIDEEXECUTELIBRARY::S:S",OverrideExecuteLibrary));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_INTERNAL_UNMANGLEFUNCTIONNAME::R:S", UnmangleFunctionName));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("CALLMACROPTRVA:::PVA",CallMacroPtrVA));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("CALLFUNCTIONPTRVA::V:PVA",CallFunctionPtrVA));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETHARESCRIPTLIBRARYINFO::R:S",GetLibraryInfo));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_INTERNAL_GETLIBRARIESINFO::R:B", GetLoadedLibrariesInfo));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("PRINT:::S",Print));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("PRINTTO::B:IS",PrintTo));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("WRITETO::I:IS",WriteTo));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("REDIRECTOUTPUTTO::I:I",HS_RedirectOutput));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_INTERNAL_RECEIVEFROM::R:IIBBB",ReceiveFrom));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_INTERNAL_CANCELRECEIVELINE:::I",HS_CancelReceiveLine));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("RIGHT::S:SI",Right));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("SEARCHELEMENT::I:VVI",SearchElement));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("SEARCHLASTELEMENT::I:VVI",SearchElementFromBack));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("SEARCHLASTSUBSTRING::I:SSI",SearchLastSubstring));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("SEARCHSUBSTRING::I:SSI",SearchSubstring));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("SUBSTITUTE::S:SSS",Substitute));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("SUBSTRING::S:SII",Substring));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("TRIMWHITESPACE::S:S",TrimWhitespace));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("TOKENIZE::SA:SS",Tokenize));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("TOLOWERCASE::S:S",ToLowerCase));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("TOUPPERCASE::S:S",ToUpperCase));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("UCLENGTH::I:S",UCLength));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("UCLEFT::S:SI",UCLeft));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("UCRIGHT::S:SI",UCRight));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("UCSUBSTRING::S:SII",UCSubstring));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("UCTOSTRING::S:I",UCToString));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("UCSEARCHSUBSTRING::I:SSI",UCSearchSubstring));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("UCSEARCHLASTSUBSTRING::I:SSI",UCSearchLastSubstring));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("ARRAYSLICE::V:VI6",ArraySlice));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("REPEATTEXT::S:SI", RepeatText));

        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_FATALERROR:::ISS",HS_FatalError));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_SILENTTERMINATE:::",HS_SilentTerminate));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETHARESCRIPTMESSAGETEXT::S:BISS",HS_FormatMessage));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_CONSTANTSDUMP::R:",HS_ConstantsDump));

        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_MARSHALWRITETO:::IV", MarshalWriteTo));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_MARSHALPACKETWRITETO:::IV", MarshalPacketWriteTo));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_MARSHALREADFROMBLOB::V:X", MarshalReadFromBlob));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_MARSHALPACKETREADFROMBLOB::V:X", MarshalPacketReadFromBlob));

        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETSTACKTRACE::RA:", GetStackTrace));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETASYNCSTACKTRACE::RA:", GetAsyncStackTrace));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_REBINDFUNCTIONPTR::P:PIAVA", RebindFunctionPtr));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_REBINDFUNCTIONPTR2::P:PRAIB", RebindFunctionPtr2));

        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("STRINGPARSER#NEXT::B:O", StringParser_Next));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("STRINGPARSER#PARSEN::S:OI", StringParser_ParseN));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("STRINGPARSER#SKIPN::B:OI", StringParser_SkipN));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("STRINGPARSER#PARSEWHILENOTINSET::S:OS", StringParser_ParseWhileNotInSet));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("STRINGPARSER#PARSEWHILEINSET::S:OS", StringParser_ParseWhileInSet));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("STRINGPARSER#TRYPARSE::B:OS", StringParser_TryParse));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("STRINGPARSER#TRYPARSECASE::B:OS", StringParser_TryParseCase));

        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_THROWEXCEPTION:::OB", ThrowException));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_GETRESETTHROWVAR::O:", GetResetExceptionVariable));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_DEBUG_ISNOWSUSPENDABLE::B:", HS_IsSafeToSuspend)); // jobmgr debugging only
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_INTERNAL_GETAUTHENTICATIONRECORD::R:", GetAuthenticationRecord));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_INTERNAL_SETAUTHENTICATIONRECORD:::R", SetAuthenticationRecord));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_INTERNAL_REGISTERLOADEDRESOURCE:::S", RegisterLoadedResource));

        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("CREATEWEBHAREPASSWORDHASH::S:S", HS_SQL_WHDB_CreatePasswordHash));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_VERIFYWEBHAREPASSWORDHASH::B:SS", HS_SQL_WHDB_VerifyPasswordHash));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("ISWEBHAREPASSWORDHASHSTILLSECURE::B:S", IsWebHarePasswordHashSecure));

        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_INTERNAL_CALCULATEVARIABLEHASH::S:V", CalculateVariableHash));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_GETINSTRUCTIONNAMEMAP:::RA", GetInstructionNameMap));

        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_INTERNAL_SUSPENDABLEFUNCTIONCONTROLLER#INITSTATE:::OB", GeneratorInitialize));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_INTERNAL_SUSPENDABLEFUNCTIONCONTROLLER#HANDLERESUME::R:OIV", GeneratorHandleResume));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_INTERNAL_SUSPENDABLEFUNCTIONCONTROLLER#PROCESSRESULT::R:OR", GeneratorProcessResult));

        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_INTERNAL_ASYNCCONTEXT#INITSTATE:::OI", AsyncContextInit));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_INTERNAL_ADDASYNCCONTEXT:::OI", PushAsyncContext));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_INTERNAL_REMOVEASYNCCONTEXT:::", PopAsyncContext));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_INTERNAL_GETASYNCSTACKTRACE::RA:", GetAsyncStackTrace));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_INTERNAL_LISTHANDLES::R:", ListHandles));
}

void SetupConsole(VirtualMachine &vm)
{
        Baselibs::SystemContext context(vm.GetContextKeeper());
        context->os.SetupConsole();
}

} // End of namespace HareScript
