#include <harescript/vm/allincludes.h>

#include <blex/path.h>
#include <blex/getopt.h>
#include <blex/utils.h>
#include <iostream>
#include "baselibs.h"
#include "hsvm_blobinterface.h"

#include "hsvm_context.h"

namespace HareScript {
namespace Baselibs {

int OSFileReader(void *opaque_ptr, int numbytes, void *data, int *errorresult)
{
        OSContext::FileInfo* file = (OSContext::FileInfo*)opaque_ptr;
        *errorresult = 0;
        return file->Read(numbytes,data);
}
int OSFileWriter(void *opaque_ptr, int numbytes, void const *data, int allow_partial, int *errorresult)
{
        OSContext::FileInfo* file = (OSContext::FileInfo*)opaque_ptr;
        *errorresult = 0;
        return file->Write(numbytes,data, allow_partial);
}
int OSFileEof(void *opaque_ptr)
{
        OSContext::FileInfo* file = (OSContext::FileInfo*)opaque_ptr;
        return file->eof ? 1 : 0;
}

// -----------------------------------------------------------------------------
//
// OSContext::Console
//

bool OSContext::Console::IsAtEOF()
{
        return Blex::IsConsoleClosed();
}
std::pair< Blex::SocketError::Errors, unsigned > OSContext::Console::Read(unsigned numbytes, void *data)
{
        return std::make_pair(Blex::SocketError::NoError, Blex::ReadConsoleBytes(data, numbytes));
}
bool OSContext::Console::AddToWaiterRead(Blex::PipeWaiter &waiter)
{
        if (!readbuffer.empty() && !wait_ignores_readbuffer)
            return true;

        waiter.AddConsoleRead();
        return false;
}
OutputObject::SignalledStatus OSContext::Console::IsReadSignalled(Blex::PipeWaiter *waiter)
{
        if (!readbuffer.empty() && !wait_ignores_readbuffer)
            return Signalled;

        if (waiter)
            return waiter->GotConsoleRead() ? Signalled : NotSignalled;
        else
            return Unknown;
}

// -----------------------------------------------------------------------------
//
// OSContext::Process
//

OSContext::Process::~Process()
{
        /* Destroy any open processes */
        proc->Kill();
}

bool OSContext::Process::AddToWaiterRead(Blex::PipeWaiter &waiter)
{
        if (output.get() && output->AddToWaiterRead(waiter)) // waiter.AddReadPipe(*output);
            return true;
        if (errors.get() && errors->AddToWaiterRead(waiter)) // waiter.AddReadPipe(*errors);
            return true;
        return !output.get() && !errors.get();
}

bool OSContext::Process::IsAtEOF()
{
        return true; //FIXME: Implement!
}

OutputObject::SignalledStatus OSContext::Process::IsReadSignalled(Blex::PipeWaiter *waiter)
{
        if (output.get() && output->IsReadSignalled(waiter) == Signalled)//waiter->GotRead(*output))
            return Signalled;
        if (errors.get() && errors->IsReadSignalled(waiter) == Signalled)//waiter->GotRead(*errors))
            return Signalled;

        // We can only return a definitive answer when we know any of the pipes is closed
        bool any_closed = !output.get() && !errors.get();
        if (any_closed)
            return Signalled;
        if (waiter)
            return NotSignalled;
        return Unknown;
}

bool OSContext::Process::AddToWaiterWrite(Blex::PipeWaiter &waiter)
{
        if (input.get())
        {
                if (!write_unblocked)
                {
                        input->SetBlocking(false);
                        write_unblocked = true;
                }
                waiter.AddWritePipe(*input);
        }
        return !input.get();
}

OutputObject::SignalledStatus OSContext::Process::IsWriteSignalled(Blex::PipeWaiter *waiter)
{
        if (!input.get())
            return Signalled;

        if (waiter)
            return waiter->GotWrite(*input) ? Signalled : NotSignalled;

        return Unknown;
}

void OSContext::Process::SetEnvironment(Blex::Process::Environment const &env)
{
        if (started)
            HSVM_ThrowException(vm, "Process environment cannot be modified after the process has been started");
        proc->SetEnvironment(env);
}

bool OSContext::Process::Run(std::string const &processname, std::vector<std::string> const &args, std::string const &set_cwd, bool share_stdin, bool share_stdout, bool share_stderr)
{
        if (started)
            HSVM_ThrowException(vm, "Cannot start the process, it has already been started");

        proc->share_stdin = share_stdin;
        proc->share_stdout = share_stdout;
        proc->share_stderr = share_stderr;
        started = proc->Start(processname, args, set_cwd, false);
        return started;
}

int OSContext::Process::WaitForProcessOutput(int waittime)
{
        if (output.get() && output->IsAtEOF())
            return 1;
        if (errors.get() && errors->IsAtEOF())
            return 2;

        //Listen for specified channels
        Blex::PipeWaiter waitlist;
        if (output.get())
            output->AddToWaiterRead(waitlist); // waitlist.AddReadPipe(*output);
        if (errors.get())
            errors->AddToWaiterRead(waitlist); // waitlist.AddReadPipe(*errors);

        Blex::DateTime now = Blex::DateTime::Now();

        Blex::DateTime until;
        if (waittime < 0)
            until = Blex::DateTime::Max();
        else if (waittime == 0)
            until = Blex::DateTime::Min();
        else
            until = now + Blex::DateTime::Msecs(std::min<int>(waittime,60*60*1000));

        Blex::DateTime nextwait = now;

        if (!output.get() && !errors.get())
        {
                while (true)
                {
                        nextwait = std::min(nextwait + Blex::DateTime::Msecs(1000), until);

                        if (proc->TimedWaitFinish(nextwait))
                            return 1; //process finished, just pretend it's a Read on the output stream

                        if (nextwait == until)
                            break;

                        // Test if we must abort before the next wait
                        if(HSVM_TestMustAbort(vm))
                            return 0;
                }
                return 0; //timeout
        }

        while (true)
        {
                nextwait = std::min(nextwait + Blex::DateTime::Msecs(1000), until);

                if (waitlist.Wait(nextwait))
                {
                        if (output.get() && output->IsReadSignalled(&waitlist) == OutputObject::Signalled)//waitlist.GotRead(*output))
                            return 1;
                        if (errors.get() && errors->IsReadSignalled(&waitlist) == OutputObject::Signalled)//if (waitlist.GotRead(*errors))
                            return 2;
                }

                if (nextwait == until)
                    break;

                // Test if we must abort before the next wait
                if(HSVM_TestMustAbort(vm))
                    return 0;
        }
        return 0; //timeout
}

std::pair< Blex::SocketError::Errors, unsigned > OSContext::Process::Write(unsigned numbytes, const void *data, bool allow_partial)
{
        if(!input.get())
            return std::make_pair(Blex::SocketError::NoError, 0);

        if (allow_partial != write_unblocked)
        {
                input->SetBlocking(!allow_partial);
                write_unblocked = allow_partial;
        }

        /* Start writing (FIXME: Support timeouts!) */
        unsigned totalbytessent=0;
        while (numbytes)
        {
                unsigned bytessent = input->Write(data,numbytes);
                if (allow_partial)
                    return std::make_pair(bytessent == 0 ? Blex::SocketError::WouldBlock : Blex::SocketError::NoError, bytessent);

                if (bytessent <= 0)
                {
                        //FIXME: Cleaner solution..
                        proc->Kill(); //FIXME FIXME writing as much as possible just causes process kills with this.... so much for flow control....
                        return std::make_pair(Blex::SocketError::UnknownError, totalbytessent);
                }

                data = static_cast<const uint8_t*>(data) + bytessent;
                numbytes -= bytessent;
                totalbytessent += bytessent;
        }
        return std::make_pair(Blex::SocketError::NoError, totalbytessent);
}

int32_t OSContext::Process::GetOutputHandle(bool for_errors)
{
        if (!for_errors)
            return output.get() ? output->GetId() : 0;
        else
            return errors.get() ? errors->GetId() : 0;
}

// -----------------------------------------------------------------------------
//
// OSContext::ProcessOutputPipe
//

OSContext::ProcessOutputPipe::ProcessOutputPipe(HSVM *vm, std::unique_ptr< Blex::PipeReadStream > &pipe)
: OutputObject(vm, "Process output pipe")
{
        output.reset(pipe.release());
}

OSContext::ProcessOutputPipe::~ProcessOutputPipe()
{
}

bool OSContext::ProcessOutputPipe::IsAtEOF()
{
        return output->EndOfStream();
}

std::pair< Blex::SocketError::Errors, unsigned > OSContext::ProcessOutputPipe::Read(unsigned numbytes, void *data)
{
        unsigned bytes_read = output->Read(data, numbytes);
        if (bytes_read == 0)
            return std::make_pair(output->EndOfStream() ? Blex::SocketError::NoError : Blex::SocketError::WouldBlock, 0);

        return std::make_pair(Blex::SocketError::NoError, bytes_read);
}

bool OSContext::ProcessOutputPipe::AddToWaiterRead(Blex::PipeWaiter &waiter)
{
        if (!readbuffer.empty() && !wait_ignores_readbuffer)
            return true;

        waiter.AddReadPipe(*output);
        return false;
}

OutputObject::SignalledStatus OSContext::ProcessOutputPipe::IsReadSignalled(Blex::PipeWaiter *waiter)
{
        if (!readbuffer.empty() && !wait_ignores_readbuffer)
            return Signalled;

        if (!waiter)
            return Unknown;
        return waiter->GotRead(*output) ? Signalled : NotSignalled;
}

// -----------------------------------------------------------------------------
//
// OSContext
//

OSContext::OSContext()
: console_support(false)
, exitcode(0)
, console_eof(false)
{

}

OSContext::~OSContext()
{
}

void OSContext::SetupConsole()
{
        console_support=true;
}

OSContext::FileInfo* OSContext::GetFile(int fileid)
{
        std::map<int, FileInfoPtr>::iterator itr=filelist.find(fileid);
        if (itr == filelist.end())
            return NULL;

        return itr->second.get();
}
OSContext::Process* OSContext::GetProcess(int processid)
{
        std::map<int, ProcessPtr>::iterator itr=processes.find(processid);
        if (itr == processes.end())
            return NULL;

        return itr->second.get();
}

int OSContext::CreateProcess(HSVM *vm,bool take_input, bool take_output, bool take_errors, bool merge_output_errors, bool separate_processgroup, int64_t virtualmemorylimit)
{
        ProcessPtr newproc(new Process(vm) );
        newproc->proc.reset(new Blex::Process);
        newproc->proc->separate_processgroup = separate_processgroup;

        if (take_input)
        {
                //Create a pipeset, keep the write end for us, and the read end for the child
                Blex::PipeSet inputset;
                inputset.GetWriteEnd().SetBlocking(true); //and that our end is easy to write
                newproc->proc->RedirectInput(inputset.GetReadEnd());
                newproc->input.reset ( inputset.ReleaseWriteEnd() );
        }

        if (take_output)
        {
                //Create a pipeset, keep the write end for us, and the read end for the child
                Blex::PipeSet outputset;
                std::unique_ptr< Blex::PipeReadStream > pipe;
                pipe.reset(outputset.ReleaseReadEnd());
                pipe->SetBlocking(false); //our end must be safe to read
                newproc->output.reset(new ProcessOutputPipe(vm, pipe));
//                newproc->output.reset ( outputset.ReleaseReadEnd() );
                newproc->proc->RedirectOutput(outputset.GetWriteEnd(), merge_output_errors);
        }

        if (take_errors && !merge_output_errors)
        {
                //Create a pipeset, keep the write end for us, and the read end for the child
                Blex::PipeSet errorset;
                std::unique_ptr< Blex::PipeReadStream > pipe;
                pipe.reset(errorset.ReleaseReadEnd());
                pipe->SetBlocking(false); //our end must be safe to read
                newproc->errors.reset(new ProcessOutputPipe(vm, pipe));
                newproc->proc->RedirectErrors(errorset.GetWriteEnd());
        }

        if (virtualmemorylimit >= 0)
            newproc->proc->SetVirtualMemoryLimit(virtualmemorylimit);

        processes[newproc->GetId()] = newproc;
        return newproc->GetId();
}

int OSContext::WaitForProcessOutput(int processid, int maxwait)
{
        Process *proc = GetProcess(processid);
        return proc ? proc->WaitForProcessOutput(maxwait) : 0;
}

std::string OSContext::ReadProcessOutput(int processid)
{
        Process *proc = GetProcess(processid);

        if (proc && proc->output.get())
        {
                Blex::PodVector<uint8_t> data(2048);
                std::pair< Blex::SocketError::Errors, unsigned > readres = proc->output->Read(data.size(), &data[0]);
                if (readres.first == Blex::SocketError::NoError && readres.second > 0)
                    return std::string(reinterpret_cast<char*>(&data[0]), reinterpret_cast<char*>(&data[readres.second]));
        }
        return std::string();
}

std::string OSContext::ReadProcessErrors(int processid)
{
        Process *proc = GetProcess(processid);

        if (proc && proc->errors.get())
        {
                Blex::PodVector<uint8_t> data(2048);
                std::pair< Blex::SocketError::Errors, unsigned > readres = proc->errors->Read(data.size(), &data[0]);
                if (readres.first == Blex::SocketError::NoError && readres.second > 0)
                    return std::string(reinterpret_cast<char*>(&data[0]), reinterpret_cast<char*>(&data[readres.second]));
        }
        return std::string();
}

int32_t OSContext::GetProcessOutputHandle(int processid, bool for_errors)
{
        Process *proc = GetProcess(processid);

        return proc ? proc->GetOutputHandle(for_errors) : 0;
}

bool OSContext::RunProcess(int processid, std::string const &processname, std::vector<std::string> const &args, std::string const &set_cwd, bool share_stdin, bool share_stdout, bool share_stderr)
{
        Process *proc = GetProcess(processid);
        if (!proc)
            return false;
        return proc->Run(processname, args, set_cwd, share_stdin, share_stdout, share_stderr);
}

void OSContext::SetProcessEnvironment(int processid, Blex::Process::Environment const &env)
{
        Process *proc = GetProcess(processid);
        if (!proc)
            throw std::runtime_error("Invalid process id");

        proc->SetEnvironment(env);
}

void OSContext::WaitProcess(int processid)
{
        Process *proc = GetProcess(processid);
        if (!proc)
            throw std::runtime_error("Invalid process id");

        proc->proc->WaitFinish();
        processes.erase(processid);
}
void OSContext::DetachProcess(int processid)
{
        Process *proc = GetProcess(processid);
        if (!proc)
            throw std::runtime_error("Invalid process id");

        proc->proc->Detach();
        processes.erase(processid);
}
void OSContext::SendInterrupt(int processid)
{
        Process *proc = GetProcess(processid);
        if (!proc)
            throw std::runtime_error("Invalid process id");

        proc->proc->SendInterrupt();
}
void OSContext::TerminateProcess(int processid)
{
        Process *proc = GetProcess(processid);
        if (!proc)
            throw std::runtime_error("Invalid process id");

        proc->proc->Kill();
}

void OSContext::ResetProcessInput(int processid)
{
        Process *proc = GetProcess(processid);
        if (!proc)
            throw std::runtime_error("Invalid process id");

        proc->input.reset(NULL);
}

int OSContext::OpenDiskFile(HSVM *vm, std::string const &path, bool writeaccess, bool create, bool failifexists, bool publicfile)
{

        FileInfoPtr newfile(new FileInfo(vm));
        if (writeaccess)
        {
                newfile->randomfile.reset(Blex::FileStream::OpenRW(path,create,failifexists,
                                                                 publicfile ? Blex::FilePermissions::PublicRead : Blex::FilePermissions::PrivateRead));
        }
        else
        {
                newfile->randomfile.reset(Blex::FileStream::OpenRead(path));
        }

        if (!newfile->randomfile.get())
            return 0; //open error..

        newfile->diskfile = static_cast<Blex::FileStream*>(newfile->randomfile.get());
        newfile->can_write=writeaccess;
        int fileid = HSVM_RegisterIOObject(vm, newfile.get(), &OSFileReader, &OSFileWriter, &OSFileEof, NULL, "Open disk file");
        filelist[fileid]=newfile;
        return fileid;
}
bool OSContext::IsProcessRunning(int processid)
{
        Process *proc = GetProcess(processid);
        return proc && proc->proc.get() && !proc->proc->IsFinished();
}
int OSContext::GetProcessExitCode(int processid)
{
        Process *proc = GetProcess(processid);
        return proc && proc->proc.get() && proc->proc->IsFinished() ? proc->proc->GetReturnValue() : -1;
}

bool OSContext::DeleteDiskDirectory(std::string const &path, bool recurse)
{
        return recurse ? Blex::RemoveDirRecursive(path) : Blex::RemoveDir(path) ;
}

Blex::FileOffset OSContext::GetFilelength(HSVM *vm,int filehandle)
{
        FileInfo *file = GetFile(filehandle);
        if (!file || file->io_failure)
            return 0;
        if (file->blobid)
            return HSVM_BlobOpenedLength (vm,file->blobid);

        return file->randomfile->GetFileLength();
}
void OSContext::SetDiskFilelength(int filehandle, Blex::FileOffset filesize)
{
        FileInfo *file = GetFile(filehandle);
        if (!file || file->io_failure)
            return;

        file->eof=false;
        if (!file->can_write || !file->diskfile || !file->diskfile->SetFileLength(filesize))
            file->io_failure=true;
        else if (file->diskfile->GetOffset() > static_cast< unsigned >(filesize)) // Cast allowed due to max(0, ..)
            file->diskfile->SetOffset(filesize);
}
Blex::FileOffset OSContext::GetFilePointer(HSVM *vm, int filehandle)
{
        HareScript::OutputObject *obj = GetVirtualMachine(vm)->GetOutputObject(filehandle, false);
        FileInfo *file = GetFile(filehandle);
        if (!obj || !file || file->io_failure)
            return 0;
        if (file->blobid)
            return file->bloboffset - obj->readbuffer.size();

        return file->randomfile->GetOffset() - obj->readbuffer.size();
}
void OSContext::SetFilePointer(HSVM *vm, int  filehandle, Blex::FileOffset filepointer)
{
        HareScript::OutputObject *obj = GetVirtualMachine(vm)->GetOutputObject(filehandle, false);
        FileInfo *file = GetFile(filehandle);
        if (!file || file->io_failure)
            return;

        obj->readbuffer.clear();
        file->eof=false;
        if (file->blobid)
            file->bloboffset = filepointer;
        else
            file->randomfile->SetOffset(filepointer);
}

unsigned OSContext::FileInfo::Read(unsigned numbytes, void *data)
{
        if (blobid)
        {
                int bytesread = HSVM_BlobDirectRead(vm, blobid, bloboffset, numbytes, data);
                if(bytesread < 0 || (unsigned)bytesread < numbytes)
                    eof=true;
                bloboffset += bytesread;
                return bytesread;
        }
        int bytesread = randomfile->Read(data,numbytes);
        if(bytesread < 0 || (unsigned)bytesread < numbytes)
            eof=true;
        return bytesread;
}
unsigned OSContext::FileInfo::Write(unsigned numbytes, const void *data, bool /*allow_partial*/)
{
        // Don't support non-blocking writes
        if (!io_failure)
        {
                eof=false;
                if (!can_write || randomfile->Write(data,numbytes) != numbytes)
                    io_failure = true;
        }
        return io_failure == false ? numbytes : 0;
}
bool OSContext::CloseFile(HSVM *vm, int  filehandle)
{
        FileInfo *file = GetFile(filehandle);
        if (!file)
            return false;

        bool any_io_errors = file->io_failure;
        if (file->blobid)
            HSVM_BlobClose (vm, file->blobid);

        HSVM_UnregisterIOObject(vm, filehandle);
        filelist.erase(filehandle);
        return any_io_errors == false;
}
void OSContext::SetConsoleExitcode(int  _exitcode)
{
        exitcode = static_cast<uint8_t>(Blex::Bound<int >(0,255,_exitcode));
}

OSContext::PipeEnd::~PipeEnd()
{
        if (owner_job)
        {
                owner_job->capture_handles.erase(GetId());
                owner_job = 0;
        }
}

std::pair< Blex::SocketError::Errors, unsigned > OSContext::PipeEnd::Read(unsigned numbytes, void *data)
{
        if (!read_stream.get())
            return std::make_pair(Blex::SocketError::UnknownError, 0);
        unsigned inbytes = read_stream->Read(data, numbytes);
//        DEBUGPRINT("Pipe Read " << inbytes);
        return std::make_pair(Blex::SocketError::NoError, inbytes);
}
std::pair< Blex::SocketError::Errors, unsigned > OSContext::PipeEnd::Write(unsigned numbytes, const void *data, bool /*allow_partial*/)
{
//        DEBUGPRINT("Pipe Write " << numbytes);
        if (!write_stream.get())
            return std::make_pair(Blex::SocketError::UnknownError, 0);

        unsigned outbytes = write_stream->Write(data, numbytes);
        return std::make_pair(Blex::SocketError::NoError, outbytes);
}
bool OSContext::PipeEnd::IsAtEOF()
{
        if (!read_stream.get())
            return true;
        return read_stream->EndOfStream();
}
bool OSContext::PipeEnd::AddToWaiterRead(Blex::PipeWaiter &waiter)
{
        if (!readbuffer.empty() && !wait_ignores_readbuffer)
            return true;

        if (!read_stream.get())
            return true;
        if (read_stream->GetEvent().IsSignalled())
            return true;
        waiter.AddEvent(read_stream->GetEvent());
        return false;
}
OutputObject::SignalledStatus OSContext::PipeEnd::IsReadSignalled(Blex::PipeWaiter *)
{
        if (!readbuffer.empty() && !wait_ignores_readbuffer)
            return Signalled;

        if (!read_stream.get())
            return Signalled;

        bool got_signalled = read_stream->GetEvent().IsSignalled();
//        DEBUGPRINT("PipeEnd " << this << " (" << GetId() << ") checking signalled " << (got_signalled? "yes" : "no"));
        return got_signalled ? Signalled : NotSignalled;
}
bool OSContext::PipeEnd::AddToWaiterWrite(Blex::PipeWaiter &waiter)
{
        if (!write_stream.get())
            return true;
        if (write_stream->GetEvent().IsSignalled())
            return true;
        waiter.AddEvent(write_stream->GetEvent());
        return false;
}
OutputObject::SignalledStatus OSContext::PipeEnd::IsWriteSignalled(Blex::PipeWaiter *)
{
        if (!write_stream.get())
            return Signalled;

        bool got_signalled = write_stream->GetEvent().IsSignalled();
        return got_signalled ? Signalled : NotSignalled;
}

bool OSContext::PipeEnd::ShouldYieldAfterWrite()
{
        return write_stream->IsYieldThresholdReached();
}

void OSContext::PipeEnd::BreakPipe()
{
        if (read_stream.get())
            read_stream->BreakPipe();
        if (write_stream.get())
            write_stream->BreakPipe();

        if (owner_job)
        {
                owner_job->capture_handles.erase(GetId());
                owner_job = 0;
        }
}

std::pair< int32_t, int32_t > OSContext::CreatePipeSet(HSVM *vm, bool bidi)
{
        std::shared_ptr< PipeEnd > left, right;
        left.reset(new PipeEnd(vm));
        right.reset(new PipeEnd(vm));

        pipes.insert(std::make_pair(left->GetId(), left));
        pipes.insert(std::make_pair(right->GetId(), right));

        Blex::BufferedPipeSet pipeset_1;
//        pipeset_1.GetReadEnd().SetBlocking(false);
//        pipeset_1.GetWriteEnd().SetBlocking(false);
        left->read_stream.reset(pipeset_1.ReleaseReadEnd());
        right->write_stream.reset(pipeset_1.ReleaseWriteEnd());

        if (bidi)
        {
                Blex::BufferedPipeSet pipeset_2;
//                pipeset_2.GetReadEnd().SetBlocking(false);
//                pipeset_2.GetWriteEnd().SetBlocking(false);
                left->write_stream.reset(pipeset_2.ReleaseWriteEnd());
                right->read_stream.reset(pipeset_2.ReleaseReadEnd());
        }

        return std::make_pair(left->GetId(), right->GetId());

}
void OSContext::DeletePipe(int32_t pipeid)
{
        pipes.erase(pipeid);
}

void OSContext::SetPipeJob(int32_t pipeid, Job *job)
{
        std::map< int32_t, std::shared_ptr< PipeEnd > >::iterator it = pipes.find(pipeid);
        if (it == pipes.end() || !it->second->read_stream.get())
            throw VMRuntimeError(Error::InternalError, "Can only set the job on the read end of a pipe");

        it->second->owner_job = job;
        job->capture_handles.insert(std::make_pair(pipeid, std::bind(&OSContext::BreakPipe, this, pipeid)));
}

void OSContext::BreakPipe(int32_t pipeid)
{
        std::map< int32_t, std::shared_ptr< PipeEnd > >::iterator it = pipes.find(pipeid);
        if (it == pipes.end())
            throw VMRuntimeError(Error::InternalError, "Can only break a pipe");

        it->second->BreakPipe();
}

void OSContext::SetPipeReadSignalThreshold(int32_t pipeid, unsigned threshold)
{
        std::map< int32_t, std::shared_ptr< PipeEnd > >::iterator it = pipes.find(pipeid);
        if (it == pipes.end() || !it->second->read_stream.get())
            throw VMRuntimeError(Error::InternalError, "Can only set the signal threshold on the read end of a pipe");

        it->second->read_stream->SetReadSignalThreshold(threshold);
}

void OSContext::SetPipeYieldThreshold(int32_t pipeid, signed threshold)
{
        std::map< int32_t, std::shared_ptr< PipeEnd > >::iterator it = pipes.find(pipeid);
        if (it == pipes.end() || !it->second->write_stream.get())
            throw VMRuntimeError(Error::InternalError, "Can only set the yield threshold on the write end of a pipe");

        it->second->write_stream->SetWriteYieldThreshold(threshold);
}

void OSContext::CloseHandles()
{
        processes.clear();
        pipes.clear();
        filelist.clear();
        zipfiles.clear();;
}


void HS_CreateProcess(VarId id_set, VirtualMachine *vm)
{
        SystemContext context(vm->GetContextKeeper());
        int32_t processid = context->os.CreateProcess(*vm,
                                                 HSVM_BooleanGet(*vm, HSVM_Arg(0)),
                                                 HSVM_BooleanGet(*vm, HSVM_Arg(1)),
                                                 HSVM_BooleanGet(*vm, HSVM_Arg(2)),
                                                 HSVM_BooleanGet(*vm, HSVM_Arg(3)),
                                                 HSVM_BooleanGet(*vm, HSVM_Arg(4)),
                                                 HSVM_Integer64Get(*vm, HSVM_Arg(5)));
        HSVM_IntegerSet(*vm, id_set, processid);
}

void HS_SetProcessEnvironment(VirtualMachine *vm)
{
        ColumnNameId col_name = vm->columnnamemapper.GetMapping("NAME");
        ColumnNameId col_value = vm->columnnamemapper.GetMapping("VALUE");

        Blex::Process::Environment env;

        unsigned len = HSVM_ArrayLength(*vm, HSVM_Arg(1));
        for (unsigned i=0; i < len; ++i)
        {
                HSVM_VariableId rec = HSVM_ArrayGetRef(*vm, HSVM_Arg(1),i);
                HSVM_VariableId name = HSVM_RecordGetRef(*vm, rec, col_name);
                HSVM_VariableId value = HSVM_RecordGetRef(*vm, rec, col_value);

                if (!name || HSVM_GetType(*vm, name) != HSVM_VAR_String)
                {
                        HSVM_ThrowException(*vm, "Expected cell 'NAME' of type STRING in the environment.");
                        return;
                }
                if (!value || HSVM_GetType(*vm, value) != HSVM_VAR_String)
                {
                        HSVM_ThrowException(*vm, "Expected cell 'VALUE' of type STRING in the environment.");
                        return;
                }

                env.insert(std::make_pair(HSVM_StringGetSTD(*vm, name), HSVM_StringGetSTD(*vm, value)));
        }

        SystemContext context(vm->GetContextKeeper());
        context->os.SetProcessEnvironment(HSVM_IntegerGet(*vm, HSVM_Arg(0)), env);
}

void HS_RunProcess(VarId id_set, VirtualMachine *vm)
{
        SystemContext context(vm->GetContextKeeper());

        std::vector<std::string> arguments(HSVM_ArrayLength(*vm, HSVM_Arg(2)));
        for (unsigned i=0; i<arguments.size();++i)
            arguments[i] = HSVM_StringGetSTD(*vm, HSVM_ArrayGetRef(*vm, HSVM_Arg(2),i));

        bool share_stdin = HSVM_BooleanGet(*vm, HSVM_Arg(4));
        bool share_stdout = HSVM_BooleanGet(*vm, HSVM_Arg(5));
        bool share_stderr = HSVM_BooleanGet(*vm, HSVM_Arg(6));
        if((share_stdin || share_stdout || share_stderr) && !HSVM_AllowStdStreamSharing(*vm))
        {
                HSVM_ThrowException(*vm, "The current environment does not permit sharing of stdin/out/err");
                return;
        }

        bool success = context->os.RunProcess(HSVM_IntegerGet(*vm, HSVM_Arg(0)),
                                              HSVM_StringGetSTD(*vm, HSVM_Arg(1)),
                                              arguments,
                                              HSVM_StringGetSTD(*vm, HSVM_Arg(3)),
                                              share_stdin,
                                              share_stdout,
                                              share_stderr);

        HSVM_BooleanSet(*vm, id_set, success);
}

void HS_WaitForProcessOutput(VarId id_set, VirtualMachine *vm)
{
        SystemContext context(vm->GetContextKeeper());
        int32_t id = context->os.WaitForProcessOutput(HSVM_IntegerGet(*vm, HSVM_Arg(0)), HSVM_IntegerGet(*vm, HSVM_Arg(1)));
        HSVM_IntegerSet(*vm, id_set, id);
}

void HS_ReadProcessOutput(VarId id_set, VirtualMachine *vm)
{
        SystemContext context(vm->GetContextKeeper());
        HSVM_StringSetSTD(*vm, id_set, context->os.ReadProcessOutput(HSVM_IntegerGet(*vm, HSVM_Arg(0))));
}

void HS_ReadProcessErrors(VarId id_set, VirtualMachine *vm)
{
        SystemContext context(vm->GetContextKeeper());
        HSVM_StringSetSTD(*vm, id_set, context->os.ReadProcessErrors(HSVM_IntegerGet(*vm, HSVM_Arg(0))));
}

void HS_CloseProcessInput(VirtualMachine *vm)
{
        SystemContext context(vm->GetContextKeeper());
        context->os.ResetProcessInput(HSVM_IntegerGet(*vm, HSVM_Arg(0)));
}

void HS_CloseProcess(VirtualMachine *vm)
{
        SystemContext context(vm->GetContextKeeper());
        context->os.WaitProcess(HSVM_IntegerGet(*vm, HSVM_Arg(0)));
}
void HS_InterruptProcess(VirtualMachine *vm)
{
        SystemContext context(vm->GetContextKeeper());
        context->os.SendInterrupt(HSVM_IntegerGet(*vm, HSVM_Arg(0)));
}
void HS_TerminateProcess(VirtualMachine *vm)
{
        SystemContext context(vm->GetContextKeeper());
        context->os.TerminateProcess(HSVM_IntegerGet(*vm, HSVM_Arg(0)));
}
void HS_DetachProcess(VirtualMachine *vm)
{
        SystemContext context(vm->GetContextKeeper());
        context->os.DetachProcess(HSVM_IntegerGet(*vm, HSVM_Arg(0)));
}

void HS_GetProcessOutputHandle(VarId id_set, VirtualMachine *vm)
{
        SystemContext context(vm->GetContextKeeper());
        HSVM_IntegerSet(*vm, id_set, context->os.GetProcessOutputHandle(
                HSVM_IntegerGet(*vm, HSVM_Arg(0)),
                HSVM_BooleanGet(*vm, HSVM_Arg(1))));
}

void HS_GenerateTemporaryPathname(VarId id_set, VirtualMachine *vm)
{
        std::string pathname = Blex::CreateTempName(Blex::MergePath(vm->GetFileSystem().GetTempDir(),"hsvmtemp"));
        HSVM_StringSetSTD(*vm, id_set, pathname);
}

void HS_GenerateTemporaryPathnameFromBasepath(VarId id_set, VirtualMachine *vm)
{
        std::string arg = HSVM_StringGetSTD(*vm, HSVM_Arg(0));
        std::string pathname = Blex::CreateTempName(arg);
        HSVM_StringSetSTD(*vm, id_set, pathname);
}

void HS_GetTempDir(VarId id_set, VirtualMachine *vm)
{
        HSVM_StringSetSTD(*vm, id_set, vm->GetFileSystem().GetTempDir());
}

void HS_GetConsoleArguments(VarId id_set, VirtualMachine *vm)
{
        Baselibs::SystemContext context(vm->GetContextKeeper());

        HSVM_SetDefault(*vm, id_set, HSVM_VAR_StringArray);
        for(unsigned i=0; i<context->os.console_args.size(); ++i)
            HSVM_StringSetSTD(*vm, HSVM_ArrayAppend(*vm, id_set), context->os.console_args[i]);
}

void HS_ParseArguments(VarId id_set, VirtualMachine *vm)
{
        // Get the arguments list
        std::vector<std::string> args;
        args.push_back("executable_name");//skipped while parsing, but expected as first argument
        unsigned numargs = HSVM_ArrayLength(*vm, HSVM_Arg(0));
        for (unsigned a = 0; a < numargs; ++a)
        {
                std::string arg = HSVM_StringGetSTD(*vm, HSVM_ArrayGetRef(*vm, HSVM_Arg(0), a));
                args.push_back(arg);
        }

        // Iterate over vars array and build options list
        std::vector<Blex::OptionParser::Option> optionlist;
        std::map<std::string, std::string> vars;
        unsigned numvars = HSVM_ArrayLength(*vm, HSVM_Arg(1));
        for (unsigned v = 0; v < numvars; ++v)
        {
                HSVM_VariableId var = HSVM_ArrayGetRef(*vm, HSVM_Arg(1), v);
                if (!HSVM_RecordExists(*vm, var))
                    continue;//skip non-existing record

                // Get name and type
                HSVM_VariableId col = HSVM_RecordGetRef(*vm, var, HSVM_GetColumnId(*vm, "NAME"));
                if (col == 0)
                {
                        HSVM_ReportCustomError(*vm, "Column 'NAME' does not exist in variable record");
                        return;
                }
                if (HSVM_GetType(*vm, col) != HSVM_VAR_String)
                {
                        HSVM_ReportCustomError(*vm, "Column 'NAME' not of type STRING");
                        return;
                }
                std::string name = HSVM_StringGetSTD(*vm, col);
                col = HSVM_RecordGetRef(*vm, var, HSVM_GetColumnId(*vm, "TYPE"));
                if (col == 0)
                {
                        HSVM_ReportCustomError(*vm, "Column 'TYPE' does not exist in variable record");
                        return;
                }
                if (HSVM_GetType(*vm, col) != HSVM_VAR_String)
                {
                        HSVM_ReportCustomError(*vm, "Column 'TYPE' not of type STRING");
                        return;
                }
                std::string type = HSVM_StringGetSTD(*vm, col);
                Blex::ToUppercase(type.begin(), type.end());
                vars.insert(std::make_pair(name,type));

                // Add option to optionlist
                if (type == "SWITCH")
                {
                        bool val = false;
                        col = HSVM_RecordGetRef(*vm, var, HSVM_GetColumnId(*vm, "DEFAULTVALUE"));
                        if (col != 0 && HSVM_GetType(*vm, col) == HSVM_VAR_Boolean)
                            val = HSVM_BooleanGet(*vm, col);
                        optionlist.push_back(Blex::OptionParser::Option::Switch(name, val));
                }
                else if (type == "STRINGOPT")
                {
                        optionlist.push_back(Blex::OptionParser::Option::StringOpt(name));
                }
                else if (type == "STRINGLIST")
                {
                        optionlist.push_back(Blex::OptionParser::Option::StringList(name));
                }
                else if (type == "PARAM")
                {
                        bool req = false;
                        col = HSVM_RecordGetRef(*vm, var, HSVM_GetColumnId(*vm, "REQUIRED"));
                        if (col != 0 && HSVM_GetType(*vm, col) == HSVM_VAR_Boolean)
                            req = HSVM_BooleanGet(*vm, col);
                        optionlist.push_back(Blex::OptionParser::Option::Param(name, req));
                }
                else if (type == "PARAMLIST")
                {
                        optionlist.push_back(Blex::OptionParser::Option::ParamList(name));
                        if ((v+1) < numvars)
                        {
                                HSVM_ReportCustomError(*vm, "'PARAMLIST' not the last variable record type");
                                return;
                        }
                }
                else
                {
                        type = "Unknown argument type '"+type+"'";
                        HSVM_ReportCustomError(*vm, type.c_str());
                        return;
                }
        }
        optionlist.push_back(Blex::OptionParser::Option::ListEnd());

        // Parse arguments and store variables
        HSVM_SetDefault(*vm, id_set, HSVM_VAR_Record);
        Blex::OptionParser parser(&optionlist[0]);
        if (parser.Parse(args))
        {
                HSVM_RecordSetEmpty(*vm, id_set);

                for (std::map<std::string, std::string>::iterator var = vars.begin();
                     var != vars.end(); ++var)
                {
                        HSVM_VariableId col = HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, var->first.c_str()));
                        if (var->second == "SWITCH")
                        {
                                HSVM_BooleanSet(*vm, col, parser.Switch(var->first));
                        }
                        else if (var->second == "STRINGOPT")
                        {
                                HSVM_StringSetSTD(*vm, col, parser.StringOpt(var->first));
                        }
                        else if (var->second == "PARAM")
                        {
                                HSVM_StringSetSTD(*vm, col, parser.Param(var->first));
                        }
                        else if (var->second == "STRINGLIST" || var->second == "PARAMLIST")
                        {
                                const std::vector<std::string> * strings;
                                if (var->second == "STRINGLIST")
                                    strings = &parser.StringList(var->first);
                                else
                                    strings = &parser.ParamList(var->first);
                                HSVM_SetDefault(*vm, col, HSVM_VAR_StringArray);
                                for (std::vector<std::string>::const_iterator s = strings->begin(); s != strings->end(); ++s)
                                    HSVM_StringSetSTD(*vm, HSVM_ArrayAppend(*vm, col), *s);
                        }
                }
        }
}
void HS_IsConsoleSupportAvailable(VarId id_set, VirtualMachine *vm)
{
        Baselibs::SystemContext context(vm->GetContextKeeper());
        HSVM_BooleanSet(*vm, id_set, context->os.console_support);
}
void HS_IsConsoleATerminal(VarId id_set, VirtualMachine *vm)
{
        Baselibs::SystemContext context(vm->GetContextKeeper());
        if (!context->os.console_support)
            throw HareScript::VMRuntimeError(Error::NoConsoleAvailable);
        HSVM_BooleanSet(*vm, id_set, Blex::IsConsoleATerminal());
}
void GetConsoleSize(VarId id_set, VirtualMachine *vm)
{
        Baselibs::SystemContext context(vm->GetContextKeeper());
        if (!context->os.console_support)
            throw HareScript::VMRuntimeError(Error::NoConsoleAvailable);

        HSVM_SetDefault(*vm, id_set, HSVM_VAR_Record);
        std::pair< unsigned, unsigned > size = Blex::GetConsoleSize();

        HSVM_SetDefault(*vm, id_set, HSVM_VAR_Record);
        if (size.first && size.second)
        {
                HSVM_IntegerSet(*vm, HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, "ROWS")), size.first);
                HSVM_IntegerSet(*vm, HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, "COLS")), size.second);
        }
}
void HS_IsPathAbsolute(VarId id_set, VirtualMachine *vm)
{
        HSVM_BooleanSet(*vm, id_set, Blex::PathIsAbsolute(HSVM_StringGetSTD(*vm, HSVM_Arg(0))));
}

