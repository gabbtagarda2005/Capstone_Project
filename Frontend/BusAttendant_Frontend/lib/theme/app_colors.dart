import 'package:flutter/material.dart';

/// Teal / white / purple palette (bus booking reference, adapted for attendant).
abstract final class AppColors {
  static const Color tealTop = Color(0xFF14B8A6);
  static const Color tealDeep = Color(0xFF0F766E);
  static const Color tealDark = Color(0xFF115E59);
  static const Color purple = Color(0xFF7C3AED);
  static const Color purpleLight = Color(0xFF8B5CF6);
  static const Color white = Color(0xFFFFFFFF);
  static const Color offWhite = Color(0xFFF8FAFC);
  static const Color textDark = Color(0xFF0F172A);
  static const Color textMuted = Color(0xFF64748B);
  static const Color line = Color(0xFFE2E8F0);

  static const LinearGradient tealHeaderGradient = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [tealTop, tealDeep, tealDark],
  );
}
