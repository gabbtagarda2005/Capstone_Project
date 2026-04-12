import '../services/api_client.dart';

/// After the assigned driver verifies their 6-digit PIN, the attendant can correct this ticket once (short-lived token).
class TicketEditSession {
  const TicketEditSession({
    required this.ticket,
    required this.editToken,
    required this.driverName,
  });

  final ApiIssuedTicket ticket;
  final String editToken;
  final String driverName;
}
