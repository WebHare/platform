//---------------------------------------------------------------------------
#include <harescript/vm/allincludes.h>


#include <blex/path.h>
#include "baselibs.h"
#include "hsvm_context.h"

// Show all tcp debugging stuff
//#define SHOW_TCPIP

#if defined(SHOW_TCPIP) && defined(DEBUG)
 #define TC_PRINT(x) DEBUGPRINT(x)
 #define TC_ONLY(x) x
#else
 #define TC_PRINT(x)
 #define TC_ONLY(x)
#endif

//---------------------------------------------------------------------------
//
// This library adds backend support functions for Blob management
//
//---------------------------------------------------------------------------
namespace HareScript {
namespace Baselibs {

//ADDME: VAlidate all received IP addresses

// Definition of static tcp cache
TCPIPContext::LockedCache TCPIPContext::cache;

TCPIPContext::SocketInfo::SocketInfo(HSVM *_vm, TCPIPContext *context, bool is_tcp)
: OutputObject(_vm)
, vm(_vm)
, context(context)
, socket(is_tcp ? Blex::Socket::Stream : Blex::Socket::Datagram)
, is_tcp(is_tcp)
, timeout(-1)
, lasterror(Blex::SocketError::Errors::NoError)
{
}

std::pair< Blex::SocketError::Errors, unsigned > TCPIPContext::SocketInfo::Read(unsigned length, void *data)
{
        TC_PRINT("{" << GetId() << "} Reading " << length << " bytes");

        int result = socket.Receive(data, length);
        if (result < 0)
        {
                lasterror = static_cast< Blex::SocketError::Errors >(result);
                result = 0;
        }
        else
            lasterror = Blex::SocketError::NoError;

        return std::make_pair(lasterror, result);
}

std::pair< Blex::SocketError::Errors, unsigned > TCPIPContext::SocketInfo::Write(unsigned length, const void *data, bool allow_partial)
{
        TC_PRINT("{" << GetId() << "} Writing " << length << " bytes of data to network socket");

        if (allow_partial)
        {
                int result = socket.Send(data, length);
                if (result < 0)
                {
                        lasterror = static_cast< Blex::SocketError::Errors >(result);
                        result = 0;
                }
                else
                    lasterror = Blex::SocketError::NoError;

                return std::make_pair(lasterror, result);
        }

        std::pair<int32_t, int32_t> result;

        Blex::DateTime nextwait = Blex::DateTime::Min();
        Blex::DateTime maxwait = timeout > 0 ? Blex::DateTime::Now() + Blex::DateTime::Msecs(timeout) : Blex::DateTime::Max();
        unsigned num_written = 0;

        lasterror = Blex::SocketError::NoError;
        while(num_written < length)
        {
                if(nextwait >= maxwait || HSVM_TestMustAbort(vm))
                {
                        lasterror = Blex::SocketError::Timeout;
                }

                nextwait = std::min(Blex::DateTime::Now() + Blex::DateTime::Msecs(1000), maxwait);

                // Max wait a second at a time
                TC_PRINT("{" << GetId() << "} Trying to send " << (length - num_written) << " bytes of data");
                result = socket.TimedSend(data, length - num_written, nextwait);
                lasterror = static_cast< Blex::SocketError::Errors >(result.first);
                TC_PRINT("{" << GetId() << "} Error " << Blex::SocketError::GetErrorText(lasterror) << ", " << result.second << " bytes");

                if(result.first != Blex::SocketError::NoError && result.first != Blex::SocketError::Timeout)
                    break;

                if(result.second) //written anything
                {
                        data = static_cast<const char*>(data) + result.second;
                        num_written += result.second;
                }
        }

        TC_PRINT("{" << GetId() << "} Sent " << (result.first < 0 ? 0 : num_written) << " bytes");
        return std::make_pair(lasterror, num_written);
}

bool TCPIPContext::SocketInfo::AddToWaiterRead(Blex::PipeWaiter &waiter)
{
        if (!readbuffer.empty() && !wait_ignores_readbuffer)
            return true;

        waiter.AddSocket(socket,true,false);
        return false;
}
bool TCPIPContext::SocketInfo::AddToWaiterWrite(Blex::PipeWaiter &waiter)
{
        waiter.AddSocket(socket,false,true);
        return false;
}

bool TCPIPContext::SocketInfo::IsAtEOF()
{
        return socket.EndOfStream();
}
OutputObject::SignalledStatus TCPIPContext::SocketInfo::IsReadSignalled(Blex::PipeWaiter *waiter)
{
        if (!readbuffer.empty() && !wait_ignores_readbuffer)
            return Signalled;

        if (waiter)
            return waiter->GotRead(socket) ? Signalled : NotSignalled;

        return Unknown;
}
OutputObject::SignalledStatus TCPIPContext::SocketInfo::IsWriteSignalled(Blex::PipeWaiter *waiter)
{
        if (waiter)
            return waiter->GotWrite(socket) ? Signalled : NotSignalled;

        return Unknown;
}


int TCPIPContext::CreateNewTCPSocket(HSVM *vm)
{
        // Setup the remote address
        SocketInfoPtr socketinfo(new SocketInfo(vm, this, true));
        DEBUGONLY(socketinfo->socket.SetDebugMode(Blex::DebugSocket::Errors));
        socketlist[socketinfo->GetId()]=socketinfo;
        // Set to unblocking
        socketinfo->socket.SetBlocking(false);
        TC_PRINT("{" << socketinfo->GetId() << "} TCP socket created");
        return socketinfo->GetId();
}

int TCPIPContext::CreateNewUDPSocket(HSVM *vm)
{
        // Setup the remote address
        SocketInfoPtr socketinfo(new SocketInfo(vm, this, false));
        DEBUGONLY(socketinfo->socket.SetDebugMode(Blex::DebugSocket::Errors));
        socketlist[socketinfo->GetId()]=socketinfo;
        socketinfo->socket.SetBlocking(false);
        TC_PRINT("{" << socketinfo->GetId() << "} UDP socket created");
        return socketinfo->GetId();
}

int TCPIPContext::ReceiveDatagram(int connectionid, Blex::SocketAddress *remoteaddress, char *buffer, int bufferlen)
{
        SocketInfo *info = GetSocket(connectionid);
        if (info == NULL)
          return -1;

        TC_PRINT("{" << info->GetId() << "} ReceivingDatagram");
        return info->socket.ReceiveDatagram(buffer, bufferlen, remoteaddress);
}

bool TCPIPContext::SendDatagram(int connectionid, Blex::SocketAddress const &remoteaddress, char const *buffer, int bufferlen)
{
        SocketInfo *info = GetSocket(connectionid);
        if (info == NULL)
          return false;

        TC_PRINT("{" << info->GetId() << "} SendDatagram");
        //sends the # of bytes, -1 upon error, or 0 when the sendbuffer was full
        return (info->socket.SendDatagram(buffer, bufferlen, remoteaddress) > 0);
}


/** @short Get the local ip and local port belonging to a connectionid
    @return local SocketAddress of the connection */
Blex::SocketAddress TCPIPContext::GetLocalEndpoint(int connectionid)
{
        SocketInfo *info = GetSocket(connectionid);
        if (info == NULL)
                return Blex::SocketAddress();

        return info->socket.GetLocalAddress();
}

/** @short Get the remote ip and remote port belonging to a connectionid
    @return local SocketAddress of the connection */
Blex::SocketAddress TCPIPContext::GetRemoteEndpoint(int connectionid)
{
        SocketInfo *info = GetSocket(connectionid);
        if (info == NULL)
                return Blex::SocketAddress();

        return info->socket.GetRemoteAddress();
}

/** @short Check a socket
    @return NULL if the socket doesn't xist*/
TCPIPContext::SocketInfo* TCPIPContext::GetSocket(int connectionid)
{
        std::map<int, SocketInfoPtr>::iterator itr=socketlist.find(connectionid);
        if (itr == socketlist.end())
            return NULL;

        return itr->second.get();
}

bool TCPIPContext::BindTCPSocket(int connectionid, Blex::SocketAddress local_endpoint)
{
        SocketInfo *info = GetSocket(connectionid);
        if (info == NULL)
            return false;

        // Try to bind
        info->lasterror = info->socket.Bind(local_endpoint);
        TC_PRINT("{" << info->GetId() << "} Bind to " << local_endpoint << " result " << info->lasterror);
        if (info->lasterror)
            return false;

        return true;
}

bool TCPIPContext::Listen (int connectionid)
{
        SocketInfo *info = GetSocket(connectionid);
        if (info == NULL)
            return false;

        // Try to bind
        info->lasterror = info->socket.Listen(5);
        TC_PRINT("{" << info->GetId() << "} Listen result " << info->lasterror);
        if (info->lasterror)
            return false;

        return true;
}

int TCPIPContext::Accept(HSVM *vm, int connectionid)
{
        SocketInfo *info = GetSocket(connectionid);
        if (info == NULL)
            return 0;

        //Create a new socket
        int receivingsocket = CreateNewTCPSocket(vm);
        if (!receivingsocket)
            return 0;

        //Try to accept the connection
        //FIXME: Assumes blocking - FIXME: Support timeouts on Accept
        info->socket.SetBlocking(true);
        info->lasterror = info->socket.Accept(&GetSocket(receivingsocket)->socket);
        TC_PRINT("{" << info->GetId() << "} Accepting connnection result " << info->lasterror);
        info->socket.SetBlocking(false);
        if (info->lasterror == Blex::SocketError::NoError)
        {
                GetSocket(receivingsocket)->socket.SetBlocking(false);
                return receivingsocket;
        }

        CloseSocket(receivingsocket);
        return info->lasterror;
}

int TCPIPContext::ConnectSocket(int connectionid, Blex::SocketAddress remote_endpoint, std::string const &hostname)
{
        SocketInfo *info = GetSocket(connectionid);
        if (info == NULL)
            return false;

        TC_PRINT("{" << info->GetId() << "} Connecting to " << remote_endpoint << " (hostname: " << hostname << ")");

        info->socket.SetRemoteHostname(hostname);
        info->lasterror = info->socket.Connect(remote_endpoint);

        int retval = 0;
        if (info->lasterror == Blex::SocketError::WouldBlock)
            retval = 1;
        else if (info->lasterror == Blex::SocketError::NoError)
            retval = 0;
        else
            retval = -1;

        TC_PRINT("{" << info->GetId() << "} Connection result " << info->lasterror << ", retval: " << retval);
        return retval;
}

int TCPIPContext::FinishConnectSocket(int connectionid, bool cancel)
{
        SocketInfo *info = GetSocket(connectionid);
        if (info == NULL)
            return false;

        TC_PRINT("{" << info->GetId() << "} Try finishing connect in progress, cancel: " << (cancel ? "yes" : "no"));

        info->lasterror = info->socket.FinishNonBlockingConnect(cancel);

        int retval = 0;
        if (info->lasterror == Blex::SocketError::WouldBlock)
            retval = 1;
        else if (info->lasterror == Blex::SocketError::NoError)
            retval = 0;
        else
            retval = -1;

        TC_PRINT("{" << info->GetId() << "} Connection result " << info->lasterror << ", retval: " << retval);
        return retval;
}

void TCPIPContext::ShutdownSocket(int connectionid, bool sread, bool swrite)
{
        SocketInfo *info = GetSocket(connectionid);
        if (info == NULL)
            return;

        TC_PRINT("{" << info->GetId() << "} Shutdown socket " << (sread?"read":"") << (swrite?"write":""));

        //FIXME: Accepting SSL connections are broken (we should set up a private key!)
        info->lasterror = info->socket.Shutdown(sread, swrite);
        return;
}
void TCPIPContext::ShutdownSSL(int connectionid)
{
        SocketInfo *info = GetSocket(connectionid);
        if (info == NULL || !info->sslcontext.get())
            return;

        TC_PRINT("{" << info->GetId() << "} Shutdown SSL");

        //FIXME: Accepting SSL connections are broken (we should set up a private key!)
        info->socket.SendSSLShutdown();
        return;
}

bool TCPIPContext::SetSecureSocketCertificate(int connectionid, Blex::Stream &str)
{
        SocketInfo *info = GetSocket(connectionid);
        if (info == NULL || info->sslcontext.get())
            return false;

        info->ssl_cert_key.clear();
        Blex::ReadStreamIntoVector(str, &info->ssl_cert_key);
        return true;
}

bool TCPIPContext::GetPeerCertificateChain(int connectionid, std::string *dest)
{
        SocketInfo *info = GetSocket(connectionid);
        if (info == NULL || !info->sslcontext.get())
            return false;

        if (!info->socket.GetPeerCertificateChain(dest))
        {
               dest->clear();
               return false;
        }
        return true;
}

bool TCPIPContext::CreateSecureSocket(int connectionid, bool initiate, std::string const &ciphersuite, std::string const &hostname, int securitylevel)
{
        SocketInfo *info = GetSocket(connectionid);
        if (info == NULL || info->sslcontext.get())
            return false;

        TC_PRINT("{" << info->GetId() << "} Secure socket");

        if (!hostname.empty())
            info->socket.SetRemoteHostname(hostname);

        // Try to setup SSL connection (FIXME: Support immediate handshaking again to speed up connect error detection (now handsahke is transparent so errors are detected later)
        info->sslcontext.reset(new Blex::SSLContext(initiate==false, ciphersuite, securitylevel));
        if(!info->ssl_cert_key.empty())
        {
                if (!info->sslcontext->LoadCertificateChain(&info->ssl_cert_key[0], info->ssl_cert_key.size())
                    || !info->sslcontext->LoadPrivateKey(&info->ssl_cert_key[0], info->ssl_cert_key.size())
                   )
                {
                        info->sslcontext.reset();
                        return false;
                }
        }

        //FIXME: Accepting SSL connections are broken (we should set up a private key!)
        return info->socket.SetSecure(info->sslcontext.get()) == Blex::SocketError::NoError;
}

void TCPIPContext::DestroySecureSocket(int connectionid)
{
        SocketInfo *info = GetSocket(connectionid);
        if (info == NULL)
            return;

        TC_PRINT("{" << info->GetId() << "} Destroy Secure socket");

        info->socket.SetSecure(NULL);
        info->sslcontext.reset();
}

void TCPIPContext::SetSocketTimeout(int connectionid, int timeout)
{
        SocketInfo *info = GetSocket(connectionid);
        if(info == NULL)
            return;

        TC_PRINT("{" << info->GetId() << "} Set socket timeout to " << timeout);
        info->timeout = timeout;
}

int TCPIPContext::GetSocketTimeout(int connectionid)
{
        SocketInfo *info = GetSocket(connectionid);
        if(info == NULL)
            return -1;

        return info->timeout;
}

int TCPIPContext::SetSocketSendBufferSize(int connectionid, uint32_t newbuffersize)
{
        SocketInfo *info = GetSocket(connectionid);
        if(info == NULL)
            return -1;

        info->lasterror = info->socket.SetSendBufferSize(newbuffersize);
        return 0;
}

uint32_t TCPIPContext::GetSocketSendBufferSize(int connectionid)
{
        SocketInfo *info = GetSocket(connectionid);
        if(info == NULL)
            return -1;

        uint32_t len = 0;
        info->lasterror = info->socket.GetSendBufferSize(&len);
        return len;
}

int TCPIPContext::GetLastError(int connectionid, std::string *out_sslerror)
{
        SocketInfo *info = GetSocket(connectionid);
        if (info == NULL)
            return 0;

        if(out_sslerror)
            *out_sslerror = info->socket.GetSSLError();

        return info->lasterror;
}

void TCPIPContext::CloseSocket(int connectionid)
{
        SocketInfo *info = GetSocket(connectionid);
        if (info == NULL)
            return;

        TC_PRINT("{" << info->GetId() << "} Close socket");

        //Close the connection
        info->socket.Close();

        // And remove the socket from the socketlist
        socketlist.erase(connectionid);
}

void TCPIPContext::SetLastError(int connectionid, int error)
{
        SocketInfo *info = GetSocket(connectionid);
        if (info == NULL)
            return;

        info->lasterror = static_cast< Blex::SocketError::Errors >(error);
}

void TCPIPContext::CloseHandles()
{
        socketlist.clear();
}

void TCPIPContext::ClearCache()
{
        TCPIPContext::LockedCache::WriteRef lock(cache);
        lock->hostnamelookupcache.clear();
}

std::shared_ptr< TCPIPContext::SocketInfo > TCPIPContext::ExportSocket(int connectionid)
{
        std::shared_ptr< SocketInfo > result;
        std::map<int, SocketInfoPtr>::iterator itr = socketlist.find(connectionid);
        if (itr != socketlist.end())
        {
                result = itr->second;
                socketlist.erase(itr);
                result->Unregister();
        }
        return result;
}

int TCPIPContext::ImportSocket(VirtualMachine *vm, std::shared_ptr< TCPIPContext::SocketInfo > const &socket)
{
        int connid = socket->Register(*vm);
        socketlist.insert(std::make_pair(connid, socket));
        return connid;
}


void CreateTCPSocket(HareScript::VarId id_set, HareScript::VirtualMachine *vm)
{
        // Open tcp/ip interface
        Baselibs::SystemContext context(vm->GetContextKeeper());

        HSVM_IntegerSet(*vm, id_set, context->tcpip.CreateNewTCPSocket(*vm));
}

void CreateUDPSocket(HareScript::VarId id_set, HareScript::VirtualMachine *vm)
{
        // Open tcp/ip interface
        Baselibs::SystemContext context(vm->GetContextKeeper());

        HSVM_IntegerSet(*vm, id_set, context->tcpip.CreateNewUDPSocket(*vm));
}

void HS_TCPIP_Connect(HareScript::VarId id_set, HareScript::VirtualMachine *vm)
{
        // Open tcp/ip interface
        Baselibs::SystemContext context(vm->GetContextKeeper());

        // Initialize variables
        Blex::SocketAddress dest;
        int portnumber = vm->GetStackMachine().GetInteger(HSVM_Arg(2));
        int socketid = HSVM_IntegerGet(*vm, HSVM_Arg(0));
        std::string hostname = vm->GetStackMachine().GetString(HSVM_Arg(3)).stl_str();

        if(!dest.SetIPAddress(HSVM_StringGetSTD(*vm, HSVM_Arg(1))) || !dest.SetPort(portnumber) /*|| dest.IsAnyAddress() || dest.IsIPV4AnyAddress()*/ || dest.GetPort()==0)
        {
                context->tcpip.SetLastError(socketid, Blex::SocketError::Errors::UnableToResolveHostname);
                HSVM_IntegerSet(*vm, id_set, -1);
                return;
        }

        HSVM_IntegerSet(*vm, id_set, context->tcpip.ConnectSocket(socketid, dest, hostname));
}

void HS_TCPIP_FinishConnect(HareScript::VarId id_set, HareScript::VirtualMachine *vm)
{
        // Open tcp/ip interface
        Baselibs::SystemContext context(vm->GetContextKeeper());

        bool cancel = HSVM_BooleanGet(*vm, HSVM_Arg(1));

        HSVM_IntegerSet(*vm, id_set, context->tcpip.FinishConnectSocket(HSVM_IntegerGet(*vm, HSVM_Arg(0)), cancel));
}


void HS_TCPIP_Bind(HareScript::VarId id_set, HareScript::VirtualMachine *vm)
{
        // Open tcp/ip interface
        Baselibs::SystemContext context(vm->GetContextKeeper());
        std::string ipaddr_text = HSVM_StringGetSTD(*vm, HSVM_Arg(1));

        // Initialize variables
        Blex::SocketAddress dest;
        int portnumber = vm->GetStackMachine().GetInteger(HSVM_Arg(2));
        if(!dest.SetIPAddress(HSVM_StringGetSTD(*vm, HSVM_Arg(1))) || !dest.SetPort(portnumber))
        {
                HSVM_BooleanSet(*vm, id_set, false);
                return;
        }

        HSVM_BooleanSet(*vm, id_set, context->tcpip.BindTCPSocket(HSVM_IntegerGet(*vm, HSVM_Arg(0)), dest));
}

void HS_TCPIP_Listen(HareScript::VarId id_set, HareScript::VirtualMachine *vm)
{
        // Open tcp/ip interface
        Baselibs::SystemContext context(vm->GetContextKeeper());
        HSVM_BooleanSet(*vm, id_set, context->tcpip.Listen(HSVM_IntegerGet(*vm, HSVM_Arg(0))));
}

void HS_TCPIP_Accept(HareScript::VarId id_set, HareScript::VirtualMachine *vm)
{
        // Open tcp/ip interface
        Baselibs::SystemContext context(vm->GetContextKeeper());

        HSVM_IntegerSet(*vm, id_set, context->tcpip.Accept(*vm,HSVM_IntegerGet(*vm, HSVM_Arg(0))));
}

void HS_TCPIP_SetSecureSocketCertificate(HareScript::VarId id_set, HareScript::VirtualMachine *vm)
{
        // Open tcp/ip interface
        Baselibs::SystemContext context(vm->GetContextKeeper());
        Interface::InputStream istr(*vm, HSVM_Arg(1));
        HSVM_BooleanSet(*vm, id_set, context->tcpip.SetSecureSocketCertificate(HSVM_IntegerGet(*vm, HSVM_Arg(0)), istr));
}

void HS_TCPIP_GetPeerCertificateChain(HareScript::VarId id_set, HareScript::VirtualMachine *vm)
{
        Baselibs::SystemContext context(vm->GetContextKeeper());
        std::string dest;
        context->tcpip.GetPeerCertificateChain(HSVM_IntegerGet(*vm, HSVM_Arg(0)), &dest);
        HSVM_StringSetSTD(*vm, id_set, dest);
}

void HS_TCPIP_CreateSecureSocket(HareScript::VarId id_set, HareScript::VirtualMachine *vm)
{
        // Open tcp/ip interface
        Baselibs::SystemContext context(vm->GetContextKeeper());
        HSVM_BooleanSet(*vm, id_set, context->tcpip.CreateSecureSocket( HSVM_IntegerGet(*vm, HSVM_Arg(0))
                                                                      , HSVM_BooleanGet(*vm, HSVM_Arg(1))
                                                                      , HSVM_StringGetSTD(*vm, HSVM_Arg(2))
                                                                      , HSVM_StringGetSTD(*vm, HSVM_Arg(3))
                                                                      , HSVM_IntegerGet(*vm, HSVM_Arg(4))));
}

void HS_TCPIP_DestroySecureSocket(HareScript::VirtualMachine *vm)
{
        // Open tcp/ip interface
        Baselibs::SystemContext context(vm->GetContextKeeper());
        context->tcpip.DestroySecureSocket(HSVM_IntegerGet(*vm, HSVM_Arg(0)));
}

void HS_TCPIP_ShutdownSocket(HareScript::VirtualMachine *vm)
{
        Baselibs::SystemContext context(vm->GetContextKeeper());
        context->tcpip.ShutdownSocket(HSVM_IntegerGet(*vm, HSVM_Arg(0)), HSVM_BooleanGet(*vm, HSVM_Arg(1)), HSVM_BooleanGet(*vm, HSVM_Arg(2)));
}

void HS_TCPIP_ShutdownSSL(HareScript::VirtualMachine *vm)
{
        Baselibs::SystemContext context(vm->GetContextKeeper());
        context->tcpip.ShutdownSSL(HSVM_IntegerGet(*vm, HSVM_Arg(0)));
}

void HS_TCPIP_Close(HareScript::VirtualMachine *vm)
{
        // Open tcp/ip interface
        Baselibs::SystemContext context(vm->GetContextKeeper());

        // Close the socket connection
        context->tcpip.CloseSocket(HSVM_IntegerGet(*vm, HSVM_Arg(0)));
}

void HS_TCPIP_SetSocketTimeout(HareScript::VirtualMachine *vm)
{
        // Open tcp/ip interface
        Baselibs::SystemContext context(vm->GetContextKeeper());
        context->tcpip.SetSocketTimeout(HSVM_IntegerGet(*vm, HSVM_Arg(0)), HSVM_IntegerGet(*vm, HSVM_Arg(1)));
}

void HS_TCPIP_GetSocketTimeout(HareScript::VarId id_set, HareScript::VirtualMachine *vm)
{
        // Open tcp/ip interface
        Baselibs::SystemContext context(vm->GetContextKeeper());
        HSVM_IntegerSet(*vm, id_set, context->tcpip.GetSocketTimeout(HSVM_IntegerGet(*vm, HSVM_Arg(0))));
}

void HS_TCPIP_SetSocketSendBufferSize(HareScript::VirtualMachine *vm)
{
        // Open tcp/ip interface
        Baselibs::SystemContext context(vm->GetContextKeeper());
        context->tcpip.SetSocketSendBufferSize(HSVM_IntegerGet(*vm, HSVM_Arg(0)), HSVM_IntegerGet(*vm, HSVM_Arg(1)));
}

void HS_TCPIP_GetSocketSendBufferSize(HareScript::VarId id_set, HareScript::VirtualMachine *vm)
{
        // Open tcp/ip interface
        Baselibs::SystemContext context(vm->GetContextKeeper());
        HSVM_IntegerSet(*vm, id_set, context->tcpip.GetSocketSendBufferSize(HSVM_IntegerGet(*vm, HSVM_Arg(0))));
}

void HS_TCPIP_GetLastError(HareScript::VarId id_set, HareScript::VirtualMachine *vm)
{
        HSVM_SetDefault(*vm, id_set, HSVM_VAR_Record);

        // Open tcp/ip interface
        Baselibs::SystemContext context(vm->GetContextKeeper());
        std::string sslerror;
        int errorcode = context->tcpip.GetLastError(HSVM_IntegerGet(*vm, HSVM_Arg(0)), &sslerror);
        HSVM_IntegerSet  (*vm, HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, "ERRORCODE")), errorcode);
        HSVM_StringSetSTD(*vm, HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, "SSLERROR")), sslerror);
}

