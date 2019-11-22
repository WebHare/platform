#include <blex/blexlib.h>

#include "binarylogfile.h"

namespace Blex
{

/** The default size size of a log segment for new files. This value is only
    used for new files, old files will still use the segment size that was
    set during their creation
*/
static const unsigned DefaultSegmentSize = 64*1024;

/** The write granularity describes which is the largest unit of bytes that
    is written to disk linearly when a section is flushed. This parameter has
    a large impact on the performance of the log, as data is flushed twice when
    it crosses the write granularity boundaries.
    Set this to 0 to assume a section is flushed linearly, 4096 to assume pages
    are written linearly, and for the really paranoid set this to 512 (harddisk
    sector size))
*/
static const unsigned MaxLinearWriteSize = 4096; // x86 page size.

/* Log structure:

        The log itself is divided into segments. Every segment has a header.
        The header of the first segment (id 0) contains header information
        about the log-file.
        Every segments can be chained to a next segment, via the 'Next segment nr'
        field in the header. So linked, segments form a 'chain'. Logically, a chain
        is used like randomstream; but it does not zero out bytes!

        Messages are stored in a chain by a 4-byte length stamp containing their
        length, and a commit flag. The stamp behind a message must ALWAYS be valid
        (is thus written first).
        A stamp can have 5 states:
        - Last message was not committed, no more messages following (stamp contents: 0)
        - Last message was not committed, a message of length X is following (stamp contents: IsLength)
        - Last message was committed, no more messages following (stamp contents: CommitButNotClosed)
        - Last message was committed, a message of length X is following (stamp contents: Commit, IsLength, X)
        - Last message was committed and this is the end of the chain, first segment of next chain is X. (Commit, X)

        Chains can also be linked together, using a special length stamp. The id
        of the first chain is recorded in the log header at segment 0.

        No segment use-info is recorded into the log, that information is inferred
        from the segment chain links and next-chain message stamps.

        Rewrite fase information is not recorded into the log.
*/

/* File Segment layout:
        0x00-0x0F: header
        rest: message data

Segment header layout:
      0x00:  uint32_t magic number 0x574C4653 "WLFS" (Only in header of segment 0)
      0x04:  uint32_t Segment size
      0x08:  uint32_t First segment nr (only in header of segment 0)
      0x0C:  uint32_t Next segment nr. No next segment: 0 (default), othwerwise (next-segment-id | Header_Mask_NextSegmentNrValid)

Messages are written as length (dword) and then the message data + ** padding to align 4 **!!!
A commit is noted by setting a bit in the length of the next message, committing all previous messages.
*/

// Header layout stuffs
static unsigned const Header_Ofs_Magic          = 0x00;
static unsigned const Header_Ofs_SegmentSize    = 0x04;
static unsigned const Header_Ofs_FirstSegment   = 0x08;
static unsigned const Header_Ofs_NextSegment    = 0x0C;

static unsigned const HeaderSize                = 0x10;

// Filesystem magic value
static unsigned const Header_Val_Magic                  = 0x574C4653; // "WLFS"

// Bits/masks for header:next segment
static unsigned const Header_Mask_NextSegmentNrValid    = 0x80000000;
static unsigned const Header_Mask_NextSegmentNr         = 0x7FFFFFFF;

// Bits/masks for message stamp
static unsigned const Msg_CommitMask          = 0x80000000;
static unsigned const Msg_IsLengthMask        = 0x40000000;
static unsigned const Msg_DataMask            = 0x3FFFFFFF;
static unsigned const Msg_CommitButNotClosed  = Msg_CommitMask | Msg_DataMask;

/* Message stamp possibilities:
        0x00000000: no commit, no next message,
        0x40000000-0x7FFFFFFF: no commit, next message length = (length & Msg_DataMask)
        0xBFFFFFFF: commit, no next message
        0x80000000-0xBFFFFFFE: chain is closed, next chain id is (length & Msg_DataMask)
        0xC0000000-0xFFFFFFFF: committed until now, next message length = (length & Msg_DataMask)
*/

namespace
{
// Getter-setter functions

uint32_t SegmentGetNextSegment(uint8_t const *section) __attribute__((nonnull(1)));
void SegmentPutNextSegment(uint8_t *section, uint32_t next_segment) __attribute__((nonnull(1)));

inline uint32_t SegmentGetNextSegment(uint8_t const *section)
{
        return Blex::getu32lsb(section + Header_Ofs_NextSegment);
}
inline void SegmentPutNextSegment(uint8_t *section, uint32_t next_segment)
{
        Blex::putu32lsb(section + Header_Ofs_NextSegment, next_segment);
}

} // End of anonymous namespace

//******************************************************************************
//
//  BinaryLogFile::Chain
//

// Init the chain
BinaryLogFile::Chain::Chain()
: write_offset(0)
, flush_limit_segment_nr(0)
{
}

// Chain destructor. Needs the log to exist.
BinaryLogFile::Chain::~Chain()
{
        // Clear the used segments from the free map
        if (!segments.empty())
        {
                assert(log);
                LockedSegmentAdmin::WriteRef slock(log->segmentadmin);
                for (std::vector< unsigned >::iterator it = segments.begin(); it != segments.end(); ++it)
                    slock->segment_used_map[*it] = false;
        }
        segments.clear();
        write_offset = 0;
}

unsigned BinaryLogFile::Chain::GetSegmentsCount() const
{
        return segments.size();
}

void BinaryLogFile::Chain::AddKnownSegment(unsigned id)
{
        segments.push_back(id);

        // This is a segment that is alreaady on disk, so adjust the flush_limit.
        flush_limit_segment_nr = segments.size();
}

void BinaryLogFile::Chain::AddNewSegment()
{
        assert(log);
        if (segments.empty())
            segments.push_back(log->AllocateNewSegment());
        else
            segments.push_back(log->AllocateNewSegment(segments.back()));
}



//******************************************************************************
//
//  BinaryLogFile::Data
//

// Initialize data to null values
BinaryLogFile::Data::Data()
{
        // Operation info
        in_rewrite_fase = false;
}

//******************************************************************************
//
//  BinaryLogFile
//

// Initialize logfile
BinaryLogFile::BinaryLogFile(const std::string &filename, bool create_exclusive, bool disable_flush)
: disable_flush(disable_flush)
{
        /* std::shared_ptr considerations: none, we're in the constructor */

        // Try to open logfile
//ADDME: Make number of free sections (now 256) configurable
        logfile.reset(SectionFile::Open(DefaultSegmentSize, filename, 256, true, create_exclusive, false, true));
        if (!logfile.get())
            throw std::runtime_error("BinaryLogFile: Failed opening log file '" + filename + "': " + Blex::GetLastOSError());

        // Initialize if needed (new file)
        if (logfile->GetNumSections() == 0)
            InitializeNewLog();

        // Lock first section, and read (and check) header
        SectionFile::AutoSection trysection(*logfile, 0);
        if (Blex::getu32lsb(trysection + Header_Ofs_Magic) != Header_Val_Magic)
            throw std::runtime_error("BinaryLogFile: Log file signature is invalid");

        // Read the segment size. If the file was opened using the wrong size, retry
        segmentsize = Blex::getu32lsb(trysection + Header_Ofs_SegmentSize);
        unsigned first_segment;

        // If the default segment size is ok, read the first segment
        if (segmentsize == DefaultSegmentSize)
        {
                // Read admin data from log
                first_segment = Blex::getu32lsb(trysection + Header_Ofs_FirstSegment);
        }
        else
        {
                // Damn, segmentsize of logfile is different, reopen.
                logfile.reset();
                logfile.reset(SectionFile::Open(segmentsize, filename, 16, true, create_exclusive, false, true));

                if (!logfile.get())
                    throw std::runtime_error("BinaryLogFile: Failed opening log file '" + filename + "'");

                SectionFile::AutoSection resection(*logfile, 0);

                // Read admin data from reopened log file
                first_segment = Blex::getu32lsb(resection + Header_Ofs_FirstSegment);
        }

        LockedData::WriteRef lock(data);
        {
                // Initialize the free map. Then release segmentadmin lock, because chain locks must be taken before segmentadmin lock
                LockedSegmentAdmin::WriteRef slock(segmentadmin);

                slock->segment_used_map.resize(logfile->GetNumSections());
                std::fill(slock->segment_used_map.begin(), slock->segment_used_map.end(), false);
        }

        SectionFile::AutoSection section(*logfile);

        // Read in all chains
        while (true)
        {
                std::shared_ptr< LockedChain > chain(new LockedChain());
                bool has_next;

                {
                        // Release the lock of the new chain before getting the one from the parent chain
                        LockedChain::WriteRef clock(*chain);
                        clock->SetAssociatedLog(this);

                        LockedSegmentAdmin::WriteRef slock(segmentadmin);

                        // Scan logfile to find the chain data
                        ScanSegmentChain(section, slock, *clock, first_segment);

                        has_next = ScanChainForEnd(section, *clock, &clock->write_offset, &first_segment);
                }

                // Set the next_chain field of the previous chain
                if (!lock->chains.empty())
                    LockedChain::WriteRef(*lock->chains.back())->next_chain = chain;

                // Push the chain!
                lock->chains.push_back(chain);

                if (!has_next)
                    break;
        }
}

// Get all the segments of a chain
void BinaryLogFile::ScanSegmentChain(SectionFile::AutoSection &section, LockedSegmentAdmin::WriteRef &slock, Chain &chain, unsigned first_segment)
{
        /* std::shared_ptr considerations: not used here */

        unsigned current_segment = first_segment;
        while (true)
        {
                // Mark segment as used
                slock->segment_used_map[current_segment] = true;

                // Push the segment in the segments list of the chain
                chain.AddKnownSegment(current_segment);

                // Open the segment, get the address of the next segment
                section.Reset(current_segment);

                current_segment = SegmentGetNextSegment(section);
                if (!(current_segment & Header_Mask_NextSegmentNrValid))
                    break;
                current_segment &= Header_Mask_NextSegmentNr;
        }

        DEBUGPRINT("Scanned segment chain: " << chain.GetSegmentsCount());
}

// Find commit mark for a chain
bool BinaryLogFile::ScanChainForEnd(SectionFile::AutoSection &section, Chain const &chain, Blex::FileOffset *last_commit_mark, unsigned *next_chain_id)
{
        /* std::shared_ptr considerations: not used here */

        if(last_commit_mark)
            *last_commit_mark = 0;
        FileOffset ofs = 0;

        while (true)
        {
                // Read length/commit marker
                uint8_t buf[4];
                if (DirectRead(section, chain, ofs, buf, 4) != 4)
                {
                        if (ofs != 0)
                            throw std::runtime_error("BinaryLogFile:: Log corrupt, missing length marker");
                        memset(buf, 0, sizeof(buf));
                }

                unsigned length = Blex::getu32lsb(buf);

                // Commit mark?
                if (length & Msg_CommitMask)
                {
                        // Commit message found, store place
                        if (last_commit_mark)
                        {
                                // Write point must be uninitialized or beyond last commit
                                assert(chain.write_offset == 0 || chain.write_offset >= *last_commit_mark);

                                *last_commit_mark = ofs;
                        }

                        if (!(length & Msg_IsLengthMask))
                        {
                                if (length == Msg_CommitButNotClosed)
                                    return false; // Chain not closed

                                // Chain ends here
                                if (next_chain_id)
                                    *next_chain_id = length & Msg_DataMask;
                                return true; // Chain closed
                        }
                }

                if (!(length & Msg_IsLengthMask))
                    return false; // No more messages left, but chain is not closed.

                // Get real length from length word
                length &= Msg_DataMask;

                // Update offset by length (4 bytes length byte + length message, pad to multiple of 4)
                ofs += (length + 7) & -4;
        }
}


// Read directly from a specific chain
unsigned BinaryLogFile::DirectRead(SectionFile::AutoSection &section, Chain const &chain, Blex::FileOffset ofs, uint8_t *buffer, unsigned size)
{
        /* std::shared_ptr considerations: not used here */

        // First block in segment is reserved
        unsigned segment_storesize = segmentsize - HeaderSize;

        // Get segment to read from, starting place in segment
        unsigned segment_nr = unsigned(ofs / segment_storesize);
        unsigned ofs_in_segment = HeaderSize + unsigned(ofs - segment_nr * segment_storesize);

        unsigned got_bytes = 0;

        // Go on while we haven't read all yet
        while (got_bytes != size)
        {
                if (segment_nr >= chain.GetSegmentsCount())
                    return got_bytes;

                // Find section id from chain, open it
                unsigned segment_id = chain.GetSegment(segment_nr);
                section.Reset(segment_id);

                // Copy data avaiable in this segment
                unsigned copy_size = std::min(segmentsize - ofs_in_segment, size - got_bytes);
                memcpy(buffer + got_bytes, section + ofs_in_segment, copy_size);
                got_bytes += copy_size;

                // next segment, data starts just after header
                ++segment_nr;
                ofs_in_segment = HeaderSize;
        }
        return got_bytes;
}

// Write directly to a specific chain
unsigned BinaryLogFile::DirectWrite(SectionFile::AutoSection &section, Chain &chain, Blex::FileOffset ofs, uint8_t const *buffer, unsigned size)
{
        /* std::shared_ptr considerations: not used here */

        // First block in segment is reserved
        unsigned segment_storesize = segmentsize - HeaderSize;

        // Make sure enough chains are available to write to
        unsigned end_segment_nr = unsigned((ofs + size - 1) / segment_storesize);
        while (chain.GetSegmentsCount() <= end_segment_nr)
            chain.AddNewSegment();

        // Get segment to write to, and starting place in segment
        unsigned segment_nr = unsigned(ofs / segment_storesize);
        unsigned ofs_in_segment = HeaderSize + unsigned(ofs - segment_nr * segment_storesize);

        unsigned written = 0;

        // Adjust the flush limit if needed.
        if (chain.flush_limit_segment_nr > segment_nr)
            chain.flush_limit_segment_nr = segment_nr;

        // Loop through segments until all is written.
        while (written != size)
        {
                // Find section id from chain, open it
                unsigned segment_id = chain.GetSegment(segment_nr);
                section.Reset(segment_id);

                // Write the data
                unsigned copy_size = std::min(segmentsize - ofs_in_segment, size - written);
                memcpy(section + ofs_in_segment, buffer + written, copy_size);
                written += copy_size;

                // next segment, data starts just after header
                ++segment_nr;
                ofs_in_segment = HeaderSize;
        }
        return written;
}

void BinaryLogFile::FlushChainData(SectionFile::AutoSection &/*section*/, Chain &chain,  Blex::FileOffset ofs, bool first_fase)
{
        if (ofs == 0)
            return;

        // Inv: ofs > 0
        unsigned segment_storesize = segmentsize - HeaderSize;

        // Determine the nr of the last segment that needs to be flushed.
        unsigned end_segment_nr;
        if (!first_fase)
        {
                // Not first fase: flush all
                end_segment_nr = unsigned((ofs - 1) / segment_storesize);
        }
        else
        {
                if (MaxLinearWriteSize == 0)
                {
                        // Skip last segment
                        end_segment_nr = unsigned((ofs - 1) / segment_storesize);
                        if (end_segment_nr == 0)
                            return;
                        --end_segment_nr;
                }
                else
                {
                        if (ofs < 4 + MaxLinearWriteSize)
                            return;

                        // Flush all but last 4 + MaxLinearWriteSize bytes (rounded up to nearest section barrier)
                        end_segment_nr = unsigned((ofs - 4 - MaxLinearWriteSize) / segment_storesize);
                }
        }

        //ADDME: Can we use the SectionUpdateHistory ?

        if (!disable_flush)
        {
                // Flush all sections that need flushing
                for (unsigned i = chain.flush_limit_segment_nr; i <= end_segment_nr; ++i)
                {
                        unsigned segment_id = chain.GetSegment(i);
                        if (!logfile->EnsureSectionFlushed(segment_id, logfile->MarkSectionDirty(segment_id)))
                            throw std::runtime_error("BinaryLogFile: Failed to flush data to disk");
                }
        }

        // Update flush limit to reflect real flushing
        chain.flush_limit_segment_nr = end_segment_nr + 1;
}

BinaryLogFile * BinaryLogFile::Open(const std::string &filename, bool create_exclusive)
{
        /* std::shared_ptr considerations: not used here */
        try
        {
                return new BinaryLogFile(filename, create_exclusive, false);
        }
        catch (std::runtime_error &)
        {
                return 0;
        }
}

BinaryLogFile * BinaryLogFile::OpenNoFlush(const std::string &filename, bool create_exclusive)
{
        /* std::shared_ptr considerations: not used here */
        try
        {
                return new BinaryLogFile(filename, create_exclusive, true);
        }
        catch (std::runtime_error &)
        {
                return 0;
        }
}

void BinaryLogFile::InitializeNewLog()
{
        /* std::shared_ptr considerations: not used here */

        // Resize the log to size of one segment
        if (!logfile->TryAppendSectionPage())
            throw std::runtime_error("Failed to initialize the log file");

        // FIXME: a crash within this code can leave the log unmountable.
        SectionFile::AutoSection section(*logfile, 0);

        Blex::putu32lsb(section + Header_Ofs_FirstSegment, 0);
        Blex::putu32lsb(section + Header_Ofs_SegmentSize, DefaultSegmentSize);
        Blex::putu32lsb(section + Header_Ofs_NextSegment, 0);
        Blex::putu32lsb(section + Header_Ofs_Magic, Header_Val_Magic);

        logfile->FlushAll();
}

// Allocates new segments, appends it to chain (on disk only - in memory structures are not changed!)
unsigned BinaryLogFile::AllocateNewSegment(unsigned append_to)
{
        /* std::shared_ptr considerations: not used here */
        LockedSegmentAdmin::WriteRef slock(segmentadmin);

        // Map current append_to page, and see if no segment is already chained
        SectionFile::AutoSection append_to_section(*logfile, append_to);
        if (append_to != 0xFFFFFFFF)
        {
                unsigned next_segment = SegmentGetNextSegment(append_to_section);
                if (next_segment != 0)
                    throw std::runtime_error("BinaryLogFile internal error: Appending segment to non-tail segment!");
        }

        // Find an empty segment
        unsigned current_count = slock->segment_used_map.size();
        unsigned idx = 0;
        for (; idx < current_count; ++idx)
        {
                if (!slock->segment_used_map[idx])
                    break;
        }

        // No free segment available? Allocate one!
        if (idx == current_count)
        {
                // Avoid reallocating push_back later
                slock->segment_used_map.reserve(slock->segment_used_map.size() + 1);

                // Try to append section before updating data, keep everything consistent
                if (!logfile->TryAppendSectionPage())
                    throw std::runtime_error("Failed to append a segment to the log file");

                slock->segment_used_map.push_back(true);
        }
        else
            slock->segment_used_map[idx] = true;

        unsigned new_section_id = idx;

        SectionFile::AutoSection new_section(*logfile, new_section_id);

        // Zero out data and next segment, leave the rest of the header alone
        memset(new_section + HeaderSize, 0, segmentsize - HeaderSize);
        SegmentPutNextSegment(new_section, 0);

        // And sync it; we need to be sure everything is consistent on disk when we link.
        if (!disable_flush)
        {
                if (!logfile->EnsureSectionFlushed(new_section_id, logfile->MarkSectionDirty(new_section_id)))
                    throw std::runtime_error("BinaryLogFile: Failed to flush data to disk");
        }

        // New section is zeroed out, and valid as such. Set the next segment link in the previous segment
        if (append_to != 0xFFFFFFFF)
        {
                SegmentPutNextSegment(append_to_section, new_section_id | Header_Mask_NextSegmentNrValid);

                if (!disable_flush)
                {
                        if (!logfile->EnsureSectionFlushed(append_to, logfile->MarkSectionDirty(append_to)))
                            throw std::runtime_error("BinaryLogFile: Failed to flush data to disk");
                }
        }
        return new_section_id;
}

void BinaryLogFile::WriteMessageToChain(Chain &chain, uint8_t const *message, unsigned length, bool commit)
{
        /* std::shared_ptr considerations: not used here */

        SectionFile::AutoSection section(*logfile);

        // Read the mark at the current write location, to save the committed mark.
        uint8_t buf[4], nextbuf[4];
        if (DirectRead(section, chain, chain.write_offset, buf, 4) != 4)
        {
                if (chain.write_offset != 0)
                    throw std::runtime_error("BinaryLogFile: Log corrupt, missing message length indicator");
                memset(buf, 0, 4);
        }
        memset(nextbuf, 0, 4);
        uint32_t newmark = (Blex::getu32lsb(buf) & Msg_CommitMask) + length + Msg_IsLengthMask;
        Blex::putu32lsb(buf, newmark);

        FileOffset new_offset = chain.write_offset + ((length + 7) & -4);

        // First write next length byte, it may not be corrupt.
        DirectWrite(section, chain, new_offset, nextbuf, 4);
        DirectWrite(section, chain, chain.write_offset, buf, 4);
        DirectWrite(section, chain, chain.write_offset + 4, message, length);

        if (commit)
        {
                FlushChainData(section, chain, new_offset + 4, true);

                Blex::putu32lsb(buf, Msg_CommitButNotClosed);
                DirectWrite(section, chain, new_offset, buf, 4);

                // FIXME: move this flush outside of the lock?
                FlushChainData(section, chain, new_offset + 4, false);
        }

        // Set new offset, +4 for length, +length, +padding to dword.
        chain.write_offset = new_offset;
}

void BinaryLogFile::WriteMessage(uint8_t const *message, unsigned length, bool commit)
{
        /* std::shared_ptr considerations: the 'chain' shared pointer is acquired under
            the Data lock, and must be released under the Data lock */

        if (length > Msg_DataMask)
            throw std::runtime_error("BinaryLogFile: Message too long");

        std::shared_ptr< LockedChain > chain;

        LockedData::ScopedRef lock(data, true);
        chain = lock->chains.back();

        try
        {
                LockedChain::WriteRef clock(*chain);
                lock.Unlock(); // We don't need the Data lock, writes to other chains may run parallel

                WriteMessageToChain(*clock, message, length, commit);
        }
        catch (std::exception &e) // The chain shared pointer must be released under the Data lock
        {
                // Relock data lock, we need to reset the chain shared_ptr.
                lock.Lock();
                chain.reset();
                throw;

        }

        // Relock data lock, we need to reset the chain shared_ptr.
        lock.Lock();
        chain.reset();
}

void BinaryLogFile::WriteRewriteMessage(uint8_t const *message, unsigned length)
{
        /* std::shared_ptr considerations: the 'chain' shared pointer is acquired under
            the Data lock, and must be released under the Data lock */

        if (length > Msg_DataMask)
            throw std::runtime_error("BinaryLogFile: Message too long");

        std::shared_ptr< LockedChain > chain;
        LockedData::ScopedRef lock(data, true);
        if (!lock->in_rewrite_fase)
            throw std::runtime_error("BinaryLogFile: Rewriting outside of rewrite fase");

        chain = lock->rewrite_chain;

        try
        {
                LockedChain::WriteRef clock(*chain);
                lock.Unlock(); // We don't need the Data lock, writes to other chains may run parallel

                WriteMessageToChain(*clock, message, length, false);
        }
        catch (std::exception &e) // The chain shared pointer must be released under the Data lock
        {
                // Relock data lock, we need to reset the chain shared_ptr.
                lock.Lock();
                chain.reset();
                throw;

        }
        // Relock data lock, we need to reset the chain shared_ptr.
        lock.Lock();
        chain.reset();
}

void BinaryLogFile::Commit(bool force_new_chain)
{
        /* std::shared_ptr considerations: Only used within data lock. */
        // FIXME: move last flush outside of the locks.

        SectionFile::AutoSection section(*logfile);

        // Keep the locks open for the entire commit, we don't want parallel commits or writes to interfere.
        LockedData::WriteRef lock(data);
        LockedChain::WriteRef clock(*lock->chains.back());

        // ADDME: try to fill segment 32 to 75% or so and switch then, instead of leaving segment 33 1% filled.
        if (clock->GetSegmentsCount() > 32 || force_new_chain)
        {
                // Switching to next stream!

                std::shared_ptr< LockedChain > next_chain(new LockedChain());

                LockedChain::WriteRef nclock(*next_chain);
                nclock->SetAssociatedLog(this);
                nclock->AddNewSegment();
                lock->chains.push_back(next_chain);
                clock->next_chain = next_chain;

                uint8_t buf[8];
                Blex::putu32lsb(buf, Msg_CommitMask + nclock->GetSegment(0));
                DirectWrite(section, *clock, clock->write_offset, buf, 4);

                FlushChainData(section, *clock,  clock->write_offset + 4, false);
        }
        else
        {
                // Flush all data that is going to be committed
                FlushChainData(section, *clock,  clock->write_offset + 4, true);

                // Write a normal commit mark
                uint8_t buf[4];
                Blex::putu32lsb(buf, Msg_CommitButNotClosed);
                DirectWrite(section, *clock, clock->write_offset, buf, 4);

                FlushChainData(section, *clock,  clock->write_offset + 4, false);
        }
}

void BinaryLogFile::SendAllMessagesInternal(MessageReceiver const &receiver, std::vector< std::shared_ptr< LockedChain > > const &chains)
{
        /* std::shared_ptr considerations: this function may not modify shared_ptrs (does not always operate
            under the Data lock). 'chains' is only safe to get the pointers from */

        SectionFile::AutoSection section(*logfile);

        Blex::PodVector< uint8_t > msgdata;
        for (std::vector< std::shared_ptr< LockedChain > >::const_iterator it = chains.begin(); it != chains.end(); ++it)
        {
                Blex::FileOffset last_commit;

                LockedChain::ReadRef clock(**it);

                ScanChainForEnd(section, *clock, &last_commit, 0); // This can throw!

                FileOffset ofs = 0;
                while (ofs < last_commit)
                {
                        uint8_t buf[4];
                        DirectRead(section, *clock, ofs, buf, 4);
                        unsigned length = Blex::getu32lsb(buf) & Msg_DataMask;
                        msgdata.resize(length);

                        // Read the message, and send it out
                        DirectRead(section, *clock, ofs + 4, &msgdata[0], length);

                        receiver(std::ref(msgdata));

                        ofs += (length + 7) & -4;
                }
        }
}

void BinaryLogFile::SendAllMessages(MessageReceiver const &receiver)
{
        /* std::shared_ptr considerations: data lock open the whole time, no problems */
        LockedData::WriteRef lock(data);
        SendAllMessagesInternal(receiver, lock->chains);
}

unsigned BinaryLogFile::GetChainCount()
{
        /* std::shared_ptr considerations: not used here */
        LockedData::WriteRef lock(data);
        return lock->chains.size();
}

bool BinaryLogFile::TryStartLogRewrite()
{
        /* std::shared_ptr considerations: data lock open the whole time, no problems */
        LockedData::WriteRef lock(data);

        if (lock->in_rewrite_fase)
            return false;

        if (lock->chains.size() <= 1)
            throw std::runtime_error("BinaryLogFile: Rewrite fase may only be entered when more than one chain is in use");

        lock->in_rewrite_fase = true;
        lock->rewritten_chains = lock->chains.size() - 1;
        lock->rewrite_chain.reset(new LockedChain);

        LockedChain::WriteRef clock(*lock->rewrite_chain);
        clock->SetAssociatedLog(this);
        clock->AddNewSegment();
        clock->next_chain = lock->chains[lock->rewritten_chains];

        return true;
}

void BinaryLogFile::CompleteLogRewrite()
{
        /* std::shared_ptr considerations: data lock open the whole time, no problems */
        LockedData::WriteRef lock(data);

        if (!lock->in_rewrite_fase)
            throw std::runtime_error("Not in rewrite fase");

        LockedChain::WriteRef clock(*lock->rewrite_chain);
        LockedChain::WriteRef nclock(*clock->next_chain);

        SectionFile::AutoSection section(*logfile);

        uint8_t buf[8];
        Blex::putu32lsb(buf, Msg_CommitMask + nclock->GetSegment(0));
        DirectWrite(section, *clock, clock->write_offset, buf, 4);

        // Make sure new section is written out completely
        FlushChainData(section, *clock, clock->write_offset + 4, false);

        lock->in_rewrite_fase = false;
        lock->chains.erase(lock->chains.begin(), lock->chains.begin() + lock->rewritten_chains);
        lock->chains.insert(lock->chains.begin(), lock->rewrite_chain);

        // Write the new chain start
        section.Reset(0);
        Blex::putu32lsb(section + Header_Ofs_FirstSegment, clock->GetSegment(0));

        if (!disable_flush)
        {
                // Flush section 0 and we're done
                if (!logfile->EnsureSectionFlushed(0, logfile->MarkSectionDirty(0)))
                    throw std::runtime_error("BinaryLogFile: Failed to flush data to disk");
        }
}

void BinaryLogFile::SendRewriteMessages(MessageReceiver const &receiver)
{
        /* std::shared_ptr considerations: shared_ptrs are used here, but
           we may not keep the Data lock open. So, we copy them under the lock
           to a temporary structure, and we take the lock again before
           destructing them */

        std::vector< std::shared_ptr< LockedChain > > chains;
        {
                LockedData::WriteRef lock(data);
                chains.assign(lock->chains.begin(), lock->chains.begin() + lock->rewritten_chains);
        }

        try
        {
                SendAllMessagesInternal(receiver, chains);
        }
        catch (std::exception &)
        {
                // Take the lock and destroy the shared_ptrs
                LockedData::WriteRef lock(data);
                chains.clear();
                throw;
        }
        // Take the lock and destroy the shared_ptrs
        LockedData::WriteRef lock(data);
        chains.clear();
}

} // End of namespace Blex
