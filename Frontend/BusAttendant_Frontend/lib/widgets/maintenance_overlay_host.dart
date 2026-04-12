import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../config/app_version.dart';
import '../services/maintenance_shield.dart';

class MaintenanceOverlayHost extends StatelessWidget {
  const MaintenanceOverlayHost({super.key, required this.child});

  final Widget? child;

  @override
  Widget build(BuildContext context) {
    return Stack(
      fit: StackFit.expand,
      children: [
        child ?? const SizedBox.shrink(),
        ListenableBuilder(
          listenable: MaintenanceShield.instance,
          builder: (context, _) {
            if (!MaintenanceShield.instance.active) {
              return const SizedBox.shrink();
            }
            return const _ObsidianMaintenanceLayer();
          },
        ),
      ],
    );
  }
}

class _ObsidianMaintenanceLayer extends StatelessWidget {
  const _ObsidianMaintenanceLayer();

  static const _amber = Color(0xFFF59E0B);

  @override
  Widget build(BuildContext context) {
    final shield = MaintenanceShield.instance;
    final updateNeeded = shield.needsAppUpdate;
    final minV = shield.minClientVersion?.trim();

    return Material(
      color: Colors.transparent,
      child: Stack(
        fit: StackFit.expand,
        children: [
          Container(color: Colors.black.withValues(alpha: 0.72)),
          Container(
            decoration: BoxDecoration(
              border: Border.all(color: _amber, width: 2),
              gradient: const LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  Color(0xFF020617),
                  Color(0xFF0F172A),
                ],
              ),
            ),
            margin: const EdgeInsets.symmetric(horizontal: 10, vertical: 28),
            padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 28),
            child: SafeArea(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Container(
                        width: 12,
                        height: 12,
                        decoration: BoxDecoration(
                          color: _amber,
                          shape: BoxShape.circle,
                          boxShadow: [
                            BoxShadow(
                              color: _amber.withValues(alpha: 0.55),
                              blurRadius: 14,
                              spreadRadius: 2,
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 12),
                      Text(
                        'SYSTEM SHIELD',
                        style: GoogleFonts.orbitron(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 3,
                          color: _amber,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 22),
                  Text(
                    shield.message.isNotEmpty
                        ? shield.message
                        : 'Bukidnon Bus Company is performing scheduled maintenance. Please try again shortly.',
                    style: GoogleFonts.inter(
                      fontSize: 15,
                      height: 1.45,
                      color: const Color(0xFFE2E8F0),
                    ),
                  ),
                  if (updateNeeded && minV != null && minV.isNotEmpty) ...[
                    const SizedBox(height: 18),
                    Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: Colors.black.withValues(alpha: 0.35),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: _amber.withValues(alpha: 0.45)),
                      ),
                      child: Text(
                        'Update required: this build is $kAppMarketingVersion. Minimum supported version is $minV.',
                        style: GoogleFonts.jetBrainsMono(
                          fontSize: 12,
                          height: 1.4,
                          color: const Color(0xFFFDE68A),
                        ),
                      ),
                    ),
                  ],
                  const Spacer(),
                  Text(
                    'This screen clears automatically when maintenance ends.',
                    textAlign: TextAlign.center,
                    style: GoogleFonts.inter(
                      fontSize: 12,
                      color: const Color(0xFF94A3B8),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