void HS_TCPIP_GetLocalIp(HareScript::VarId id_set, HareScript::VirtualMachine *vm)
{
        // Open tcp/ip interface
        Baselibs::SystemContext context(vm->GetContextKeeper());
        Blex::SocketAddress localaddress = context->tcpip.GetLocalEndpoint(HSVM_IntegerGet(*vm, HSVM_Arg(0)));

        // Return the ip address to harescript
        HSVM_StringSetSTD(*vm, id_set, localaddress.GetIPAddress());
}

void HS_TCPIP_UDPReceive(HareScript::VarId id_set, HareScript::VirtualMachine *vm)
{
        HSVM_SetDefault(*vm, id_set, HSVM_VAR_Record);

        // Create the return RECORD

        Blex::SocketAddress remoteaddress;

        char buffer[16 * 1024];

        Baselibs::SystemContext context(vm->GetContextKeeper());
        int socketid = HSVM_IntegerGet(*vm, HSVM_Arg(0));

        int received = context->tcpip.ReceiveDatagram(socketid, &remoteaddress, buffer, 16 * 1024);
        if(received > 0)
        {
                HSVM_StringSetSTD(*vm, HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, "IP")), remoteaddress.GetIPAddress());
                HSVM_IntegerSet(*vm, HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, "PORT")), remoteaddress.GetPort());
                HSVM_StringSet(*vm, HSVM_RecordCreate(*vm, id_set, HSVM_GetColumnId(*vm, "DATA")), buffer, buffer + received);
        }
}

