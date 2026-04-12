import 'package:flutter/material.dart';

import '../services/api_client.dart';
import '../theme/app_colors.dart';
import '../widgets/wavy_bottom_clipper.dart';
import 'trip_list_screen.dart';

class AttendantDashboardScreen extends StatefulWidget {
  const AttendantDashboardScreen({
    super.key,
    required this.displayName,
    required this.authToken,
  });

  final String displayName;
  final String authToken;

  @override
  State<AttendantDashboardScreen> createState() => _AttendantDashboardScreenState();
}

class _AttendantDashboardScreenState extends State<AttendantDashboardScreen> {
  final _from = TextEditingController(text: 'Malaybalay');
  final _to = TextEditingController(text: 'Valencia');
  final _passengers = TextEditingController(text: '02');
  final _api = ApiClient();
  String _ticketType = 'Regular';
  DateTime _date = DateTime.now();
  List<ApiRouteCoverage> _coverages = [];
  bool _coveragesLoading = false;
  List<({String ticketLabel, String displayLabel})> _toChoices = [];

  @override
  void initState() {
    super.initState();
    _from.addListener(_syncToChoicesFromFrom);
    _loadCoverages();
  }

  static String _norm(String s) =>
      s.toLowerCase().replaceAll(RegExp(r'\s+'), ' ').trim();

  Future<void> _loadCoverages() async {
    setState(() => _coveragesLoading = true);
    try {
      final list = await _api.fetchRouteCoverages(token: widget.authToken);
      if (!mounted) return;
      setState(() {
        _coverages = list;
        _coveragesLoading = false;
      });
      _syncToChoicesFromFrom();
    } catch (_) {
      if (!mounted) return;
      setState(() => _coveragesLoading = false);
    }
  }

  ApiRouteCoverage? _hubMatchingFrom() {
    final raw = _from.text.trim();
    if (raw.isEmpty) return null;
    final q = _norm(raw);
    ApiRouteCoverage? best;
    for (final c in _coverages) {
      final ln = _norm(c.locationName);
      final term = c.terminal != null ? _norm(c.terminal!.name) : '';
      final hit = ln == q ||
          term == q ||
          ln.contains(q) ||
          q.contains(ln) ||
          (term.isNotEmpty && (term.contains(q) || q.contains(term)));
      if (hit) {
        best = c;
        if (ln == q || term == q) break;
      }
    }
    return best;
  }

  List<({String ticketLabel, String displayLabel})> _waypointChoicesForHub(ApiRouteCoverage hub) {
    final hubName = hub.locationName.trim();
    final out = <({String ticketLabel, String displayLabel})>[];
    final sorted = List<ApiRouteStop>.from(hub.stops)..sort((a, b) => a.sequence.compareTo(b.sequence));
    for (final s in sorted) {
      final d = s.name.trim();
      if (d.isEmpty) continue;
      out.add((ticketLabel: '$d ($hubName)', displayLabel: d));
    }
    if (out.isEmpty && hub.terminal != null && hub.terminal!.name.trim().isNotEmpty) {
      final d = hub.terminal!.name.trim();
      out.add((ticketLabel: '$d ($hubName)', displayLabel: d));
    }
    return out;
  }

  void _syncToChoicesFromFrom() {
    final hub = _hubMatchingFrom();
    final next = hub == null ? <({String ticketLabel, String displayLabel})>[] : _waypointChoicesForHub(hub);
    setState(() => _toChoices = next);
  }

  @override
  void dispose() {
    _from.removeListener(_syncToChoicesFromFrom);
    _from.dispose();
    _to.dispose();
    _passengers.dispose();
    super.dispose();
  }

  void _swap() {
    final a = _from.text;
    _from.text = _to.text;
    _to.text = a;
    setState(_syncToChoicesFromFrom);
  }

  Future<void> _pickDate() async {
    final d = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: DateTime.now().subtract(const Duration(days: 1)),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (d != null) setState(() => _date = d);
  }

