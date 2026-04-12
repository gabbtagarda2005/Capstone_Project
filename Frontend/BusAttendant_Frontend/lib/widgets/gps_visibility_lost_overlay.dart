import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../theme/app_colors.dart';

class GpsVisibilityLostOverlay extends StatelessWidget {
  const GpsVisibilityLostOverlay({
    super.key,
    required this.onRetry,
  });

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: TacticalColors.obsidian,
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                Icons.location_off_rounded,
                size: 56,
                color: TacticalColors.alertRed.withOpacity(0.95),
              ),
              const SizedBox(height: 20),
              Text(
                'Bus visibility lost',
                textAlign: TextAlign.center,
                style: GoogleFonts.inter(
                  color: Colors.white,
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 12),
              Text(
                'Please enable GPS to continue. Ticketing and corridor map sync are locked until your position is restored.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Colors.white.withOpacity(0.78),
                  fontSize: 14,
                  height: 1.45,
                ),
              ),
              const SizedBox(height: 32),
              FilledButton(
                style: FilledButton.styleFrom(
                  backgroundColor: TacticalColors.slideOceanBlue,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 14),
                ),
                onPressed: onRetry,
                child: const Text('Retry GPS check'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
