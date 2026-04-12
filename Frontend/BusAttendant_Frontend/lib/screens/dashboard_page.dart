import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../services/api_client.dart';
import '../theme/app_colors.dart';

class DashboardPage extends StatefulWidget {
  const DashboardPage({
    super.key,
    required this.displayName,
    required this.authToken,
    required this.ticketingToken,
    required this.onSos,
  });

  final String displayName;
  final String authToken;
  final String ticketingToken;
  final VoidCallback onSos;

  @override
  State<DashboardPage> createState() => _DashboardPageState();
}

class _DashboardPageState extends State<DashboardPage> {
  final _api = ApiClient();
  late Future<ApiDashboardSummary> _future;
  int _focusIndex = 0;

  static const _chipLabels = ['Tickets', 'Revenue', 'Passengers', 'Corridor'];

  @override
  void initState() {
    super.initState();
    _future = _api.fetchDashboardSummary(
      token: widget.authToken,
      ticketingToken: widget.ticketingToken,
    );
  }

  String get _firstName {
    final parts = widget.displayName.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty) return 'Attendant';
    return parts.first;
  }

  String _longDate(DateTime d) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    return '${days[d.weekday - 1]}, ${months[d.month - 1]} ${d.day}, ${d.year}';
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final textPrimary = isDark ? MintObsidian.textPrimary : const Color(0xFF111827);
    final textSecondary = isDark ? MintObsidian.textSecondary : const Color(0xFF64748B);
    return ColoredBox(
      color: Theme.of(context).scaffoldBackgroundColor,
      child: FutureBuilder<ApiDashboardSummary>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return Center(
              child: CircularProgressIndicator(
                color: MintObsidian.mint,
                strokeWidth: 2.5,
              ),
            );
          }
          if (snap.hasError || !snap.hasData) {
            return Center(
              child: Text(
                'Could not load dashboard',
                style: t.bodyMedium?.copyWith(color: MintObsidian.textSecondary),
              ),
            );
          }
          final d = snap.data!;
          return SafeArea(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(20, 10, 20, 28),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text.rich(
                        TextSpan(
                          children: [
                            TextSpan(
                              text: 'Hey, ',
                              style: t.headlineMedium!.copyWith(
                                color: textPrimary,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            TextSpan(
                              text: '$_firstName!',
                              style: t.headlineMedium!.copyWith(
                                color: const Color(0xFF5EE396),
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        _longDate(DateTime.now()),
                        style: t.bodySmall!.copyWith(color: textSecondary),
                      ),
                    ],
                  ),
                  const SizedBox(height: 18),
                  _HeroStatusCard(summary: d, focusIndex: _focusIndex),
                  const SizedBox(height: 16),
                  Text(
                    'QUICK FOCUS',
                    style: t.labelSmall!.copyWith(color: textSecondary, letterSpacing: 1.2),
                  ),
                  const SizedBox(height: 10),
                  SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: List.generate(4, (i) {
                        final on = _focusIndex == i;
                        return Padding(
                          padding: EdgeInsets.only(right: i < 3 ? 10 : 0),
                          child: Material(
                            color: Colors.transparent,
                            child: InkWell(
                              onTap: () => setState(() => _focusIndex = i),
                              borderRadius: BorderRadius.circular(999),
                              child: AnimatedContainer(
                                duration: const Duration(milliseconds: 200),
                                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
                                decoration: BoxDecoration(
                                  borderRadius: BorderRadius.circular(999),
                                  gradient: on ? MintObsidian.activeTileGradient : null,
                                  color: on ? null : (isDark ? MintObsidian.surface : Colors.white),
                                  border: Border.all(
                                    color: on ? Colors.transparent : (isDark ? Colors.white.withOpacity(0.08) : const Color(0x1A111827)),
                                  ),
                                  boxShadow: on
                                      ? [
                                          BoxShadow(
                                            color: MintObsidian.mint.withOpacity(0.25),
                                            blurRadius: 10,
                                            offset: const Offset(0, 3),
                                          ),
                                        ]
                                      : null,
                                ),
                                child: Text(
                                  _chipLabels[i],
                                  style: t.labelLarge!.copyWith(
                                    color: on ? MintObsidian.textOnMint : textSecondary,
                                  ),
                                ),
                              ),
                            ),
                          ),
                        );
                      }),
                    ),
                  ),
                  const SizedBox(height: 18),
                  Text(
                    'SHIFT METRICS',
                    style: t.labelSmall!.copyWith(color: textSecondary, letterSpacing: 1.2),
                  ),
                  const SizedBox(height: 10),
                  _metricRow(
                    d,
                    leftIndex: 0,
                    rightIndex: 1,
                    leftActive: _focusIndex == 0,
                    rightActive: _focusIndex == 1,
                  ),
                  const SizedBox(height: 10),
                  _metricRow(
                    d,
                    leftIndex: 2,
                    rightIndex: 3,
                    leftActive: _focusIndex == 2,
                    rightActive: _focusIndex == 3,
                  ),
                  const SizedBox(height: 24),
                  Text(
                    'EMERGENCY',
                    style: t.labelSmall!.copyWith(color: MintObsidian.textSecondary, letterSpacing: 1.2),
                  ),
                  const SizedBox(height: 10),
                  Material(
                    color: TacticalColors.sosCrimson,
                    borderRadius: BorderRadius.circular(18),
                    child: InkWell(
                      onTap: widget.onSos,
                      borderRadius: BorderRadius.circular(18),
                      child: Container(
                        width: double.infinity,
                        padding: const EdgeInsets.symmetric(vertical: 18),
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(18),
                          border: Border.all(color: TacticalColors.alertRed, width: 1.5),
                          boxShadow: [
                            BoxShadow(
                              color: TacticalColors.alertRed.withValues(alpha: 0.35),
                              blurRadius: 16,
                            ),
                          ],
                        ),
                        child: Center(
                          child: Text(
                            'SOS',
                            style: t.headlineMedium!.copyWith(
                              color: Colors.white,
                              fontWeight: FontWeight.w900,
                              letterSpacing: 2,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _metricRow(
    ApiDashboardSummary d, {
    required int leftIndex,
    required int rightIndex,
    required bool leftActive,
    required bool rightActive,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: _DashTile(
            active: leftActive,
            icon: _iconFor(leftIndex),
            title: _tileTitle(leftIndex),
            value: _tileValue(d, leftIndex),
            subtitle: _tileSubtitle(leftIndex),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _DashTile(
            active: rightActive,
            icon: _iconFor(rightIndex),
            title: _tileTitle(rightIndex),
            value: _tileValue(d, rightIndex),
            subtitle: _tileSubtitle(rightIndex),
          ),
        ),
      ],
    );
  }

  IconData _iconFor(int i) {
    switch (i) {
      case 0:
        return Icons.confirmation_number_rounded;
      case 1:
        return Icons.payments_rounded;
      case 2:
        return Icons.groups_rounded;
      default:
        return Icons.route_rounded;
    }
  }

  String _tileTitle(int i) {
    switch (i) {
      case 0:
        return 'Today tickets';
      case 1:
        return 'Revenue';
      case 2:
        return 'Passengers';
      default:
        return 'Top corridor';
    }
  }

  String _tileValue(ApiDashboardSummary d, int i) {
    switch (i) {
      case 0:
        return '${d.todayTickets}';
      case 1:
        return '₱${d.todayRevenue.toStringAsFixed(0)}';
      case 2:
        return '${d.activePassengers}';
      default:
        return d.topRoute.length > 14 ? '${d.topRoute.substring(0, 12)}…' : d.topRoute;
    }
  }

  String _tileSubtitle(int i) {
    switch (i) {
      case 0:
        return 'Issued today';
      case 1:
        return 'Gross shift';
      case 2:
        return 'Active on bus';
      default:
        return 'By fare volume';
    }
  }
}

class _HeroStatusCard extends StatelessWidget {
  const _HeroStatusCard({required this.summary, required this.focusIndex});

  final ApiDashboardSummary summary;
  final int focusIndex;

  String _heroLabel() {
    switch (focusIndex) {
      case 0:
        return 'Tickets today';
      case 1:
        return 'Revenue today';
      case 2:
        return 'Passengers';
      default:
        return 'Primary corridor';
    }
  }

  String _heroMain() {
    switch (focusIndex) {
      case 0:
        return '${summary.todayTickets}';
      case 1:
        return '₱${summary.todayRevenue.toStringAsFixed(2)}';
      case 2:
        return '${summary.activePassengers}';
      default:
        return summary.topRoute;
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final heroGradient = isDark
        ? MintObsidian.heroGradient
        : const LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [Color(0xFFDBEAFE), Color(0xFFBFDBFE)],
          );
    final heroText = isDark ? MintObsidian.heroForeground : const Color(0xFF0F172A);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(18, 18, 18, 16),
      decoration: BoxDecoration(
        gradient: heroGradient,
        borderRadius: BorderRadius.circular(24),
        boxShadow: [
          BoxShadow(
            color: (isDark ? MintObsidian.heroGlow : const Color(0x331D4ED8)),
            blurRadius: 24,
            spreadRadius: -2,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'SHIFT PULSE',
                style: t.labelSmall!.copyWith(
                  letterSpacing: 1.4,
                  color: heroText.withOpacity(0.65),
                ),
              ),
              Icon(Icons.directions_bus_filled_rounded, color: heroText.withOpacity(0.5), size: 28),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            _heroMain(),
            style: t.displaySmall!.copyWith(color: heroText),
          ),
          const SizedBox(height: 4),
          Text(
            _heroLabel(),
            style: t.titleMedium!.copyWith(color: heroText.withOpacity(0.82)),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: _HeroMini(
                  label: 'TKT',
                  value: '${summary.todayTickets}',
                  mono: true,
                ),
              ),
              Expanded(
                child: _HeroMini(
                  label: 'PHP',
                  value: summary.todayRevenue >= 1000
                      ? '${(summary.todayRevenue / 1000).toStringAsFixed(1)}k'
                      : summary.todayRevenue.toStringAsFixed(0),
                  mono: true,
                ),
              ),
              Expanded(
                child: _HeroMini(
                  label: 'PAX',
                  value: '${summary.activePassengers}',
                  mono: true,
                ),
              ),
              Expanded(
                child: _HeroMini(
                  label: 'RT',
                  value: summary.topRoute.length > 8 ? '${summary.topRoute.substring(0, 6)}…' : summary.topRoute,
                  mono: false,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _HeroMini extends StatelessWidget {
  const _HeroMini({required this.label, required this.value, required this.mono});

  final String label;
  final String value;
  final bool mono;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final heroText = isDark ? MintObsidian.heroForeground : const Color(0xFF0F172A);
    final vStyle = mono
        ? GoogleFonts.jetBrainsMono(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: heroText.withOpacity(0.95),
          )
        : t.labelMedium!.copyWith(
            fontWeight: FontWeight.w700,
            color: heroText.withOpacity(0.9),
          );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: GoogleFonts.jetBrainsMono(
            fontSize: 9,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.8,
            color: heroText.withOpacity(0.55),
          ),
        ),
        const SizedBox(height: 2),
        Text(value, style: vStyle, maxLines: 1, overflow: TextOverflow.ellipsis),
      ],
    );
  }
}

class _DashTile extends StatelessWidget {
  const _DashTile({
    required this.active,
    required this.icon,
    required this.title,
    required this.value,
    required this.subtitle,
  });

  final bool active;
  final IconData icon;
  final String title;
  final String value;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final titleColor = active
        ? MintObsidian.textOnMint.withOpacity(0.65)
        : (isDark ? MintObsidian.textSecondary : const Color(0xFF64748B));
    final valueColor = active ? MintObsidian.textOnMint : (isDark ? MintObsidian.textPrimary : const Color(0xFF111827));
    final subColor = active
        ? MintObsidian.textOnMint.withOpacity(0.55)
        : (isDark ? MintObsidian.textSecondary : const Color(0xFF6B7280));

    return SizedBox(
      height: 154,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 220),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          gradient: active ? MintObsidian.activeTileGradient : null,
          color: active ? null : (isDark ? MintObsidian.surface : Colors.white),
          borderRadius: BorderRadius.circular(22),
          border: Border.all(color: active ? Colors.white.withOpacity(0.12) : (isDark ? Colors.white.withOpacity(0.06) : const Color(0x1A111827))),
          boxShadow: active
              ? MintObsidian.tileShadow(active)
              : [
                  BoxShadow(
                    color: isDark ? Colors.black.withOpacity(0.45) : const Color(0x14000000),
                    blurRadius: 12,
                    offset: const Offset(0, 4),
                  ),
                ],
        ),
        child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                icon,
                size: 26,
                color: active ? MintObsidian.textOnMint.withOpacity(0.85) : (isDark ? MintObsidian.textSecondary : const Color(0xFF64748B)),
              ),
              const Spacer(),
              if (active)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: MintObsidian.textOnMint.withOpacity(0.12),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    'FOCUS',
                    style: GoogleFonts.jetBrainsMono(
                      fontSize: 9,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.6,
                      color: MintObsidian.textOnMint.withOpacity(0.85),
                    ),
                  ),
                ),
            ],
          ),
          const Spacer(),
          Text(
            title.toUpperCase(),
            style: GoogleFonts.jetBrainsMono(
              fontSize: 9,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.9,
              color: titleColor,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            value,
            style: t.titleLarge!.copyWith(height: 1.1, color: valueColor),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: 4),
          Text(
            subtitle,
            style: t.labelMedium!.copyWith(
              fontSize: 11,
              fontWeight: FontWeight.w500,
              color: subColor,
            ),
          ),
        ],
      ),
      ),
    );
  }
}