void HS_TCPIP_UDPSend(HareScript::VarId id_set, HareScript::VirtualMachine *vm)
{

        Baselibs::SystemContext context(vm->GetContextKeeper());
        int socketid = HSVM_IntegerGet(*vm, HSVM_Arg(0));
        int portnumber = HSVM_IntegerGet(*vm, HSVM_Arg(2));

        // Initialize variables
        Blex::SocketAddress dest;
        if(!dest.SetIPAddress(HSVM_StringGetSTD(*vm, HSVM_Arg(1))) || !dest.SetPort(portnumber) || dest.IsAnyAddress() || dest.IsIPV4AnyAddress() || dest.GetPort()==0)
        {
                HSVM_BooleanSet(*vm, id_set, false);
                return;
        }
        const char *bufferstart,*bufferend;
        HSVM_StringGet(*vm, HSVM_Arg(3), &bufferstart, &bufferend);
        HSVM_BooleanSet(*vm, id_set, context->tcpip.SendDatagram(socketid, dest, bufferstart, bufferend - bufferstart));
}


void HS_TCPIP_GetLocalPort(HareScript::VarId id_set, HareScript::VirtualMachine *vm)
{
        // Open tcp/ip interface
        Baselibs::SystemContext context(vm->GetContextKeeper());
        Blex::SocketAddress localaddress = context->tcpip.GetLocalEndpoint(HSVM_IntegerGet(*vm, HSVM_Arg(0)));

        // Return the port number to harescript
        HSVM_IntegerSet(*vm, id_set, localaddress.GetPort());
}

