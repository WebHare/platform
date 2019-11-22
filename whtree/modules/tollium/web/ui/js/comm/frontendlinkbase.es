
/// This class defines the interface for a frontend link
class FrontendLinkBase
{
  /** Set the current status of the server link
      @param newstatus New status ("offline", "online")
  */
  handleStatusUpdate(newstatus)
  {
  }

  /** Handles an incoming message
  */
  handleMessage(message)
  {
  }
}

export default FrontendLinkBase;
