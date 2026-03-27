import 'package:flutter/material.dart';

import '../services/api_client.dart';
import '../theme/app_colors.dart';

class DashboardPage extends StatefulWidget {
  const DashboardPage({
    super.key,
    required this.displayName,
    required this.authToken,
  });

  final String displayName;
  final String authToken;

  @override
  State<DashboardPage> createState() => _DashboardPageState();
}

class _DashboardPageState extends State<DashboardPage> {
  final _api = ApiClient();
  late Future<ApiDashboardSummary> _future;

  @override
  void initState() {
    super.initState();
    _future = _api.fetchDashboardSummary(token: widget.authToken);
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: FutureBuilder<ApiDashboardSummary>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snap.hasError || !snap.hasData) {
            return const Center(child: Text('Could not load dashboard'));
          }
          final d = snap.data!;
          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 24),
            children: [
              Container(
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(
                  gradient: AppColors.tealHeaderGradient,
                  borderRadius: BorderRadius.circular(26),
                ),
                child: Row(
                  children: [
                    const CircleAvatar(
                      radius: 26,
                      backgroundColor: Color(0x33FFFFFF),
                      child: Icon(Icons.directions_bus_filled_rounded, color: AppColors.white, size: 30),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Hi ${widget.displayName.split(' ').first}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 18)),
                          Text('Bus ${d.busNumber}', style: TextStyle(color: Colors.white.withValues(alpha: 0.92))),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 14),
              _cardMetric('Today tickets', '${d.todayTickets}', Icons.confirmation_number_rounded),
              _cardMetric('Today revenue', '₱${d.todayRevenue.toStringAsFixed(2)}', Icons.payments_rounded),
              _cardMetric('Active passengers', '${d.activePassengers}', Icons.groups_rounded),
              _cardMetric('Top route', d.topRoute, Icons.route_rounded),
            ],
          );
        },
      ),
    );
  }

  Widget _cardMetric(String label, String value, IconData icon) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        boxShadow: const [BoxShadow(color: Color(0x14000000), blurRadius: 14, offset: Offset(0, 6))],
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 20,
            backgroundColor: AppColors.tealTop.withValues(alpha: 0.14),
            child: Icon(icon, color: AppColors.tealDeep),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
                const SizedBox(height: 3),
                Text(value, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