  void _search() {
    Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (_) => TripListScreen(
          authToken: widget.authToken,
          from: _from.text.trim().isEmpty ? 'From' : _from.text.trim(),
          to: _to.text.trim().isEmpty ? 'To' : _to.text.trim(),
          date: _date,
          ticketType: _ticketType,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final dateStr = _formatDate(_date);

    return ColoredBox(
      color: MintObsidian.canvas,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
        ClipPath(
          clipper: WavyBottomClipper(),
          child: Container(
            width: double.infinity,
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 40),
            decoration: const BoxDecoration(gradient: AppColors.tealHeaderGradient),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    IconButton(
                      onPressed: () {},
                      icon: const Icon(Icons.more_horiz, color: AppColors.white),
                    ),
                    const Spacer(),
                    CircleAvatar(
                      backgroundColor: AppColors.white.withOpacity(0.25),
                      child: const Icon(Icons.person_rounded, color: AppColors.white),
                    ),
                  ],
                ),
                Padding(
                  padding: const EdgeInsets.only(left: 8),
                  child: Text(
                    'Hi, ${widget.displayName.split(' ').first}',
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                          color: AppColors.white,
                          fontWeight: FontWeight.w800,
                        ),
                  ),
                ),
                const SizedBox(height: 6),
                Padding(
                  padding: const EdgeInsets.only(left: 8),
                  child: Text(
                    'Manage my trip',
                    style: TextStyle(color: AppColors.white.withOpacity(0.9), fontSize: 14),
                  ),
                ),
              ],
            ),
          ),
        ),
        Transform.translate(
          offset: const Offset(0, -24),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _whiteCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: _locationField(
                              icon: Icons.place_rounded,
                              iconColor: MintObsidian.ocean,
                              label: 'From',
                              controller: _from,
                            ),
                          ),
                          Padding(
                            padding: const EdgeInsets.only(top: 20),
                            child: IconButton.filledTonal(
                              onPressed: _swap,
                              style: IconButton.styleFrom(
                                backgroundColor: MintObsidian.ocean.withOpacity(0.18),
                                foregroundColor: MintObsidian.ocean,
                              ),
                              icon: const Icon(Icons.swap_vert_rounded),
                            ),
                          ),
                        ],
                      ),
                      const Divider(height: 28),
                      _toDestinationBlock(),
                    ],
                  ),
                ),
                const SizedBox(height: 14),
                _whiteCard(
                  child: Column(
                    children: [
                      _detailRow(
                        icon: Icons.groups_outlined,
                        label: 'Passengers / capacity',
                        child: SizedBox(
                          width: 56,
                          child: TextField(
                            controller: _passengers,
                            keyboardType: TextInputType.number,
                            textAlign: TextAlign.center,
                            decoration: const InputDecoration(
                              isDense: true,
                              border: UnderlineInputBorder(),
                            ),
                          ),
                        ),
                      ),
                      const Divider(height: 24),
                      _detailRow(
                        icon: Icons.confirmation_number_outlined,
                        label: 'Type',
                        child: DropdownButton<String>(
                          value: _ticketType,
                          underline: const SizedBox.shrink(),
                          items: const [
                            DropdownMenuItem(value: 'Regular', child: Text('Regular')),
                            DropdownMenuItem(value: 'Student', child: Text('Student')),
                            DropdownMenuItem(value: 'PWD', child: Text('PWD')),
                            DropdownMenuItem(value: 'Senior', child: Text('Senior')),
                          ],
                          onChanged: (v) {
                            if (v != null) setState(() => _ticketType = v);
                          },
                        ),
                      ),
                      const Divider(height: 24),
                      InkWell(
                        onTap: _pickDate,
                        child: _detailRow(
                          icon: Icons.calendar_today_outlined,
                          label: 'Date',
                          child: Text(dateStr, style: const TextStyle(fontWeight: FontWeight.w600)),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 22),
                FilledButton(
                  onPressed: _search,
                  style: FilledButton.styleFrom(
                    backgroundColor: MintObsidian.mint,
                    foregroundColor: MintObsidian.textOnMint,
                  ),
                  child: const Text('SEARCH'),
                ),
              ],
            ),
          ),
        ),
      ],
      ),
    );
  }

  static String _formatDate(DateTime d) {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return '${days[d.weekday - 1]} ${d.day.toString().padLeft(2, '0')} ${months[d.month - 1]} ${d.year}';
  }

  Widget _toDestinationBlock() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _locationField(
          icon: Icons.place_rounded,
          iconColor: MintObsidian.ocean,
          label: 'To',
          controller: _to,
        ),
        if (_coveragesLoading) ...[
          const SizedBox(height: 8),
          Text(
            'Loading corridor waypoints…',
            style: TextStyle(color: MintObsidian.textSecondary.withOpacity(0.95), fontSize: 11),
          ),
        ],
        if (!_coveragesLoading && _toChoices.isNotEmpty) ...[
          const SizedBox(height: 10),
          Text(
            'Barangay / waypoint stops',
            style: TextStyle(color: MintObsidian.textSecondary, fontSize: 12, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 4),
          DropdownButton<String>(
            isDense: true,
            isExpanded: true,
            hint: const Text('Pick stop (Admin hub waypoints)'),
            underline: Container(height: 1, color: AppColors.line),
            value: _toChoices.any((c) => c.ticketLabel == _to.text.trim()) ? _to.text.trim() : null,
            items: _toChoices
                .map(
                  (c) => DropdownMenuItem<String>(
                    value: c.ticketLabel,
                    child: Text(c.displayLabel, overflow: TextOverflow.ellipsis),
                  ),
                )
                .toList(),
            onChanged: (v) {
              if (v == null) return;
              setState(() => _to.text = v);
            },
          ),
        ],
      ],
    );
  }

  Widget _whiteCard({required Widget child}) {
    return Container(
      decoration: BoxDecoration(
        color: MintObsidian.surface.withOpacity(0.92),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: Colors.white.withOpacity(0.08)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.45),
            blurRadius: 24,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: child,
      ),
    );
  }

  Widget _locationField({
    required IconData icon,
    required Color iconColor,
    required String label,
    required TextEditingController controller,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, color: iconColor, size: 22),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: TextStyle(color: MintObsidian.textSecondary, fontSize: 12)),
              TextField(
                controller: controller,
                style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16, color: MintObsidian.textPrimary),
                decoration: InputDecoration(
                  border: UnderlineInputBorder(borderSide: BorderSide(color: MintObsidian.textSecondary.withOpacity(0.35))),
                  enabledBorder: UnderlineInputBorder(borderSide: BorderSide(color: MintObsidian.textSecondary.withOpacity(0.35))),
                  focusedBorder: const UnderlineInputBorder(borderSide: BorderSide(color: MintObsidian.ocean, width: 1.5)),
                  isDense: true,
                  contentPadding: EdgeInsets.only(bottom: 6),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _detailRow({required IconData icon, required String label, required Widget child}) {
    return Row(
      children: [
        Icon(icon, size: 20, color: MintObsidian.ocean),
        const SizedBox(width: 12),
        Expanded(
          child: Text(label, style: TextStyle(color: MintObsidian.textSecondary, fontSize: 13)),
        ),
        child,
      ],
    );
  }
}
