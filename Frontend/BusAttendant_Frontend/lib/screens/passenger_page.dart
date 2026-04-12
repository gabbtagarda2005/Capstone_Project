import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/services.dart';

import '../models/ticket_edit_session.dart';
import '../services/api_client.dart';
import '../theme/app_colors.dart';

class PassengerPage extends StatefulWidget {
  const PassengerPage({
    super.key,
    required this.authToken,
    required this.ticketingToken,
    required this.assignedBusNumber,
    required this.onEditAuthorized,
  });

  final String authToken;
  final String ticketingToken;
  final String assignedBusNumber;
  final ValueChanged<TicketEditSession> onEditAuthorized;

  @override
  State<PassengerPage> createState() => _PassengerPageState();
}

class _PassengerPageState extends State<PassengerPage> {
  final _api = ApiClient();
  final _search = TextEditingController();
  late Future<List<ApiIssuedTicket>> _ticketsFuture;

  static const Color _kMint = Color(0xFF5EE396);

  @override
  void initState() {
    super.initState();
    _ticketsFuture = _loadTickets();
  }

  @override
  void didUpdateWidget(covariant PassengerPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.authToken != widget.authToken ||
        oldWidget.ticketingToken != widget.ticketingToken) {
      _refreshTickets();
    }
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<List<ApiIssuedTicket>> _loadTickets() {
    return _api.fetchRecentTickets(
      attendantToken: widget.authToken,
      ticketingToken: widget.ticketingToken,
    );
  }

  void _refreshTickets() {
    setState(() {
      _ticketsFuture = _loadTickets();
    });
  }

  void _runSearch() {
    setState(() {});
  }

  static const List<String> _routeHubs = ['Malaybalay', 'Valencia', 'Maramag', 'Don Carlos'];

  String? _hubNameIn(String raw) {
    final lower = raw.toLowerCase();
    for (final h in _routeHubs) {
      if (lower.contains(h.toLowerCase())) return h;
    }
    return null;
  }

  /// Short label for cards (e.g. "Malaybalay to Valencia") instead of full terminal names.
  String _shortRouteLabel(String from, String to) {
    final a = _hubNameIn(from);
    final b = _hubNameIn(to);
    if (a != null && b != null) return '$a to $b';
    if (a != null && b == null) return '$a to ${_clipTerminal(to)}';
    if (a == null && b != null) return '${_clipTerminal(from)} to $b';
    return '${_clipTerminal(from)} to ${_clipTerminal(to)}';
  }

  String _clipTerminal(String s) {
    final t = s.trim();
    if (t.isEmpty) return '—';
    final comma = t.indexOf(',');
    final head = comma > 0 ? t.substring(0, comma).trim() : t;
    if (head.length <= 32) return head;
    return '${head.substring(0, 29)}…';
  }

  bool get _canEditTickets =>
      widget.ticketingToken.trim().isNotEmpty && widget.assignedBusNumber.trim().isNotEmpty;

