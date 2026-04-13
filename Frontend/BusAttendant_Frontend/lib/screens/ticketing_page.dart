import 'dart:async';

import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';

import '../models/ticket_edit_session.dart';
import '../services/api_client.dart';
import '../theme/app_colors.dart';

/// Which trip leg is being filled when the attendant picks a location → stop.
enum _TripLeg { none, fromLeg, toLeg }

class TicketingPage extends StatefulWidget {
  const TicketingPage({
    super.key,
    required this.authToken,
    required this.ticketingToken,
    required this.busNumber,
    this.editBootstrap,
    this.onEditBootstrapConsumed,
    this.onFocusPassengerTickets,
    this.onTicketIssued,
    this.onTicketCorrected,
  });

  final String authToken;
  final String ticketingToken;
  final String busNumber;
  final TicketEditSession? editBootstrap;
  final VoidCallback? onEditBootstrapConsumed;
  final VoidCallback? onFocusPassengerTickets;
  /// Parent should bump passenger list epoch / refresh so Passengers tab shows the new ticket.
  final VoidCallback? onTicketIssued;
  final VoidCallback? onTicketCorrected;

  @override
  State<TicketingPage> createState() => _TicketingPageState();
}

class _TicketingPageState extends State<TicketingPage> {
  /// Preferred hub label order for fares / display; all deployed admin locations still appear (see [_terminalCoveragesOrdered]).
  static const List<String> _terminalHubOrder = [
    'Maramag',
    'Valencia',
    'Malaybalay',
    'Don Carlos',
  ];

  static const Color _kMint = Color(0xFF5EE396);
  static const Color _kOcean = Color(0xFF38BDF8);
  /// Toast surface — slate-900 @ 80% opacity (non-blocking floating success).
  static final Color _kToastBg = const Color(0xFF111827).withValues(alpha: 0.8);

  final _api = ApiClient();
  final _from = TextEditingController();
  final _to = TextEditingController();
  final _fare = TextEditingController(text: '');
  String _category = 'regular';
  bool _saving = false;
  bool _loadingTerminals = false;
  String? _terminalLoadError;
  List<ApiRouteCoverage> _terminalCoverages = const [];
  String? _routeAreaSummary;

  _TripLeg _tripLeg = _TripLeg.none;
  ApiRouteCoverage? _fromCoverage;
  ApiRouteCoverage? _toCoverage;

  String? _activeEditToken;
  String? _editingTicketId;
  String? _driverVoucheeName;
  String? _lastConsumedBootstrapSig;

  int _fareQuoteGen = 0;
  bool _fareQuoteLoading = false;
  String? _fareQuoteError;
  /// From `/api/fares/quote`: human-readable how the fare was computed.
  String? _fareQuoteExplanation;

  String _normalizeCategory(String raw) {
    final x = raw.toLowerCase().trim();
    const allowed = {'regular', 'student', 'pwd', 'senior'};
    if (allowed.contains(x)) return x;
    return 'regular';
  }

