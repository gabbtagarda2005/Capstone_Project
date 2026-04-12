import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../services/app_broadcast_controller.dart';

class AppBroadcastTopBanner extends StatelessWidget {
  const AppBroadcastTopBanner({super.key});

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: AppBroadcastController.instance,
      builder: (context, _) {
        final s = AppBroadcastController.instance.state;
        if (s == null || !s.visible) return const SizedBox.shrink();

        final border = switch (s.severity) {
          'critical' => const Color(0xFFF87171),
          'medium' => const Color(0xFFF59E0B),
          _ => const Color(0xFF38BDF8),
        };

        return SafeArea(
          bottom: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(10, 4, 10, 0),
            child: Material(
              color: const Color(0xFF0F172A).withValues(alpha: 0.94),
              elevation: 6,
              borderRadius: BorderRadius.circular(10),
              child: Container(
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: border, width: 1.2),
                ),
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      'OPERATIONS',
                      style: GoogleFonts.orbitron(
                        fontSize: 9,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 2,
                        color: border,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      s.message,
                      style: GoogleFonts.inter(
                        fontSize: 13,
                        height: 1.35,
                        color: const Color(0xFFE2E8F0),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}
