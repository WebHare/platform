#include <blex/blexlib.h>

#define STACKTRACE_SUPPORT
#include <execinfo.h>
#include <iomanip>
#include "path.h"
#include "logfile.h"
#include <sstream>

namespace Blex
{

std::stringstream ErrStream::store;
std::stringstream ErrStream::stamp;

namespace
{

static bool timestamp=false;
static bool threadids=false;
static Blex::CoreMutex error_stream_synchronizer;
static std::unique_ptr<Blex::FileStream> logfile;


const char * const months[]={"Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"};

//Convert a num (0 to 9) to a digit ('0' to '9')
inline char GetDigit(unsigned num)
{
        return static_cast<char>(num + '0');
}

}

char * InsertLogDate(Blex::DateTime datetime, bool with_mseconds, char *outptr)
{
        static const char TZ[]=" +0000";

        struct std::tm time = datetime.GetTM();
        outptr[ 0] = GetDigit(time.tm_mday / 10);
        outptr[ 1] = GetDigit(time.tm_mday % 10);
        outptr[ 2] = '/';
        std::copy(months[time.tm_mon],
                  months[time.tm_mon]+3,
                  outptr+3);
        outptr[ 6] = '/';
        unsigned year=time.tm_year+1900;
        outptr[ 7] = GetDigit(year / 1000);
        outptr[ 8] = GetDigit(year % 1000 / 100);
        outptr[ 9] = GetDigit(year % 100 / 10);
        outptr[10] = GetDigit(year % 10);
        outptr[11] = ':';
        outptr[12] = GetDigit(time.tm_hour / 10);
        outptr[13] = GetDigit(time.tm_hour % 10);
        outptr[14] = ':';
        outptr[15] = GetDigit(time.tm_min / 10);
        outptr[16] = GetDigit(time.tm_min % 10);
        outptr[17] = ':';
        outptr[18] = GetDigit(time.tm_sec / 10);
        outptr[19] = GetDigit(time.tm_sec % 10);

        if (with_mseconds)
        {
                outptr[20] = '.';
                unsigned long msecs = datetime.GetMsecs() % 1000;
                outptr[21] = GetDigit(msecs / 100);
                outptr[22] = GetDigit((msecs / 10) % 10);
                outptr[23] = GetDigit(msecs % 10);
                std::copy(TZ,TZ+sizeof(TZ)-1,outptr+24);

                return outptr + 30;
        }
        else
        {
                std::copy(TZ,TZ+sizeof(TZ)-1,outptr+20);

                return outptr + 26;
        }
}


Logfile::Logfile()
{
}

Logfile::~Logfile()
{
}

bool Logfile::OpenLogfile(const std::string &logroot, const std::string &logfile, const std::string &logextension, bool autoflush, unsigned rotates, bool with_mseconds)
{
        {
                Log::WriteRef loglock(log);
                if (loglock->logfile.get())
                    return false;

                Blex::DateTime now = Blex::DateTime::Now();

                loglock->logroot=logroot;
                loglock->logfilename=logfile;
                loglock->logextension=logextension;
                loglock->autoflush=autoflush;
                loglock->with_mseconds=with_mseconds;

                std::string filepath;
                loglock->GenerateFileName(now, 0, &filepath);

                loglock->rawlogfile.reset( Blex::FileStream::OpenWrite(filepath,true,false,FilePermissions::PublicRead) );
                //Open file, create if necessary, open if exists, for sequential access
                if (!loglock->rawlogfile.get())
                    return false;

                loglock->rawlogfile->SetOffset(loglock->rawlogfile->GetFileLength());
                loglock->lastday=now.GetDays();

                loglock->logfile.reset( new Blex::BufferedStream(*loglock->rawlogfile) );
        }

        SetRotates(rotates);

        //Succesfully opened log file
        return true;
}

void Logfile::CloseLogfile()
{
        Log::WriteRef loglock(log);
        if (loglock->logfile.get())
            loglock->logfile->FlushBuffer();
        loglock->logfile.reset();
}

void Logfile::Flush()
{
        //Obtain exclusive access to the log files
        Blex::DateTime now=Blex::DateTime::Now();
        Log::WriteRef loglock(log);
        if (!loglock->logfile.get())
            return;

        loglock->logfile->FlushBuffer();
        if (now.GetDays() != loglock->lastday)
            loglock->RotateLogfiles(now);
}

void Logfile::RawLog (const char *textstart, const char *textlimit, Blex::DateTime curtime)
{
        //Obtain exclusive access to the log files
        Log::WriteRef loglock(log);
        if (!loglock->logfile.get())
            return;

        //Must rotate?
        if (curtime.GetDays() != loglock->lastday)
        {
                if (!loglock->RotateLogfiles(curtime))
                    return;
        }

        //Do the actual write
        loglock->logfile->Write(textstart,textlimit-textstart);
        if (loglock->autoflush) //probably an important logfile
            loglock->logfile->FlushBuffer();
}

void Logfile::StampedLog (const char *textstart, const char *textlimit)
{
        static const char linefeed[1]={'\n'};

        char curtime[LogDateMaxSize + 3];
        Blex::DateTime now=Blex::DateTime::Now();

        //Obtain exclusive access to the log files
        Log::WriteRef loglock(log);
        if (!loglock->logfile.get())
            return;

        curtime[0]='[';
        char *stamp_end = InsertLogDate(now, loglock->with_mseconds, curtime+1); //fills bytes 1 to 26/30
        *stamp_end++ = ']';
        *stamp_end++ = ' ';

        //Must rotate?
        if (now.GetDays () != loglock->lastday)
        {
                if (!loglock->RotateLogfiles(now))
                    return;
        }

        //Do the actual write
        loglock->logfile->Write(curtime,stamp_end - curtime);
        loglock->logfile->Write(textstart,textlimit-textstart);
        loglock->logfile->Write(linefeed,sizeof linefeed);
        if (loglock->autoflush) //probably an important logfile
            loglock->logfile->FlushBuffer();
}

void Logfile::SetRotates(unsigned days)
{
        //Update rotate setting first
        Log::WriteRef loglock(log);
        if (!loglock->logfile.get())
            return;
        loglock->rotates=days;

        //Now destroy any overdue rotate files
        std::string searchmask(loglock->logfilename);
        searchmask+=".*";

        Blex::DateTime now = Blex::DateTime::Now();

        // Guard for overflow!
        unsigned daynow = now.GetDays();
        if (daynow < days)
            days = 0;
        else
            days = daynow - days;

        // 'days' now contains the DateTime day nr of the oldest log to keep

        for (Blex::Directory dirptr(loglock->logroot,searchmask);dirptr;++dirptr)
        {
                unsigned daynum=Blex::DecodeUnsignedNumber<unsigned>
                     (dirptr.CurrentFile().begin() + loglock->logfilename.size() + 1, //1 for the dot..
                      dirptr.CurrentFile().end()).first;

                unsigned daynr = Blex::DateTime::FromDate(daynum / 10000, (daynum / 100) % 100, daynum % 100).GetDays();
                if (daynr < 100000) // .nr logfile, must change format
                {
                        // Calculate daynr to compare with
                        daynr = now.GetDays() - daynum;
                        if (daynr >= days)
                        {
                                // File isn't too old, rename the file to datestamped format. daynum contains rotation
                                std::string newname;
                                loglock->GenerateFileName(now, daynum, &newname);
                                MovePath(dirptr.CurrentPath(), newname);
                        }
                }

                if (daynr < days)
                {
                        // File is too old, remove it
                        Blex::RemoveFile(dirptr.CurrentPath());
                }
        }
}

void Logfile::LogData::GenerateFileName(DateTime now, unsigned rotation, std::string *result)
{
        *result = Blex::MergePath(logroot, logfilename);

        char buffer[40]; // A lot more than needed

        DateTime old_date = now - DateTime::Days(rotation);
        struct std::tm time = old_date.GetTM();
        char *bufend = buffer + std::sprintf(buffer, ".%04d%02d%02d",time.tm_year+1900,time.tm_mon + 1,time.tm_mday);

        result->insert(result->end(), buffer, bufend);

        *result += logextension;
}


bool Logfile::LogData::RotateLogfiles(Blex::DateTime now)
{
        logfile.reset();
        rawlogfile.reset();

        // Calc the rotation nr of the oldest day to remove

        // Calc the rotation nr of the previous opened file
        signed last_log_nr = now.GetDays() - lastday;
        if (last_log_nr >= 0) // Don't delete if we're going back in time
        {
                // That was rotation nr. 0, get the rotation nr of the oldest file
                int oldest_log_nr = last_log_nr + rotates;

                for (unsigned idx = oldest_log_nr; idx > rotates; --idx)
                {
                        std::string olderfile;
                        GenerateFileName(now, idx, &olderfile);

                        Blex::RemoveFile(olderfile);
                }
        }

        std::string newfile;
        GenerateFileName(now, 0, &newfile);

/*
        std::ostringstream filetokill;
        filetokill << Blex::MergePath(logroot,logfilename) << '.' << rotates << logextension;

        //Remove the oldest log file
        Blex::RemoveFile(filetokill.str());

        //Move all files one day backwards
        for (unsigned day=rotates;day>0;--day)
        {
                std::ostringstream oldfile;
                std::ostringstream newfile;

                if (day > 1)
                    oldfile << Blex::MergePath(logroot,logfilename) << '.' << (day-1) << logextension;
                else
                    oldfile << Blex::MergePath(logroot,logfilename) << logextension;

                newfile << Blex::MergePath(logroot,logfilename) << '.' << (day) << logextension;

                Blex::MovePath (oldfile.str(),newfile.str());
        }
        rawlogfile.reset(Blex::FileStream::OpenWrite( Blex::MergePath(logroot,logfilename + logextension),true,false,FilePermissions::PublicRead) );
*/
        lastday = now.GetDays();
        rawlogfile.reset(Blex::FileStream::OpenWrite( newfile,true,false,FilePermissions::PublicRead) );
        if (!rawlogfile.get())
        {
                return false;
        }

        logfile.reset(new Blex::BufferedStream(*rawlogfile));
        return true;
}

void ErrStream::SetTimestamping(bool enable)
{
        timestamp=enable;
}
void ErrStream::SetThreadIds(bool enable)
{
        threadids=enable;
}

ErrStream::ErrStream()
{
        error_stream_synchronizer.Lock();
        try
        {
                // ADDME: rewrite to encodenumber etc. to avoid slow ostream functions
                if(timestamp)
                {
                        Blex::DateTime now = Blex::DateTime::Now();
                        std::tm now_tm = now.GetTM();

                        stamp << "[" << std::right << std::setw(2) << std::setfill('0') << now_tm.tm_mday << "-" << std::setw(2) << std::setfill('0') << (now_tm.tm_mon+1) << "-" << (now_tm.tm_year+1900) << " ";
                        stamp << std::right << std::setw(2) << std::setfill(' ') << now_tm.tm_hour << ":" << std::setw(2) << std::setfill('0') << now_tm.tm_min << ":" << std::setw(2) << std::setfill('0') << now_tm.tm_sec << ":" << std::setw(3) << std::setfill('0') << (now.GetMsecs() % 1000) << "] ";
                }
                if (threadids)
                {
                        stamp << std::right << std::setw(5) << std::setfill(' ') << GetThreadPointer(Blex::CurrentThread()) << ": ";
                }
        }
        catch(...)
        {
                error_stream_synchronizer.Unlock();
                stamp.str("");
        }
}
ErrStream::~ErrStream()
{
        try
        {
                //ADDME: Perhaps we should automatically split at embedded '\n's ? (for Blex::ErrStream too!)
                store << '\n';
                std::string finaldata = stamp.str();
                unsigned stamp_size = finaldata.size();
                finaldata += store.str();
                store.str("");
                stamp.str("");
                while (true)
                {
                        std::string::iterator next_lf = std::find(finaldata.begin() + stamp_size, finaldata.end(),'\n');
                        unsigned to_write = next_lf - finaldata.begin() + 1;
                        write(2,finaldata.c_str(), to_write);
                        if(logfile.get())
                            logfile->Write(finaldata.c_str(), to_write);

                        if (next_lf + 1 == finaldata.end() || next_lf + 2 == finaldata.end())
                            break;
                        finaldata.erase(finaldata.begin() + stamp_size, next_lf + 1);
                }
        }
        catch(std::bad_alloc &)
        {
                /* Ignore allocation errors for the str() stuff */
        }
        error_stream_synchronizer.Unlock();
}

bool ErrStream::OpenLogFile(std::string const &filename)
{
        error_stream_synchronizer.Lock(); //ADDME: Perhaphs there should be ways to do scoped locks even on Core Mutexes ?
        try
        {
                logfile.reset(Blex::FileStream::OpenWrite(filename, true, false, Blex::FilePermissions::PublicRead));
                if(!logfile.get())
                {
                        error_stream_synchronizer.Unlock();
                        return false;
                }
                logfile->SetOffset(logfile->GetFileLength());
        }
        catch(...)
        {
                error_stream_synchronizer.Unlock();
                throw;
        }
        error_stream_synchronizer.Unlock();
        return true;
}
void ErrStream::CloseLogFile()
{
        error_stream_synchronizer.Lock();
        try
        {
                logfile.reset();
        }
        catch(...)
        {
                error_stream_synchronizer.Unlock();
                throw;
        }
        error_stream_synchronizer.Unlock();
}

void SafeErrorPrint(const char *errormessage)
{
        unsigned len=0;
        for(const char *eos=errormessage;*eos;++eos)
            ++len;

        write(2/*stderr*/,errormessage,len);
}

void FatalAbort()
{
#ifdef HAVE_PTHREAD_KILL_OTHER_THREADS_NP /* LinuxThreads don't always properly kill subthreads */
        pthread_kill_other_threads_np();
#endif

        SafeErrorPrint("Abnormal program termination, trace:\n");
        void *buffer[30];
        int cnt = backtrace (buffer, 30);
        backtrace_symbols_fd(buffer, cnt, 2/*stderr*/);

        _exit(13);
}

void DumpStackTrace()
{
#ifdef STACKTRACE_SUPPORT
        ErrStream error;

        void *buffer[30];
        int cnt = backtrace (buffer, 30);

        char **strings = backtrace_symbols(buffer, cnt);
        if (strings)
        {
                for (int j = 1; j < cnt; j++)
                    error << strings[j] << "\n";
                free(strings);
        }
#endif
}

std::string GetStackTrace()
{
        std::string result;
#ifdef STACKTRACE_SUPPORT
        void *buffer[30];
        int cnt = backtrace (buffer, 30);

        char **strings = backtrace_symbols(buffer, cnt);
        if (strings)
        {
                for (int j = 1; j < cnt; j++)
                {
                        result += strings[j];
                        result += "\n";
                }
                free(strings);
        }
#endif
        return result;
}

} //end of namespace Blex
