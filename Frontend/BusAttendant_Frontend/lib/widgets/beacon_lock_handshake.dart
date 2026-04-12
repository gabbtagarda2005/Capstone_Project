import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';

import '../theme/app_colors.dart';

const Color _kMint = Color(0xFF5EE396);
const Color _kMintDeep = Color(0xFF45B376);
const Color _kMidnight = Color(0xFF011126);
const Color _kOcean = Color(0xFF1F5885);

/// Full-screen gate until live GPS beacon is active. Matches the tactical tracking card only
/// (no separate “Mandatory GPS” header or “Go live” button — sync is the single action).
class BeaconLockHandshake extends StatefulWidget {
  const BeaconLockHandshake({
    super.key,
    required this.gpsBlocked,
    required this.busy,
    required this.onSyncLocation,
  });

  final bool gpsBlocked;
  final bool busy;
  final VoidCallback onSyncLocation;

  @override
  State<BeaconLockHandshake> createState() => _BeaconLockHandshakeState();
}

class _BeaconLockHandshakeState extends State<BeaconLockHandshake>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulse;

  @override
  void initState() {
    super.initState();
    _pulse = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1100),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      color: TacticalColors.obsidian,
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(22, 24, 22, 28),
          child: Column(
            children: [
              Expanded(
                child: Center(
                  child: SingleChildScrollView(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        ClipRRect(
                          borderRadius: BorderRadius.circular(22),
                          child: BackdropFilter(
                            filter: ImageFilter.blur(sigmaX: 12, sigmaY: 12),
                            child: Container(
                              padding: const EdgeInsets.fromLTRB(22, 22, 22, 20),
                              decoration: BoxDecoration(
                                gradient: const LinearGradient(
                                  begin: Alignment.topLeft,
                                  end: Alignment.bottomRight,
                                  colors: [_kMidnight, _kOcean],
                                ),
                                borderRadius: BorderRadius.circular(22),
                                border: Border.all(color: _kOcean, width: 1),
                                boxShadow: [
                                  BoxShadow(
                                    color: Colors.black.withValues(alpha: 0.45),
                                    blurRadius: 24,
                                  ),
                                ],
                              ),
                              child: Column(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  ScaleTransition(
                                    scale: Tween<double>(begin: 0.92, end: 1.08).animate(
                                      CurvedAnimation(parent: _pulse, curve: Curves.easeInOut),
                                    ),
                                    child: Container(
                                      padding: const EdgeInsets.all(14),
                                      decoration: BoxDecoration(
                                        shape: BoxShape.circle,
                                        color: _kMint.withValues(alpha: 0.15),
                                        boxShadow: [
                                          BoxShadow(
                                            color: _kMint.withValues(alpha: 0.45),
                                            blurRadius: 18,
                                            spreadRadius: 0,
                                          ),
                                        ],
                                      ),
                                      child: const Icon(
                                        Icons.location_on_rounded,
                                        color: _kMint,
                                        size: 44,
                                      ),
                                    ),
                                  ),
                                  const SizedBox(height: 18),
                                  const Text(
                                    'Enable Tactical Tracking',
                                    textAlign: TextAlign.center,
                                    style: TextStyle(
                                      color: AppColors.white,
                                      fontSize: 22,
                                      fontWeight: FontWeight.w800,
                                      letterSpacing: 0.2,
                                    ),
                                  ),
                                  const SizedBox(height: 10),
                                  Text(
                                    'Your location is required to sync your bus with the Operations Board.',
                                    textAlign: TextAlign.center,
                                    style: TextStyle(
                                      color: Colors.white.withValues(alpha: 0.88),
                                      height: 1.45,
                                      fontSize: 15,
                                    ),
                                  ),
                                  const SizedBox(height: 24),
                                  Material(
                                    color: Colors.transparent,
                                    child: InkWell(
                                      onTap: widget.busy ? null : widget.onSyncLocation,
                                      borderRadius: BorderRadius.circular(16),
                                      child: Ink(
                                        decoration: BoxDecoration(
                                          borderRadius: BorderRadius.circular(16),
                                          gradient: const LinearGradient(
                                            begin: Alignment.topLeft,
                                            end: Alignment.bottomRight,
                                            colors: [_kMint, _kMintDeep],
                                          ),
                                          boxShadow: [
                                            BoxShadow(
                                              color: _kMint.withValues(alpha: 0.55),
                                              blurRadius: 16,
                                              offset: const Offset(0, 4),
                                            ),
                                          ],
                                        ),
                                        child: Container(
                                          width: double.infinity,
                                          padding: const EdgeInsets.symmetric(vertical: 16),
                                          alignment: Alignment.center,
                                          child: widget.busy
                                              ? const SizedBox(
                                                  height: 22,
                                                  width: 22,
                                                  child: CircularProgressIndicator(
                                                    strokeWidth: 2.5,
                                                    color: Color(0xFF0F172A),
                                                  ),
                                                )
                                              : const Text(
                                                  'Sync My Location',
                                                  style: TextStyle(
                                                    color: Color(0xFF0F172A),
                                                    fontSize: 17,
                                                    fontWeight: FontWeight.w800,
                                                    letterSpacing: 0.3,
                                                  ),
                                                ),
                                        ),
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                        if (widget.gpsBlocked) ...[
                          const SizedBox(height: 16),
                          Container(
                            padding: const EdgeInsets.all(16),
                            decoration: BoxDecoration(
                              color: TacticalColors.alertRed.withValues(alpha: 0.12),
                              border: Border.all(color: TacticalColors.alertRed.withValues(alpha: 0.85), width: 1),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Icon(Icons.gps_off_rounded, color: TacticalColors.alertRed, size: 22),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Text(
                                    'GPS connection required to start trip logs. Turn on Location Services and grant this app location access, then tap Sync My Location again.',
                                    style: TextStyle(
                                      color: Colors.white.withValues(alpha: 0.92),
                                      fontSize: 13,
                                      height: 1.35,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
