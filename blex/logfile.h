#ifndef blex_logfile
#define blex_logfile

#ifndef blex_path
#include "path.h"
#endif
#ifndef blex_threads
#include "threads.h"
#endif

#include <sstream>

namespace Blex
{

///Maximum length of a loggable date size
const unsigned int LogDateMaxSize = 30;

/** Create a date for a log entry
    @param datetime Date/time to put into the log entry
    @param with_mseconds Include milliseconds in the date (outputs 26 bytes without, 30 bytes with milliseconds)
    @param outptr Pointer to which the date/time will be sent, which must have at least 26/30 bytes available (depending on the
        inclusion of milliseconds)
    @return Returns pointer to the first character after the logged date */
BLEXLIB_PUBLIC char * InsertLogDate(Blex::DateTime datetime, bool with_mseconds, char *outptr);

/** Implement basic logfile functionality, with optional automatic flushing
    and file rotation. WriteLogfile is implemented MT-safe. */
class BLEXLIB_PUBLIC Logfile
{
        public:
        /** Construct a logfile class */
        Logfile();

        /** Destroy a logfile class */
        ~Logfile();

        /** Open a log file
            @param logroot Root directory for log files
            @param logfile File to open, append if it already exists
            @param logextension Extension to use on logfiles
            @param autoflush True to automatically flush after each log entry
            @param rotates Maximum number of rotates to keep
            @return True if the logfile was succesfully opened */
        bool OpenLogfile(const std::string &logroot, const std::string &logfile, const std::string &logextension, bool autoflush, unsigned rotates, bool with_mseconds);

        /** Close a log file */
        void CloseLogfile();

        /** Flush, and if necessary rotate, a log file */
        void Flush();

        /** Write to the log file
            @param text Text to timestamp and log without newlines */
        void StampedLog(const char *textstart, const char *textlimit);
        inline void StampedLog(std::string const &text)
        { StampedLog(&text[0], &text[text.size()]); }

        /** Write directly to the log file
            @param text Raw text, _with_ newlines */
        void RawLog(const char *textstart, const char *textlimit, Blex::DateTime curtime);

        /** Set/update rotate settings */
        void SetRotates(unsigned rotates);

        private:
//        void GenerateFileName(const std::string &logdir, const std::string &logfile, const std::string &logextension, Blex::DateTime now, bool stamp_log_filenames, unsigned rotates, std::string *result);

        /** Structure to protect our logging data */
        struct LogData
        {
                /** Rotate the logfiles. Close the current logfile, rotate all files,
                    and open a new logfile. Assumes LogData is locked */
                bool RotateLogfiles(DateTime now);

                /** Generate the filename for a specific rotation within a log
                    @param now Current datetime
                    @param rotates Specific rotation (in days from now)
                    @param result String where result is placed
                */
                void GenerateFileName(DateTime now, unsigned rotation, std::string *result);

                /** The actual log file */
                std::unique_ptr <Blex::FileStream> rawlogfile;
                /** Buffered version of the log file */
                std::unique_ptr <Blex::BufferedStream> logfile;
                /** Root for the log files */
                std::string logroot;
                /** Name of the log file */
                std::string logfilename;
                /** Extension of the log file */
                std::string logextension;
                /** Day of last logfile write */
                unsigned lastday;
                /** Auto-flush setting */
                bool autoflush;
                /** Include milliseconds setting */
                bool with_mseconds;
                /** Auto-rotate setting */
                unsigned rotates;
        };
        typedef Blex::InterlockedData<LogData, Blex::Mutex> Log;

        /** Our internal data, protected by a mutex */
        Log log;

        friend struct LogData;
};

BLEXLIB_PUBLIC void DumpStackTrace();
BLEXLIB_PUBLIC std::string GetStackTrace();

} //end namespace Blex

#endif /* Sentry */
