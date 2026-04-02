import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../services/api_client.dart';
import '../theme/app_colors.dart';

class TicketingPage extends StatefulWidget {
  const TicketingPage({
    super.key,
    required this.authToken,
  });

  final String authToken;

  @override
  State<TicketingPage> createState() => _TicketingPageState();
}

class _TicketingPageState extends State<TicketingPage> {
  /// Route terminals only — fixed list; i-match sa Admin `locationName` para sa bus stops.
  static const List<String> _terminalHubOrder = [
    'Maramag',
    'Valencia',
    'Malaybalay',
    'Don Carlos',
  ];
  static const Map<String, double> _fixedFareByPair = {
    'Maramag|Valencia': 45,
    'Maramag|Malaybalay': 65,
    'Maramag|Don Carlos': 35,
    'Valencia|Malaybalay': 30,
    'Valencia|Don Carlos': 55,
    'Malaybalay|Don Carlos': 75,
  };

  final _api = ApiClient();
  final _from = TextEditingController();
  final _to = TextEditingController();
  final _fare = TextEditingController(text: '');
  String _category = 'regular';
  bool _saving = false;
  /// Short summary under "Choose route" (e.g. Maramag → Valencia).
  String? _routeAreaSummary;

  @override
  void initState() {
    super.initState();
  }