void HS_TCPIP_GetRemoteIp(HareScript::VarId id_set, HareScript::VirtualMachine *vm)
{
        // Open tcp/ip interface
        Baselibs::SystemContext context(vm->GetContextKeeper());
        Blex::SocketAddress remoteaddress = context->tcpip.GetRemoteEndpoint(HSVM_IntegerGet(*vm, HSVM_Arg(0)));

        // Return the ip address to harescript
        HSVM_StringSetSTD(*vm, id_set, remoteaddress.GetIPAddress());
}

void HS_TCPIP_GetRemotePort(HareScript::VarId id_set, HareScript::VirtualMachine *vm)
{
        // Open tcp/ip interface
        Baselibs::SystemContext context(vm->GetContextKeeper());
        Blex::SocketAddress remoteaddress = context->tcpip.GetRemoteEndpoint(HSVM_IntegerGet(*vm, HSVM_Arg(0)));

        // Return the port number to harescript
        HSVM_IntegerSet(*vm, id_set, remoteaddress.GetPort());
}

void HS_TCPIP_SetLastErrorCode(HareScript::VirtualMachine *vm)
{
        // Open tcp/ip interface
        Baselibs::SystemContext context(vm->GetContextKeeper());

        // Initialize variables
        int socketid = vm->GetStackMachine().GetInteger(HSVM_Arg(0));
        int errorid = vm->GetStackMachine().GetInteger(HSVM_Arg(1));

        context->tcpip.SetLastError(socketid,errorid);
}

