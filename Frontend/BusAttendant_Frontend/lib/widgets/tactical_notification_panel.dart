import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';

import '../theme/app_colors.dart';
import 'tactical_pulse_dot.dart';

enum TacticalNotifCategory { routeSync, schedule, emergency, lostFound }

class TacticalNotificationItem {
  const TacticalNotificationItem({
    required this.id,
    required this.title,
    required this.body,
    required this.at,
    required this.category,
  });

  final String id;
  final String title;
  final String body;
  final DateTime at;
  final TacticalNotifCategory category;
}

Color _categoryAccent(TacticalNotifCategory c) {
  switch (c) {
    case TacticalNotifCategory.routeSync:
      return TacticalColors.neonCyan;
    case TacticalNotifCategory.schedule:
      return TacticalColors.amberSignal;
    case TacticalNotifCategory.emergency:
      return TacticalColors.alertRed;
    case TacticalNotifCategory.lostFound:
      return TacticalColors.slideOceanBlue;
  }
}

class TacticalNotificationPanel extends StatelessWidget {
  const TacticalNotificationPanel({super.key, required this.items});

  final List<TacticalNotificationItem> items;

  static Route<void> route({required List<TacticalNotificationItem> items}) {
    return PageRouteBuilder<void>(
      opaque: false,
      barrierColor: Colors.black54,
      pageBuilder: (context, animation, secondaryAnimation) {
        return TacticalNotificationPanel(items: items);
      },
      transitionsBuilder: (context, animation, secondaryAnimation, child) {
        final slide = Tween<Offset>(begin: const Offset(1, 0), end: Offset.zero).animate(
          CurvedAnimation(parent: animation, curve: Curves.easeOutCubic),
        );
        return SlideTransition(position: slide, child: child);
      },
    );
  }

  static Future<void> open(
    BuildContext context, {
    required List<TacticalNotificationItem> items,
  }) async {
    await HapticFeedback.lightImpact();
    if (!context.mounted) return;
    await Navigator.of(context).push(TacticalNotificationPanel.route(items: items));
  }

  String _timeLabel(DateTime at) {
    final h = at.hour.toString().padLeft(2, '0');
    final m = at.minute.toString().padLeft(2, '0');
    return '$h:$m';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cs = theme.colorScheme;
    final isDark = theme.brightness == Brightness.dark;
    final panelBg = isDark ? TacticalColors.obsidian : const Color(0xFFE8ECF1);
    final itemBg = isDark ? TacticalColors.obsidianElevated : Colors.white;
    final itemBorder = isDark ? TacticalColors.slideOceanBlue : const Color(0xFFCBD5E1);
    final onSurface = cs.onSurface;
    final onSurfaceVariant = cs.onSurfaceVariant;
    final w = MediaQuery.sizeOf(context).width * 0.9;
    return Align(
      alignment: Alignment.centerRight,
      child: Material(
        color: Colors.transparent,
        child: SizedBox(
          width: w,
          height: MediaQuery.sizeOf(context).height,
          child: Container(
            color: panelBg,
            child: SafeArea(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 8, 4, 12),
                    child: Row(
                      children: [
                        IconButton(
                          icon: Icon(Icons.chevron_right, color: onSurfaceVariant),
                          onPressed: () => Navigator.of(context).pop(),
                        ),
                        Expanded(
                          child: Text(
                            'Tactical feed',
                            style: GoogleFonts.inter(
                              color: onSurface,
                              fontSize: 18,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  Divider(height: 1, color: isDark ? TacticalColors.borderSubtle : const Color(0x33000000)),
                  Expanded(
                    child: items.isEmpty
                        ? Center(
                            child: Text(
                              'No notifications',
                              style: TextStyle(color: onSurfaceVariant),
                            ),
                          )
                        : ListView.separated(
                            padding: const EdgeInsets.fromLTRB(14, 16, 14, 24),
                            itemCount: items.length,
                            separatorBuilder: (_, __) => const SizedBox(height: 12),
                            itemBuilder: (context, i) {
                              final n = items[i];
                              final accent = _categoryAccent(n.category);
                              return Container(
                                padding: const EdgeInsets.all(14),
                                decoration: BoxDecoration(
                                  color: itemBg,
                                  border: Border.all(color: itemBorder, width: 1),
                                  borderRadius: BorderRadius.circular(4),
                                  boxShadow: isDark
                                      ? null
                                      : const [
                                          BoxShadow(
                                            color: Color(0x14000000),
                                            blurRadius: 8,
                                            offset: Offset(0, 2),
                                          ),
                                        ],
                                ),
                                child: Row(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Container(
                                      width: 3,
                                      height: 48,
                                      color: accent,
                                    ),
                                    const SizedBox(width: 12),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Row(
                                            crossAxisAlignment: CrossAxisAlignment.start,
                                            children: [
                                              Expanded(
                                                child: Text(
                                                  n.title,
                                                  style: TextStyle(
                                                    color: onSurface,
                                                    fontWeight: FontWeight.w700,
                                                    fontSize: 15,
                                                  ),
                                                ),
                                              ),
                                              Text(
                                                _timeLabel(n.at),
                                                style: GoogleFonts.jetBrainsMono(
                                                  color: onSurfaceVariant,
                                                  fontSize: 12,
                                                  fontWeight: FontWeight.w500,
                                                ),
                                              ),
                                            ],
                                          ),
                                          const SizedBox(height: 6),
                                          Text(
                                            n.body,
                                            style: TextStyle(
                                              color: onSurfaceVariant,
                                              fontSize: 13,
                                              height: 1.35,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ],
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
  }
}

/// Circular obsidian notification control (top-right AppBar).
class TacticalNotificationAction extends StatelessWidget {
  const TacticalNotificationAction({
    super.key,
    required this.hasActiveAlert,
    required this.onPressed,
  });

  final bool hasActiveAlert;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bg = isDark ? TacticalColors.obsidianElevated : const Color(0xFFE8EEF3);
    final borderColor = isDark ? const Color(0x1AFFFFFF) : const Color(0x22000000);
    final iconColor = Theme.of(context).colorScheme.onSurface;
    return Padding(
      padding: const EdgeInsets.only(right: 12),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onPressed,
          child: Container(
            width: 46,
            height: 46,
            decoration: BoxDecoration(
              color: bg,
              shape: BoxShape.circle,
              border: Border.all(color: borderColor, width: 1),
            ),
            child: Stack(
              clipBehavior: Clip.none,
              alignment: Alignment.center,
              children: [
                Icon(Icons.notifications_none_outlined, color: iconColor, size: 22),
                if (hasActiveAlert)
                  const Positioned(
                    right: 10,
                    top: 10,
                    child: PulsingRedAlertDot(size: 8),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
