// Native HTTP framing regressions. Inputs never allocate their declared large bodies.
// No listener, application route, database, or external fixture is required.
#include <ap/libwebhare/allincludes.h>
#include <ap/libwebhare/requestparser.h>
#include <iostream>
#include <csignal>

using WebServer::RequestParser;

namespace WebServer
{
struct RequestParserTestAccess
{
        static void ReplaceBodyStorage(RequestParser &parser, std::shared_ptr<Blex::RandomStream> const &stream)
        {
                if (!parser.outstream)
                    throw std::runtime_error("body did not reach temporary storage before the fault");
                parser.outstream = stream;
        }
};
}

namespace
{
enum class Expected { Complete, Incomplete, RejectHeaders, RejectBody };

struct Case
{
        const char *name;
        std::string headers, body;
        Expected expected;
        bool form = false;
        std::string proxy_source = {};
};

struct FailingBodyStorage final : Blex::MemoryRWStream
{
        FailingBodyStorage() : Blex::Stream(false) {}

        std::size_t Write(void const *, std::size_t) override
        {
                ++writes;
                return 0;
        }

        unsigned writes = 0;
};

void Check(bool condition, const char *message)
{
        if (!condition)
            throw std::runtime_error(message);
}

std::size_t Feed(RequestParser &parser, std::string const &wire, std::size_t split, unsigned *headers_complete = nullptr)
{
        std::size_t offset = 0;
        while (offset < wire.size() && parser.IsExpectingData()) {
                const char *start = wire.data() + offset;
                const char *limit = wire.data() + std::min(wire.size(), offset + split);
                const char *end = parser.ParseHTTP(start, limit, [&] { if (headers_complete) ++*headers_complete; return true; });
                Check(end >= start && end <= limit, "parser escaped input bounds");
                Check(end > start || !parser.IsExpectingData(), "parser made no progress");
                offset += end - start;
        }
        return offset;
}

void TestStorageFailures(unsigned *passed, unsigned *failed)
{
        // First cross the real 32 KiB spill threshold, then force the next write
        // to fail exactly at the end of the declared body/chunk. Without the
        // post-BodyReceive guards, completion would overwrite ParsingFailed.
        const std::string prefix(32768, 'a');
        const std::string next = "GET /next?marker=second HTTP/1.1\r\nHost: localhost\r\n\r\n";
        for (bool chunked : {false, true})
            for (std::size_t split : {std::size_t(1), std::size_t(2), std::size_t(7), std::size_t(4096)})
        {
                try
                {
                        Blex::ComplexFileSystem tempfs;
                        RequestParser parser(tempfs);
                        unsigned headers_complete = 0;
                        const std::string header = "POST /synthetic HTTP/1.1\r\nHost: localhost\r\n"
                            + std::string(chunked ? "Transfer-Encoding: chunked\r\n\r\n8001\r\n"
                                                 : "Content-Length: 32769\r\n\r\n");
                        Check(Feed(parser, header, split, &headers_complete) == header.size(), "storage test header incomplete");
                        Check(Feed(parser, prefix, split) == prefix.size() && parser.IsExpectingData()
                              && parser.GetBodyBytesReceived() == prefix.size(), "body did not reach spill boundary");
                        auto storage = std::make_shared<FailingBodyStorage>();
                        WebServer::RequestParserTestAccess::ReplaceBodyStorage(parser, storage);
                        const std::string tail = std::string("b") + (chunked ? "\r\n0\r\n\r\n" : "") + next;
                        Check(Feed(parser, tail, split) == 0, "failed body storage advanced the parser");
                        Check(storage->writes == 1, "storage write fault was not exercised");
                        Check(parser.GetErrorCode() == RequestParser::ErrorIO && !parser.IsProtocolSane()
                              && !parser.IsExpectingData(), "storage failure lost its original error or terminal state");
                        Check(parser.GetBodyBytesReceived() == prefix.size() && headers_complete == 1,
                              "failed storage changed the received count or dispatched another header");
                        Check(parser.ParseHTTP(next.data(), next.data() + next.size(), [&] { ++headers_complete; return true; }) == next.data()
                              && parser.GetErrorCode() == RequestParser::ErrorIO && !parser.IsProtocolSane()
                              && !parser.IsExpectingData() && storage->writes == 1 && headers_complete == 1,
                              "subsequent input replaced the terminal storage failure");
                        ++*passed;
                        std::cout << "PASS storage-write-failure chunked=" << chunked << " split=" << split << '\n';
                }
                catch (std::exception const &e)
                {
                        ++*failed;
                        std::cout << "FAIL storage-write-failure chunked=" << chunked << " split=" << split << ' ' << e.what() << '\n';
                }
        }
}
}