namespace
{

void DoHostnameLookup(HareScript::VirtualMachine *vm, std::string const &sourcename, std::vector< Blex::SocketAddress > *alladdresses)
{
        Blex::DateTime now = Blex::DateTime::Now();
        Baselibs::SystemContext context(vm->GetContextKeeper());
        bool found = false;

        // Lookup in the cache
        {
                TCPIPContext::LockedCache::WriteRef lock(context->tcpip.cache);
                TCPIPContext::Cache::HostNameLookupCache::iterator it = lock->hostnamelookupcache.find(sourcename);
                if (it != lock->hostnamelookupcache.end())
                {
                        if (it->second.expires > now)
                        {
                                *alladdresses = it->second.alladdresses;
                                found = true;
                                TC_PRINT("Using hostname lookup for '" << sourcename << "' from cache");
                        }
                        else
                        {
                                TC_PRINT("Erasing expired hostname lookup for '" << sourcename << "' from cache");
                                lock->hostnamelookupcache.erase(it);
                        }
                }
        }

        if (!found)
        {
                // Resolve
                Blex::ResolveHostnameAllIPs(sourcename, alladdresses);
                TC_PRINT("Resolving hostname '" << sourcename << "', no entry in cache");

                // Put in the cache, expiry of 5 minutes
                TCPIPContext::LockedCache::WriteRef lock(context->tcpip.cache);

                TCPIPContext::Cache::HostnameLookupValue val;
                val.alladdresses = *alladdresses;
                val.expires = now + Blex::DateTime::Minutes(5);
                lock->hostnamelookupcache.insert(std::make_pair(sourcename, val));
        }
}

} // End of anonymous namespace

