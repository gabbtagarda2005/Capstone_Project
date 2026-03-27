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
  late Future<List<ApiPassenger>> _future;

  @override
  void initState() {
    super.initState();
    _future = _api.fetchPassengers(token: widget.authToken);
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  void _runSearch() {
    setState(() {
      _future = _api.fetchPassengers(token: widget.authToken, query: _search.text.trim());
    });
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
                hintText: 'Search passenger name or ID',
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
            child: FutureBuilder<List<ApiPassenger>>(
              future: _future,
              builder: (context, snap) {
                if (snap.connectionState != ConnectionState.done) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (snap.hasError) {
                  return const Center(child: Text('Could not load passengers'));
                }
                final items = snap.data ?? [];
                if (items.isEmpty) {
                  return const Center(child: Text('No passengers found'));
                }
                return ListView.builder(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                  itemCount: items.length,
                  itemBuilder: (context, i) {
                    final p = items[i];
                    return Container(
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
                            backgroundColor: AppColors.tealTop.withValues(alpha: 0.18),
                            child: Text(
                              p.name.isNotEmpty ? p.name[0].toUpperCase() : '?',
                              style: const TextStyle(fontWeight: FontWeight.w800, color: AppColors.tealDeep),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(p.name, style: const TextStyle(fontWeight: FontWeight.w700)),
                                Text('${p.id} • ${p.category.toUpperCase()}', style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
                                Text(p.lastTrip, style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
                              ],
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
        ],
      ),
    );
  }
}

