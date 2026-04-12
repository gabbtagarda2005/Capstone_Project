import 'dart:ui' show ImageFilter;

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:permission_handler/permission_handler.dart';

import '../theme/app_colors.dart';

/// Outcome of the tactical tracking pre-permission step (after attendant taps Sync).
enum LocationAccessIntroResult {
  granted,
  denied,
  serviceDisabled,
}

const Color _kMint = Color(0xFF5EE396);
const Color _kMintDeep = Color(0xFF45B376);
const Color _kMidnight = Color(0xFF011126);
const Color _kOcean = Color(0xFF1F5885);

/// Dark glass dialog aligned with password recovery / forgot-email styling.
Future<LocationAccessIntroResult?> showLocationAccessIntroDialog(BuildContext context) {
  return showDialog<LocationAccessIntroResult>(
    context: context,
    barrierDismissible: false,
    barrierColor: Colors.black.withValues(alpha: 0.55),
    builder: (ctx) => const _LocationAccessIntroDialog(),
  );
}

/// Second-step notice when permission is blocked (matches same glass theme).
Future<void> showLocationDeniedOperationsDialog(BuildContext context) {
  return showDialog<void>(
    context: context,
    barrierDismissible: true,
    barrierColor: Colors.black.withValues(alpha: 0.55),
    builder: (ctx) {
      return Dialog(
        backgroundColor: Colors.transparent,
        insetPadding: const EdgeInsets.symmetric(horizontal: 22, vertical: 24),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(22),
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 12, sigmaY: 12),
            child: Container(
              padding: const EdgeInsets.fromLTRB(22, 20, 22, 18),
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
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Icon(Icons.location_off_rounded, color: Colors.orange.shade300, size: 28),
                      const SizedBox(width: 10),
                      const Expanded(
                        child: Text(
                          'Location denied',
                          style: TextStyle(
                            color: AppColors.white,
                            fontSize: 20,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Text(
                    'You will appear as "OFFLINE" on the Management Map until location access is allowed. '
                    'You can enable it later in your browser or device settings.',
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: 0.9),
                      height: 1.45,
                      fontSize: 15,
                    ),
                  ),
                  const SizedBox(height: 20),
                  FilledButton(
                    onPressed: () => Navigator.of(ctx).pop(),
                    style: FilledButton.styleFrom(
                      backgroundColor: _kMint.withValues(alpha: 0.22),
                      foregroundColor: _kMint,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14),
                        side: BorderSide(color: _kMint.withValues(alpha: 0.5)),
                      ),
                    ),
                    child: const Text('Understood', style: TextStyle(fontWeight: FontWeight.w700)),
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

class _LocationAccessIntroDialog extends StatefulWidget {
  const _LocationAccessIntroDialog();

  @override
  State<_LocationAccessIntroDialog> createState() => _LocationAccessIntroDialogState();
}

class _LocationAccessIntroDialogState extends State<_LocationAccessIntroDialog>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulse;
  bool _busy = false;

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

  Future<void> _onSyncLocation() async {
    setState(() => _busy = true);
    try {
      final enabled = await Geolocator.isLocationServiceEnabled();
      if (!mounted) return;
      if (!enabled) {
        Navigator.of(context).pop(LocationAccessIntroResult.serviceDisabled);
        return;
      }

      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) {
        perm = await Geolocator.requestPermission();
      }
      if (!mounted) return;
      if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) {
        Navigator.of(context).pop(LocationAccessIntroResult.denied);
        return;
      }

      if (!kIsWeb) {
        await Permission.locationWhenInUse.request();
        await Permission.locationAlways.request();
      }

      try {
        if (kIsWeb) {
          await Geolocator.getCurrentPosition(
            locationSettings: WebSettings(
              accuracy: LocationAccuracy.best,
              distanceFilter: 0,
              maximumAge: Duration.zero,
              timeLimit: const Duration(seconds: 45),
            ),
          );
        } else {
          await Geolocator.getCurrentPosition(
            locationSettings: const LocationSettings(
              accuracy: LocationAccuracy.best,
              distanceFilter: 0,
              timeLimit: Duration(seconds: 35),
            ),
          );
        }
      } catch (_) {
        /* Permission granted but fix failed — still treat as granted for beacon flow */
      }

      if (mounted) Navigator.of(context).pop(LocationAccessIntroResult.granted);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: Colors.transparent,
      insetPadding: const EdgeInsets.symmetric(horizontal: 22, vertical: 24),
      child: ClipRRect(
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
                    onTap: _busy ? null : _onSyncLocation,
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
                        child: _busy
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
    );
  }
}