void HS_IsSafeFilePath(VarId id_set, VirtualMachine *vm)
{
        Blex::StringPair the_str;
        HSVM_StringGet(*vm, HSVM_Arg(0), &the_str.begin, &the_str.end);

        HSVM_BooleanSet(*vm, id_set, Blex::IsSafeFilePath(the_str.begin, the_str.end, HSVM_BooleanGet(*vm, HSVM_Arg(1))));
}

void HS_GetHSResource(VarId id_set, VirtualMachine *vm)
{
        HSVM_SetDefault(*vm, id_set, HSVM_VAR_Record);
        std::string path = HSVM_StringGetSTD(*vm, HSVM_Arg(0));

        HSVM_VariableId resblob = HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, "DATA"));

        int errorcode = HSVM_MakeBlobFromFilesystem(*vm, resblob, path.c_str(), 6/*resource*/);
        HSVM_IntegerSet(*vm, HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, "ERROR")), errorcode);
}
void HS_OpenBlobAsFile(VarId id_set, VirtualMachine *vm)
{
        int32_t fileid = 0;
        if (uint32_t blobid = HSVM_BlobOpen(*vm, HSVM_Arg(0)))
        {
                Baselibs::SystemContext context(vm->GetContextKeeper());
                OSContext::FileInfoPtr newfile(new OSContext::FileInfo(*vm));
                newfile->blobid = blobid;
                newfile->bloboffset = 0;

                fileid = HSVM_RegisterIOObject(*vm, newfile.get(), &OSFileReader, &OSFileWriter, &OSFileEof, NULL, "Blob as file");
                context->os.filelist[fileid]=newfile;
        }
        HSVM_IntegerSet(*vm, id_set, fileid);
}
void HS_OpenDiskFile(VarId id_set, VirtualMachine *vm)
{
        Baselibs::SystemContext context(vm->GetContextKeeper());

        int32_t fileid = context->os.OpenDiskFile(*vm,
                                              HSVM_StringGetSTD(*vm, HSVM_Arg(0)),
                                              HSVM_BooleanGet(*vm, HSVM_Arg(1)),
                                              HSVM_BooleanGet(*vm, HSVM_Arg(2)),
                                              HSVM_BooleanGet(*vm, HSVM_Arg(3)),
                                              HSVM_BooleanGet(*vm, HSVM_Arg(4)));
        HSVM_IntegerSet(*vm, id_set, fileid);
}
void HS_CloseFile(VarId id_set, VirtualMachine *vm)
{
        Baselibs::SystemContext context(vm->GetContextKeeper());
        HSVM_BooleanSet(*vm, id_set, context->os.CloseFile(*vm, HSVM_IntegerGet(*vm, HSVM_Arg(0))));
}