void HS_TCPIP_ResolveHostname(HareScript::VarId id_set, HareScript::VirtualMachine *vm)
{
        std::string sourcename = vm->GetStackMachine().GetSTLString(HSVM_Arg(0));

        std::vector<Blex::SocketAddress> alladdresses;
        DoHostnameLookup(vm, sourcename, &alladdresses);

        if (alladdresses.empty())
            HSVM_SetDefault(*vm, id_set, HSVM_VAR_String);
        else
            HSVM_StringSetSTD(*vm, id_set, alladdresses[0].GetIPAddress());
}

void HS_TCPIP_ResolveHostnameAllIPs(HareScript::VarId id_set, HareScript::VirtualMachine *vm)
{
        std::string sourcename = vm->GetStackMachine().GetSTLString(HSVM_Arg(0));

        std::vector<Blex::SocketAddress> alladdresses;
        DoHostnameLookup(vm, sourcename, &alladdresses);

        HSVM_SetDefault(*vm, id_set, HSVM_VAR_StringArray);
        for (unsigned i=0;i<alladdresses.size();++i)
        {
                HSVM_StringSetSTD(*vm, HSVM_ArrayAppend(*vm, id_set), alladdresses[i].GetIPAddress());
        }
}

void HS_TCPIP_ResolveIPAddress(HareScript::VarId id_set, HareScript::VirtualMachine *vm)
{
        std::string ipaddress = vm->GetStackMachine().GetSTLString(HSVM_Arg(0));
        Blex::SocketAddress ipaddy(ipaddress,0);
        vm->GetStackMachine().SetSTLString(id_set, Blex::ResolveIPAddress(ipaddy));
}

