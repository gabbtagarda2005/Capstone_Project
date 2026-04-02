import 'package:flutter/material.dart';

import '../services/api_client.dart';
import '../theme/app_colors.dart';

class PassengerPage extends StatefulWidget {
  const PassengerPage({super.key, required this.authToken});

  final String authToken;

  @override
  State<PassengerPage> createState() => _PassengerPageState();
}

class _PassengerPageState extends State<PassengerPage> {
  final _api = ApiClient();
  final _search = TextEditingController();

  @override
  void initState() {
    super.initState();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  void _runSearch() {
    setState(() {});
  }

  String _sampleUniqueId(ApiIssuedTicket t) {
    final seed = (t.id.isNotEmpty ? t.id : t.ticketCode).replaceAll(RegExp(r'[^A-Za-z0-9]'), '');
    final short = seed.isEmpty ? '000000' : seed.padRight(6, '0').substring(0, 6).toUpperCase();
    return 'UID-$short';
  }
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
        title: const Text('Ticket details'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Code: $code', style: const TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            Text('Route: ${t.from} → ${t.to}'),
            Text('Category: ${t.category.toUpperCase()}'),
            Text('Fare: ₱${t.fare.toStringAsFixed(2)}'),
            Text('Date: $dateStr'),
            Text('Time: $timeStr'),
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
              decoration: InputDecoration(
                hintText: 'Search ticket code, route, or category',
                prefixIcon: const Icon(Icons.search_rounded),
                suffixIcon: IconButton(onPressed: _runSearch, icon: const Icon(Icons.tune_rounded)),
                filled: true,
                fillColor: Colors.white,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: AppColors.line)),
                enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: AppColors.line)),
              ),
            ),
          ),
          Expanded(
            child: FutureBuilder<List<ApiIssuedTicket>>(
              future: _api.fetchRecentTickets(token: widget.authToken),
              builder: (context, snap) {
                if (snap.connectionState != ConnectionState.done) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (snap.hasError) {
                  return const Center(child: Text('Could not load issued tickets'));
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
                  return const Center(child: Text('No issued tickets found'));
                }
                return ListView.builder(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                  itemCount: items.length,
                  itemBuilder: (context, i) {
                    final t = items[i];
                    final uid = _sampleUniqueId(t);
                                    final ts = t.createdAt;
                    final dateStr =
                        '${ts.year}-${ts.month.toString().padLeft(2, '0')}-${ts.day.toString().padLeft(2, '0')}';
                    final timeStr =
                        '${ts.hour.toString().padLeft(2, '0')}:${ts.minute.toString().padLeft(2, '0')}';
                    return InkWell(
                      borderRadius: BorderRadius.circular(16),
                      onTap: () => _showTicketDetails(t),
                      child: Container(
                        margin: const EdgeInsets.only(bottom: 10),
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(16),
                          boxShadow: const [BoxShadow(color: Color(0x12000000), blurRadius: 12, offset: Offset(0, 5))],
                        ),
                        child: Row(
                          children: [
                            CircleAvatar(
                              backgroundColor: AppColors.tealTop.withOpacity(0.18),
                              child: Text(
                                t.ticketCode.isNotEmpty ? t.ticketCode[0].toUpperCase() : '#',
                                style: const TextStyle(fontWeight: FontWeight.w800, color: AppColors.tealDeep),
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    t.ticketCode.trim().isEmpty ? t.id : t.ticketCode,
                                    style: const TextStyle(fontWeight: FontWeight.w800),
                                  ),
                                  Text(
                                    uid,
                                    style: const TextStyle(color: AppColors.textMuted, fontSize: 11),
                                  ),
                                  Text(
                                    '${t.category.toUpperCase()} • ₱${t.fare.toStringAsFixed(2)}',
                                    style: const TextStyle(color: AppColors.textMuted, fontSize: 12),
                                  ),
                                  Text(
                                    '${t.from} → ${t.to}',
                                    style: const TextStyle(color: AppColors.textMuted, fontSize: 12),
                                  ),
                                  Text(
                                    '$dateStr $timeStr',
                                    style: const TextStyle(color: AppColors.textMuted, fontSize: 11),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}