  void _showTicketDetails(ApiIssuedTicket t) {
    final ts = t.createdAt;
    final dateStr =
        '${ts.year}-${ts.month.toString().padLeft(2, '0')}-${ts.day.toString().padLeft(2, '0')}';
    final timeStr =
        '${ts.hour.toString().padLeft(2, '0')}:${ts.minute.toString().padLeft(2, '0')}';
    final code = t.ticketCode.trim().isEmpty ? t.id : t.ticketCode;
    showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: MintObsidian.surface,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
          side: BorderSide(color: Colors.white.withOpacity(0.08)),
        ),
        title: const Text('Ticket details', style: TextStyle(color: MintObsidian.textPrimary)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Code: $code', style: const TextStyle(fontWeight: FontWeight.w700, color: MintObsidian.textPrimary)),
            const SizedBox(height: 6),
            Text('Route: ${_shortRouteLabel(t.from, t.to)}', style: const TextStyle(color: MintObsidian.textSecondary)),
            Text('Fare: ₱${t.fare.toStringAsFixed(2)}', style: const TextStyle(color: MintObsidian.mint, fontWeight: FontWeight.w700)),
            Text('Date: $dateStr', style: const TextStyle(color: MintObsidian.textSecondary)),
            Text('Time: $timeStr', style: const TextStyle(color: MintObsidian.textSecondary)),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  Future<void> _openDriverPinSheet(ApiIssuedTicket ticket) async {
    if (!_canEditTickets) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('You need an active bus assignment and ticketing session to correct tickets.'),
        ),
      );
      return;
    }

    final pinCtrl = TextEditingController();
    var busy = false;
    String? err;

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      isDismissible: false,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        final bottom = MediaQuery.paddingOf(ctx).bottom;
        return Padding(
          padding: EdgeInsets.only(bottom: bottom + 12),
          child: StatefulBuilder(
            builder: (context, setModal) {
              Future<void> verify() async {
                final pin = pinCtrl.text.trim();
                if (!RegExp(r'^\d{6}$').hasMatch(pin)) {
                  setModal(() => err = 'Enter the driver’s 6-digit PIN.');
                  return;
                }
                setModal(() {
                  busy = true;
                  err = null;
                });
                final r = await _api.verifyTicketEditPin(
                  attendantToken: widget.authToken,
                  ticketingToken: widget.ticketingToken,
                  busNumber: widget.assignedBusNumber,
                  pin: pin,
                  ticketId: ticket.id,
                );
                if (!context.mounted) return;
                if (r.ok && r.editToken != null) {
                  final session = TicketEditSession(
                    ticket: ticket,
                    editToken: r.editToken!,
                    driverName: r.driverName?.trim().isNotEmpty == true ? r.driverName!.trim() : 'Driver',
                  );
                  Navigator.of(context).pop();
                  // Defer parent IndexedStack/tab switch until after route dispose — avoids
                  // Flutter framework.dart "_dependents.isEmpty" assert on web.
                  SchedulerBinding.instance.addPostFrameCallback((_) {
                    if (!mounted) return;
                    widget.onEditAuthorized(session);
                  });
                  return;
                }
                setModal(() {
                  busy = false;
                  err = r.message ?? 'Verification failed';
                });
              }

              return Center(
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(22),
                  child: BackdropFilter(
                    filter: ImageFilter.blur(sigmaX: 24, sigmaY: 24),
                    child: Container(
                      width: MediaQuery.sizeOf(ctx).width * 0.9,
                      constraints: const BoxConstraints(maxWidth: 400),
                      padding: const EdgeInsets.fromLTRB(22, 22, 22, 18),
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          colors: [
                            const Color(0xE60B1220),
                            const Color(0xF20F172A),
                            const Color(0xEE020817),
                          ],
                        ),
                        borderRadius: BorderRadius.circular(22),
                        border: Border.all(color: Colors.white.withValues(alpha: 0.14)),
                        boxShadow: [
                          BoxShadow(
                            color: _kMint.withValues(alpha: 0.12),
                            blurRadius: 28,
                            spreadRadius: 0,
                            offset: const Offset(0, 8),
                          ),
                        ],
                      ),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Row(
                            children: [
                              Icon(Icons.verified_user_rounded, color: _kMint.withValues(alpha: 0.95), size: 26),
                              const SizedBox(width: 10),
                              const Expanded(
                                child: Text(
                                  'Driver authorization',
                                  style: TextStyle(
                                    color: Colors.white,
                                    fontSize: 18,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                              ),
                              IconButton(
                                onPressed: busy ? null : () => Navigator.of(context).pop(),
                                icon: Icon(Icons.close_rounded, color: Colors.white.withValues(alpha: 0.75)),
                              ),
                            ],
                          ),
                          const SizedBox(height: 6),
                          Text(
                            'Hand the device to the driver. They must enter their 6-digit ticket-correction PIN for ${ticket.ticketCode.trim().isEmpty ? 'ticket #${ticket.id}' : ticket.ticketCode}.',
                            style: TextStyle(
                              color: Colors.white.withValues(alpha: 0.72),
                              fontSize: 13,
                              height: 1.35,
                            ),
                          ),
                          const SizedBox(height: 18),
                          TextField(
                            controller: pinCtrl,
                            keyboardType: TextInputType.number,
                            obscureText: true,
                            maxLength: 6,
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 22,
                              letterSpacing: 8,
                              fontWeight: FontWeight.w800,
                            ),
                            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                            decoration: InputDecoration(
                              counterText: '',
                              hintText: '• • • • • •',
                              hintStyle: TextStyle(color: Colors.white.withValues(alpha: 0.25), letterSpacing: 6),
                              filled: true,
                              fillColor: Colors.black.withValues(alpha: 0.35),
                              border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(14),
                                borderSide: BorderSide(color: _kMint.withValues(alpha: 0.45)),
                              ),
                              enabledBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(14),
                                borderSide: BorderSide(color: Colors.white.withValues(alpha: 0.12)),
                              ),
                              focusedBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(14),
                                borderSide: BorderSide(color: _kMint.withValues(alpha: 0.9), width: 1.5),
                              ),
                            ),
                            onSubmitted: (_) => busy ? null : verify(),
                          ),
                          if (err != null) ...[
                            const SizedBox(height: 10),
                            Text(
                              err!,
                              style: const TextStyle(color: Color(0xFFFFB4AB), fontSize: 12, height: 1.3),
                            ),
                          ],
                          const SizedBox(height: 18),
                          FilledButton(
                            onPressed: busy ? null : verify,
                            style: FilledButton.styleFrom(
                              backgroundColor: _kMint,
                              foregroundColor: MintObsidian.textOnMint,
                              minimumSize: const Size.fromHeight(48),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                            ),
                            child: busy
                                ? const SizedBox(
                                    height: 22,
                                    width: 22,
                                    child: CircularProgressIndicator(strokeWidth: 2, color: MintObsidian.textOnMint),
                                  )
                                : const Text('Verify & open correction', style: TextStyle(fontWeight: FontWeight.w800)),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              );
            },
          ),
        );
      },
    );

    pinCtrl.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 10),
            child: TextField(
              controller: _search,
              onSubmitted: (_) => _runSearch(),
              style: const TextStyle(color: MintObsidian.textPrimary),
              decoration: InputDecoration(
                hintText: 'Search ticket code, route, or category',
                hintStyle: TextStyle(color: MintObsidian.textSecondary.withOpacity(0.85)),
                prefixIcon: const Icon(Icons.search_rounded, color: MintObsidian.ocean),
                suffixIcon: IconButton(
                  onPressed: _runSearch,
                  icon: const Icon(Icons.tune_rounded, color: MintObsidian.ocean),
                ),
                filled: true,
                fillColor: MintObsidian.surfaceElevated,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: BorderSide(color: Colors.white.withOpacity(0.1)),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: BorderSide(color: Colors.white.withOpacity(0.1)),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: const BorderSide(color: MintObsidian.ocean, width: 1.5),
                ),
              ),
            ),
          ),
          if (!_canEditTickets)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Text(
                widget.ticketingToken.trim().isEmpty
                    ? 'Sign in again if ticket list stays empty (ticketing session required).'
                    : 'Sync location on an assigned bus (Home) to enable ticket corrections (driver PIN).',
                textAlign: TextAlign.center,
                style: TextStyle(color: MintObsidian.textSecondary.withOpacity(0.9), fontSize: 12),
              ),
            ),
          Expanded(
            child: RefreshIndicator(
              color: MintObsidian.mint,
              onRefresh: () async {
                _refreshTickets();
                await _ticketsFuture;
              },
              child: FutureBuilder<List<ApiIssuedTicket>>(
                future: _ticketsFuture,
                builder: (context, snap) {
                  if (snap.connectionState != ConnectionState.done) {
                    return ListView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      children: const [
                        SizedBox(height: 120),
                        Center(child: CircularProgressIndicator(color: MintObsidian.mint)),
                      ],
                    );
                  }
                  if (snap.hasError) {
                    return ListView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      padding: const EdgeInsets.all(24),
                      children: [
                        Text(
                          'Could not load issued tickets',
                          style: TextStyle(color: MintObsidian.textSecondary.withOpacity(0.95)),
                        ),
                      ],
                    );
                  }
                  final q = _search.text.trim().toLowerCase();
                  final all = snap.data ?? [];
                  final items = q.isEmpty
                      ? all
                      : all.where((t) {
                          final code = t.ticketCode.toLowerCase();
                          final route = '${t.from} ${t.to}'.toLowerCase();
                          final category = t.category.toLowerCase();
                          return code.contains(q) || route.contains(q) || category.contains(q);
                        }).toList();
                  if (items.isEmpty) {
                    return ListView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      padding: const EdgeInsets.all(24),
                      children: [
                        Text(
                          widget.ticketingToken.trim().isEmpty
                              ? 'No ticketing session — sign out and sign in again.'
                              : 'No issued tickets found',
                          style: const TextStyle(color: MintObsidian.textSecondary),
                        ),
                      ],
                    );
                  }
                  return ListView.builder(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                    itemCount: items.length,
                    itemBuilder: (context, i) {
                      final t = items[i];
                      final routeShort = _shortRouteLabel(t.from, t.to);
                      final ts = t.createdAt;
                      final dateStr =
                          '${ts.year}-${ts.month.toString().padLeft(2, '0')}-${ts.day.toString().padLeft(2, '0')}';
                      final timeStr =
                          '${ts.hour.toString().padLeft(2, '0')}:${ts.minute.toString().padLeft(2, '0')}';
                      return Container(
                        margin: const EdgeInsets.only(bottom: 10),
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: MintObsidian.surface.withOpacity(0.95),
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: Colors.white.withOpacity(0.08)),
                          boxShadow: [
                            BoxShadow(color: Colors.black.withOpacity(0.35), blurRadius: 14, offset: const Offset(0, 6)),
                          ],
                        ),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: Material(
                                color: Colors.transparent,
                                child: InkWell(
                                  borderRadius: BorderRadius.circular(12),
                                  onTap: () => _showTicketDetails(t),
                                  child: Row(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      CircleAvatar(
                                        backgroundColor: MintObsidian.mint.withOpacity(0.22),
                                        child: Text(
                                          t.ticketCode.isNotEmpty ? t.ticketCode[0].toUpperCase() : '#',
                                          style: const TextStyle(fontWeight: FontWeight.w800, color: MintObsidian.mint),
                                        ),
                                      ),
                                      const SizedBox(width: 10),
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            Text(
                                              t.ticketCode.trim().isEmpty ? t.id : t.ticketCode,
                                              style: const TextStyle(fontWeight: FontWeight.w800, color: MintObsidian.textPrimary),
                                            ),
                                            Text(
                                              '₱${t.fare.toStringAsFixed(2)}',
                                              style: TextStyle(color: MintObsidian.textSecondary.withOpacity(0.95), fontSize: 12),
                                            ),
                                            Text(
                                              routeShort,
                                              style: TextStyle(color: MintObsidian.textSecondary.withOpacity(0.95), fontSize: 12),
                                            ),
                                            Text(
                                              '$dateStr $timeStr',
                                              style: TextStyle(color: MintObsidian.textSecondary.withOpacity(0.85), fontSize: 11),
                                            ),
                                          ],
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                            IconButton(
                              tooltip: 'Edit (driver PIN)',
                              onPressed: _canEditTickets ? () => _openDriverPinSheet(t) : null,
                              icon: Icon(
                                Icons.edit_rounded,
                                color: _canEditTickets ? MintObsidian.ocean : MintObsidian.textSecondary.withOpacity(0.35),
                              ),
                            ),
                          ],
                        ),
                      );
                    },
                  );
                },
              ),
            ),
          ),
        ],
      ),
    );
  }
}