void HS_DeleteDiskFile(VarId id_set, VirtualMachine *vm)
{
        Baselibs::SystemContext context(vm->GetContextKeeper());

        std::string path = HSVM_StringGetSTD(*vm, HSVM_Arg(0));
        bool success=true;

        if (success)
        {
                //ADDME Eliminate filesystem references?
                success = Blex::RemoveFile(path);
        }
        HSVM_BooleanSet(*vm,id_set,success);
}
void HS_ReadSoftLink(VarId id_set, VirtualMachine *vm)
{
        HSVM_StringSetSTD(*vm, id_set, Blex::ReadSoftLink(HSVM_StringGetSTD(*vm, HSVM_Arg(0))));
}
void HS_CreateSoftLink(VarId id_set, VirtualMachine *vm)
{
        HSVM_BooleanSet(*vm, id_set, Blex::CreateNewSoftLink(HSVM_StringGetSTD(*vm, HSVM_Arg(0)), HSVM_StringGetSTD(*vm, HSVM_Arg(1))));
}
void HS_CreateHardLink(VarId id_set, VirtualMachine *vm)
{
        HSVM_BooleanSet(*vm, id_set, Blex::CreateNewHardLink(HSVM_StringGetSTD(*vm, HSVM_Arg(0)), HSVM_StringGetSTD(*vm, HSVM_Arg(1))));
}
void HS_DeleteDiskDirectory(VarId id_set, VirtualMachine *vm)
{
        Baselibs::SystemContext context(vm->GetContextKeeper());

        HSVM_BooleanSet(*vm, id_set, context->os.DeleteDiskDirectory(HSVM_StringGetSTD(*vm, HSVM_Arg(0)),false));
}
void HS_DeleteDiskDirectoryRecursive(VarId id_set, VirtualMachine *vm)
{
        Baselibs::SystemContext context(vm->GetContextKeeper());

        HSVM_BooleanSet(*vm, id_set, context->os.DeleteDiskDirectory(HSVM_StringGetSTD(*vm, HSVM_Arg(0)),true));
}
void HS_IsProcessRunning(VarId id_set, VirtualMachine *vm)
{
        Baselibs::SystemContext context(vm->GetContextKeeper());
        HSVM_BooleanSet(*vm, id_set, context->os.IsProcessRunning(HSVM_IntegerGet(*vm, HSVM_Arg(0))));
}
void HS_SetConsoleExitValue(VirtualMachine *vm)
{
        Baselibs::SystemContext context(vm->GetContextKeeper());
        context->os.SetConsoleExitcode(HSVM_IntegerGet(*vm, HSVM_Arg(0)));
}
void HS_SetConsoleLineBuffered(VirtualMachine *vm)
{
        Blex::SetConsoleLineBuffered(HSVM_BooleanGet(*vm, HSVM_Arg(0)));
}
void HS_GetConsoleEcho(VarId id_set, VirtualMachine *vm)
{
        HSVM_BooleanSet(*vm, id_set, Blex::GetConsoleEcho());
}
void HS_SetConsoleEcho(VirtualMachine *vm)
{
        if (Blex::IsConsoleATerminal())
            Blex::SetConsoleEcho(HSVM_BooleanGet(*vm, HSVM_Arg(0)));
}
void HS_SetFilePointer(VirtualMachine *vm)
{
        Baselibs::SystemContext context(vm->GetContextKeeper());
        context->os.SetFilePointer(*vm, HSVM_IntegerGet(*vm, HSVM_Arg(0)), HSVM_Integer64Get(*vm, HSVM_Arg(1)));
}
void HS_SetDiskFileLength(VirtualMachine *vm)
{
        Baselibs::SystemContext context(vm->GetContextKeeper());
        context->os.SetDiskFilelength(HSVM_IntegerGet(*vm, HSVM_Arg(0)), HSVM_Integer64Get(*vm, HSVM_Arg(1)));
}
void HS_GetFilePointer(VarId id_set,VirtualMachine *vm)
{
        Baselibs::SystemContext context(vm->GetContextKeeper());
        HSVM_Integer64Set(*vm, id_set, context->os.GetFilePointer(*vm, HSVM_IntegerGet(*vm, HSVM_Arg(0))));
}
void HS_GetProcessExitCode(VarId id_set,VirtualMachine *vm)
{
        Baselibs::SystemContext context(vm->GetContextKeeper());
        HSVM_IntegerSet(*vm, id_set, context->os.GetProcessExitCode(HSVM_IntegerGet(*vm, HSVM_Arg(0))));
}
void HS_GetFileLength(VarId id_set,VirtualMachine *vm)
{
        Baselibs::SystemContext context(vm->GetContextKeeper());
        HSVM_Integer64Set(*vm, id_set, context->os.GetFilelength(*vm, HSVM_IntegerGet(*vm, HSVM_Arg(0))));
}
void HS_GetCurrentPath(VarId id_set, VirtualMachine *vm)
{
        HSVM_StringSetSTD(*vm, id_set, Blex::GetCurrentDir());
}