void HS_TCPIP_GetLocalIPs(HareScript::VarId id_set, HareScript::VirtualMachine *vm)
{
        std::vector<Blex::SocketAddress> alladdresses;

        Blex::GetLocalIPs(&alladdresses);
        HSVM_SetDefault(*vm, id_set, HSVM_VAR_StringArray);
        for (unsigned i=0;i<alladdresses.size();++i)
            HSVM_StringSetSTD(*vm, HSVM_ArrayAppend(*vm, id_set),  alladdresses[i].GetIPAddress());
}

void HS_TCPIP_GetSystemHostName(HareScript::VarId id_set, HareScript::VirtualMachine *vm)
{
        HSVM_StringSetSTD(*vm, id_set, Blex::GetSystemHostName( HSVM_BooleanGet(*vm, HSVM_Arg(0))));
}

void HS_TCPIP_GetSocketErrorText(HareScript::VarId id_set, HareScript::VirtualMachine *vm)
{
        int errorcode = HSVM_IntegerGet(*vm, HSVM_Arg(0));
        const char *errortext = Blex::SocketError::GetErrorText((Blex::SocketError::Errors)errorcode);

        HSVM_StringSet(*vm, id_set, errortext, errortext?errortext+strlen(errortext):NULL);
}

//STRING FUNCTION __HS_TCPIP_CanoncalizeIP(STRING address, INTEGER networkprefix) __ATTRIBUTES__(EXTERNAL);
void HS_TCPIP_CanonicalizeIP(HareScript::VarId id_set, HareScript::VirtualMachine *vm)
{
        try
        {
                Blex::SocketAddress inaddr(HSVM_StringGetSTD(*vm, HSVM_Arg(0)),0);
                inaddr = inaddr.GetNetworkNumber(HSVM_IntegerGet(*vm, HSVM_Arg(1)));
                HSVM_StringSetSTD(*vm, id_set, inaddr.GetIPAddress());
        }
        catch(std::exception &e)
        {
                HSVM_SetDefault(*vm, id_set, HSVM_VAR_String);
        }
}

class TCPIPContext::SocketMarshallerData
{
    public:
        SocketMarshallerData(std::shared_ptr< TCPIPContext::SocketInfo > socket)
        : socket(socket)
        {
        }

        ~SocketMarshallerData()
        {
        }

        bool RestoreTo(struct HSVM *vm, HSVM_VariableId var);

        static int MarshalSocket(struct HSVM *vm, HSVM_VariableId sent_var, void **resultdata, HSVM_ObjectRestorePtr *restoreptr, HSVM_ObjectClonePtr *cloneptr);

    private:
        std::shared_ptr< TCPIPContext::SocketInfo > socket;
};

bool TCPIPContext::SocketMarshallerData::RestoreTo(struct HSVM *vm, HSVM_VariableId var)
{
        Baselibs::SystemContext context(GetVirtualMachine(vm)->GetContextKeeper());
        int connectionid = context->tcpip.ImportSocket(GetVirtualMachine(vm), socket);

        // Create the object in var
        HSVM_OpenFunctionCall(vm, 2);
        HSVM_IntegerSet(vm, HSVM_CallParam(vm, 0), connectionid);
        HSVM_BooleanSet(vm, HSVM_CallParam(vm, 1), socket->is_tcp);
        const HSVM_VariableType args[2] = { HSVM_VAR_Integer, HSVM_VAR_Boolean };
        HSVM_VariableId obj = HSVM_CallFunction(vm, "wh::internet/tcpip.whlib", "__RESTOREMARSHALLEDSOCKET", HSVM_VAR_Object, 2, args);
        if (!obj)
            return false;

        HSVM_CopyFrom(vm, var, obj);
        HSVM_CloseFunctionCall(vm);
        return true;
}

