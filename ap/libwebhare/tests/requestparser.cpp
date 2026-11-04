// Native HTTP framing regressions. Inputs never allocate their declared large bodies.
// No listener, application route, database, or external fixture is required.
#include <ap/libwebhare/allincludes.h>
#include <ap/libwebhare/requestparser.h>
#include <iostream>
#include <csignal>

using WebServer::RequestParser;

namespace
{
enum class Expected { Complete, Incomplete, RejectHeaders, RejectBody };

struct Case
{
        const char *name;
        std::string headers, body;
        Expected expected;
        bool form = false;
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
        const std::vector<Case> cases = {
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
                {"trailer-cannot-reframe", "Transfer-Encoding: chunked\r\n", "3\r\nabc\r\n0\r\nContent-Length: 999\r\nX-WH-Proxy: for=192.0.2.1\r\n\r\n", Expected::Complete},
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
                                Check(!parser.GetHaveWHProxy(), "trailer changed proxy metadata");
                                parser.ClearState();
                                Check(Feed(parser, next, split) == next.size() && !parser.IsExpectingData() && parser.IsProtocolSane(), "next request not independently parsed");
                                Check(parser.GetBodyBytesReceived() == 0 && parser.GetVariableValue("mode").empty() && parser.GetVariableValue("marker") == "second", "request state survived reset");
                        }
                        ++passed;
                        std::cout << "PASS " << test.name << " split=" << split << "\n";
                } catch (std::exception const &e) {
                        ++failed;
                        std::cout << "FAIL " << test.name << " split=" << split << " " << e.what() << "\n";
                }
        }
        std::cout << "RESULT passed=" << passed << " failed=" << failed << "\n";
        return failed ? 1 : 0;
}