void HS_CollapsePath(VarId id_set, VirtualMachine *vm)
{
        std::string path = vm->GetStackMachine().GetString(HSVM_Arg(0)).stl_str();
        path = Blex::CollapsePathString(path);
        vm->GetStackMachine().SetSTLString(id_set,path);
}

void HS_MergePath(VarId id_set, VirtualMachine *vm)
{
        std::string path1 = vm->GetStackMachine().GetString(HSVM_Arg(0)).stl_str();
        std::string path2 = vm->GetStackMachine().GetString(HSVM_Arg(1)).stl_str();
        path1 = Blex::MergePath(path1, path2);
        vm->GetStackMachine().SetSTLString(id_set,path1);
}
void HS_GetSystemOsName(VarId id_set, VirtualMachine *vm)
{
        vm->GetStackMachine().SetSTLString(id_set,Blex::GetSystemDescription());
}

void HS_GetSystemNumProcessors(VarId id_set, VirtualMachine *vm)
{
        vm->GetStackMachine().SetInteger(id_set,Blex::GetSystemCPUs(true));
}
void HS_GetSystemNumVirtualProcessors(VarId id_set, VirtualMachine *vm)
{
        vm->GetStackMachine().SetInteger(id_set,Blex::GetSystemCPUs(false));
}