int main(int argc, char **argv)
{
        if (argc > 2 || (argc == 2 && std::string(argv[1]) != "--large-sizes")) return 2;
        // A broken parser can loop inside ParseHTTP. Bound the process itself.
        std::signal(SIGALRM, [](int) { _exit(1); });
        alarm(10);
        const std::string form = "mode=plain&count=1";
        std::ostringstream hexlength;
        hexlength << std::hex << form.size();
        const std::string chunkform = hexlength.str() + "\r\n" + form + "\r\n0\r\n\r\n";
        if (argc == 2) {
                // No large allocation or upload: only six body bytes per case.
                // Keep this mode separate so a broken parser can be killed by timeout.
                for (const char *length : {"100000000", "ffffffff", "100000001", "200000000", "ffffffffffffffff"})
                    for (std::size_t split : {std::size_t(1), std::size_t(2), std::size_t(7), std::size_t(4096)}) {
                        Blex::ComplexFileSystem tempfs;
                        RequestParser parser(tempfs);
                        const std::string wire = std::string("POST /synthetic HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\n\r\n") + length + "\r\nabc";
                        Check(Feed(parser, wire, split) == wire.size() && parser.IsExpectingData() && parser.GetBodyBytesReceived() == 3, "large chunk lost progress");
                        Check(Feed(parser, "def", split) == 3 && parser.IsExpectingData() && parser.GetBodyBytesReceived() == 6, "large chunk lost subsequent input");
                        std::unique_ptr<Blex::RandomStream> body(parser.OpenBody());
                        char bytes[6];
                        Check(body && body->Read(bytes, sizeof bytes) == sizeof bytes && std::string(bytes, sizeof bytes) == "abcdef", "large chunk corrupted body");
                        std::cout << "PASS large-chunk-progress length=" << length << " split=" << split << "\n";
                    }
                // Content-Length used the same narrowing operation. Check a body,
                // rather than just accepting a large header without any input.
                for (const char *length : {"4294967296", "4294967295", "4294967297", "8589934592", "18446744073709551615"})
                    for (std::size_t split : {std::size_t(1), std::size_t(2), std::size_t(7), std::size_t(4096)}) {
                        Blex::ComplexFileSystem tempfs;
                        RequestParser parser(tempfs);
                        const std::string wire = std::string("POST /synthetic HTTP/1.1\r\nHost: localhost\r\nContent-Length: ") + length + "\r\n\r\nabc";
                        Check(Feed(parser, wire, split) == wire.size() && parser.IsExpectingData() && parser.GetBodyBytesReceived() == 3, "large content-length lost progress");
                        Check(Feed(parser, "def", split) == 3 && parser.IsExpectingData() && parser.GetBodyBytesReceived() == 6, "large content-length lost subsequent input");
                        std::cout << "PASS large-length-progress length=" << length << " split=" << split << "\n";
                    }
                std::cout << "RESULT large-size passed=40\n";
                return 0;
        }
        const std::string multipart = "--native\r\nContent-Disposition: form-data; name=\"mode\"\r\n\r\nplain\r\n--native\r\nContent-Disposition: form-data; name=\"count\"\r\n\r\n1\r\n--native--\r\n";
        std::ostringstream multipartlength;
        multipartlength << std::hex << multipart.size();
        const std::string headerproxy = "source=native-fixture;proto=https;for=192.0.2.1";
        const std::string trailerproxy = "source=trailer-fixture;proto=http;for=192.0.2.2";
        const std::vector<Case> cases = {
                {"proxy-header-control", "X-WH-Proxy: " + headerproxy + "\r\nContent-Length: 3\r\n", "abc", Expected::Complete, false, "native-fixture"},
                {"proxy-only-trailer", "Transfer-Encoding: chunked\r\n", "3\r\nabc\r\n0\r\nX-WH-Proxy: " + trailerproxy + "\r\n\r\n", Expected::Complete},
                {"proxy-trailer-preserves-header", "X-WH-Proxy: " + headerproxy + "\r\nTransfer-Encoding: chunked\r\n", "3\r\nabc\r\n0\r\nX-WH-Proxy: " + trailerproxy + "\r\n\r\n", Expected::Complete, false, "native-fixture"},
                {"multipart-length", "Content-Type: multipart/form-data; boundary=native\r\nContent-Length: " + std::to_string(multipart.size()) + "\r\n", multipart, Expected::Complete, true},
                {"multipart-chunked", "Content-Type: multipart/form-data; boundary=native\r\nTransfer-Encoding: chunked\r\n", multipartlength.str() + "\r\n" + multipart + "\r\n0\r\n\r\n", Expected::Complete, true},
                {"empty-urlencoded-chunked", "Content-Type: application/x-www-form-urlencoded\r\nTransfer-Encoding: chunked\r\n", "0\r\n\r\n", Expected::Complete},
                {"empty-chunked", "Transfer-Encoding: chunked\r\n", "0\r\n\r\n", Expected::Complete},
                {"mixed-case-duplicate-length", "content-length: 3\r\nCONTENT-LENGTH: 03\r\n", "abc", Expected::Complete},
                {"mixed-case-conflict-length", "content-length: 4\r\nCONTENT-LENGTH: 3\r\n", "abc", Expected::RejectHeaders},
                {"chunk-leading-zeroes", "Transfer-Encoding: ChUnKeD \r\n", "0003\r\nabc\r\n00\r\n\r\n", Expected::Complete},
                {"form-trailers", "Content-Type: application/x-www-form-urlencoded\r\nTransfer-Encoding: chunked\r\n", hexlength.str() + "\r\n" + form + "\r\n0\r\nContent-Type: text/plain\r\nHost: invalid.example\r\n\r\n", Expected::Complete, true},
                {"length", "Content-Length: 3\r\n", "abc", Expected::Complete},
                {"equal-lengths", "Content-Length: 3\r\nContent-Length: 3\r\n", "abc", Expected::Complete},
                {"length-ows", "Content-Length:\t3 \t\r\n", "abc", Expected::Complete},
                {"conflicting-lengths", "Content-Length: 4\r\nContent-Length: 3\r\n", "abc", Expected::RejectHeaders},
                {"length-suffix", "Content-Length: 3x\r\n", "abc", Expected::RejectHeaders},
                {"length-empty", "Content-Length:\r\n", "", Expected::RejectHeaders},
                {"length-negative", "Content-Length: -1\r\n", "", Expected::RejectHeaders},
                {"length-plus", "Content-Length: +3\r\n", "abc", Expected::RejectHeaders},
                {"length-comma-conflict", "Content-Length: 3,4\r\n", "abc", Expected::RejectHeaders},
                {"length-overflow64", "Content-Length: 18446744073709551616\r\n", "", Expected::RejectHeaders},
                {"length-64bit", "Content-Length: 4294967296\r\n", "", Expected::Incomplete},
                {"length-max64", "Content-Length: 18446744073709551615\r\n", "", Expected::Incomplete},
                {"bad-transfer", "Transfer-Encoding: garbage\r\n", "", Expected::RejectHeaders},
                {"duplicate-transfer", "Transfer-Encoding: chunked\r\nTransfer-Encoding: chunked\r\n", "0\r\n\r\n", Expected::RejectHeaders},
                {"transfer-length", "Transfer-Encoding: chunked\r\nContent-Length: 3\r\n", "3\r\nabc\r\n0\r\n\r\n", Expected::RejectHeaders},
                {"length-transfer", "Content-Length: 3\r\nTransfer-Encoding: chunked\r\n", "3\r\nabc\r\n0\r\n\r\n", Expected::RejectHeaders},
                {"form-length", "Content-Type: application/x-www-form-urlencoded\r\nContent-Length: " + std::to_string(form.size()) + "\r\n", form, Expected::Complete, true},
                {"form-chunked", "Content-Type: application/x-www-form-urlencoded\r\nTransfer-Encoding: chunked\r\n", chunkform, Expected::Complete, true},
                {"chunks", "Transfer-Encoding: chunked\r\n", "1\r\na\r\n2\r\nbc\r\n0\r\n\r\n", Expected::Complete},
                {"chunk-trailer", "Transfer-Encoding: chunked\r\n", "3\r\nabc\r\n0\r\nX-Probe: synthetic\r\n\r\n", Expected::Complete},
                {"trailer-cannot-reframe", "Transfer-Encoding: chunked\r\n", "3\r\nabc\r\n0\r\nX-WH-Proxy: " + trailerproxy + "\r\nContent-Length: 999\r\n\r\n", Expected::Complete},
                {"chunk-empty-size", "Transfer-Encoding: chunked\r\n", "\r\n\r\n", Expected::RejectBody},
                {"chunk-overflow", "Transfer-Encoding: chunked\r\n", "10000000000000000\r\n", Expected::RejectBody},
                {"chunk-bare-lf", "Transfer-Encoding: chunked\r\n", "1\na\n0\n\n", Expected::RejectBody},
                {"chunk-no-delimiter", "Transfer-Encoding: chunked\r\n", "1\r\na0\r\n\r\n", Expected::RejectBody},
        };
        unsigned failed = 0, passed = 0;
        Blex::ComplexFileSystem tempfs;
        for (const auto &test : cases) for (std::size_t split : {std::size_t(1), std::size_t(2), std::size_t(7), std::size_t(4096)}) {
                try {
                        RequestParser parser(tempfs);
                        const std::string wire = "POST /synthetic HTTP/1.1\r\nHost: localhost\r\n" + test.headers + "\r\n" + test.body;
                        const std::string next = "GET /next?marker=second HTTP/1.1\r\nHost: localhost\r\n\r\n";
                        unsigned headers_complete = 0;
                        const auto consumed = Feed(parser, wire + (test.expected == Expected::Incomplete ? "" : next), split, &headers_complete);
                        if (test.expected == Expected::RejectHeaders || test.expected == Expected::RejectBody) {
                                Check(!parser.IsProtocolSane() && parser.GetErrorCode() != RequestParser::ErrorNone, "invalid framing accepted or failure state lost");
                                Check(headers_complete == (test.expected == Expected::RejectHeaders ? 0u : 1u), "malformed headers reached dispatch");
                                const auto error = parser.GetErrorCode();
                                Check(parser.ParseHTTP(next.data(), next.data() + next.size(), [&] { ++headers_complete; return true; }) == next.data()
                                      && parser.GetErrorCode() == error && !parser.IsProtocolSane(), "terminal failure accepted subsequent input");
                        } else if (test.expected == Expected::Incomplete) {
                                Check(headers_complete == 1 && parser.IsExpectingData() && parser.IsProtocolSane(), "large valid length truncated/completed");
                        } else {
                                Check(headers_complete == 1 && parser.IsProtocolSane() && !parser.IsExpectingData() && parser.GetErrorCode() == RequestParser::ErrorNone, "valid request not complete");
                                Check(consumed == wire.size(), "wrong boundary before next request");
                                if (test.form) Check(parser.GetVariableValue("mode") == "plain" && parser.GetVariableValue("count") == "1", "form finalization missing");
                                Check(parser.GetHeaderValue("X-Probe").empty() && parser.GetHeaderValue("Host") == "localhost", "trailer changed request headers");
                                Check(parser.GetHaveWHProxy() == !test.proxy_source.empty()
                                      && parser.GetWHProxySource() == test.proxy_source
                                      && parser.GetWHProxyProto() == (test.proxy_source.empty() ? "" : "https"),
                                      "trailer changed proxy metadata or the positive header control failed");
                                parser.ClearState();
                                Check(Feed(parser, next, split) == next.size() && !parser.IsExpectingData() && parser.IsProtocolSane(), "next request not independently parsed");
                                Check(parser.GetBodyBytesReceived() == 0 && parser.GetVariableValue("mode").empty() && parser.GetVariableValue("marker") == "second", "request state survived reset");
                                Check(!parser.GetHaveWHProxy() && parser.GetWHProxySource().empty()
                                      && parser.GetWHProxyProto().empty(), "proxy metadata survived request reset");
                        }
                        ++passed;
                        std::cout << "PASS " << test.name << " split=" << split << "\n";
                } catch (std::exception const &e) {
                        ++failed;
                        std::cout << "FAIL " << test.name << " split=" << split << " " << e.what() << "\n";
                }
        }
        TestStorageFailures(&passed, &failed);
        std::cout << "RESULT passed=" << passed << " failed=" << failed << "\n";
        return failed ? 1 : 0;
}