  void _consumeBootstrapIfNeeded() {
    final b = widget.editBootstrap;
    if (b == null) return;
    final sig = '${b.ticket.id}|${b.editToken}';
    if (_lastConsumedBootstrapSig == sig) return;
    _lastConsumedBootstrapSig = sig;

    final captured = b;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      setState(() {
        _activeEditToken = captured.editToken;
        _editingTicketId = captured.ticket.id;
        _driverVoucheeName = captured.driverName;
        _from.text = captured.ticket.from;
        _to.text = captured.ticket.to;
        _fare.text = captured.ticket.fare.toStringAsFixed(2);
        _category = _normalizeCategory(captured.ticket.category);
        _fromCoverage = null;
        _toCoverage = null;
        _tripLeg = _TripLeg.none;
        _routeAreaSummary = null;
        _fareQuoteError = null;
        _fareQuoteExplanation = null;
      });
      widget.onEditBootstrapConsumed?.call();
    });
  }

  void _clearCorrectionMode() {
    setState(() {
      _activeEditToken = null;
      _editingTicketId = null;
      _driverVoucheeName = null;
      _lastConsumedBootstrapSig = null;
      _from.clear();
      _to.clear();
      _fare.clear();
      _category = 'regular';
      _fromCoverage = null;
      _toCoverage = null;
      _routeAreaSummary = null;
      _tripLeg = _TripLeg.none;
      _fareQuoteError = null;
      _fareQuoteExplanation = null;
    });
  }

  bool get _editMode => _activeEditToken != null && _activeEditToken!.isNotEmpty;

  @override
  void initState() {
    super.initState();
    _loadTerminalCoverages();
    _consumeBootstrapIfNeeded();
  }

  @override
  void didUpdateWidget(covariant TicketingPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.editBootstrap != oldWidget.editBootstrap) {
      _consumeBootstrapIfNeeded();
    }
  }

  @override
  void dispose() {
    _from.dispose();
    _to.dispose();
    _fare.dispose();
    super.dispose();
  }

  void _showIssuedSuccessGlow(ApiIssuedTicket ticket) {
    final overlay = Overlay.of(context, rootOverlay: true);
    late OverlayEntry entry;
    var dismissed = false;
    void dismiss() {
      if (dismissed) return;
      dismissed = true;
      entry.remove();
    }

    final codeLabel =
        ticket.ticketCode.trim().isEmpty ? '#${ticket.id}' : ticket.ticketCode.trim();

    entry = OverlayEntry(
      builder: (ctx) {
        // Sit above bottom navigation (main shell uses height 72).
        final bottomPad = MediaQuery.paddingOf(ctx).bottom + 80;

        return Stack(
          clipBehavior: Clip.none,
          children: [
            Positioned(
              left: 16,
              right: 16,
              bottom: bottomPad,
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 520),
                  child: Material(
                    color: Colors.transparent,
                    child: Container(
                      padding: const EdgeInsets.fromLTRB(12, 10, 4, 10),
                      decoration: BoxDecoration(
                        color: _kToastBg,
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(color: _kMint, width: 1),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withValues(alpha: 0.4),
                            blurRadius: 20,
                            offset: const Offset(0, 6),
                          ),
                        ],
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.center,
                        children: [
                          const Padding(
                            padding: EdgeInsets.only(left: 4),
                            child: Icon(Icons.check_circle_rounded, color: _kMint, size: 22),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Ticket $codeLabel issued',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontWeight: FontWeight.w800,
                                    fontSize: 14,
                                    height: 1.2,
                                  ),
                                ),
                                Text(
                                  '${ticket.from} → ${ticket.to} · ₱${ticket.fare.toStringAsFixed(2)}',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    color: Colors.white.withValues(alpha: 0.7),
                                    fontSize: 11,
                                    height: 1.2,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          TextButton(
                            style: TextButton.styleFrom(
                              foregroundColor: _kMint,
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              minimumSize: Size.zero,
                              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                            ),
                            onPressed: () {
                              dismiss();
                              widget.onFocusPassengerTickets?.call();
                            },
                            child: const Text('UNDO', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 12)),
                          ),
                          TextButton(
                            style: TextButton.styleFrom(
                              foregroundColor: _kMint,
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              minimumSize: Size.zero,
                              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                            ),
                            onPressed: () {
                              Share.share(
                                'Ticket ${ticket.ticketCode}\n${ticket.from} → ${ticket.to}\n₱${ticket.fare.toStringAsFixed(2)}',
                              );
                            },
                            child: const Text('PRINT', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 12)),
                          ),
                          IconButton(
                            visualDensity: VisualDensity.compact,
                            onPressed: dismiss,
                            icon: Icon(Icons.close_rounded, color: Colors.white.withValues(alpha: 0.55), size: 20),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        );
      },
    );
    overlay.insert(entry);
    Future.delayed(const Duration(seconds: 4), dismiss);
  }

  void _showCorrectionSuccessGlow(String ticketId, String from, String to, double fare) {
    final overlay = Overlay.of(context, rootOverlay: true);
    late OverlayEntry entry;
    var dismissed = false;
    void dismiss() {
      if (dismissed) return;
      dismissed = true;
      entry.remove();
    }

    final shortId =
        ticketId.length > 10 ? '${ticketId.substring(0, 6)}…${ticketId.substring(ticketId.length - 4)}' : ticketId;

    entry = OverlayEntry(
      builder: (ctx) {
        final bottomPad = MediaQuery.paddingOf(ctx).bottom + 80;
        return Stack(
          clipBehavior: Clip.none,
          children: [
            Positioned(
              left: 16,
              right: 16,
              bottom: bottomPad,
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 520),
                  child: Material(
                    color: Colors.transparent,
                    child: Container(
                      padding: const EdgeInsets.fromLTRB(12, 10, 4, 10),
                      decoration: BoxDecoration(
                        color: _kToastBg,
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(color: _kMint, width: 1),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withValues(alpha: 0.4),
                            blurRadius: 22,
                            offset: const Offset(0, 6),
                          ),
                        ],
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.center,
                        children: [
                          const Padding(
                            padding: EdgeInsets.only(left: 4),
                            child: Icon(Icons.verified_rounded, color: _kMint, size: 22),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Correction saved · $shortId',
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontWeight: FontWeight.w800,
                                    fontSize: 14,
                                    height: 1.2,
                                  ),
                                ),
                                Text(
                                  '$from → $to · ₱${fare.toStringAsFixed(2)}',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    color: Colors.white.withValues(alpha: 0.72),
                                    fontSize: 11,
                                    height: 1.2,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          TextButton(
                            style: TextButton.styleFrom(
                              foregroundColor: _kMint,
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              minimumSize: Size.zero,
                              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                            ),
                            onPressed: () {
                              dismiss();
                              widget.onFocusPassengerTickets?.call();
                            },
                            child: const Text('PASSENGERS', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 11)),
                          ),
                          IconButton(
                            visualDensity: VisualDensity.compact,
                            onPressed: dismiss,
                            icon: Icon(Icons.close_rounded, color: Colors.white.withValues(alpha: 0.55), size: 20),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        );
      },
    );
    overlay.insert(entry);
    Future.delayed(const Duration(seconds: 5), dismiss);
  }

  Future<void> _issue() async {
    final fare = double.tryParse(_fare.text.trim());
    if (_from.text.trim().isEmpty || _to.text.trim().isEmpty || fare == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Select route and fare.')));
      return;
    }
    final generatedPassengerId = 'PAX-${DateTime.now().millisecondsSinceEpoch}';
    const generatedPassengerName = 'Walk-in Passenger';
    setState(() => _saving = true);
    final r = await _api.issueTicket(
      attendantToken: widget.authToken,
      ticketingToken: widget.ticketingToken,
      passengerId: generatedPassengerId,
      passengerName: generatedPassengerName,
      from: _from.text,
      to: _to.text,
      category: _category,
      fare: fare,
      busNumber: widget.busNumber.trim().isNotEmpty ? widget.busNumber.trim() : null,
    );
    if (!mounted) return;
    setState(() {
      _saving = false;
    });
    if (r.ok && r.ticket != null) {
      widget.onTicketIssued?.call();
      _showIssuedSuccessGlow(r.ticket!);
      setState(() {
        _from.clear();
        _to.clear();
        _fare.clear();
        _fromCoverage = null;
        _toCoverage = null;
        _routeAreaSummary = null;
        _tripLeg = _TripLeg.none;
        _fareQuoteError = null;
        _fareQuoteExplanation = null;
      });
    } else {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(r.message ?? 'Issue failed')));
    }
  }

  Future<void> _saveCorrection() async {
    final fare = double.tryParse(_fare.text.trim());
    final tok = _activeEditToken;
    final tid = _editingTicketId;
    if (tok == null || tid == null || _from.text.trim().isEmpty || _to.text.trim().isEmpty || fare == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Complete route and fare before saving.')));
      return;
    }
    setState(() => _saving = true);
    final r = await _api.patchTicket(
      attendantToken: widget.authToken,
      ticketingToken: widget.ticketingToken,
      editToken: tok,
      ticketId: tid,
      startLocation: _from.text,
      destination: _to.text,
      fare: fare,
      passengerCategory: _category,
    );
    if (!mounted) return;
    setState(() => _saving = false);
    if (r.ok) {
      final from = _from.text.trim();
      final to = _to.text.trim();
      widget.onTicketCorrected?.call();
      _showCorrectionSuccessGlow(tid, from, to, fare);
      _clearCorrectionMode();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(r.message ?? 'Update failed')));
    }
  }

  Future<void> _loadTerminalCoverages() async {
    setState(() {
      _loadingTerminals = true;
      _terminalLoadError = null;
    });
    try {
      final coverages = await _api.fetchRouteCoverages(token: widget.authToken);
      final usable = coverages.where((c) => c.pickableStopLabels().isNotEmpty).toList();
      var hubsOrdered = _terminalCoveragesOrdered(usable);
      if (hubsOrdered.isEmpty) {
        hubsOrdered = _terminalHubOrder
            .map(
              (hub) => ApiRouteCoverage(
                id: 'fallback-$hub',
                locationName: hub,
                pointType: 'terminal',
                terminalName: hub,
                terminal: null,
                stops: _fallbackStopsForHub(hub),
              ),
            )
            .toList();
      }
      if (!mounted) return;
      setState(() {
        _terminalCoverages = hubsOrdered;
        _loadingTerminals = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loadingTerminals = false;
        _terminalLoadError = 'Could not load terminals: $e';
      });
    }
  }

  /// Location cards: live data from Admin Location management, or hardcoded fallbacks if the API is empty.
  List<ApiRouteCoverage> _locationRowCoverages() {
    if (_terminalCoverages.isNotEmpty) {
      return List<ApiRouteCoverage>.from(_terminalCoverages);
    }
    return _terminalHubOrder
        .map(
          (hub) => ApiRouteCoverage(
            id: 'fallback-$hub',
            locationName: hub,
            pointType: 'terminal',
            terminalName: hub,
            terminal: null,
            stops: _fallbackStopsForHub(hub),
          ),
        )
        .toList();
  }

  Widget _locationCardsRow(List<ApiRouteCoverage> row, bool tripReady) {
    if (row.isEmpty) {
      return const SizedBox(
        height: 112,
        child: Align(
          alignment: Alignment.centerLeft,
          child: Text(
            'No deployed locations yet.',
            style: TextStyle(color: Color(0xFFFFB4AB), fontSize: 12),
          ),
        ),
      );
    }
    if (row.length <= 3) {
      return SizedBox(
        height: 112,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (var i = 0; i < row.length; i++) ...[
              if (i > 0) const SizedBox(width: 8),
              Expanded(
                child: _locationSquareCard(
                  hubName: _routeHubButtonLabel(row[i]),
                  enabled: tripReady,
                  onTap: () => _onLocationCardTapped(row[i]),
                ),
              ),
            ],
          ],
        ),
      );
    }
    return SizedBox(
      height: 112,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        clipBehavior: Clip.none,
        itemCount: row.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (context, i) {
          final cov = row[i];
          return SizedBox(
            width: 102,
            child: _locationSquareCard(
              hubName: _routeHubButtonLabel(cov),
              enabled: tripReady,
              onTap: () => _onLocationCardTapped(cov),
            ),
          );
        },
      ),
    );
  }

  void _setTripLeg(_TripLeg leg) {
    setState(() => _tripLeg = leg);
  }

  void _onLocationCardTapped(ApiRouteCoverage coverage) {
    if (_loadingTerminals || _terminalLoadError != null) return;
    if (_tripLeg == _TripLeg.none) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Tap “From” or “To” first, then choose a location.')),
      );
      return;
    }
    _openStopSelectionSheet(coverage);
  }

  Future<void> _openStopSelectionSheet(ApiRouteCoverage coverage) async {
    final hub = _routeHubButtonLabel(coverage);
    final choices = coverage.pickableStopChoices(hub);
    if (choices.isEmpty) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('No terminals or stops configured for $hub.')),
        );
      }
      return;
    }

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        final bottom = MediaQuery.paddingOf(ctx).bottom;
        final maxH = (MediaQuery.sizeOf(ctx).height * 0.62).clamp(320.0, 580.0);
        return Padding(
          padding: EdgeInsets.only(bottom: bottom + 8),
          child: Align(
            alignment: Alignment.bottomCenter,
            child: ClipRRect(
              borderRadius: const BorderRadius.vertical(top: Radius.circular(22)),
              child: BackdropFilter(
                filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
                child: Container(
                  height: maxH,
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
                    border: Border.all(color: Colors.white.withValues(alpha: 0.12)),
                    borderRadius: const BorderRadius.vertical(top: Radius.circular(22)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const SizedBox(height: 10),
                      Center(
                        child: Container(
                          width: 40,
                          height: 4,
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.25),
                            borderRadius: BorderRadius.circular(2),
                          ),
                        ),
                      ),
                      Padding(
                        padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
                        child: Row(
                          children: [
                            Expanded(
                              child: Text(
                                '$hub — terminal & stops',
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 18,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                            IconButton(
                              onPressed: () => Navigator.of(ctx).pop(),
                              icon: Icon(Icons.close_rounded, color: Colors.white.withValues(alpha: 0.8)),
                            ),
                          ],
                        ),
                      ),
                      Text(
                        _tripLeg == _TripLeg.fromLeg ? 'Select origin' : 'Select destination',
                        style: TextStyle(
                          color: _kMint.withValues(alpha: 0.9),
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          letterSpacing: 0.4,
                        ),
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 8),
                      Expanded(
                        child: ListView.separated(
                          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
                          itemCount: choices.length,
                          separatorBuilder: (_, __) => const SizedBox(height: 10),
                          itemBuilder: (context, i) {
                            final ch = choices[i];
                            return Material(
                              color: const Color(0xFF1E293B),
                              borderRadius: BorderRadius.circular(14),
                              child: InkWell(
                                borderRadius: BorderRadius.circular(14),
                                onTap: () {
                                  Navigator.of(ctx).pop();
                                  _confirmStopSelection(coverage, ch.ticketLabel);
                                },
                                child: Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
                                  decoration: BoxDecoration(
                                    borderRadius: BorderRadius.circular(14),
                                    border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
                                  ),
                                  child: Row(
                                    children: [
                                      Icon(Icons.place_rounded, color: _kMint.withValues(alpha: 0.95), size: 22),
                                      const SizedBox(width: 12),
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            Text(
                                              ch.displayLabel,
                                              style: const TextStyle(
                                                color: Colors.white,
                                                fontWeight: FontWeight.w700,
                                                fontSize: 16,
                                              ),
                                            ),
                                            const SizedBox(height: 2),
                                            Text(
                                              ch.ticketLabel,
                                              style: TextStyle(
                                                color: Colors.white.withValues(alpha: 0.55),
                                                fontSize: 12,
                                                fontWeight: FontWeight.w500,
                                              ),
                                            ),
                                          ],
                                        ),
                                      ),
                                      Icon(Icons.chevron_right_rounded, color: Colors.white.withValues(alpha: 0.35)),
                                    ],
                                  ),
                                ),
                              ),
                            );
                          },
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }

  void _confirmStopSelection(ApiRouteCoverage coverage, String ticketLabel) {
    setState(() {
      if (_tripLeg == _TripLeg.fromLeg) {
        _from.text = ticketLabel;
        _fromCoverage = coverage;
      } else if (_tripLeg == _TripLeg.toLeg) {
        _to.text = ticketLabel;
        _toCoverage = coverage;
      }
      _tripLeg = _TripLeg.none;
      if (_fromCoverage != null && _toCoverage != null) {
        final a = _routeHubButtonLabel(_fromCoverage!);
        final b = _routeHubButtonLabel(_toCoverage!);
        _routeAreaSummary = '$a → $b';
      } else {
        _routeAreaSummary = null;
      }
      unawaited(_recomputeFareAsync());
    });
  }

  Future<void> _recomputeFareAsync() async {
    final fromLabel = _from.text.trim();
    final toLabel = _to.text.trim();
    if (_fromCoverage == null ||
        _toCoverage == null ||
        fromLabel.isEmpty ||
        toLabel.isEmpty ||
        fromLabel == toLabel) {
      if (mounted) {
        setState(() {
          _fareQuoteLoading = false;
          _fareQuoteError = null;
          _fareQuoteExplanation = null;
          if (!_editMode) {
            _fare.text = '';
          }
        });
      }
      return;
    }

    final gen = ++_fareQuoteGen;
    if (mounted) {
      setState(() {
        _fareQuoteLoading = true;
        _fareQuoteError = null;
        _fareQuoteExplanation = null;
      });
    }

    final r = await _api.quoteFare(
      attendantToken: widget.authToken,
      ticketingToken: widget.ticketingToken,
      startLocation: fromLabel,
      destination: toLabel,
      passengerCategory: _category,
    );

    if (!mounted || gen != _fareQuoteGen) return;

    if (r.ok && r.matched && r.fare != null) {
      final bd = r.fareBreakdownDisplay?.trim();
      final ps = r.pricingSummary?.trim();
      setState(() {
        _fareQuoteLoading = false;
        _fareQuoteError = null;
        _fare.text = r.fare!.toStringAsFixed(2);
        _fareQuoteExplanation =
            (bd != null && bd.isNotEmpty) ? bd : (ps != null && ps.isNotEmpty ? ps : null);
      });
      return;
    }

    setState(() {
      _fareQuoteLoading = false;
      _fareQuoteExplanation = null;
      if (!_editMode) {
        _fare.text = '';
      }
      _fareQuoteError = !r.ok
          ? (r.message ?? 'Could not reach fare service')
          : (r.message ?? 'No matrix fare for these hubs — add hub-to-hub fare in Admin');
    });
  }

  bool get _canPlaceTicket {
    final fare = double.tryParse(_fare.text.trim());
    final from = _from.text.trim();
    final to = _to.text.trim();
    if (_editMode) {
      return !_saving && from.isNotEmpty && to.isNotEmpty && from != to && fare != null && fare >= 0;
    }
    return !_saving &&
        !_fareQuoteLoading &&
        from.isNotEmpty &&
        to.isNotEmpty &&
        from != to &&
        !_isPlaceholder(from) &&
        !_isPlaceholder(to) &&
        fare != null &&
        fare >= 0;
  }

  bool _isPlaceholder(String v) {
    final s = v.toLowerCase();
    return s.startsWith('tap to select') || s.startsWith('select ');
  }

  List<ApiRouteCoverage> _terminalCoveragesOrdered(List<ApiRouteCoverage> usable) {
    final seen = <String>{};
    final ordered = <ApiRouteCoverage>[];
    for (final hub in _terminalHubOrder) {
      ApiRouteCoverage? found;
      for (final c in usable) {
        if (seen.contains(c.id)) continue;
        if (_locationMatchesHub(c.locationName, hub)) {
          found = c;
          break;
        }
      }
      if (found != null) {
        ordered.add(found);
        seen.add(found.id);
      }
    }
    for (final c in usable) {
      if (seen.contains(c.id)) continue;
      ordered.add(c);
      seen.add(c.id);
    }
    return ordered;
  }

  String _routeHubButtonLabel(ApiRouteCoverage c) {
    for (final hub in _terminalHubOrder) {
      if (_locationMatchesHub(c.locationName, hub)) return hub;
    }
    return c.locationName;
  }

  bool _locationMatchesHub(String locationName, String hub) {
    final a = locationName.toLowerCase().trim();
    final b = hub.toLowerCase().trim();
    if (a == b) return true;
    if (a.startsWith('$b ') || a.startsWith('$b,') || a.startsWith('$b-')) return true;
    return false;
  }

  List<ApiRouteStop> _fallbackStopsForHub(String hub) {
    final names = switch (hub) {
      'Maramag' => const <String>[
          'Dulogon',
          'CMU',
          'North Poblacion',
          'South Poblacion',
          'Panadtalan',
          'Bagontaas',
          'Kisanday',
          'Base Camp',
          'Anahawon',
          'Dagumbaan',
        ],
      'Valencia' => const <String>[
          'Poblacion',
          'Sayre Highway',
          'Bagontaas Junction',
          'Mailag',
          'Lilingayon',
          'Sinabuagan',
          'Lumbo',
          'Purok 1',
          'Purok 2',
          'Purok 3',
        ],
      'Malaybalay' => const <String>[
          'Capitol Grounds',
          'Aglayan',
          'Sumpong',
          'Casisang',
          'Simaya',
          'Barangay 9',
          'Dalwangan',
          'Managok',
          'San Jose',
          'Patpat',
        ],
      'Don Carlos' => const <String>[
          'Poblacion',
          'San Francisco',
          'Mahayahay',
          'Minsuro',
          'Kisia',
          'Bismartz',
          'Buyot',
          'Maraay',
          'Kiburiao',
          'Kipalili',
        ],
      _ => const <String>[],
    };
    return List<ApiRouteStop>.generate(
      names.length,
      (i) => ApiRouteStop(name: names[i], sequence: i + 1),
    );
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final onSurface = isDark ? MintObsidian.textPrimary : const Color(0xFF111827);
    final sectionText = isDark ? MintObsidian.textSecondary.withOpacity(0.95) : const Color(0xFF64748B);
    final locationRow = _locationRowCoverages();
    final tripReady = !_loadingTerminals && _terminalLoadError == null;

    return SafeArea(
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 22),
        children: [
          if (_editMode) ...[
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              margin: const EdgeInsets.only(bottom: 12),
              decoration: BoxDecoration(
                color: const Color(0xFF134E4A).withValues(alpha: 0.45),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: _kMint.withValues(alpha: 0.45)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(Icons.edit_note_rounded, color: _kMint.withValues(alpha: 0.95), size: 22),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'Correction mode · Ticket #${_editingTicketId ?? "—"}',
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w800,
                            fontSize: 15,
                          ),
                        ),
                      ),
                    ],
                  ),
                  if (_driverVoucheeName != null && _driverVoucheeName!.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    Text(
                      'Authorized by $_driverVoucheeName',
                      style: TextStyle(color: Colors.white.withValues(alpha: 0.75), fontSize: 12),
                    ),
                  ],
                  const SizedBox(height: 8),
                  TextButton(
                    onPressed: _saving ? null : _clearCorrectionMode,
                    style: TextButton.styleFrom(foregroundColor: const Color(0xFFFFB4AB), padding: EdgeInsets.zero),
                    child: const Text('Cancel correction', style: TextStyle(fontWeight: FontWeight.w700)),
                  ),
                ],
              ),
            ),
          ],
          _card(
            child: Column(
              children: [
                Row(
                  children: [
                    Expanded(
                      child: _tripLegButton(
                        label: 'From',
                        icon: Icons.trip_origin_rounded,
                        displayValue: _from.text.trim().isEmpty ? 'Tap to select origin' : _from.text.trim(),
                        active: _tripLeg == _TripLeg.fromLeg,
                        enabled: tripReady,
                        onTap: () => _setTripLeg(_TripLeg.fromLeg),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _tripLegButton(
                        label: 'To',
                        icon: Icons.flag_rounded,
                        displayValue: _to.text.trim().isEmpty ? 'Tap to select destination' : _to.text.trim(),
                        active: _tripLeg == _TripLeg.toLeg,
                        enabled: tripReady,
                        onTap: () => _setTripLeg(_TripLeg.toLeg),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    'Location',
                    style: t.labelMedium!.copyWith(color: sectionText),
                  ),
                ),
                const SizedBox(height: 10),
                if (_loadingTerminals)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 6),
                    child: LinearProgressIndicator(minHeight: 3),
                  )
                else if (_terminalLoadError != null)
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      _terminalLoadError!,
                      style: const TextStyle(color: Color(0xFFFFB4AB), fontSize: 12),
                    ),
                  )
                else
                  _locationCardsRow(locationRow, tripReady),
                if (_tripLeg != _TripLeg.none) ...[
                  const SizedBox(height: 8),
                  Text(
                    _tripLeg == _TripLeg.fromLeg
                        ? 'Choose a location, then a terminal or stop for origin.'
                        : 'Choose a location, then a terminal or stop for destination.',
                    style: t.bodySmall!.copyWith(color: _kMint.withValues(alpha: isDark ? 0.95 : 0.85)),
                  ),
                ],
                if (_routeAreaSummary != null && _routeAreaSummary!.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      _routeAreaSummary!,
                      style: t.bodySmall!.copyWith(color: sectionText),
                    ),
                  ),
                ],
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  value: _category,
                  style: t.bodyLarge!.copyWith(color: onSurface, fontWeight: FontWeight.w700),
                  decoration: _dec('Category', Icons.category_rounded),
                  items: const [
                    DropdownMenuItem(value: 'regular', child: Text('Regular')),
                    DropdownMenuItem(value: 'student', child: Text('Student')),
                    DropdownMenuItem(value: 'pwd', child: Text('PWD')),
                    DropdownMenuItem(value: 'senior', child: Text('Senior')),
                  ],
                  onChanged: (v) {
                    setState(() => _category = v ?? 'regular');
                    unawaited(_recomputeFareAsync());
                  },
                ),
                const SizedBox(height: 10),
                _field(
                  _fare,
                  'Fare',
                  Icons.payments_rounded,
                  readOnly: !_editMode,
                  hintText: _editMode ? 'Adjust if needed' : 'Hub fare + distance (from Admin matrix & per km)',
                  keyboard: const TextInputType.numberWithOptions(decimal: true),
                  inputFormatters: [
                    FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')),
                  ],
                ),
                if (_fareQuoteLoading) ...[
                  const SizedBox(height: 6),
                  Text(
                    'Computing fare…',
                    style: t.bodySmall!.copyWith(color: sectionText),
                  ),
                ] else if (_fareQuoteError != null && _fareQuoteError!.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text(
                    _fareQuoteError!,
                    style: const TextStyle(color: Color(0xFFFFB4AB), fontSize: 12),
                  ),
                ] else if (_fareQuoteExplanation != null && _fareQuoteExplanation!.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      _fareQuoteExplanation!,
                      style: t.bodySmall!.copyWith(
                        color: _kMint.withValues(alpha: isDark ? 0.95 : 0.88),
                        height: 1.35,
                      ),
                    ),
                  ),
                ],
                const SizedBox(height: 14),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: _canPlaceTicket ? (_editMode ? _saveCorrection : _issue) : null,
                    style: FilledButton.styleFrom(
                      minimumSize: const Size.fromHeight(48),
                      backgroundColor: _kMint,
                      foregroundColor: MintObsidian.textOnMint,
                      disabledBackgroundColor: isDark ? const Color(0xFF334155) : const Color(0xFFD1D5DB),
                      disabledForegroundColor: isDark ? const Color(0xFF94A3B8) : const Color(0xFF6B7280),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(15)),
                    ),
                    child: Text(
                      _saving
                          ? (_editMode ? 'Saving...' : 'Placing...')
                          : (_editMode ? 'Save correction' : 'Place ticket'),
                      style: t.labelLarge!.copyWith(fontWeight: FontWeight.w800),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// POS secondary trip control: dark fill, blue outline; highlights when this leg is active.
  Widget _tripLegButton({
    required String label,
    required IconData icon,
    required String displayValue,
    required bool active,
    required bool enabled,
    required VoidCallback onTap,
  }) {
    final t = Theme.of(context).textTheme;
    final placeholder = _isPlaceholder(displayValue);
    return Opacity(
      opacity: enabled ? 1 : 0.45,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: enabled ? onTap : null,
          borderRadius: BorderRadius.circular(14),
          child: Ink(
            decoration: BoxDecoration(
              color: const Color(0xFF0F172A),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(
                color: active ? _kMint : _kOcean,
                width: active ? 2 : 1.5,
              ),
              boxShadow: active
                  ? [
                      BoxShadow(
                        color: _kMint.withValues(alpha: 0.35),
                        blurRadius: 10,
                        offset: const Offset(0, 2),
                      ),
                    ]
                  : null,
            ),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(icon, size: 18, color: active ? _kMint : _kOcean),
                    const SizedBox(width: 6),
                    Text(
                      label,
                      style: t.labelMedium!.copyWith(
                        color: Colors.white.withValues(alpha: 0.75),
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  displayValue,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: t.bodySmall!.copyWith(
                    color: placeholder ? Colors.white54 : Colors.white,
                    fontWeight: FontWeight.w700,
                    height: 1.25,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _locationSquareCard({
    required String hubName,
    required bool enabled,
    required VoidCallback onTap,
  }) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: enabled ? onTap : null,
        borderRadius: BorderRadius.circular(16),
        child: Ink(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: enabled
                  ? const [Color(0xFF1E3A5F), Color(0xFF0F172A), Color(0xFF134E4A)]
                  : [const Color(0xFF334155), const Color(0xFF1E293B)],
            ),
            border: Border.all(color: Colors.white.withValues(alpha: enabled ? 0.14 : 0.06)),
            boxShadow: enabled
                ? const [
                    BoxShadow(
                      color: Color(0x33000000),
                      blurRadius: 10,
                      offset: Offset(0, 4),
                    ),
                  ]
                : null,
          ),
          child: Center(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 6),
              child: Text(
                hubName,
                textAlign: TextAlign.center,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w800,
                  fontSize: 15,
                  height: 1.15,
                  letterSpacing: 0.2,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _card({required Widget child}) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF0F172A) : Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: isDark ? const Color(0x331F5885) : const Color(0x1A111827)),
        boxShadow: const [BoxShadow(color: Color(0x12000000), blurRadius: 12, offset: Offset(0, 4))],
      ),
      child: child,
    );
  }

  Widget _field(
    TextEditingController c,
    String label,
    IconData icon, {
    TextInputType? keyboard,
    bool readOnly = false,
    String? hintText,
    List<TextInputFormatter>? inputFormatters,
    ValueChanged<String>? onChanged,
  }) {
    return TextField(
      controller: c,
      keyboardType: keyboard,
      readOnly: readOnly,
      enableInteractiveSelection: !readOnly,
      inputFormatters: inputFormatters,
      onChanged: onChanged,
      style: Theme.of(context).textTheme.bodyLarge!.copyWith(
            color: Theme.of(context).brightness == Brightness.dark
                ? MintObsidian.textPrimary
                : const Color(0xFF111827),
            fontWeight: FontWeight.w700,
          ),
      decoration: _dec(label, icon, hintText: hintText),
    );
  }

  InputDecoration _dec(String label, IconData icon, {String? hintText}) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return InputDecoration(
      labelText: label,
      hintText: hintText,
      hintStyle: TextStyle(color: isDark ? MintObsidian.textSecondary.withOpacity(0.9) : const Color(0xFF9CA3AF), fontWeight: FontWeight.w500),
      labelStyle: TextStyle(
        color: isDark ? MintObsidian.textSecondary : const Color(0xFF475569),
        fontWeight: FontWeight.w700,
      ),
      floatingLabelStyle: const TextStyle(
        color: _kMint,
        fontWeight: FontWeight.w700,
      ),
      prefixIcon: Icon(icon, size: 20, color: _kMint),
      filled: true,
      fillColor: isDark ? MintObsidian.surfaceElevated : const Color(0xFFF3F4F6),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: isDark ? Colors.white.withOpacity(0.1) : const Color(0x1A111827)),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: isDark ? Colors.white.withOpacity(0.1) : const Color(0x1A111827)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: _kMint, width: 1.5),
      ),
    );
  }
}