void HS_GetLastOSError(VarId id_set, VirtualMachine *vm)
{
        vm->GetStackMachine().SetSTLString(id_set,Blex::GetLastOSError());
}
void PathStatusToVar(HSVM *vm, HSVM_VariableId varid, Blex::PathStatus const &status)
{
        HSVM_ColumnId typecolid =  HSVM_GetColumnId(vm, "TYPE");
        HSVM_ColumnId groupid =    HSVM_GetColumnId(vm, "OWNERGROUP");
        HSVM_ColumnId userid =     HSVM_GetColumnId(vm, "OWNERUSER");
        HSVM_ColumnId modifiedid = HSVM_GetColumnId(vm, "MODIFIED");
        HSVM_ColumnId sizeid     = HSVM_GetColumnId(vm, "SIZE");
        HSVM_ColumnId size64id   = HSVM_GetColumnId(vm, "SIZE64");
        HSVM_ColumnId unixrights = HSVM_GetColumnId(vm, "UNIXPERMISSIONS");

        int type = status.IsLink() ? 2 : status.IsDir() ? 1 : 0;
        HSVM_IntegerSet(vm,   HSVM_RecordCreate(vm, varid, typecolid), type);
        HSVM_SetDefault(vm,   HSVM_RecordCreate(vm, varid, groupid), HSVM_VAR_String);
        HSVM_SetDefault(vm,   HSVM_RecordCreate(vm, varid, userid), HSVM_VAR_String);
        HSVM_DateTimeSet(vm,  HSVM_RecordCreate(vm, varid, modifiedid), status.ModTime().GetDays(), status.ModTime().GetMsecs());
        HSVM_IntegerSet(vm,   HSVM_RecordCreate(vm, varid, sizeid), Blex::LimitOffsetToInt(status.FileLength()));
        HSVM_Integer64Set(vm, HSVM_RecordCreate(vm, varid, size64id), status.FileLength());
        HSVM_IntegerSet(vm,   HSVM_RecordCreate(vm, varid, unixrights), status.GetUnixAccess());
}