  @override
  void dispose() {
    _from.dispose();
    _to.dispose();
    _fare.dispose();
    super.dispose();
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
      token: widget.authToken,
      passengerId: generatedPassengerId,
      passengerName: generatedPassengerName,
      from: _from.text,
      to: _to.text,
      category: _category,
      fare: fare,
    );
    if (!mounted) return;
    setState(() {
      _saving = false;
    });
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(r.ok ? 'Ticket issued successfully.' : (r.message ?? 'Issue failed'))));
  }

  void _proceedToReview() {
    final fare = double.tryParse(_fare.text.trim());
    if (_from.text.trim().isEmpty || _to.text.trim().isEmpty || fare == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Select route and fare first.')),
      );
      return;
    }
    showDialog<void>(
      context: context,
      builder: (context) {
        return AlertDialog(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
          insetPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
          titlePadding: const EdgeInsets.fromLTRB(20, 20, 20, 8),
          contentPadding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
          actionsPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          title: const Text(
            'Review ticket',
            style: TextStyle(fontSize: 34, fontWeight: FontWeight.w300),
          ),
          content: SizedBox(
            width: 360,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _reviewLine('Origin', _from.text),
                const SizedBox(height: 4),
                _reviewLine('Destination', _to.text),
                const SizedBox(height: 10),
                _reviewLine('Category', _category.toUpperCase()),
                const SizedBox(height: 4),
                _reviewLine('Fare', '₱${fare.toStringAsFixed(2)}'),
              ],
            ),
          ),
          actions: [
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.of(context).pop(),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(44),
                    ),
                    child: const Text('Edit'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: FilledButton(
                    onPressed: _saving
                        ? null
                        : () {
                            Navigator.of(context).pop();
                            _issue();
                          },
                    style: FilledButton.styleFrom(
                      minimumSize: const Size.fromHeight(44),
                    ),
                    child: const Text('Confirm'),
                  ),
                ),
              ],
            ),
          ],
        );
      },
    );
  }

  Future<void> _startRouteSelection() async {
    List<ApiRouteCoverage> coverages;
    try {
      coverages = await _api.fetchRouteCoverages(token: widget.authToken);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not load places from admin: $e')),
      );
      return;
    }
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
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Admin routes unavailable. Using default terminals.')),
        );
      }
    }

    if (!mounted) return;
    final originCov = await _pickCoverage(
      context,
      title: 'Gikan — pilia ang terminal',
      items: hubsOrdered,
    );
    if (!mounted || originCov == null) return;

    final fromLabel = await _pickStopLabel(
      context,
      coverage: originCov,
      title: 'Pilia ang bus stop — ${_routeHubButtonLabel(originCov)}',
    );
    if (!mounted || fromLabel == null) return;

    final destCov = await _pickCoverage(
      context,
      title: 'Padulong — pilia ang terminal',
      items: hubsOrdered,
    );
    if (!mounted || destCov == null) return;

    final toLabel = await _pickStopLabel(
      context,
      coverage: destCov,
      title: 'Pilia ang bus stop — ${_routeHubButtonLabel(destCov)}',
    );
    if (!mounted || toLabel == null) return;

    final originHub = _routeHubButtonLabel(originCov);
    final destinationHub = _routeHubButtonLabel(destCov);
    final fare = _fareForStopPair(
      originCov: originCov,
      destinationCov: destCov,
      originHub: originHub,
      destinationHub: destinationHub,
      fromLabel: fromLabel,
      toLabel: toLabel,
    );
    setState(() {
      _from.text = fromLabel;
      _to.text = toLabel;
      _routeAreaSummary = '$originHub ? $destinationHub';
      _fare.text = fare.toStringAsFixed(2);
    });
  }

  /// Upat ra ka route hub (Maramag, Valencia, Don Carlos, Malaybalay) — walay ubang lugar.
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
    return ordered;
  }

  /// Button label sa grid — kanunay ang fixed nga ngalan sa hub.
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

  String _hubPairKey(String a, String b) {
    final sorted = [a.trim(), b.trim()]..sort();
    return '${sorted.first}|${sorted.last}';
  }

  double? _fixedFareForHubs(String fromHub, String toHub) {
    if (fromHub.trim().isEmpty || toHub.trim().isEmpty) return null;
    if (fromHub.trim() == toHub.trim()) return 20;
    return _fixedFareByPair[_hubPairKey(fromHub, toHub)];
  }

  int _stopChoiceIndex(ApiRouteCoverage cov, String hub, String ticketLabel) {
    final choices = cov.pickableStopChoices(hub);
    final idx = choices.indexWhere((c) => c.ticketLabel == ticketLabel);
    return idx < 0 ? 0 : idx;
  }

  double _fareForStopPair({
    required ApiRouteCoverage originCov,
    required ApiRouteCoverage destinationCov,
    required String originHub,
    required String destinationHub,
    required String fromLabel,
    required String toLabel,
  }) {
    final base = _fixedFareForHubs(originHub, destinationHub) ?? 50;
    final fromIdx = _stopChoiceIndex(originCov, originHub, fromLabel);
    final toIdx = _stopChoiceIndex(destinationCov, destinationHub, toLabel);

    // Per-stop matrix behavior: every stop pair gets its own computed fare.
    final stopAdjustment = (fromIdx * 1.5) + (toIdx * 1.5);
    return base + stopAdjustment;
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

  static const Color _routeSheetBg = Color(0xFFE9EEF2);

  Future<ApiRouteCoverage?> _pickCoverage(
    BuildContext context, {
    required String title,
    required List<ApiRouteCoverage> items,
  }) {
    return showModalBottomSheet<ApiRouteCoverage>(
      context: context,
      isScrollControlled: true,
      backgroundColor: _routeSheetBg,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        final bottomPad = MediaQuery.paddingOf(ctx).bottom + 8.0;
        return Padding(
          padding: EdgeInsets.only(bottom: bottomPad),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 8),
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppColors.line,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
                child: Text(
                  title,
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textDark,
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: GridView.builder(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 2,
                    mainAxisSpacing: 8,
                    crossAxisSpacing: 8,
                    childAspectRatio: 2.2,
                  ),
                  itemCount: items.length,
                  itemBuilder: (context, i) {
                    final c = items[i];
                    return OutlinedButton(
                      onPressed: () => Navigator.of(ctx).pop(c),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppColors.textDark,
                        backgroundColor: AppColors.offWhite,
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                        minimumSize: Size.zero,
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        side: const BorderSide(color: AppColors.line),
                      ),
                      child: Text(
                        _routeHubButtonLabel(c),
                        textAlign: TextAlign.center,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13, height: 1.15),
                      ),
                    );
                  },
                ),
              ),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(
                  onPressed: () => Navigator.of(ctx).pop(),
                  child: const Text('Cancel'),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  /// Kanunay mo gawas ang lista (dili na auto-pick bisan usa lang); ticket text = `CMU (Maramag)` etc.
  Future<String?> _pickStopLabel(
    BuildContext context, {
    required ApiRouteCoverage coverage,
    required String title,
  }) async {
    final hub = _routeHubButtonLabel(coverage);
    final choices = coverage.pickableStopChoices(hub);
    if (choices.isEmpty) return null;

    return showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: _routeSheetBg,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        final maxH = (MediaQuery.sizeOf(ctx).height * 0.55).clamp(300.0, 560.0);
        return SizedBox(
          height: maxH,
          child: SafeArea(
            top: false,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const SizedBox(height: 8),
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: AppColors.line,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 14, 20, 8),
                  child: Text(
                    title,
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textDark,
                    ),
                  ),
                ),
                Expanded(
                  child: ListView.separated(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                    itemCount: choices.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (context, i) {
                      final ch = choices[i];
                      return Material(
                        color: AppColors.offWhite,
                        borderRadius: BorderRadius.circular(14),
                        child: InkWell(
                          borderRadius: BorderRadius.circular(14),
                          onTap: () => Navigator.of(ctx).pop(ch.ticketLabel),
                          child: Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                            child: Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    ch.displayLabel,
                                    style: const TextStyle(
                                      fontWeight: FontWeight.w600,
                                      fontSize: 16,
                                      color: AppColors.textDark,
                                    ),
                                  ),
                                ),
                                Text(
                                  hub,
                                  style: const TextStyle(
                                    fontSize: 12,
                                    color: AppColors.textMuted,
                                    fontWeight: FontWeight.w500,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      );
                    },
                  ),
                ),
                Align(
                  alignment: Alignment.centerRight,
                  child: Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: TextButton(
                      onPressed: () => Navigator.of(ctx).pop(),
                      child: const Text('Cancel'),
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 22),
        children: [
          _card(
            child: Column(
              children: [
                Row(
                  children: [
                    Expanded(child: _field(_from, 'From', Icons.place_rounded, readOnly: true)),
                    const SizedBox(width: 8),
                    Expanded(child: _field(_to, 'To', Icons.place_outlined, readOnly: true)),
                  ],
                ),
                const SizedBox(height: 10),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton(
                        onPressed: _startRouteSelection,
                        style: FilledButton.styleFrom(
                          minimumSize: const Size.fromHeight(48),
                          backgroundColor: AppColors.purple,
                          foregroundColor: AppColors.white,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        ),
                        child: const Text(
                          'Choose route',
                          style: TextStyle(fontWeight: FontWeight.w700),
                        ),
                      ),
                    ),
                    if (_routeAreaSummary != null && _routeAreaSummary!.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      Text(
                        _routeAreaSummary!,
                        style: const TextStyle(fontSize: 12, color: AppColors.textMuted),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        value: _category,
                        style: const TextStyle(
                          color: AppColors.textDark,
                          fontWeight: FontWeight.w700,
                        ),
                        decoration: _dec('Category', Icons.category_rounded),
                        items: const [
                          DropdownMenuItem(value: 'regular', child: Text('Regular')),
                          DropdownMenuItem(value: 'student', child: Text('Student')),
                          DropdownMenuItem(value: 'pwd', child: Text('PWD')),
                          DropdownMenuItem(value: 'senior', child: Text('Senior')),
                        ],
                        onChanged: (v) => setState(() => _category = v ?? 'regular'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _field(
                        _fare,
                        'Fare',
                        Icons.payments_rounded,
                        readOnly: true,
                        hintText: 'Auto-set by route + stops',
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: _saving ? null : _proceedToReview,
                    style: FilledButton.styleFrom(
                      minimumSize: const Size.fromHeight(48),
                      backgroundColor: AppColors.purple,
                      foregroundColor: AppColors.white,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    child: const Text(
                      'Review ticket',
                      style: TextStyle(fontWeight: FontWeight.w700),
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

  Widget _reviewLine(String label, String value) {
    return RichText(
      text: TextSpan(
        style: const TextStyle(
          color: AppColors.textDark,
          fontSize: 16,
          height: 1.3,
        ),
        children: [
          TextSpan(
            text: '$label: ',
            style: const TextStyle(fontWeight: FontWeight.w500),
          ),
          TextSpan(
            text: value,
            style: const TextStyle(fontWeight: FontWeight.w400),
          ),
        ],
      ),
    );
  }

  Widget _card({required Widget child}) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        boxShadow: const [BoxShadow(color: Color(0x12000000), blurRadius: 14, offset: Offset(0, 6))],
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
      style: const TextStyle(
        color: AppColors.textDark,
        fontWeight: FontWeight.w700,
      ),
      decoration: _dec(label, icon, hintText: hintText),
    );
  }

  InputDecoration _dec(String label, IconData icon, {String? hintText}) {
    return InputDecoration(
      labelText: label,
      hintText: hintText,
      hintStyle: const TextStyle(color: AppColors.textMuted, fontWeight: FontWeight.w500),
      labelStyle: const TextStyle(
        color: AppColors.textDark,
        fontWeight: FontWeight.w700,
      ),
      floatingLabelStyle: const TextStyle(
        color: AppColors.textDark,
        fontWeight: FontWeight.w700,
      ),
      prefixIcon: Icon(icon, size: 20, color: AppColors.textDark),
      filled: true,
      fillColor: AppColors.offWhite,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: AppColors.line)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: AppColors.line)),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: AppColors.tealDeep, width: 1.5)),
    );
  }
}





