int TCPIPContext::SocketMarshallerData::MarshalSocket(struct HSVM *vm, HSVM_VariableId sent_var, void **resultdata, HSVM_ObjectRestorePtr *restoreptr, HSVM_ObjectClonePtr *cloneptr)
{
        // Don't allow clone
        if (cloneptr)
            return false;

        Baselibs::SystemContext context(GetVirtualMachine(vm)->GetContextKeeper());

        HSVM_ColumnId col_pvt_handle = HSVM_GetColumnId(vm, "PVT_HANDLE");
        HSVM_VariableId var_pvt_handle = HSVM_ObjectMemberRef(vm, sent_var, col_pvt_handle, true);
        if (!var_pvt_handle || HSVM_GetType(vm, var_pvt_handle) != HSVM_VAR_Integer)
            return 0;

        int32_t id = HSVM_IntegerGet(vm, var_pvt_handle);
        if (!id)
            return 0; // addme: make messages like 'cannot marshal a closed socket' possible

        auto socket = context->tcpip.ExportSocket(id);
        if (!socket.get())
            return 0;

        //Blex::ErrStream() << "Prepare for marshall " << id << " at " << (void*)&drawinfo;
        try
        {
                *restoreptr = &HSVM_ObjectMarshalRestoreWrapper< SocketMarshallerData >;
                *resultdata = new SocketMarshallerData(socket);
                HSVM_IntegerSet(vm, var_pvt_handle, 0);
                return 1;
        }
        catch (std::exception &)
        {
                return 0;
        }
}

void HS_TCPIP_SetSocketMarshaller(HareScript::VirtualMachine *vm)
{
        Baselibs::SystemContext context(vm->GetContextKeeper());

        HSVM_ObjectSetMarshaller(*vm, HSVM_Arg(0), &TCPIPContext::SocketMarshallerData::MarshalSocket);
}

void InitTCPIP(BuiltinFunctionsRegistrator &bifreg)
{
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("CREATETCPSOCKET::I:",CreateTCPSocket));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("CREATEUDPSOCKET::I:",CreateUDPSocket));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_TCPIP_SETLASTERROR:::II",HS_TCPIP_SetLastErrorCode));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_TCPIP_CONNECT::I:ISIS",HS_TCPIP_Connect));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_TCPIP_FINISHCONNECT::I:IB",HS_TCPIP_FinishConnect));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_TCPIP_BIND::B:ISI",HS_TCPIP_Bind));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("ACCEPTONTCPSOCKET::I:I",HS_TCPIP_Accept));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_TCPIP_SETCERT::B:IX",HS_TCPIP_SetSecureSocketCertificate));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_TCPIP_SETSECURECONNECTION::B:IBSSI",HS_TCPIP_CreateSecureSocket));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_TCPIP_GETPEERCERTIFICATECHAIN::S:I",HS_TCPIP_GetPeerCertificateChain));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("DESTROYSECURECONNECTION:::I",HS_TCPIP_DestroySecureSocket));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("SHUTDOWNSOCKET:::IBB",HS_TCPIP_ShutdownSocket));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("SHUTDOWNSSL:::I",HS_TCPIP_ShutdownSSL));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("CLOSESOCKET:::I",HS_TCPIP_Close));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("LISTENONTCPSOCKET::B:I",HS_TCPIP_Listen));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_TCPIP_GETLASTERROR::R:I",HS_TCPIP_GetLastError));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETLOCALSOCKETIP::S:I",HS_TCPIP_GetLocalIp));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETLOCALSOCKETPORT::I:I",HS_TCPIP_GetLocalPort));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETREMOTESOCKETIP::S:I",HS_TCPIP_GetRemoteIp));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETREMOTESOCKETPORT::I:I",HS_TCPIP_GetRemotePort));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETSYSTEMHOSTNAME::S:B",HS_TCPIP_GetSystemHostName));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETSOCKETERRORTEXT::S:I",HS_TCPIP_GetSocketErrorText));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("RESOLVEHOSTNAME::S:S",HS_TCPIP_ResolveHostname));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("RESOLVEHOSTNAMEALLIPS::SA:S",HS_TCPIP_ResolveHostnameAllIPs));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("RESOLVEIPADDRESS::S:S",HS_TCPIP_ResolveIPAddress));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETLOCALIPS::SA:",HS_TCPIP_GetLocalIPs));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_TCPIP_GETSOCKETTIMEOUT::I:I",HS_TCPIP_GetSocketTimeout));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("SETSOCKETTIMEOUT:::II",HS_TCPIP_SetSocketTimeout));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("SETSOCKETSENDBUFFERSIZE:::II",HS_TCPIP_SetSocketSendBufferSize));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("GETSOCKETSENDBUFFERSIZE::I:I",HS_TCPIP_GetSocketSendBufferSize));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("RECEIVESOCKETUDP::R:I",HS_TCPIP_UDPReceive));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("SENDSOCKETUDP::B:ISIS",HS_TCPIP_UDPSend));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("__HS_TCPIP_CANONICALIZEIP::S:SI",HS_TCPIP_CanonicalizeIP));
        bifreg.RegisterBuiltinFunction(BuiltinFunctionDefinition("SOCKET#SETSOCKETMARSHALLER:::O", HS_TCPIP_SetSocketMarshaller));
}


} // End of namespace Baselibs
} // End of namespace HareScript
