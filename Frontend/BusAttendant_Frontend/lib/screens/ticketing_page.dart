import 'package:flutter/material.dart';

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
  final _api = ApiClient();
  final _pid = TextEditingController();
  final _name = TextEditingController();
  final _from = TextEditingController(text: 'Location 1');
  final _to = TextEditingController(text: 'Location 2');
  final _fare = TextEditingController(text: '45');
  String _category = 'regular';
  bool _saving = false;
  late Future<List<ApiIssuedTicket>> _ticketsFuture;

  @override
  void initState() {
    super.initState();
    _ticketsFuture = _api.fetchRecentTickets(token: widget.authToken);
  }

  @override
  void dispose() {
    _pid.dispose();
    _name.dispose();
    _from.dispose();
    _to.dispose();
    _fare.dispose();
    super.dispose();
  }

  Future<void> _issue() async {
    final fare = double.tryParse(_fare.text.trim());
    if (_pid.text.trim().isEmpty || _name.text.trim().isEmpty || _from.text.trim().isEmpty || _to.text.trim().isEmpty || fare == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Fill all ticket fields.')));
      return;
    }
    setState(() => _saving = true);
    final r = await _api.issueTicket(
      token: widget.authToken,
      passengerId: _pid.text,
      passengerName: _name.text,
      from: _from.text,
      to: _to.text,
      category: _category,
      fare: fare,
    );
    if (!mounted) return;
    setState(() {
      _saving = false;
      _ticketsFuture = _api.fetchRecentTickets(token: widget.authToken);
    });
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(r.ok ? 'Ticket issued successfully.' : (r.message ?? 'Issue failed'))));
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 22),
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              gradient: AppColors.tealHeaderGradient,
              borderRadius: BorderRadius.circular(24),
            ),
            child: const Text('Ticketing', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 20)),
          ),
          const SizedBox(height: 12),
          _card(
            child: Column(
              children: [
                _field(_pid, 'Passenger ID', Icons.badge_rounded),
                const SizedBox(height: 10),
                _field(_name, 'Passenger name', Icons.person_rounded),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(child: _field(_from, 'From', Icons.place_rounded)),
                    const SizedBox(width: 8),
                    Expanded(child: _field(_to, 'To', Icons.place_outlined)),
                  ],
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        value: _category,
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
                    Expanded(child: _field(_fare, 'Fare', Icons.payments_rounded, keyboard: TextInputType.number)),
                  ],
                ),
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: _saving ? null : _issue,
                    child: Text(_saving ? 'Saving…' : 'Issue ticket'),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          _card(
            child: FutureBuilder<List<ApiIssuedTicket>>(
              future: _ticketsFuture,
              builder: (context, snap) {
                if (snap.connectionState != ConnectionState.done) return const Padding(padding: EdgeInsets.all(18), child: Center(child: CircularProgressIndicator()));
                if (!snap.hasData || snap.data!.isEmpty) return const Padding(padding: EdgeInsets.all(8), child: Text('No recent tickets.'));
                final items = snap.data!;
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Recent issued tickets', style: TextStyle(fontWeight: FontWeight.w800)),
                    const SizedBox(height: 8),
                    for (final t in items.take(8))
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Container(
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: AppColors.offWhite,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: AppColors.line),
                          ),
                          child: Row(
                            children: [
                              Expanded(child: Text('${t.passengerName} • ${t.from} → ${t.to}', style: const TextStyle(fontSize: 12))),
                              Text('₱${t.fare.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.w800, color: AppColors.purple)),
                            ],
                          ),
                        ),
                      ),
                  ],
                );
              },
            ),
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

  Widget _field(TextEditingController c, String label, IconData icon, {TextInputType? keyboard}) {
    return TextField(
      controller: c,
      keyboardType: keyboard,
      decoration: _dec(label, icon),
    );
  }

  InputDecoration _dec(String label, IconData icon) {
    return InputDecoration(
      labelText: label,
      prefixIcon: Icon(icon, size: 20),
      filled: true,
      fillColor: AppColors.offWhite,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: AppColors.line)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: AppColors.line)),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: AppColors.tealDeep, width: 1.5)),
    );
  }
}

