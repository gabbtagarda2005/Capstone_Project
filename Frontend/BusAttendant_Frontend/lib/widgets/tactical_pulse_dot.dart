import 'package:flutter/material.dart';

import '../theme/app_colors.dart';

/// Solid red “active alert” badge with a subtle breathing glow.
class PulsingRedAlertDot extends StatefulWidget {
  const PulsingRedAlertDot({super.key, this.size = 8});

  final double size;

  @override
  State<PulsingRedAlertDot> createState() => _PulsingRedAlertDotState();
}

class _PulsingRedAlertDotState extends State<PulsingRedAlertDot> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1200))
    ..repeat(reverse: true);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      builder: (context, child) {
        final t = CurvedAnimation(parent: _c, curve: Curves.easeInOut).value;
        final blur = 2.0 + t * 4;
        return Container(
          width: widget.size,
          height: widget.size,
          decoration: BoxDecoration(
            color: TacticalColors.alertRed,
            shape: BoxShape.circle,
            boxShadow: [
              BoxShadow(
                color: TacticalColors.alertRed.withOpacity(0.45 + t * 0.35),
                blurRadius: blur,
                spreadRadius: 0.5,
              ),
            ],
          ),
        );
      },
    );
  }
}

/// Status-bar style “live beacon” indicator.
class PulsingCyanBeaconDot extends StatefulWidget {
  const PulsingCyanBeaconDot({super.key, this.size = 10});

  final double size;

  @override
  State<PulsingCyanBeaconDot> createState() => _PulsingCyanBeaconDotState();
}

/// Pulsing satellite icon for “Live Syncing” corridor telemetry.
class PulsingSatelliteIcon extends StatefulWidget {
  const PulsingSatelliteIcon({super.key, this.size = 22});

  final double size;

  @override
  State<PulsingSatelliteIcon> createState() => _PulsingSatelliteIconState();
}

class _PulsingSatelliteIconState extends State<PulsingSatelliteIcon> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1100))
    ..repeat(reverse: true);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      builder: (context, child) {
        final t = CurvedAnimation(parent: _c, curve: Curves.easeInOut).value;
        final scale = 0.92 + t * 0.12;
        return Transform.scale(
          scale: scale,
          child: Icon(
            Icons.satellite_alt_rounded,
            size: widget.size,
            color: TacticalColors.neonCyan.withOpacity(0.75 + t * 0.25),
            shadows: [
              Shadow(
                color: TacticalColors.neonCyan.withOpacity(0.4 + t * 0.35),
                blurRadius: 8,
              ),
            ],
          ),
        );
      },
    );
  }
}

class _PulsingCyanBeaconDotState extends State<PulsingCyanBeaconDot> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1400))
    ..repeat(reverse: true);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      builder: (context, child) {
        final t = CurvedAnimation(parent: _c, curve: Curves.easeInOut).value;
        return Container(
          width: widget.size,
          height: widget.size,
          decoration: BoxDecoration(
            color: TacticalColors.neonCyan.withOpacity(0.85 + t * 0.15),
            shape: BoxShape.circle,
            boxShadow: [
              BoxShadow(
                color: TacticalColors.neonCyan.withOpacity(0.35 + t * 0.4),
                blurRadius: 6 + t * 4,
              ),
            ],
          ),
        );
      },
    );
  }
}