void HS_GetDiskFileProperties(VarId id_set, VirtualMachine *vm)
{
        HSVM_SetDefault(*vm, id_set, HSVM_VAR_Record);
        std::string path = HSVM_StringGetSTD(*vm, HSVM_Arg(0));
        if(!Blex::PathIsAbsolute(path))
              return;

        Blex::PathStatus status(path);
        if(!status.Exists())
              return;

        PathStatusToVar(*vm, id_set, status);
}

void HS_ReadDiskDirectory(VarId id_set, VirtualMachine *vm)
{
        HSVM_SetDefault(*vm, id_set, HSVM_VAR_RecordArray);
        std::string path = HSVM_StringGetSTD(*vm, HSVM_Arg(0));
        if(!Blex::PathIsAbsolute(path))
              return;

        HSVM_ColumnId nameid = HSVM_GetColumnId(*vm, "NAME");
        HSVM_ColumnId pathid = HSVM_GetColumnId(*vm, "PATH");

        for (Blex::Directory dirdata(path, HSVM_StringGetSTD(*vm, HSVM_Arg(1))); dirdata;++dirdata)
        {
                HSVM_VariableId newrec = HSVM_ArrayAppend(*vm, id_set);
                HSVM_StringSetSTD(*vm, HSVM_RecordCreate(*vm, newrec, nameid), dirdata.CurrentFile());
                HSVM_StringSetSTD(*vm, HSVM_RecordCreate(*vm, newrec, pathid), dirdata.CurrentPath());
                PathStatusToVar(*vm, newrec, dirdata.GetStatus());
        }
}

