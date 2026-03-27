import 'package:flutter/material.dart';

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
  String _ticketType = 'Regular';
  DateTime _date = DateTime.now();

  @override
  void dispose() {
    _from.dispose();
    _to.dispose();
    _passengers.dispose();
    super.dispose();
  }

  void _swap() {
    final a = _from.text;
    _from.text = _to.text;
    _to.text = a;
    setState(() {});
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

    return Column(
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
                      backgroundColor: AppColors.white.withValues(alpha: 0.25),
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
                    style: TextStyle(color: AppColors.white.withValues(alpha: 0.9), fontSize: 14),
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
                              iconColor: AppColors.purple,
                              label: 'From',
                              controller: _from,
                            ),
                          ),
                          Padding(
                            padding: const EdgeInsets.only(top: 20),
                            child: IconButton.filledTonal(
                              onPressed: _swap,
                              style: IconButton.styleFrom(
                                backgroundColor: AppColors.tealTop.withValues(alpha: 0.15),
                                foregroundColor: AppColors.tealDeep,
                              ),
                              icon: const Icon(Icons.swap_vert_rounded),
                            ),
                          ),
                        ],
                      ),
                      const Divider(height: 28),
                      _locationField(
                        icon: Icons.place_rounded,
                        iconColor: AppColors.tealDeep,
                        label: 'To',
                        controller: _to,
                      ),
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
                  child: const Text('SEARCH'),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  static String _formatDate(DateTime d) {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return '${days[d.weekday - 1]} ${d.day.toString().padLeft(2, '0')} ${months[d.month - 1]} ${d.year}';
  }

  Widget _whiteCard({required Widget child}) {
    return Material(
      elevation: 6,
      shadowColor: Colors.black26,
      borderRadius: BorderRadius.circular(20),
      color: AppColors.white,
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
              Text(label, style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
              TextField(
                controller: controller,
                style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16, color: AppColors.textDark),
                decoration: const InputDecoration(
                  border: UnderlineInputBorder(borderSide: BorderSide(color: AppColors.line)),
                  enabledBorder: UnderlineInputBorder(borderSide: BorderSide(color: AppColors.line)),
                  focusedBorder: UnderlineInputBorder(borderSide: BorderSide(color: AppColors.tealDeep, width: 1.5)),
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
        Icon(icon, size: 20, color: AppColors.tealDeep),
        const SizedBox(width: 12),
        Expanded(
          child: Text(label, style: const TextStyle(color: AppColors.textMuted, fontSize: 13)),
        ),
        child,
      ],
    );
  }
}
