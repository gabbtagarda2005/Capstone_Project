import 'package:flutter/material.dart';

import '../models/trip_result.dart';
import '../services/api_client.dart';
import '../theme/app_colors.dart';
import '../widgets/wavy_bottom_clipper.dart';

class TripListScreen extends StatefulWidget {
  const TripListScreen({
    super.key,
    required this.authToken,
    required this.from,
    required this.to,
    required this.date,
    this.ticketType = 'Regular',
  });

  final String authToken;
  final String from;
  final String to;
  final DateTime date;
  final String ticketType;

  @override
  State<TripListScreen> createState() => _TripListScreenState();
}

class _TripListScreenState extends State<TripListScreen> {
  final _api = ApiClient();
  late Future<List<TripResult>> _future;

  @override
  void initState() {
    super.initState();
    _future = _api.searchTrips(
      from: widget.from,
      to: widget.to,
      dateIso: widget.date.toIso8601String().split('T').first,
      token: widget.authToken,
      ticketType: widget.ticketType,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.offWhite,
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ClipPath(
            clipper: WavyBottomClipper(),
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.fromLTRB(8, 48, 16, 44),
              decoration: const BoxDecoration(gradient: AppColors.tealHeaderGradient),
              child: Row(
                children: [
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.arrow_back_ios_new_rounded, color: AppColors.white),
                  ),
                  Expanded(
                    child: Text(
                      '${widget.from}  ↔  ${widget.to}',
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                            color: AppColors.white,
                            fontWeight: FontWeight.w800,
                          ),
                    ),
                  ),
                  const SizedBox(width: 48),
                ],
              ),
            ),
          ),
          Expanded(
            child: Transform.translate(
              offset: const Offset(0, -20),
              child: FutureBuilder<List<TripResult>>(
                future: _future,
                builder: (context, snap) {
                  if (snap.connectionState != ConnectionState.done) {
                    return const Center(child: CircularProgressIndicator(color: AppColors.tealDeep));
                  }
                  if (snap.hasError) {
                    return Center(child: Text('Could not load trips.\n${snap.error}', textAlign: TextAlign.center));
                  }
                  final list = snap.data ?? [];
                  if (list.isEmpty) {
                    return const Center(child: Text('No trips for this route.'));
                  }
                  return ListView.builder(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                    itemCount: list.length,
                    itemBuilder: (context, i) => _TripCard(trip: list[i]),
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

class _TripCard extends StatelessWidget {
  const _TripCard({required this.trip});

  final TripResult trip;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 20),
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Material(
            elevation: 8,
            shadowColor: Colors.black26,
            borderRadius: BorderRadius.circular(20),
            color: AppColors.white,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(20, 28, 20, 20),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(trip.from, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                        const SizedBox(height: 4),
                        Text(trip.statusLabel, style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
                        const SizedBox(height: 12),
                        Text(trip.to, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                        const SizedBox(height: 4),
                        Text('Departure', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                      ],
                    ),
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(trip.durationLabel, style: const TextStyle(fontWeight: FontWeight.w600)),
                      const SizedBox(height: 6),
                      Text(trip.departLabel, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
                      const SizedBox(height: 8),
                      Text(
                        trip.priceLabel,
                        style: const TextStyle(
                          color: AppColors.purple,
                          fontWeight: FontWeight.w900,
                          fontSize: 18,
                        ),
                      ),
                      const SizedBox(height: 12),
                      FilledButton(
                        onPressed: () {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Open scanner / passenger list — wire to your Node API')),
                          );
                        },
                        style: FilledButton.styleFrom(
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                          textStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800),
                        ),
                        child: const Text('SCAN QR'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          Positioned(
            top: -14,
            left: 20,
            child: CircleAvatar(
              radius: 22,
              backgroundColor: AppColors.tealDeep,
              child: const Icon(Icons.directions_bus_rounded, color: AppColors.white, size: 22),
            ),
          ),
        ],
      ),
    );
  }
}