void HS_CreateDiskDirectory(VarId id_set, VirtualMachine *vm)
{
        bool success =
                Blex::CreateDir(
                        vm->GetStackMachine().GetString(HSVM_Arg(0)).stl_str(),
                        vm->GetStackMachine().GetBoolean(HSVM_Arg(1)));

        HSVM_BooleanSet(*vm, id_set, success);
}
void HS_CreateDiskDirectoryRecursive(VarId id_set, VirtualMachine *vm)
{
        bool success =
                Blex::CreateDirRecursive(
                        vm->GetStackMachine().GetString(HSVM_Arg(0)).stl_str(),
                        vm->GetStackMachine().GetBoolean(HSVM_Arg(1)));

        HSVM_BooleanSet(*vm, id_set, success);
}

void HS_MoveDiskFile(VarId id_set, VirtualMachine *vm)
{
        bool success =
                Blex::MovePath(
                        vm->GetStackMachine().GetString(HSVM_Arg(0)).stl_str(),
                        vm->GetStackMachine().GetString(HSVM_Arg(1)).stl_str());

        HSVM_BooleanSet(*vm, id_set, success);
}

void HS_SetUnixPermissions(VarId id_set, VirtualMachine *vm)
{
        bool success = Blex::SetUNIXPermissions(HSVM_StringGetSTD(*vm, HSVM_Arg(0)),
                                                (Blex::FilePermissions::AccessFlags)HSVM_IntegerGet(*vm, HSVM_Arg(1)));
        HSVM_BooleanSet(*vm, id_set, success);
}
void HS_SetFileModificationDate(VarId id_set, VirtualMachine *vm)
{
        int high, low;
        HSVM_DateTimeGet(*vm, HSVM_Arg(1), &high, &low);
        bool success = Blex::SetFileModificationDate(HSVM_StringGetSTD(*vm, HSVM_Arg(0)), Blex::DateTime(high,low));
        HSVM_BooleanSet(*vm, id_set, success);
}

void HS_SetOutputBuffering(VirtualMachine *vm)
{
        HSVM_SetOutputBuffering(*vm, vm->GetStackMachine().GetBoolean(HSVM_Arg(0)));
}

void HS_FlushOutputBuffer(VirtualMachine *vm)
{
        HSVM_FlushOutputBuffer(*vm);
}

void HS_CreatePipeSet(VarId id_set, VirtualMachine *vm)
{
        SystemContext context(vm->GetContextKeeper());
        std::pair< int32_t, int32_t > pipes = context->os.CreatePipeSet(*vm, /*bidi=*/false);

        HSVM_ColumnId col_read   = HSVM_GetColumnId(*vm, "READ");
        HSVM_ColumnId col_write  = HSVM_GetColumnId(*vm, "WRITE");
        HSVM_SetDefault(*vm, id_set, HSVM_VAR_Record);

        HSVM_IntegerSet(*vm,   HSVM_RecordCreate(*vm, id_set, col_read), pipes.first);
        HSVM_IntegerSet(*vm,   HSVM_RecordCreate(*vm, id_set, col_write), pipes.second);
}

void HS_SetPipeReadSignalThreshold(VirtualMachine *vm)
{
        SystemContext context(vm->GetContextKeeper());
        int32_t pipeid = HSVM_IntegerGet(*vm, HSVM_Arg(0));
        int32_t threshold = HSVM_IntegerGet(*vm, HSVM_Arg(1));

        if (threshold < 0)
            threshold = 0;

        context->os.SetPipeReadSignalThreshold(pipeid, threshold);
}

void HS_SetPipeYieldThreshold(VirtualMachine *vm)
{
        SystemContext context(vm->GetContextKeeper());
        int32_t pipeid = HSVM_IntegerGet(*vm, HSVM_Arg(0));
        int32_t threshold = HSVM_IntegerGet(*vm, HSVM_Arg(1));

        if (threshold < -1)
            threshold = -1;

        context->os.SetPipeYieldThreshold(pipeid, threshold);
}

OSContext::PipeMarshalData::PipeMarshalData(PipeEnd *pipe)
{
        read_stream.reset(pipe->read_stream.release());
        write_stream.reset(pipe->write_stream.release());
}

bool OSContext::PipeMarshalData::RestoreTo(struct HSVM *vm, HSVM_VariableId var)
{
        std::shared_ptr< OSContext::PipeEnd > pipe;
        pipe.reset(new OSContext::PipeEnd(vm));

        pipe->read_stream.reset(read_stream.release());
        pipe->write_stream.reset(write_stream.release());

        int32_t newid = pipe->GetId();

        SystemContext receiver_context(GetVirtualMachine(vm)->GetContextKeeper());
        receiver_context->os.pipes.insert(std::make_pair(newid, pipe));

        // Create the object in var
        HSVM_OpenFunctionCall(vm, 1);
        HSVM_IntegerSet(vm, HSVM_CallParam(vm, 0), newid);
        const HSVM_VariableType args[1] = { HSVM_VAR_Integer };
        HSVM_VariableId obj = HSVM_CallFunction(vm, "wh::internal/jobs.whlib", "CREATEPIPEMARSHALLER", HSVM_VAR_Object, 1, args);
        if (!obj)
            return false;

        HSVM_CopyFrom(vm, var, obj);
        HSVM_CloseFunctionCall(vm);

        return true;
}

int OSContext::MovePipeToOtherVM(HSVM *receiver, int pipeid)
{
        std::shared_ptr< OSContext::PipeEnd > pipe;
        int32_t newid = -1;

        std::map< int32_t, std::shared_ptr< OSContext::PipeEnd > > :: iterator it = pipes.find(pipeid);
        if (it != pipes.end())
        {
                pipe.reset(new OSContext::PipeEnd(receiver));
                newid = pipe->GetId();

                // move the pipedata
                pipe->read_stream.reset(it->second->read_stream.release());
                pipe->write_stream.reset(it->second->write_stream.release());

                // Kill the org pipe
                pipes.erase(it);

                // Register the new pipe
                SystemContext receiver_context(GetVirtualMachine(receiver)->GetContextKeeper());
                receiver_context->os.pipes.insert(std::make_pair(newid, pipe));
        }
        return newid;
}

int OSContext::PipeMarshaller(struct HSVM *vm, HSVM_VariableId var, void **resultdata, HSVM_ObjectRestorePtr *restoreptr, HSVM_ObjectClonePtr *cloneptr)
{
        // Can't clone a pipe
        if (cloneptr)
            return false;

        SystemContext caller_context(GetVirtualMachine(vm)->GetContextKeeper());
        HSVM_ColumnId caller_col_pvt_pipe   = HSVM_GetColumnId(vm, "PVT_PIPE");
        HSVM_VariableId pipe_var = HSVM_ObjectMemberRef(vm, var, caller_col_pvt_pipe, true);
        int32_t id = pipe_var ? HSVM_IntegerGet(vm, pipe_var) : -1;

        std::map< int32_t, std::shared_ptr< OSContext::PipeEnd > > :: iterator it = caller_context->os.pipes.find(id);
        if (it != caller_context->os.pipes.end())
        {
                // Create a marshal packet
                std::unique_ptr< PipeMarshalData > data;
                data.reset(new PipeMarshalData(it->second.get()));

                // Kill the org pipe
                caller_context->os.pipes.erase(it);

                *restoreptr = &HSVM_ObjectMarshalRestoreWrapper< PipeMarshalData >;
                *resultdata = data.release();
                return true;
        }
        return false;
}


void HS_SetPipeMarshaller(VirtualMachine *vm)
{
        HSVM_ObjectSetMarshaller(*vm, HSVM_Arg(0), &OSContext::PipeMarshaller);
}
void HS_ClosePipe(VirtualMachine *vm)
{
        Baselibs::SystemContext context(vm->GetContextKeeper());

        context->os.DeletePipe(HSVM_IntegerGet(*vm, HSVM_Arg(0)));
}

void HS_GetEnvironmentVariable(VarId id_set, VirtualMachine *vm)
{
        std::string name = HSVM_StringGetSTD(*vm, HSVM_Arg(0)), value;

        JobManager *jobmgr = vm->GetVMGroup()->GetJobManager();
        std::shared_ptr< const Blex::Process::Environment > override;
        if (jobmgr)
            override = jobmgr->GetGroupEnvironmentOverride(vm->GetVMGroup());

        if (override)
        {
                for (auto itr : *override)
                    if (itr.first == name)
                        value = itr.second;
        }
        else
            value = Blex::GetEnvironVariable(name);

        HSVM_StringSetSTD(*vm, id_set, value);
}

void HS_GetEnvironment(VarId id_set, VirtualMachine *vm)
{
        JobManager *jobmgr = vm->GetVMGroup()->GetJobManager();

        Blex::Process::Environment env;
        std::shared_ptr< const Blex::Process::Environment > override;
        if (jobmgr)
            override = jobmgr->GetGroupEnvironmentOverride(vm->GetVMGroup());

        Blex::Process::Environment const *useenv;
        if (override)
            useenv = override.get();
        else
        {
                useenv = &env;
                Blex::ParseEnvironment(&env);
        }

        HSVM_ColumnId col_name =   HSVM_GetColumnId(*vm, "NAME");
        HSVM_ColumnId col_value =  HSVM_GetColumnId(*vm, "VALUE");

        HSVM_SetDefault(*vm, id_set, HSVM_VAR_RecordArray);
        for (auto itr : *useenv)
        {
                HSVM_VariableId newrec = HSVM_ArrayAppend(*vm, id_set);

                HSVM_StringSetSTD(*vm, HSVM_RecordCreate(*vm, newrec, col_name), itr.first);
                HSVM_StringSetSTD(*vm, HSVM_RecordCreate(*vm, newrec, col_value), itr.second);
        }
}

void HS_GetHostingProcessStartTime(VarId id_set, VirtualMachine *vm)
{
        Blex::DateTime boottime = Blex::GetProcessStartTime();
        HSVM_DateTimeSet(*vm, id_set, boottime.GetDays(), boottime.GetMsecs());
}

void InitProcess(BuiltinFunctionsRegistrator &bifreg)
{
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_OPENDISKFILE::I:SBBBB",HS_OpenDiskFile));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_CLOSEFILE::B:I",HS_CloseFile));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__PIPEMARSHALLER#SETMARSHALLER:::O",HS_SetPipeMarshaller));

        //KEEP THIS LIST ALPHABETICALLY SORTED!
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("CLOSEPIPE:::I", HS_ClosePipe));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("CLOSEPROCESS:::I",HS_CloseProcess));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("CLOSEPROCESSINPUT:::I",HS_CloseProcessInput));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__COLLAPSEPATH::S:S",HS_CollapsePath));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("CREATEDISKDIRECTORY::B:SB",HS_CreateDiskDirectory));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("CREATEDISKDIRECTORYRECURSIVE::B:SB",HS_CreateDiskDirectoryRecursive));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("CREATEPIPESET::R:",HS_CreatePipeSet));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("CREATEPROCESSINTERNAL::I:BBBBB6",HS_CreateProcess));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("CREATESOFTLINK::B:SS",HS_CreateSoftLink));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("CREATEHARDLINK::B:SS",HS_CreateHardLink));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("DELETEDISKDIRECTORY::B:S",HS_DeleteDiskDirectory));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("DELETEDISKDIRECTORYRECURSIVE::B:S",HS_DeleteDiskDirectoryRecursive));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("DELETEDISKFILE::B:S",HS_DeleteDiskFile));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("FLUSHOUTPUTBUFFER:::",HS_FlushOutputBuffer));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("ISCONSOLEATERMINAL::B:",HS_IsConsoleATerminal));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("ISCONSOLESUPPORTAVAILABLE::B:",HS_IsConsoleSupportAvailable));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("ISPROCESSRUNNING::B:I",HS_IsProcessRunning));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("ISPATHABSOLUTE::B:S",HS_IsPathAbsolute));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("ISSAFEFILEPATH::B:SB",HS_IsSafeFilePath));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GENERATETEMPORARYPATHNAME::S:",HS_GenerateTemporaryPathname));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GENERATETEMPORARYPATHNAMEFROMBASEPATH::S:S", HS_GenerateTemporaryPathnameFromBasepath));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETTEMPDIR::S:",HS_GetTempDir));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETCONSOLEARGUMENTS::SA:",HS_GetConsoleArguments));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETCURRENTPATH::S:",HS_GetCurrentPath));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETENVIRONMENTVARIABLE::S:S", HS_GetEnvironmentVariable));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETENVIRONMENT::RA:", HS_GetEnvironment));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETFILELENGTH::6:I",HS_GetFileLength));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETFILEPOINTER::6:I",HS_GetFilePointer));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETHOSTINGPROCESSSTARTTIME::D:", HS_GetHostingProcessStartTime));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETLASTOSERROR::S:", HS_GetLastOSError));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETPROCESSEXITCODE::I:I",HS_GetProcessExitCode));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETSYSTEMNUMPROCESSORS::I:",HS_GetSystemNumProcessors));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETSYSTEMNUMVIRTUALPROCESSORS::I:",HS_GetSystemNumVirtualProcessors));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETSYSTEMOSNAME::S:",HS_GetSystemOsName));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__GETHSRESOURCE::R:S",HS_GetHSResource));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("MERGEPATH::S:SS",HS_MergePath));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("MOVEDISKPATH::B:SS",HS_MoveDiskFile));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("OPENBLOBASFILE::I:X",HS_OpenBlobAsFile));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("PARSEARGUMENTS::R:SARA",HS_ParseArguments));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETDISKFILEPROPERTIES::R:S",HS_GetDiskFileProperties));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("READDISKDIRECTORY::RA:SS",HS_ReadDiskDirectory));
//        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("READFROMFILE::S:II",HS_ReadFromFile));
        //ADDME: Replace these two functions with a 'GetPRocessOutputHandle' and then just readfrom file on that
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("READPROCESSOUTPUT::S:I",HS_ReadProcessOutput));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("READPROCESSERRORS::S:I",HS_ReadProcessErrors));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("READSOFTLINK::S:S",HS_ReadSoftLink));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETCONSOLEECHO::B:",HS_GetConsoleEcho));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("SETCONSOLEECHO:::B",HS_SetConsoleEcho));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("SETCONSOLEEXITCODE:::I",HS_SetConsoleExitValue));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("SETCONSOLELINEBUFFERED:::B",HS_SetConsoleLineBuffered));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETCONSOLESIZE::R:", GetConsoleSize));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("SETDISKFILELENGTH:::I6",HS_SetDiskFileLength));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("SETOUTPUTBUFFERING:::B",HS_SetOutputBuffering));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("SETUNIXPERMISSIONS::B:SI",HS_SetUnixPermissions));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("SETFILEMODIFICATIONDATE::B:SD",HS_SetFileModificationDate));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("SETFILEPOINTER:::I6",HS_SetFilePointer));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("SETPIPEREADSIGNALTHRESHOLD:::II", HS_SetPipeReadSignalThreshold));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("SETPIPEYIELDTHRESHOLD:::II", HS_SetPipeYieldThreshold));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("SETPROCESSENVIRONMENT:::IRA", HS_SetProcessEnvironment));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("RUNPROCESS::B:ISSASBBB",HS_RunProcess));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("INTERRUPTPROCESS:::I",HS_InterruptProcess));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("TERMINATEPROCESS:::I",HS_TerminateProcess));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("DETACHPROCESS:::I",HS_DetachProcess));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("WAITFORPROCESSOUTPUT::I:II",HS_WaitForProcessOutput));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETPROCESSOUTPUTHANDLE::I:IB",HS_GetProcessOutputHandle));
}

} // End of namespace Baselibs

} // End of namespace HareScript
